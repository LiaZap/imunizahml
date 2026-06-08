/**
 * Reseta TUDO: apaga todos os pacientes, conversas, mensagens, handoffs,
 * vacinações e lembretes. Mantém tenant, vacinas, pacotes, persona, KB.
 *
 * Usa só em ambiente de teste. NUNCA rode em prod.
 *
 * Uso:
 *   cd apps/api && pnpm exec dotenv -e ../../.env.test.local -e ../../.env -- tsx src/scripts/resetAll.ts
 */
import { prisma } from '@imuniza/db';
import { agentTurnQueue, incomingMessageQueue } from '../queue/queues.js';

async function main(): Promise<void> {
  console.log('limpando filas BullMQ...');
  await agentTurnQueue.obliterate({ force: true }).catch(() => undefined);
  await incomingMessageQueue.obliterate({ force: true }).catch(() => undefined);

  console.log('apagando pacientes (cascade leva conversas, mensagens, etc)...');
  const r = await prisma.patient.deleteMany({});
  console.log(`✓ ${r.count} paciente(s) removido(s)`);

  // Handoffs órfãos (caso existam sem conversation)
  await prisma.handoff.deleteMany({}).catch(() => undefined);

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
