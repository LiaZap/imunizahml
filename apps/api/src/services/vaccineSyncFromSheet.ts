/**
 * Parser + sync da planilha de vacinas da Clínica Imuniza.
 *
 * A planilha tem 3 seções:
 *   1. Vacinas unitárias (linhas 3-29)
 *   2. Pacotes (linhas 30-52) — múltiplos pacotes, cada um com composição
 *   3. Brinco (linhas 53-54)
 *
 * O parser distingue cada tipo de linha pelo formato:
 *   - Vacina UNITÁRIA: nome + preço + coluna 3 (doses) VAZIA
 *   - HEADER de pacote: nome começa com "PACOTE DE"
 *   - ITEM de pacote: nome + preço + coluna 3 (doses) preenchida (1, 2, 3...)
 *   - TOTAL de pacote: coluna 0 (nome) VAZIA + coluna 4 (Cartão 1X) preenchida
 *     OU coluna 1 = "pix / dinheiro"
 *   - Linha de detalhamento de parcelas: começa com "1X" / "2X" na coluna 5+
 *
 * Sync:
 *   - Vacinas (incluindo brinco): upsert por slug com matching fuzzy
 *   - Pacotes: upsert em VaccinePackage por slug
 *   - NUNCA mexe em ageMonths/description (manual)
 */
import { prisma, Prisma } from '@imuniza/db';
import { readSheet, saveSheetsConfig, loadSheetsConfig } from './googleSheets.js';

function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function parsePrice(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s
    .replace(/r\$/i, '')
    .replace(/\s/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '.')
    .trim();
  if (!cleaned || cleaned === '-') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseInt0(s: string | undefined | null): number {
  if (!s) return 0;
  const n = Number(s.replace(/[^0-9]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

interface ColumnIndexes {
  name: number;
  cash: number;
  doses: number; // 3 — só usada na seção pacotes
  installment1xTotal: number; // CARTAO 1X total (col 4)
  installment3xTotal: number;
  installment3xValue: number;
}

function detectColumns(headerRow: string[]): ColumnIndexes {
  const cols: ColumnIndexes = {
    name: 0,
    cash: -1,
    doses: 3,
    installment1xTotal: -1,
    installment3xTotal: -1,
    installment3xValue: -1,
  };
  for (let i = 0; i < headerRow.length; i++) {
    const cell = (headerRow[i] ?? '').toLowerCase().trim();
    if (cols.cash < 0 && /dinheiro|pix|vista/.test(cell)) cols.cash = i;
    if (cols.installment1xTotal < 0 && /cart[aã]o\s*1x/.test(cell)) cols.installment1xTotal = i;
    if (cols.installment3xTotal < 0 && /cart[aã]o\s*3x/.test(cell)) {
      cols.installment3xTotal = i;
      cols.installment3xValue = i + 1;
    }
  }
  return cols;
}

/** Linha parseada do tipo VACINA (unitária ou item de pacote). */
export interface ParsedVaccineRow {
  nameRaw: string;
  priceCash: number;
  priceInstallment3xTotal: number | null;
  /** Se preenchido (> 0), é item de pacote — não é vacina unitária. */
  doses: number;
}

export interface ParsedPackage {
  nameRaw: string; // "PACOTE DE 2 A 6 M"
  items: Array<{ vaccineNameRaw: string; doses: number; priceCashUnit: number }>;
  /** Preço total à vista do pacote. */
  priceCash: number;
  /** Preço total 3x do pacote. */
  priceInstallment3xTotal: number | null;
}

export interface ParseResult {
  vaccines: ParsedVaccineRow[]; // só unitárias + brinco
  packages: ParsedPackage[];
}

export function parseVaccineSheet(rows: string[][]): ParseResult {
  // Header da seção unitárias
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    if ((rows[i] ?? []).some((c) => /dinheiro|pix/i.test(c))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('Header "Dinheiro/PIX" não encontrado');
  const cols = detectColumns(rows[headerIdx] ?? []);
  if (cols.cash < 0) throw new Error('Coluna preço à vista não localizada');

  const vaccines: ParsedVaccineRow[] = [];
  const packages: ParsedPackage[] = [];

  let inPackageSection = false;
  let currentPackage: ParsedPackage | null = null;
  let lastPackageHeader: string | null = null;

  const MARKUP_3X = 1.0693;
  const closeCurrentPackage = () => {
    if (!currentPackage) return;
    // Total = soma de (priceCashUnit * doses) dos itens. Confere com o valor
    // que a planilha mostra na linha de total — usar essa abordagem evita
    // depender de detecção de coluna que varia entre seções.
    const sumCash = currentPackage.items.reduce(
      (acc, it) => acc + it.priceCashUnit * it.doses,
      0,
    );
    currentPackage.priceCash = Math.round(sumCash * 100) / 100;
    currentPackage.priceInstallment3xTotal =
      Math.round(currentPackage.priceCash * MARKUP_3X * 100) / 100;
    if (currentPackage.items.length > 0 && currentPackage.priceCash > 0) {
      packages.push(currentPackage);
    }
    currentPackage = null;
  };

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const name = (row[cols.name] ?? '').trim();
    const cashStr = row[cols.cash] ?? '';
    const dosesVal = parseInt0(row[cols.doses] ?? '');
    const priceCash = parsePrice(cashStr);
    const i1xTotal =
      cols.installment1xTotal >= 0 ? parsePrice(row[cols.installment1xTotal]) : null;
    const i3xTotal =
      cols.installment3xTotal >= 0 ? parsePrice(row[cols.installment3xTotal]) : null;

    // Header geral da seção pacotes
    if (/^pacotes\s*$/i.test(name)) {
      inPackageSection = true;
      continue;
    }
    // Header de um pacote específico
    if (/^pacote\s+de\s+/i.test(name)) {
      closeCurrentPackage();
      lastPackageHeader = name;
      currentPackage = {
        nameRaw: name,
        items: [],
        priceCash: 0,
        priceInstallment3xTotal: null,
      };
      inPackageSection = true;
      continue;
    }
    // Linha de detalhamento de parcelas (tem "1X", "2X"... em alguma col) — ignora
    const hasInstallmentMarker = row.some((c) => /^\s*\d+x\s*$/i.test(c ?? ''));
    if (hasInstallmentMarker) continue;

    // Linha de TOTAL de pacote: sem nome + algum preço em qualquer coluna.
    // Fecha o pacote (o total é calculado via sumCash dos itens, não da
    // planilha, porque o layout varia entre seções).
    const anyPriceInRow = row.some((c, idx) => idx > 1 && parsePrice(c) != null);
    const isTotalRow =
      !name && currentPackage && (anyPriceInRow || /pix|dinheiro/i.test(cashStr));
    if (isTotalRow) {
      closeCurrentPackage();
      continue;
    }
    // Linha completamente vazia
    if (!name && !priceCash && !anyPriceInRow) continue;

    // Header de outra seção (nome sem preço, ex: "Brinco")
    if (name && !cashStr) {
      closeCurrentPackage();
      inPackageSection = false;
      lastPackageHeader = null;
      continue;
    }

    // A partir daqui, linha tem (name + priceCash) — é item de pacote OU vacina unitária

    // ITEM DE PACOTE: tem doses preenchidas
    if (dosesVal > 0) {
      // Se não tem pacote ativo, cria um implícito (caso do HPV 9 sem header próprio)
      if (!currentPackage) {
        currentPackage = {
          nameRaw: `Pacote ${name}`,
          items: [],
          priceCash: 0,
          priceInstallment3xTotal: null,
        };
        lastPackageHeader = currentPackage.nameRaw;
      }
      currentPackage.items.push({
        vaccineNameRaw: name,
        doses: dosesVal,
        priceCashUnit: priceCash!,
      });
      continue;
    }

    // Linha dentro da seção de pacotes mas SEM doses → órfão (não é pacote nem unitária válida)
    // Ex: "Febre Amarela R$ 136 doses=0" — preço de pacote mas sem nº doses preenchido.
    // Ignora (não vira unitária — preço com desconto não é o preço da clínica).
    if (inPackageSection && lastPackageHeader) continue;

    // VACINA UNITÁRIA (fora da seção de pacotes ou após "Brinco")
    vaccines.push({
      nameRaw: name,
      priceCash: priceCash!,
      priceInstallment3xTotal: i3xTotal,
      doses: 0,
    });
  }

  closeCurrentPackage();

  return { vaccines, packages };
}

// ───────── Matching e Sync ─────────

const MARKUP_3X = 1.0693;

async function matchVaccine(
  tenantId: string,
  nameRaw: string,
): Promise<{ slug: string; name: string; priceCash: number } | null> {
  const target = normalize(nameRaw);
  if (!target) return null;
  const all = await prisma.vaccine.findMany({
    where: { tenantId },
    select: { slug: true, name: true, priceCash: true },
  });
  for (const v of all) {
    if (normalize(v.name) === target) {
      return { slug: v.slug, name: v.name, priceCash: Number(v.priceCash) };
    }
  }
  for (const v of all) {
    const dbNorm = normalize(v.name);
    if (dbNorm.includes(target) || target.includes(dbNorm)) {
      return { slug: v.slug, name: v.name, priceCash: Number(v.priceCash) };
    }
  }
  return null;
}

async function matchPackage(
  tenantId: string,
  nameRaw: string,
): Promise<{ slug: string; name: string; priceCash: number } | null> {
  const target = normalize(nameRaw);
  if (!target) return null;
  const all = await prisma.vaccinePackage.findMany({
    where: { tenantId },
    select: { slug: true, name: true, priceCash: true },
  });
  for (const p of all) {
    if (normalize(p.name) === target) {
      return { slug: p.slug, name: p.name, priceCash: Number(p.priceCash) };
    }
  }
  for (const p of all) {
    const dbNorm = normalize(p.name);
    if (dbNorm.includes(target) || target.includes(dbNorm)) {
      return { slug: p.slug, name: p.name, priceCash: Number(p.priceCash) };
    }
  }
  return null;
}

export interface SyncMatch {
  sheetName: string;
  matchedSlug: string | null;
  matchedDbName: string | null;
  priceCash: number;
  priceInstallment: number;
  installments: number;
  matchType: 'exact' | 'fuzzy' | 'unmatched';
  prevPriceCash?: number;
  kind: 'vaccine' | 'package';
}

export interface SyncReport {
  total: number;
  matched: number;
  unmatched: number;
  updated: number;
  unchanged: number;
  matches: SyncMatch[];
}

export async function syncVaccinesFromSheet(
  tenantId: string,
  dryRun = false,
): Promise<SyncReport> {
  const cfg = await loadSheetsConfig(tenantId);
  if (!cfg?.spreadsheetId) throw new Error('Planilha não configurada — cole o ID em /settings');

  const rows = await readSheet(tenantId, cfg.spreadsheetId, cfg.range);
  const { vaccines, packages } = parseVaccineSheet(rows);

  const matches: SyncMatch[] = [];
  let updated = 0;
  let unchanged = 0;

  // Sync vacinas
  for (const row of vaccines) {
    const match = await matchVaccine(tenantId, row.nameRaw);
    const priceInstallment =
      row.priceInstallment3xTotal && row.priceInstallment3xTotal > 0
        ? Math.round(row.priceInstallment3xTotal * 100) / 100
        : Math.round(row.priceCash * MARKUP_3X * 100) / 100;
    const installments = 3;

    if (!match) {
      matches.push({
        sheetName: row.nameRaw,
        matchedSlug: null,
        matchedDbName: null,
        priceCash: row.priceCash,
        priceInstallment,
        installments,
        matchType: 'unmatched',
        kind: 'vaccine',
      });
      continue;
    }
    const matchType: SyncMatch['matchType'] =
      normalize(match.name) === normalize(row.nameRaw) ? 'exact' : 'fuzzy';
    matches.push({
      sheetName: row.nameRaw,
      matchedSlug: match.slug,
      matchedDbName: match.name,
      priceCash: row.priceCash,
      priceInstallment,
      installments,
      matchType,
      prevPriceCash: match.priceCash,
      kind: 'vaccine',
    });
    if (!dryRun) {
      const before = await prisma.vaccine.findUnique({
        where: { tenantId_slug: { tenantId, slug: match.slug } },
        select: { priceCash: true, priceInstallment: true, installments: true },
      });
      const same =
        before &&
        Number(before.priceCash) === row.priceCash &&
        Number(before.priceInstallment) === priceInstallment &&
        before.installments === installments;
      if (same) {
        unchanged++;
      } else {
        await prisma.vaccine.update({
          where: { tenantId_slug: { tenantId, slug: match.slug } },
          data: { priceCash: row.priceCash, priceInstallment, installments },
        });
        updated++;
      }
    }
  }

  // Sync pacotes
  for (const pkg of packages) {
    if (pkg.priceCash <= 0) continue; // pacote vazio ou mal parseado
    const match = await matchPackage(tenantId, pkg.nameRaw);
    const priceInstallment =
      pkg.priceInstallment3xTotal && pkg.priceInstallment3xTotal > 0
        ? Math.round(pkg.priceInstallment3xTotal * 100) / 100
        : Math.round(pkg.priceCash * MARKUP_3X * 100) / 100;
    const installments = 3;

    if (!match) {
      matches.push({
        sheetName: pkg.nameRaw,
        matchedSlug: null,
        matchedDbName: null,
        priceCash: pkg.priceCash,
        priceInstallment,
        installments,
        matchType: 'unmatched',
        kind: 'package',
      });
      continue;
    }
    const matchType: SyncMatch['matchType'] =
      normalize(match.name) === normalize(pkg.nameRaw) ? 'exact' : 'fuzzy';
    matches.push({
      sheetName: pkg.nameRaw,
      matchedSlug: match.slug,
      matchedDbName: match.name,
      priceCash: pkg.priceCash,
      priceInstallment,
      installments,
      matchType,
      prevPriceCash: match.priceCash,
      kind: 'package',
    });
    if (!dryRun) {
      const before = await prisma.vaccinePackage.findUnique({
        where: { tenantId_slug: { tenantId, slug: match.slug } },
        select: { priceCash: true, priceInstallment: true, installments: true },
      });
      const same =
        before &&
        Number(before.priceCash) === pkg.priceCash &&
        Number(before.priceInstallment) === priceInstallment &&
        before.installments === installments;
      if (same) {
        unchanged++;
      } else {
        await prisma.vaccinePackage.update({
          where: { tenantId_slug: { tenantId, slug: match.slug } },
          data: {
            priceCash: pkg.priceCash,
            priceInstallment,
            installments,
          } as Prisma.VaccinePackageUpdateInput,
        });
        updated++;
      }
    }
  }

  if (!dryRun) {
    await saveSheetsConfig(tenantId, {
      ...cfg,
      lastSyncAt: new Date().toISOString(),
      lastSyncCount: updated,
    });
  }

  return {
    total: matches.length,
    matched: matches.filter((m) => m.matchType !== 'unmatched').length,
    unmatched: matches.filter((m) => m.matchType === 'unmatched').length,
    updated,
    unchanged,
    matches,
  };
}
