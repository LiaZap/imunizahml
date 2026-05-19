/**
 * Limpa o historico de conversas para testar a IA do zero.
 * MANTEM: tenant/config, usuarios, vacinas, pacotes, base de conhecimento.
 * APAGA: conversas, mensagens, handoffs, lembretes, agendamentos,
 *        extracoes de carteirinha e (opcionalmente) pacientes.
 *
 * Uso:
 *   - Tudo:            pnpm --filter @imuniza/db exec tsx prisma/reset-conversations.ts
 *   - Só um telefone:  pnpm --filter @imuniza/db exec tsx prisma/reset-conversations.ts 5511987959188
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const phoneArg = process.argv[2]?.replace(/\D/g, '');

  if (phoneArg) {
    // ─── Limpa apenas um paciente/telefone ───
    const patients = await prisma.patient.findMany({
      where: { phone: { contains: phoneArg } },
      select: { id: true, phone: true, name: true },
    });
    if (patients.length === 0) {
      console.log(`Nenhum paciente com telefone contendo "${phoneArg}".`);
      await prisma.$disconnect();
      return;
    }
    const ids = patients.map((p) => p.id);
    console.log(`Limpando ${patients.length} paciente(s): ${patients.map((p) => p.phone).join(', ')}`);

    // Conversas cascateiam mensagens e handoffs (onDelete: Cascade)
    await prisma.appointment.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.vaccinationReminder.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patientVaccination.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.vaccineCardExtraction.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.conversation.deleteMany({ where: { patientId: { in: ids } } });
    await prisma.patient.deleteMany({ where: { id: { in: ids } } });

    console.log('✓ Paciente(s) e todo o histórico apagados.');
  } else {
    // ─── Limpa TUDO de conversas ───
    console.log('Limpando TODO o histórico de conversas...');

    const r1 = await prisma.appointment.deleteMany({});
    const r2 = await prisma.vaccinationReminder.deleteMany({});
    const r3 = await prisma.patientVaccination.deleteMany({});
    const r4 = await prisma.vaccineCardExtraction.deleteMany({});
    const r5 = await prisma.handoff.deleteMany({});
    const r6 = await prisma.message.deleteMany({});
    const r7 = await prisma.conversation.deleteMany({});
    const r8 = await prisma.patient.deleteMany({});

    console.log(`✓ ${r7.count} conversas`);
    console.log(`✓ ${r6.count} mensagens`);
    console.log(`✓ ${r5.count} handoffs`);
    console.log(`✓ ${r8.count} pacientes`);
    console.log(`✓ ${r1.count} agendamentos`);
    console.log(`✓ ${r2.count} lembretes`);
    console.log(`✓ ${r3.count} vacinas aplicadas`);
    console.log(`✓ ${r4.count} extrações de carteirinha`);
  }

  console.log('\n✨ Pronto. Pode testar a IA do zero.');
  console.log('Mantidos: vacinas, pacotes, base de conhecimento, usuários e configurações.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
