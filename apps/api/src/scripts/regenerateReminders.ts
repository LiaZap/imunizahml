/**
 * Regenera os lembretes dos agendamentos futuros — usado quando mudou
 * algo no template do lembrete OU em como a hora e formatada (ex: fix
 * de timezone). A funcao `scheduleAppointmentReminders` ja eh idempotente:
 * apaga os reminders pendentes do appointment e cria de novo com o texto
 * atualizado.
 *
 * Uso:
 *   cd apps/api && pnpm exec tsx src/scripts/regenerateReminders.ts
 */
import { prisma } from '@imuniza/db';
import { scheduleAppointmentReminders } from '../services/appointmentReminders.js';

async function main(): Promise<void> {
  const now = new Date();
  const appts = await prisma.appointment.findMany({
    where: {
      status: { in: ['scheduled', 'attended'] },
      scheduledFor: { gte: now },
    },
    select: { id: true, scheduledFor: true },
  });

  console.log(`encontrei ${appts.length} agendamento(s) futuro(s) pra regenerar`);
  let total = 0;
  for (const appt of appts) {
    try {
      const n = await scheduleAppointmentReminders(appt.id);
      total += n;
      console.log(`  ✓ ${appt.id} (${appt.scheduledFor.toISOString()}) → ${n} reminder(s)`);
    } catch (err) {
      console.error(`  ✗ ${appt.id}:`, (err as Error).message);
    }
  }
  console.log(`pronto. ${total} reminder(s) recriado(s).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
