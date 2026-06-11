import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, ConversationStatus, Prisma } from '@imuniza/db';
import { addMessage } from '../services/conversation.js';
import { uazapi } from '../services/uazapi.js';
import { eventBus } from '../events/bus.js';
import { agentTurnQueue, agentTurnJobId } from '../queue/queues.js';
import { env } from '../env.js';

// Pause "indefinido" pra IA quando humano assume — so o botao "Devolver
// para IA" zera. Usamos data far-future em vez de booleano pra reutilizar
// toda a logica existente de `aiPausedUntil > now`.
const HUMAN_OVERRIDE_PAUSE_INDEFINITE = new Date('2099-12-31T23:59:59Z');

const listQuery = z.object({
  status: z.enum(['active', 'awaiting_handoff', 'assigned', 'closed']).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const paramsSchema = z.object({ id: z.string().uuid() });

const assignBody = z.object({
  userId: z.string().uuid().optional(),
});

const humanMessageBody = z.object({
  text: z.string().min(1),
  userId: z.string().uuid().optional(),
});

export async function conversationsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const query = listQuery.parse(req.query);
    return prisma.conversation.findMany({
      where: query.status ? { status: query.status } : undefined,
      orderBy: { lastMessageAt: 'desc' },
      take: query.limit,
      include: {
        patient: { select: { id: true, phone: true, name: true, profile: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
  });

  app.get('/:id', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: {
        patient: true,
        assignedTo: { select: { id: true, name: true, email: true } },
        messages: { orderBy: { createdAt: 'asc' } },
        handoffs: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!conversation) return reply.code(404).send({ error: 'not_found' });
    return conversation;
  });

  app.post('/:id/assign', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const { userId } = assignBody.parse(req.body ?? {});

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.code(404).send({ error: 'not_found' });
    if (conversation.status === 'closed') {
      return reply.code(409).send({ error: 'conversation_closed' });
    }

    let assigneeId = userId;
    if (!assigneeId) {
      const admin = await prisma.user.findFirst({
        where: { tenantId: conversation.tenantId, role: 'admin', active: true },
      });
      if (!admin) return reply.code(400).send({ error: 'no_user_to_assign' });
      assigneeId = admin.id;
    }

    const [updated] = await prisma.$transaction([
      prisma.conversation.update({
        where: { id },
        data: { status: 'assigned', assignedToUserId: assigneeId },
        include: { assignedTo: { select: { id: true, name: true, email: true } } },
      }),
      prisma.handoff.updateMany({
        where: { conversationId: id, status: 'pending' },
        data: { status: 'assigned', assignedToUserId: assigneeId },
      }),
    ]);

    eventBus.emitDomain({
      type: 'conversation.assigned',
      tenantId: conversation.tenantId,
      conversationId: id,
      userId: assigneeId,
    });

    return updated;
  });

  app.post('/:id/message', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const { text, userId } = humanMessageBody.parse(req.body);

    const conversation = await prisma.conversation.findUnique({
      where: { id },
      include: { patient: { select: { phone: true } } },
    });
    if (!conversation) return reply.code(404).send({ error: 'not_found' });
    if (conversation.status === 'closed') {
      return reply.code(409).send({ error: 'conversation_closed' });
    }

    // PAUSE da IA: PERMANENTE quando humano responde, ate alguem clicar
    // "Devolver para IA". Decisao da dona da clinica — quando elas falam,
    // a IA NAO pode mais responder nessa conversa.
    //
    // Implementacao: aiPausedUntil = data far-future (2099). Todas as
    // checagens fazem `pausedUntil > now`, entao fica indefinido.
    // O botao "Devolver para IA" zera esse campo (POST /resume-ai).
    const pauseUntil = HUMAN_OVERRIDE_PAUSE_INDEFINITE;

    // Auto-assign if still in queue and userId provided (atendente começa a responder direto)
    if (conversation.status !== 'assigned' && userId) {
      await prisma.conversation.update({
        where: { id },
        data: { status: 'assigned', assignedToUserId: userId, aiPausedUntil: pauseUntil },
      });
      await prisma.handoff.updateMany({
        where: { conversationId: id, status: 'pending' },
        data: { status: 'assigned', assignedToUserId: userId },
      });
      eventBus.emitDomain({
        type: 'conversation.assigned',
        tenantId: conversation.tenantId,
        conversationId: id,
        userId,
      });
    } else {
      // Mesmo sem userId, ainda assim pausa a IA — mensagem do atendente foi
      // enviada e não queremos que a IA mande outra resposta logo depois.
      await prisma.conversation.update({
        where: { id },
        data: { aiPausedUntil: pauseUntil },
      });
    }

    // Cancela qualquer agent_turn pendente na fila pra evitar resposta
    // "fantasma" da IA depois da mensagem humana.
    try {
      const pending = await agentTurnQueue.getJob(agentTurnJobId(id));
      if (pending) await pending.remove().catch(() => undefined);
    } catch {
      /* ignore */
    }

    eventBus.emitDomain({
      type: 'conversation.ai_paused',
      tenantId: conversation.tenantId,
      conversationId: id,
      pausedUntil: pauseUntil.toISOString(),
    });

    let sentMessageId = '';
    try {
      const sent = await uazapi.sendText({ number: conversation.patient.phone, text });
      sentMessageId = sent.id;
    } catch (err) {
      req.log.error({ err }, 'failed to send human message via uazapi');
      return reply.code(502).send({ error: 'uazapi_failed', detail: (err as Error).message });
    }

    const message = await addMessage({
      conversationId: id,
      role: 'human',
      content: text,
      metadata: {
        ...(userId ? { sentBy: userId } : {}),
        ...(sentMessageId ? { uazapiMessageId: sentMessageId } : {}),
        source: 'dashboard',
      },
    });

    return { message };
  });

  app.post('/:id/resume-ai', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.code(404).send({ error: 'not_found' });

    const wasPaused = !!conversation.aiPausedUntil;
    const wasAssigned = conversation.status === 'assigned' || conversation.status === 'awaiting_handoff';

    if (!wasPaused && !wasAssigned) {
      return reply.send({ id, aiPausedUntil: null, status: conversation.status });
    }

    // Marca timestamp de quando o atendente devolveu pra IA. O safety net
    // do agent_turn ignora msgs human ANTERIORES a este timestamp — assim
    // o historico nao bloqueia mais a IA. Apenas msgs human FUTURAS
    // (que ainda nao ocorreram) bloqueariam.
    const prevMeta = (conversation.metadata as Record<string, unknown> | null) ?? {};
    const updated = await prisma.conversation.update({
      where: { id },
      data: {
        aiPausedUntil: null,
        metadata: { ...prevMeta, aiResumedAt: new Date().toISOString() } as Prisma.InputJsonValue,
        // Se estiver atribuida ou em handoff, volta a IA pro fluxo
        ...(wasAssigned ? { status: 'active', assignedToUserId: null } : {}),
      },
      select: { id: true, aiPausedUntil: true, tenantId: true, status: true },
    });

    // Marca handoffs como resolvidos
    if (wasAssigned) {
      await prisma.handoff.updateMany({
        where: { conversationId: id, status: { in: ['pending', 'assigned'] } },
        data: { status: 'resolved' },
      });
    }

    // Mensagem de sistema para registrar a transicao no historico
    await addMessage({
      conversationId: id,
      role: 'system',
      content: 'Conversa devolvida para a IA pelo atendente.',
      metadata: { event: 'returned_to_ai' },
    });

    eventBus.emitDomain({
      type: 'conversation.ai_paused',
      tenantId: updated.tenantId,
      conversationId: updated.id,
      pausedUntil: '',
    });

    // Dispara o agent_turn pra IA processar IMEDIATAMENTE as ultimas
    // mensagens pendentes do paciente. Sem isso a IA so responderia
    // quando o paciente mandasse algo NOVO — o que pode demorar.
    //
    // Le os ultimos dados necessarios pra montar o job. Se nao houver
    // msg pendente do paciente, o agent_turn vai checar e nao fazer
    // nada (loadHistory traz tudo, mas se a ultima eh assistant, o
    // modelo geralmente nao responde sozinho).
    try {
      const fullConv = await prisma.conversation.findUnique({
        where: { id },
        select: {
          tenantId: true,
          patientId: true,
          patient: { select: { phone: true } },
        },
      });
      if (fullConv?.patient?.phone) {
        const jobId = agentTurnJobId(id);
        const pending = await agentTurnQueue.getJob(jobId).catch(() => null);
        if (pending) await pending.remove().catch(() => undefined);
        await agentTurnQueue.add(
          'agent_turn',
          {
            tenantId: fullConv.tenantId,
            conversationId: id,
            patientId: fullConv.patientId,
            patientPhone: fullConv.patient.phone,
          },
          { jobId, delay: 500 }, // delay curto pra evitar race com o update do banco
        );
        req.log.info({ conversationId: id }, 'resume-ai: agent_turn enfileirado');
      }
    } catch (err) {
      req.log.error({ err }, 'resume-ai: falha ao enfileirar agent_turn');
    }

    return { id: updated.id, aiPausedUntil: updated.aiPausedUntil, status: updated.status };
  });

  app.post('/:id/close', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation) return reply.code(404).send({ error: 'not_found' });
    if (conversation.status === 'closed') return reply.send(conversation);

    // Pausa a IA enquanto a conversa estiver fechada — se o paciente mandar
    // mensagem nova ANTES desse tempo expirar, vira nova conversa mas a IA
    // ainda fica em silencio (cooldown pos-fechamento) pra equipe poder
    // decidir se reabre ou ignora. Default 24h.
    const cooldownUntil = new Date(Date.now() + env.AI_HUMAN_OVERRIDE_PAUSE_MS);

    const updated = await prisma.$transaction(async (tx) => {
      const c = await tx.conversation.update({
        where: { id },
        data: { status: ConversationStatus.closed, aiPausedUntil: cooldownUntil },
      });
      await tx.handoff.updateMany({
        where: { conversationId: id, status: { in: ['pending', 'assigned'] } },
        data: { status: 'resolved' },
      });
      return c;
    });

    // Cancela qualquer agent_turn pendente — IA nao vai mais responder esta
    // conversa nem mesmo no proximo debounce
    try {
      const pending = await agentTurnQueue.getJob(agentTurnJobId(id));
      if (pending) await pending.remove().catch(() => undefined);
    } catch {
      /* ignore */
    }

    eventBus.emitDomain({
      type: 'conversation.closed',
      tenantId: conversation.tenantId,
      conversationId: id,
    });

    return updated;
  });
}
