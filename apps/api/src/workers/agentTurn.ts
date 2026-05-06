import type { FastifyBaseLogger } from 'fastify';
import type { Job } from 'bullmq';
import { prisma } from '@imuniza/db';
import { registerAgentTurnWorker, type AgentTurnJob } from '../queue/queues.js';
import { runAgent } from '../services/agent.js';

/**
 * Processa o "turno" da IA apos o debounce de mensagens do paciente.
 *
 * O webhook salva as mensagens picadas no banco; o agent_turn so dispara
 * quando ha MESSAGE_BUFFER_MS de silencio. Assim, quando runAgent carrega
 * o historico, ele ja enxerga todas as mensagens consolidadas.
 */
export function startAgentTurnWorker(logger: FastifyBaseLogger) {
  const worker = registerAgentTurnWorker(async (job: Job<AgentTurnJob>) => {
    const { tenantId, conversationId, patientId, patientPhone } = job.data;

    // Re-checa status: atendente pode ter assumido durante o buffer
    const conv = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { status: true, aiPausedUntil: true },
    });
    if (!conv) {
      logger.warn({ conversationId }, 'agent_turn: conversation not found');
      return;
    }
    if (conv.status === 'assigned' || conv.status === 'awaiting_handoff') {
      logger.info(
        { conversationId, status: conv.status },
        'agent_turn: conversation now human-handled, skipping',
      );
      return;
    }
    if (conv.aiPausedUntil && conv.aiPausedUntil.getTime() > Date.now()) {
      logger.info(
        { conversationId, until: conv.aiPausedUntil.toISOString() },
        'agent_turn: IA pausada (humano respondeu pelo numero da clinica), skipping',
      );
      return;
    }

    // A IA continua respondendo mesmo fora do horario comercial — ela
    // sabe pelo system prompt informar a previsao de retorno da equipe
    // pra agendamentos. Ver agent.ts (busca tenant.config.businessHours).
    await runAgent({
      tenantId,
      conversationId,
      patientId,
      patientPhone,
      logger,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'agent_turn job failed');
  });

  worker.on('completed', (job) => {
    logger.debug({ jobId: job.id }, 'agent_turn job completed');
  });

  logger.info('agent_turn worker started');
  return worker;
}
