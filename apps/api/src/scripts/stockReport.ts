import { prisma } from '@imuniza/db';

async function main(): Promise<void> {
  const vaccines = await prisma.vaccine.findMany({
    select: { name: true, slug: true, priceCash: true, priceInstallment: true, installments: true, inStock: true, outOfStockNote: true, ageMonths: true },
    orderBy: { name: 'asc' },
  });

  const ok = vaccines.filter((v) => v.inStock);
  const off = vaccines.filter((v) => !v.inStock);

  console.log(`\n=== EM ESTOQUE (${ok.length}/${vaccines.length}) ===`);
  for (const v of ok) {
    console.log(`  ✓ ${v.name.padEnd(35)} R$ ${v.priceCash.toString().padStart(7)} a vista`);
  }

  console.log(`\n=== EM FALTA (${off.length}/${vaccines.length}) ===`);
  for (const v of off) {
    const note = v.outOfStockNote ? ` — ${v.outOfStockNote}` : '';
    console.log(`  ✗ ${v.name.padEnd(35)} R$ ${v.priceCash.toString().padStart(7)} (${v.slug})${note}`);
  }

  console.log(`\nTotal: ${vaccines.length} vacinas, ${ok.length} em estoque, ${off.length} em falta`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
