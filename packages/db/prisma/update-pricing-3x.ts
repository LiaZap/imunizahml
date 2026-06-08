/**
 * Atualiza todas as vacinas pro novo padrão da clínica:
 *
 * - `installments = 3` (era 18 ou variado)
 * - `priceInstallment = round(priceCash * 1.0693, 2)` — markup fixo de 6.93%
 *
 * Daí a IA divide priceInstallment / installments e mostra "3x R$ X,XX".
 *
 * Também atualiza a descrição da HPV 9 com o template oficial do cliente
 * (foco em adolescentes, menciona proteção completa contra 9 tipos do vírus).
 *
 * Uso:
 *   cd packages/db && pnpm exec dotenv -e ../../.env.test.local -e ../../.env -- tsx prisma/update-pricing-3x.ts
 *
 * Idempotente — pode rodar quantas vezes quiser.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const MARKUP_3X = 1.0693;
const DEFAULT_INSTALLMENTS = 3;

const HPV9_DESCRIPTION =
  'Vacina HPV Nonavalente — forma mais completa de proteção contra o HPV, ' +
  'cobrindo 9 tipos do vírus. Auxilia na prevenção do câncer de colo do útero, ' +
  'além de outros tipos relacionados ao HPV (vulva, vagina, ânus, pênis e ' +
  'orofaringe). Também protege contra a maioria dos casos de verrugas genitais. ' +
  'Indicada principalmente para adolescentes, mas pode ser aplicada em adultos.';

async function main(): Promise<void> {
  const vaccines = await prisma.vaccine.findMany({
    select: { id: true, name: true, slug: true, priceCash: true },
  });

  console.log(`Atualizando ${vaccines.length} vacinas pro padrão 3x...\n`);

  for (const v of vaccines) {
    const cash = Number(v.priceCash);
    const priceInstallment = Math.round(cash * MARKUP_3X * 100) / 100;
    const parcela = (priceInstallment / DEFAULT_INSTALLMENTS).toFixed(2);

    await prisma.vaccine.update({
      where: { id: v.id },
      data: {
        installments: DEFAULT_INSTALLMENTS,
        priceInstallment,
      },
    });

    console.log(
      `  ${v.name.padEnd(40)} cash=R$${cash.toFixed(2).padStart(8)}  → 3x R$${parcela}`,
    );
  }

  // HPV 9 — descrição específica
  const hpv = await prisma.vaccine.findFirst({
    where: {
      OR: [
        { name: { contains: 'HPV', mode: 'insensitive' } },
        { slug: { contains: 'hpv', mode: 'insensitive' } },
      ],
    },
  });
  if (hpv) {
    await prisma.vaccine.update({
      where: { id: hpv.id },
      data: { description: HPV9_DESCRIPTION },
    });
    console.log(`\n✓ Descrição da HPV 9 atualizada (foco adolescentes)`);
  }

  // Remove possíveis duplicatas (ex: "Pneumocócica 20 (Pneumo 20)" + "Pneumocócica 20")
  const pneumo20s = await prisma.vaccine.findMany({
    where: { name: { contains: 'Pneumocócica 20', mode: 'insensitive' } },
    orderBy: { createdAt: 'asc' },
  });
  if (pneumo20s.length > 1) {
    // Mantém o mais novo (provavelmente o "limpo"), apaga os antigos
    const [...older] = pneumo20s.slice(0, -1);
    for (const v of older) {
      await prisma.vaccine.delete({ where: { id: v.id } });
      console.log(`✓ Duplicata removida: ${v.name}`);
    }
  }

  // Atualiza pacotes também (mesmo markup)
  const packages = await prisma.vaccinePackage.findMany({
    select: { id: true, name: true, priceCash: true },
  });
  if (packages.length > 0) console.log(`\nPacotes:`);
  for (const p of packages) {
    const cash = Number(p.priceCash);
    const priceInstallment = Math.round(cash * MARKUP_3X * 100) / 100;
    const parcela = (priceInstallment / DEFAULT_INSTALLMENTS).toFixed(2);
    await prisma.vaccinePackage.update({
      where: { id: p.id },
      data: { installments: DEFAULT_INSTALLMENTS, priceInstallment },
    });
    console.log(
      `  ${p.name.padEnd(40)} cash=R$${cash.toFixed(2).padStart(8)}  → 3x R$${parcela}`,
    );
  }

  console.log('\n✨ Pronto.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
