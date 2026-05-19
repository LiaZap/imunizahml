/**
 * Importa a TABELA REAL DE VACINAS DA CLINICA IMUNIZA.
 * Fonte: VACINAS TABELAS DE VALORES.xlsx fornecida pelo cliente.
 *
 * - Cada vacina: priceCash (PIX/dinheiro), priceInstallment = total 18x,
 *   installments=18 (AREXVY so vai ate 5x). Idades por PNI/SBIm.
 * - 3 Pacotes (2-6m, 1a-1a6m, HPV 9 - 3 doses)
 *
 * Idempotente: usa upsert por slug.
 *
 * Uso:
 *   pnpm --filter @imuniza/db exec tsx prisma/import-real-vaccines.ts
 */
import { PrismaClient, type Prisma } from '@prisma/client';

const prisma = new PrismaClient();

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

interface VaccineRow {
  name: string;
  priceCash: number;
  priceInstallment: number; // total 18x
  installments: number;
  ageMonths: number[];
  description: string;
}

// 28 vacinas/serviços — preços PIX/dinheiro e total parcelado em 18x
const VACCINES: VaccineRow[] = [
  {
    name: 'DTPa (difteria, tétano, coqueluche)',
    priceCash: 237.00,
    priceInstallment: 290.95,
    installments: 18,
    ageMonths: [108, 120, 132], // 9–11 anos
    description:
      'Reforço da tríplice bacteriana acelular. Indicada para adolescentes (a partir de 9 anos) e gestantes a partir da 20ª semana.',
  },
  {
    name: 'DTPa-IPV (difteria, tétano, coqueluche e pólio)',
    priceCash: 239.00,
    priceInstallment: 293.40,
    installments: 18,
    ageMonths: [15, 48], // 15 meses e 4 anos
    description:
      'Reforço da DTPa combinada com poliomielite inativada. Indicada aos 15 meses e aos 4 anos.',
  },
  {
    name: 'Febre amarela',
    priceCash: 156.00,
    priceInstallment: 191.51,
    installments: 18,
    ageMonths: [9, 48],
    description:
      'Protege contra a febre amarela. Aplicada aos 9 meses, com reforço aos 4 anos. Indicada também para viagens a áreas de risco.',
  },
  {
    name: 'Febre tifoide',
    priceCash: 210.00,
    priceInstallment: 257.80,
    installments: 18,
    ageMonths: [],
    description:
      'Indicada para viajantes com destino a regiões com saneamento precário. Aplicação a partir de 2 anos.',
  },
  {
    name: 'Anti-Rh (imunoglobulina)',
    priceCash: 484.00,
    priceInstallment: 594.18,
    installments: 18,
    ageMonths: [],
    description:
      'Imunoglobulina anti-D para gestantes Rh negativo, prevenindo doença hemolítica do recém-nascido.',
  },
  {
    name: 'Abrysvo (VSR materna)',
    priceCash: 1540.00,
    priceInstallment: 1890.56,
    installments: 18,
    ageMonths: [],
    description:
      'Vacina materna contra o vírus sincicial respiratório (VSR), aplicada na gestante para proteger o bebê nos primeiros meses de vida.',
  },
  {
    name: 'Arexvy (VSR adulto)',
    priceCash: 1690.00,
    priceInstallment: 1850.78, // só tem ate 5x — usamos 5x
    installments: 5,
    ageMonths: [],
    description:
      'Vacina contra o VSR para adultos a partir de 60 anos e populações de risco.',
  },
  {
    name: 'Beyfortus (anticorpo VSR bebê)',
    priceCash: 3690.00,
    priceInstallment: 4529.97,
    installments: 18,
    ageMonths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    description:
      'Anticorpo monoclonal contra o VSR para bebês até 1 ano. Dose única (até 5kg).',
  },
  {
    name: 'Beyfortus 2 doses (acima de 5kg)',
    priceCash: 6800.00,
    priceInstallment: 8347.92,
    installments: 18,
    ageMonths: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
    description:
      'Anticorpo monoclonal anti-VSR — esquema de 2 doses para bebês acima de 5kg.',
  },
  {
    name: 'Hepatite A — adulto',
    priceCash: 276.00,
    priceInstallment: 338.83,
    installments: 18,
    ageMonths: [],
    description:
      'Vacina contra hepatite A para adultos. Esquema de 2 doses com intervalo de 6 meses.',
  },
  {
    name: 'Hepatite A — infantil',
    priceCash: 186.00,
    priceInstallment: 228.34,
    installments: 18,
    ageMonths: [12, 18],
    description:
      'Vacina contra hepatite A para crianças. Indicada aos 12 meses, com reforço aos 18 meses.',
  },
  {
    name: 'Hepatite A + B (combinada)',
    priceCash: 332.04,
    priceInstallment: 407.62,
    installments: 18,
    ageMonths: [],
    description:
      'Vacina combinada contra hepatite A e B. Esquema de 3 doses (0, 1 e 6 meses).',
  },
  {
    name: 'Herpes Zóster (Shingrix GSK)',
    priceCash: 859.00,
    priceInstallment: 1054.54,
    installments: 18,
    ageMonths: [],
    description:
      'Vacina recombinante contra herpes zóster (cobreiro). Indicada a partir dos 50 anos. Esquema de 2 doses.',
  },
  {
    name: 'Hexavalente acelular',
    priceCash: 256.00,
    priceInstallment: 314.27,
    installments: 18,
    ageMonths: [2, 4, 6],
    description:
      'Protege contra 6 doenças: difteria, tétano, coqueluche, pólio, hepatite B e Haemophilus influenzae b. Indicada aos 2, 4 e 6 meses.',
  },
  {
    name: 'HPV 9 (Gardasil 9)',
    priceCash: 924.00,
    priceInstallment: 1134.33,
    installments: 18,
    ageMonths: [108, 120, 132, 144, 156, 168],
    description:
      'Vacina nonavalente contra o HPV. Indicada a partir dos 9 anos. Esquema de 2 doses (9-14 anos) ou 3 doses (15+).',
  },
  {
    name: 'Meningocócica ACWY',
    priceCash: 389.00,
    priceInstallment: 486.12,
    installments: 18,
    ageMonths: [3, 5, 12, 132],
    description:
      'Protege contra meningites e infecções pelos sorogrupos A, C, W e Y. Indicada aos 3, 5 e 12 meses, e reforço na adolescência.',
  },
  {
    name: 'Meningocócica B',
    priceCash: 689.00,
    priceInstallment: 845.84,
    installments: 18,
    ageMonths: [3, 5, 12],
    description:
      'Protege contra o meningococo do tipo B. Esquema aos 3, 5 e 12 meses.',
  },
  {
    name: 'Pneumocócica 13',
    priceCash: 308.00,
    priceInstallment: 378.11,
    installments: 18,
    ageMonths: [],
    description:
      'Pneumocócica conjugada 13-valente. Indicada para adultos com fatores de risco e idosos.',
  },
  {
    name: 'Pneumocócica 15',
    priceCash: 350.00,
    priceInstallment: 429.67,
    installments: 18,
    ageMonths: [],
    description:
      'Pneumocócica conjugada 15-valente. Esquema completo com cobertura ampliada.',
  },
  {
    name: 'Pneumocócica 20',
    priceCash: 489.00,
    priceInstallment: 600.31,
    installments: 18,
    ageMonths: [2, 4, 6, 12],
    description:
      'Pneumocócica conjugada 20-valente. Cobertura ampla contra pneumonia, meningite, otite e infecções graves. Aos 2, 4, 6 e 12 meses.',
  },
  {
    name: 'Eflueda (gripe alta dose)',
    priceCash: 330.00,
    priceInstallment: 405.12,
    installments: 18,
    ageMonths: [],
    description:
      'Vacina contra gripe em alta dose, indicada para idosos a partir de 60 anos para resposta imunológica reforçada.',
  },
  {
    name: 'Pentavalente acelular',
    priceCash: 256.00,
    priceInstallment: 314.27,
    installments: 18,
    ageMonths: [2, 4, 6],
    description:
      'Protege contra 5 doenças: difteria, tétano, coqueluche, hepatite B e Haemophilus influenzae b. Esquema aos 2, 4 e 6 meses.',
  },
  {
    name: 'Rotavírus pentavalente',
    priceCash: 312.00,
    priceInstallment: 383.02,
    installments: 18,
    ageMonths: [2, 4, 6],
    description:
      'Protege contra o rotavírus, principal causa de diarreia grave em bebês. 3 doses aos 2, 4 e 6 meses.',
  },
  {
    name: 'Varicela (catapora)',
    priceCash: 396.00,
    priceInstallment: 486.14,
    installments: 18,
    ageMonths: [12, 15, 48],
    description:
      'Vacina contra varicela. Esquema aos 12 e 15 meses, com reforço aos 4 anos.',
  },
  {
    name: 'Tríplice viral (sarampo, caxumba, rubéola)',
    priceCash: 140.80,
    priceInstallment: 172.85,
    installments: 18,
    ageMonths: [12, 15],
    description:
      'Vacina tríplice viral. Aplicada aos 12 meses, com reforço aos 15 meses.',
  },
  {
    name: 'Influenza (gripe)',
    priceCash: 120.00,
    priceInstallment: 147.32,
    installments: 18,
    ageMonths: [6, 7, 8, 9, 10, 11, 12],
    description:
      'Vacina anual contra a gripe. Indicada a partir de 6 meses para todos os anos.',
  },
  {
    name: 'Qdenga (dengue)',
    priceCash: 590.00,
    priceInstallment: 724.30,
    installments: 18,
    ageMonths: [],
    description:
      'Vacina contra a dengue. Esquema de 2 doses com intervalo de 3 meses. Indicada a partir dos 4 anos.',
  },
  {
    name: 'Aplicação/perfuração de brincos',
    priceCash: 140.00,
    priceInstallment: 171.87,
    installments: 18,
    ageMonths: [],
    description:
      'Aplicação e perfuração de brincos para bebês e adultos com técnica humanizada.',
  },
];

interface PackageRow {
  name: string;
  description: string;
  items: Array<{ vaccineSlug: string; doses: number }>;
  priceCash: number;
  priceInstallment: number;
  installments: number;
}

const PACKAGES: PackageRow[] = [
  {
    name: 'Pacote vacinal 2 a 6 meses',
    description:
      'Proteção completa para o bebê dos 2 aos 6 meses: hexavalente, pneumo 20, rotavírus, ACWY e meningo B.',
    items: [
      { vaccineSlug: 'hexavalente-acelular', doses: 3 },
      { vaccineSlug: 'pneumococica-20', doses: 3 },
      { vaccineSlug: 'rotavirus-pentavalente', doses: 3 },
      { vaccineSlug: 'meningococica-acwy', doses: 2 },
      { vaccineSlug: 'meningococica-b', doses: 2 },
    ],
    priceCash: 5067.00,
    priceInstallment: 6453.54,
    installments: 18,
  },
  {
    name: 'Pacote vacinal 1 ano a 1 ano e 6 meses',
    description:
      'Esquema completo dos 12 aos 18 meses: hepatite A, febre amarela, varicela, tríplice viral, pneumo 20, pentavalente, ACWY e meningo B.',
    items: [
      { vaccineSlug: 'hepatite-a-infantil', doses: 2 },
      { vaccineSlug: 'febre-amarela', doses: 1 },
      { vaccineSlug: 'varicela-catapora', doses: 2 },
      { vaccineSlug: 'triplice-viral-sarampo-caxumba-rubeola', doses: 2 },
      { vaccineSlug: 'pneumococica-20', doses: 1 },
      { vaccineSlug: 'pentavalente-acelular', doses: 1 },
      { vaccineSlug: 'meningococica-acwy', doses: 1 },
      { vaccineSlug: 'meningococica-b', doses: 1 },
    ],
    // Planilha: R$ 3.141,00 era a SOMA das vacinas individuais.
    // Preço real do pacote: à vista 2.467,36 / total 18x 3.106,27.
    priceCash: 2467.36,
    priceInstallment: 3106.27,
    installments: 18,
  },
  {
    name: 'Pacote HPV 9 (3 doses)',
    description:
      'Esquema completo da HPV nonavalente em 3 doses (recomendado para 15 anos ou mais).',
    items: [{ vaccineSlug: 'hpv-9-gardasil-9', doses: 3 }],
    priceCash: 2712.00,
    priceInstallment: 3719.82,
    installments: 18,
  },
];

async function main() {
  const tenant = await prisma.tenant.findFirst({
    where: { slug: 'clinica-imuniza' },
  });
  if (!tenant) {
    console.error('Tenant clinica-imuniza nao encontrado');
    process.exit(1);
  }

  console.log(`Importando vacinas para tenant ${tenant.name}...\n`);

  let createdV = 0;
  let updatedV = 0;
  for (const v of VACCINES) {
    const slug = slugify(v.name);
    const existing = await prisma.vaccine.findFirst({
      where: { tenantId: tenant.id, slug },
    });
    const data = {
      name: v.name,
      description: v.description,
      ageMonths: v.ageMonths,
      priceCash: v.priceCash,
      priceInstallment: v.priceInstallment,
      installments: v.installments,
      active: true,
    } as const;

    if (existing) {
      await prisma.vaccine.update({ where: { id: existing.id }, data });
      updatedV++;
      process.stdout.write('.');
    } else {
      await prisma.vaccine.create({
        data: { tenantId: tenant.id, slug, ...data },
      });
      createdV++;
      process.stdout.write('+');
    }
  }
  console.log(`\n✓ ${createdV} criadas, ${updatedV} atualizadas (${VACCINES.length} vacinas)`);

  // Pacotes
  let createdP = 0;
  let updatedP = 0;
  for (const p of PACKAGES) {
    const slug = slugify(p.name);
    const existing = await prisma.vaccinePackage.findFirst({
      where: { tenantId: tenant.id, slug },
    });
    const data = {
      name: p.name,
      description: p.description,
      items: p.items as unknown as Prisma.InputJsonValue,
      priceCash: p.priceCash,
      priceInstallment: p.priceInstallment,
      installments: p.installments,
      active: true,
    } as const;

    if (existing) {
      await prisma.vaccinePackage.update({ where: { id: existing.id }, data });
      updatedP++;
    } else {
      await prisma.vaccinePackage.create({
        data: { tenantId: tenant.id, slug, ...data },
      });
      createdP++;
    }
  }
  console.log(`✓ ${createdP} pacotes criados, ${updatedP} atualizados (${PACKAGES.length} total)`);

  console.log('\n✨ Tabela real importada. A IA passa a usar esses preços imediatamente.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
