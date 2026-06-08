/**
 * Reseta um paciente — apaga conversa, mensagens, vacinações, lembretes
 * e o paciente em si. Use quando quiser que o número volte a ser tratado
 * como "primeira mensagem" (saudação curta, sem histórico).
 *
 * Aceita número parcial (faz match por endsWith).
 *
 * Uso:
 *   local:  cd apps/api && pnpm exec dotenv -e ../../.env.test.local -e ../../.env -- tsx src/scripts/resetPatient.ts 5596013791
 *   prod:   cd /app/apps/api && pnpm exec tsx src/scripts/resetPatient.ts 5596013791
 */
import { prisma } from '@imuniza/db';
import { agentTurnQueue, incomingMessageQueue } from '../queue/queues.js';

const arg = process.argv[2];
if (!arg) {
  console.error('uso: tsx src/scripts/resetPatient.ts <numero>');
  process.exit(1);
}

const digits = arg.replace(/\D/g, '');
if (!digits) {
  console.error('numero invalido');
  process.exit(1);
}

async function main(): Promise<void> {
  // Match por endsWith (último N dígitos) — cobre variações de DDI/DDD
  const patients = await prisma.patient.findMany({
    where: { phone: { endsWith: digits } },
    include: {
      conversations: { select: { id: true } },
    },
  });

  if (patients.length === 0) {
    console.log(`nenhum paciente encontrado pra ${digits}`);
    return;
  }

  for (const p of patients) {
    console.log(`paciente: ${p.id}  phone=${p.phone}  name=${p.name ?? '-'}  conversas=${p.conversations.length}`);

    // Limpa jobs pendentes no BullMQ (agent_turn usa id da conversa como jobId)
    for (const c of p.conversations) {
      try {
        const j = await agentTurnQueue.getJob(`agent_turn:${c.id}`);
        if (j) await j.remove().catch(() => undefined);
      } catch { /* ignore */ }
    }

    // Apaga o paciente — cascade leva conversation/message/vaccinations/reminders
    await prisma.patient.delete({ where: { id: p.id } });
    console.log(`  ✓ removido (cascade levou ${p.conversations.length} conversa(s) e mensagens)`);
  }

  // Drena jobs incoming pendentes pra esse número (são consumidos rápido, mas
  // ainda assim — vamos limpar pra não recriar o paciente que acabamos de apagar)
  const waiting = await incomingMessageQueue.getJobs(['waiting', 'delayed', 'paused']);
  for (const j of waiting) {
    const data = j.data;
    if (data?.from && data.from.endsWith(digits)) {
      await j.remove().catch(() => undefined);
      console.log(`  ✓ job incoming pendente removido`);
    }
  }

  console.log('done.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await agentTurnQueue.close();
    await incomingMessageQueue.close();
  });
