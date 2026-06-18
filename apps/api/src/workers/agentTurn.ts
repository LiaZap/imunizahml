import type { FastifyBaseLogger } from 'fastify';
import type { Job } from 'bullmq';
import { prisma } from '@imuniza/db';
import { registerAgentTurnWorker, type AgentTurnJob } from '../queue/queues.js';
import { runAgent } from '../services/agent.js';
import { isWithinBusinessHours, type BusinessHoursConfig } from '../services/businessHours.js';
import { getTenantConfig } from '../services/tenant.js';
import { env } from '../env.js';

interface TenantBusinessHoursConfig {
  businessHours?: BusinessHoursConfig;
}

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
      select: { status: true, aiPausedUntil: true, metadata: true },
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
    if (conv.status === 'closed') {
      logger.info(
        { conversationId },
        'agent_turn: conversa fechada, IA nao responde',
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

    // SAFETY NET: regra operacional da clinica — se em algum momento um
    // humano respondeu nesta conversa, a IA NAO assume mais. So volta
    // depois que alguem clicar "Devolver para IA" (POST /resume-ai), que
    // zera aiPausedUntil + grava aiResumedAt no metadata.
    //
    // Funciona como rede de seguranca contra qualquer falha das outras
    // camadas (status, aiPausedUntil) — checagem direta no banco do que
    // ja foi enviado.
    //
    // Filtragem por aiResumedAt: ignora msgs human ANTERIORES ao resume.
    // Se o atendente assumiu, devolveu pra IA, e depois NAO falou de
    // novo — a IA volta a operar normal.
    const meta = (conv.metadata as Record<string, unknown> | null) ?? {};
    const aiResumedAt =
      typeof meta.aiResumedAt === 'string' ? new Date(meta.aiResumedAt) : null;
    const humanFilter = aiResumedAt
      ? { conversationId, role: 'human' as const, createdAt: { gt: aiResumedAt } }
      : { conversationId, role: 'human' as const };
    const hasHumanMsg = await prisma.message.findFirst({
      where: humanFilter,
      select: { id: true, createdAt: true },
    });
    if (hasHumanMsg) {
      logger.info(
        { conversationId, humanMsgAt: hasHumanMsg.createdAt.toISOString() },
        'agent_turn: humano ja interveio nesta conversa, IA bloqueada (Devolver para IA pra reativar)',
      );
      return;
    }

    // Hard stop opcional: quando env.AI_HARD_STOP_OUTSIDE_BUSINESS_HOURS = true,
    // a IA NAO responde fora do horario comercial. Decisao operacional pra
    // pre-lancamento — a clinica nao quer respostas da IA depois das 18h
    // enquanto ainda calibra a persona. Se quiser voltar a operar 24/7,
    // basta tirar essa env (ou deixar false).
    if (env.AI_HARD_STOP_OUTSIDE_BUSINESS_HOURS) {
      const tenant = await getTenantConfig(tenantId);
      const businessHours = (tenant.config as TenantBusinessHoursConfig | null)?.businessHours;
      if (!isWithinBusinessHours(businessHours)) {
        logger.info(
          { conversationId, tenantId },
          'agent_turn: fora do horario comercial e AI_HARD_STOP_OUTSIDE_BUSINESS_HOURS=true — IA em silencio',
        );
        return;
      }
    }

    // Dentro do horario (ou hard stop desligado): IA responde normalmente.
    // Mesmo fora do horario com hard stop OFF, o agent.ts ainda informa pelo
    // system prompt a previsao de retorno da equipe pra agendamentos.
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
