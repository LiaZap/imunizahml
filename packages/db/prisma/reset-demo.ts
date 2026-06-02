/**
 * Zera TODOS os dados de demonstracao/teste antes de entrar em producao.
 *
 * APAGA:
 *  - Conversas, mensagens, handoffs
 *  - Pacientes (e tudo relacionado: prontuario, lembretes, agendamentos)
 *  - Campanhas (incluindo demo)
 *  - Metric snapshots (14 dias mock)
 *  - Extracoes de carteirinha
 *
 * MANTEM:
 *  - Tenant (nome, slug, config: persona, lembretes, iCal token, etc.)
 *  - Vacinas e pacotes (28 reais importados da planilha)
 *  - Documentos da Base de Conhecimento (KB)
 *  - Usuarios (admin, secretaria, atendentes)
 *
 * Uso:
 *   local: pnpm --filter @imuniza/db exec tsx prisma/reset-demo.ts
 *   prod:  cd /app/packages/db && pnpm exec tsx prisma/reset-demo.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('🧹 Zerando dados de demonstracao...\n');

  // Ordem importa por causa das FKs (mais especifico primeiro).
  const r1 = await prisma.appointment.deleteMany({});
  const r2 = await prisma.vaccinationReminder.deleteMany({});
  const r3 = await prisma.patientVaccination.deleteMany({});
  const r4 = await prisma.vaccineCardExtraction.deleteMany({});
  const r5 = await prisma.handoff.deleteMany({});
  const r6 = await prisma.message.deleteMany({});
  const r7 = await prisma.conversation.deleteMany({});
  const r8 = await prisma.campaign.deleteMany({});
  const r9 = await prisma.metricSnapshot.deleteMany({});
  const r10 = await prisma.patient.deleteMany({});

  console.log(`✓ ${r10.count} pacientes removidos`);
  console.log(`✓ ${r7.count} conversas`);
  console.log(`✓ ${r6.count} mensagens`);
  console.log(`✓ ${r5.count} handoffs`);
  console.log(`✓ ${r1.count} agendamentos`);
  console.log(`✓ ${r2.count} lembretes`);
  console.log(`✓ ${r3.count} vacinas aplicadas`);
  console.log(`✓ ${r4.count} extracoes de carteirinha`);
  console.log(`✓ ${r8.count} campanhas`);
  console.log(`✓ ${r9.count} snapshots de metricas`);

  // Recontagens do que ficou pra confirmar
  const [vaccines, packages, users, kb] = await Promise.all([
    prisma.vaccine.count(),
    prisma.vaccinePackage.count(),
    prisma.user.count(),
    prisma.kBDocument.count(),
  ]);

  console.log('\n✅ Sistema zerado, pronto para producao.');
  console.log(`   Mantidos: ${vaccines} vacinas, ${packages} pacotes, ${users} usuarios, ${kb} documentos KB.`);
  console.log('   Persona, lembretes, iCal token e demais configuracoes intactos.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
