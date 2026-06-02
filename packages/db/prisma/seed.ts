import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

async function main() {
  const tenantName = process.env.DEFAULT_TENANT_NAME ?? 'Clinica Imuniza';
  const tenantSlug = slugify(tenantName);

  const tenant = await prisma.tenant.upsert({
    where: { slug: tenantSlug },
    create: {
      name: tenantName,
      slug: tenantSlug,
      config: {
        greeting:
          'Olá! Aqui é da clínica. Tudo bem? Me conta como posso te ajudar.',
        persona:
          'Você é uma atendente virtual humanizada e empática de uma clínica de vacinação no Brasil. Seu tom é acolhedor, claro e nunca alarmista.',
        businessHours: { start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
      },
    },
    update: {},
  });

  const adminEmail = process.env.DEFAULT_ADMIN_EMAIL ?? 'admin@imuniza.local';
  const adminPassword = process.env.DEFAULT_ADMIN_PASSWORD ?? 'change-me';
  const passwordHash = await bcrypt.hash(adminPassword, 10);

  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      tenantId: tenant.id,
      email: adminEmail,
      name: 'Admin',
      passwordHash,
      role: 'admin',
    },
    update: { tenantId: tenant.id, passwordHash },
  });

  const vaccines: Array<{
    name: string;
    slug: string;
    description: string;
    ageMonths: number[];
    priceCash: number;
    priceInstallment: number;
  }> = [
    {
      name: 'Hexavalente acelular',
      slug: 'hexavalente-acelular',
      description:
        'Protege contra seis doenças importantes: difteria, tétano, coqueluche, hepatite B, poliomielite e Haemophilus influenzae tipo b.',
      ageMonths: [2, 4, 6],
      priceCash: 256.0,
      priceInstallment: 273.75,
    },
    {
      name: 'Pneumocócica 20 (Pneumo 20)',
      slug: 'pneumo-20',
      description:
        'Protege contra 20 tipos de pneumococo, prevenindo doenças como pneumonia, meningite, otite e infecções mais graves.',
      ageMonths: [2, 4, 6],
      priceCash: 489.0,
      priceInstallment: 522.9,
    },
    {
      name: 'Rotavírus pentavalente',
      slug: 'rotavirus-pentavalente',
      description: 'Protege contra o rotavírus, principal causa de diarreia grave em bebês.',
      ageMonths: [2, 4, 6],
      priceCash: 312.0,
      priceInstallment: 333.63,
    },
    {
      name: 'Meningocócica ACWY',
      slug: 'meningococica-acwy',
      description:
        'Protege contra meningites e infecções causadas pelos sorogrupos A, C, W e Y do meningococo.',
      ageMonths: [3, 5],
      priceCash: 389.0,
      priceInstallment: 415.97,
    },
    {
      name: 'Meningocócica B',
      slug: 'meningococica-b',
      description:
        'Protege contra o meningococo do tipo B, responsável por casos graves de meningite e infecções generalizadas.',
      ageMonths: [3, 5],
      priceCash: 689.0,
      priceInstallment: 736.76,
    },
  ];

  for (const v of vaccines) {
    await prisma.vaccine.upsert({
      where: { tenantId_slug: { tenantId: tenant.id, slug: v.slug } },
      create: { tenantId: tenant.id, ...v, installments: 3 },
      update: {
        name: v.name,
        description: v.description,
        ageMonths: v.ageMonths,
        priceCash: v.priceCash,
        priceInstallment: v.priceInstallment,
      },
    });
  }

  await prisma.vaccinePackage.upsert({
    where: { tenantId_slug: { tenantId: tenant.id, slug: 'pacote-2-6-meses' } },
    create: {
      tenantId: tenant.id,
      name: 'Pacote vacinal 2 a 6 meses',
      slug: 'pacote-2-6-meses',
      description:
        'Proteção completa para o bebê dos 2 aos 6 meses: hexavalente, pneumo 20, rotavírus, ACWY e meningo B.',
      items: [
        { vaccineSlug: 'hexavalente-acelular', doses: 3 },
        { vaccineSlug: 'pneumo-20', doses: 3 },
        { vaccineSlug: 'rotavirus-pentavalente', doses: 3 },
        { vaccineSlug: 'meningococica-acwy', doses: 2 },
        { vaccineSlug: 'meningococica-b', doses: 2 },
      ],
      priceCash: 5067.0,
      priceInstallment: 5549.06,
      installments: 5,
    },
    update: {},
  });

  const kbContent = [
    '# Vacinas indicadas de 2 a 6 meses',
    '',
    'As vacinas hexavalente acelular, pneumocócica 20 e rotavírus pentavalente são indicadas aos 2, 4 e 6 meses de vida.',
    'As vacinas meningocócica ACWY e meningocócica B são indicadas aos 3 e 5 meses de vida.',
    '',
    '## Hexavalente acelular',
    'Protege contra seis doenças importantes: difteria, tétano, coqueluche, hepatite B, poliomielite e Haemophilus influenzae tipo b.',
    '',
    '## Pneumocócica 20',
    'Protege contra 20 tipos de pneumococo, prevenindo pneumonia, meningite, otite e infecções mais graves.',
    '',
    '## Rotavírus pentavalente',
    'Protege contra o rotavírus, principal causa de diarreia grave em bebês.',
    '',
    '## Meningocócica ACWY',
    'Protege contra meningites e infecções causadas pelos sorogrupos A, C, W e Y do meningococo.',
    '',
    '## Meningocócica B',
    'Protege contra o meningococo do tipo B, responsável por casos graves de meningite e infecções generalizadas.',
    '',
    '## Pacote 2 a 6 meses',
    'Composição: 3 doses da hexavalente, 3 doses da pneumocócica 20, 3 doses da rotavírus pentavalente, 2 doses da ACWY e 2 doses da meningocócica B.',
    'Valor à vista (PIX/dinheiro): R$ 5.067,00. Parcelado em até 5x: R$ 5.549,06. Também há opção em até 12x com acréscimo.',
  ].join('\n');

  await prisma.kBDocument.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      tenantId: tenant.id,
      title: 'Base de conhecimento — Vacinas 2 a 6 meses',
      source: 'seed',
      content: kbContent,
    },
    update: { content: kbContent },
  });

  console.log(`Seed concluído. Tenant: ${tenant.name} (${tenant.slug}).`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
