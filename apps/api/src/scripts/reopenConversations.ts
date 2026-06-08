/**
 * Lista (e opcionalmente reabre) conversas em handoff.
 *
 * Uso:
 *   listar:   tsx src/scripts/reopenConversations.ts
 *   reabrir tudo: tsx src/scripts/reopenConversations.ts --reopen
 *   reabrir uma conversa: tsx src/scripts/reopenConversations.ts <conversationId>
 */
import { prisma } from '@imuniza/db';

async function main(): Promise<void> {
  const arg = process.argv[2];

  const convs = await prisma.conversation.findMany({
    where: { status: { in: ['awaiting_handoff', 'assigned'] } },
    include: { patient: { select: { phone: true, name: true } } },
    orderBy: { lastMessageAt: 'desc' },
  });

  console.log(`\nConversas em handoff: ${convs.length}\n`);
  for (const c of convs) {
    console.log(`  ${c.id}  ${c.status.padEnd(18)} ${c.patient.phone.padEnd(15)} ${c.patient.name ?? '-'}`);
  }

  if (convs.length === 0) {
    console.log('nada a fazer.');
    return;
  }

  if (arg === '--reopen') {
    const r = await prisma.conversation.updateMany({
      where: { status: { in: ['awaiting_handoff', 'assigned'] } },
      data: { status: 'active', assignedToUserId: null, aiPausedUntil: null },
    });
    console.log(`\n✓ ${r.count} conversa(s) reabertas pra active`);
    // Resolve handoffs pendentes
    const h = await prisma.handoff.updateMany({
      where: { status: { in: ['pending', 'assigned'] } },
      data: { status: 'cancelled' },
    });
    console.log(`✓ ${h.count} handoff(s) cancelados`);
  } else if (arg) {
    const r = await prisma.conversation.update({
      where: { id: arg },
      data: { status: 'active', assignedToUserId: null, aiPausedUntil: null },
    });
    console.log(`\n✓ reaberta: ${r.id}`);
    const h = await prisma.handoff.updateMany({
      where: { conversationId: arg, status: { in: ['pending', 'assigned'] } },
      data: { status: 'cancelled' },
    });
    console.log(`✓ ${h.count} handoff(s) cancelados`);
  } else {
    console.log('\nPra reabrir tudo: --reopen');
    console.log('Pra reabrir uma só: <conversationId>');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
