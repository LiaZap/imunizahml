/**
 * Parser + sync da planilha de vacinas da Clínica Imuniza.
 *
 * Formato esperado (da planilha que a clinica usa):
 *   Linha 1: titulo "TABELA VACINAS UNITÁRIAS"
 *   Linha 2: header (Dinheiro/PIX, CARTAO 1X, ..., 18X)
 *   Linhas 3..N: vacinas unitarias (uma por linha)
 *   Linha N+1: divisor "PACOTES"
 *   Linhas N+2..: pacotes (estrutura diferente, ainda nao parseamos)
 *
 * O parser:
 *   - le todas as linhas
 *   - para na linha que contem "PACOTE" (case-insensitive)
 *   - extrai (nome, priceCash, parcelas por modalidade) de cada linha valida
 *   - aplica matching fuzzy contra `vaccine.slug`/`vaccine.name` do banco
 *   - upsert por slug: atualiza priceCash, priceInstallment (3x), installments
 *   - NUNCA mexe em ageMonths nem description (mantidos manualmente)
 *   - inStock: assume true (a planilha nao tem essa coluna)
 *
 * Retorna um relatorio: { matched, created, unmatched, errors }.
 */
import { prisma } from '@imuniza/db';
import { readSheet, saveSheetsConfig, loadSheetsConfig } from './googleSheets.js';

/** Normaliza string pra matching: lowercase, sem acento, sem espaços/parênteses. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // remove acentos
    .replace(/[^a-z0-9]/g, ''); // só letra+número
}

/** Converte string "R$  237,00" → 237. Retorna null se não der pra parsear. */
function parsePrice(s: string | undefined | null): number | null {
  if (!s) return null;
  const cleaned = s
    .replace(/r\$/i, '')
    .replace(/\s/g, '')
    .replace(/\./g, '') // remove separador de milhar
    .replace(/,/g, '.') // vírgula decimal → ponto
    .trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export interface SheetRowParsed {
  nameRaw: string;
  priceCash: number;
  /** Total no cartão 3x (parcelado). */
  installment3xTotal: number | null;
  /** Valor de cada parcela 3x. */
  installment3xValue: number | null;
}

const HEADER_CASH_TOKENS = ['dinheiro', 'pix', 'à vista', 'a vista'];
const HEADER_3X_TOKENS = ['3x'];

interface ColumnIndexes {
  name: number; // 0
  cash: number; // coluna do à vista
  installment3xTotal: number;
  installment3xValue: number;
}

/** Localiza os índices das colunas pelo header (linha 2). */
function detectColumns(headerRow: string[]): ColumnIndexes {
  const cols: ColumnIndexes = { name: 0, cash: -1, installment3xTotal: -1, installment3xValue: -1 };
  // O cabeçalho do CSV tem células "vazias" porque cada modalidade ocupa 2 colunas
  // (total + parcela). Ex.: header = ['', 'Dinheiro/PIX', '', '', '', 'CARTAO 1X', '', 'CARTÃO 2X', '', 'CARTÃO 3X', '', ...]
  // Achamos o "CARTÃO 3X" e a coluna da parcela é a SEGUINTE.
  for (let i = 0; i < headerRow.length; i++) {
    const lower = (headerRow[i] ?? '').toLowerCase().trim();
    if (cols.cash < 0 && HEADER_CASH_TOKENS.some((t) => lower.includes(t))) {
      cols.cash = i;
    }
    if (cols.installment3xTotal < 0 && HEADER_3X_TOKENS.some((t) => lower.includes(t))) {
      cols.installment3xTotal = i;
      cols.installment3xValue = i + 1;
      // Mas só consideramos "3x" se NÃO for "12x" ou "13x" — confere prefixo "cart" antes
      if (!/cart[aã]o\s*3x/i.test(headerRow[i] ?? '')) {
        cols.installment3xTotal = -1;
        cols.installment3xValue = -1;
      }
    }
  }
  return cols;
}

/** Parseia o CSV/values do Sheets em SheetRowParsed[]. Para na seção de pacotes. */
export function parseVaccineSheet(rows: string[][]): SheetRowParsed[] {
  // Acha linha de header (a que tem "Dinheiro/PIX" ou "Dinheiro")
  let headerIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const row = rows[i] ?? [];
    if (row.some((c) => /dinheiro|pix/i.test(c))) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) throw new Error('Header não encontrado (procurando "Dinheiro/PIX")');

  const cols = detectColumns(rows[headerIdx] ?? []);
  if (cols.cash < 0) throw new Error('Coluna "Dinheiro/PIX" não localizada no header');

  const result: SheetRowParsed[] = [];
  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const nameRaw = (row[cols.name] ?? '').trim();
    if (!nameRaw) continue;
    // Para na divisória de PACOTES
    if (/pacote/i.test(nameRaw)) break;
    const priceCash = parsePrice(row[cols.cash]);
    if (priceCash === null) continue; // linha sem preço (separador, divisor) → ignora
    const installment3xTotal =
      cols.installment3xTotal >= 0 ? parsePrice(row[cols.installment3xTotal]) : null;
    const installment3xValue =
      cols.installment3xValue >= 0 ? parsePrice(row[cols.installment3xValue]) : null;
    result.push({ nameRaw, priceCash, installment3xTotal, installment3xValue });
  }
  return result;
}

export interface SyncMatch {
  sheetName: string;
  matchedSlug: string | null;
  matchedDbName: string | null;
  priceCash: number;
  priceInstallment: number;
  installments: number;
  /** "matched" = bateu por similaridade, "exact" = nome exato, "unmatched" = não achou no banco. */
  matchType: 'exact' | 'fuzzy' | 'unmatched';
  /** Se aplicado, novo valor de priceCash do banco. */
  prevPriceCash?: number;
}

export interface SyncReport {
  total: number;
  matched: number;
  unmatched: number;
  updated: number;
  unchanged: number;
  matches: SyncMatch[];
}

/** Tenta casar nome da planilha com vacina existente no banco. */
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
  // Exact normalizado
  for (const v of all) {
    if (normalize(v.name) === target) {
      return { slug: v.slug, name: v.name, priceCash: Number(v.priceCash) };
    }
  }
  // Fuzzy: planilha contém ou é contida no nome do banco
  for (const v of all) {
    const dbNorm = normalize(v.name);
    if (dbNorm.includes(target) || target.includes(dbNorm)) {
      return { slug: v.slug, name: v.name, priceCash: Number(v.priceCash) };
    }
  }
  return null;
}

const MARKUP_3X = 1.0693;

/**
 * Roda o sync. dryRun=true só calcula o relatório sem alterar banco.
 */
export async function syncVaccinesFromSheet(
  tenantId: string,
  dryRun = false,
): Promise<SyncReport> {
  const cfg = await loadSheetsConfig(tenantId);
  if (!cfg?.spreadsheetId) throw new Error('Planilha não configurada — cole o ID em /settings');

  const rows = await readSheet(tenantId, cfg.spreadsheetId, cfg.range);
  const parsed = parseVaccineSheet(rows);

  const matches: SyncMatch[] = [];
  let updated = 0;
  let unchanged = 0;

  for (const row of parsed) {
    const match = await matchVaccine(tenantId, row.nameRaw);
    // priceInstallment de 3x: usa o que veio da planilha se válido, senão calcula via markup
    const priceInstallment =
      row.installment3xTotal && row.installment3xTotal > 0
        ? Math.round(row.installment3xTotal * 100) / 100
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
    });

    if (!dryRun) {
      const before = await prisma.vaccine.findUnique({
        where: { tenantId_slug: { tenantId, slug: match.slug } },
        select: { priceCash: true, priceInstallment: true, installments: true },
      });
      const samePrice =
        before &&
        Number(before.priceCash) === row.priceCash &&
        Number(before.priceInstallment) === priceInstallment &&
        before.installments === installments;
      if (samePrice) {
        unchanged++;
      } else {
        await prisma.vaccine.update({
          where: { tenantId_slug: { tenantId, slug: match.slug } },
          data: {
            priceCash: row.priceCash,
            priceInstallment,
            installments,
          },
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
