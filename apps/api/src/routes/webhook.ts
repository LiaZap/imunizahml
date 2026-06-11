import type { FastifyInstance } from 'fastify';
import { prisma } from '@imuniza/db';
import { UazapiWebhookMessageSchema } from '@imuniza/shared';
import { uazapi } from '../services/uazapi.js';
import { getDefaultTenantId } from '../services/tenant.js';
import {
  agentTurnJobId,
  agentTurnQueue,
  incomingMessageQueue,
} from '../queue/queues.js';
import { addMessage, getOrCreateActiveConversation, upsertPatient } from '../services/conversation.js';
import { eventBus } from '../events/bus.js';
import { env } from '../env.js';

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  app.post('/uazapi', async (req, reply) => {
    // Autenticação aceita uma das duas formas:
    // 1) body.token === UAZAPI_TOKEN (formato padrão que a Uazapi envia)
    // 2) header x-webhook-secret === UAZAPI_WEBHOOK_SECRET (alternativa)
    const body = req.body as { token?: string } | undefined;
    const headerSecret = req.headers['x-webhook-secret'];
    const bodyTokenOk = !!body?.token && body.token === env.UAZAPI_TOKEN;
    const headerSecretOk = !!headerSecret && headerSecret === env.UAZAPI_WEBHOOK_SECRET;
    if (!bodyTokenOk && !headerSecretOk) {
      return reply.code(401).send({ error: 'unauthorized' });
    }

    const parsed = UazapiWebhookMessageSchema.safeParse(req.body);
    if (!parsed.success) {
      const rawBody = req.body as { message?: { type?: string; messageType?: string } };
      req.log.warn(
        {
          issues: parsed.error.issues,
          messageType: rawBody?.message?.messageType,
          type: rawBody?.message?.type,
        },
        'webhook payload did not match schema — adicionar campos ao Zod',
      );
      return reply.code(202).send({ status: 'ignored', reason: 'schema' });
    }

    // Processamos apenas evento de mensagens
    const eventType = parsed.data.EventType ?? parsed.data.event;
    if (eventType && !/message/i.test(eventType)) {
      return reply.code(202).send({ status: 'ignored', reason: `event:${eventType}` });
    }

    const inbound = uazapi.parseInbound(parsed.data);

    // DEBUG temporario: loga payload completo quando fromMe=true
    // pra ajudar a investigar pq msg do celular/web nao esta sendo
    // detectada como humano respondendo. Remover depois que estabilizar.
    if (parsed.data.message?.fromMe === true) {
      req.log.info(
        {
          fromMe: true,
          msgId: parsed.data.message?.id ?? parsed.data.message?.messageid,
          sender_pn: parsed.data.message?.sender_pn,
          chatid: parsed.data.message?.chatid,
          messageType: parsed.data.message?.messageType,
          type: parsed.data.message?.type,
          inbound: inbound
            ? {
                from: inbound.from,
                fromMe: inbound.fromMe,
                text: inbound.text?.slice(0, 80),
                id: inbound.id,
              }
            : null,
        },
        'webhook DEBUG fromMe=true (humano respondeu pelo celular/web)',
      );
    }

    if (!inbound) {
      const mt = parsed.data.message?.messageType;
      const t = parsed.data.message?.type;
      req.log.debug(
        { messageType: mt, type: t, fromMe: parsed.data.message?.fromMe, isGroup: parsed.data.message?.isGroup },
        'webhook message ignored by parser',
      );
      return reply.code(202).send({ status: 'ignored', reason: `type:${mt ?? t ?? 'unknown'}` });
    }

    const tenantId = await getDefaultTenantId();

    // ————————————————————————————————————————————————
    // fromMe = mensagem saiu do proprio numero da clinica.
    // Dois casos:
    //   (a) eh o echo do nosso proprio send (AI ou atendente no dashboard) —
    //       ja salvamos a mensagem com uazapiMessageId, entao deduplica
    //   (b) um humano respondeu pelo WhatsApp do celular da clinica —
    //       salva como role='human', pausa a IA por 2h
    // ————————————————————————————————————————————————
    if (inbound.fromMe) {
      // (a) echo: ja existe Message com esse uazapiMessageId?
      if (inbound.id) {
        const echoed = await prisma.message.findFirst({
          where: {
            metadata: { path: ['uazapiMessageId'], equals: inbound.id },
          },
          select: { id: true },
        });
        if (echoed) {
          return reply.code(202).send({ status: 'ignored', reason: 'self-echo' });
        }
      }

      // (b) humano respondeu pelo celular. Precisa de paciente/conversa.
      if (!inbound.from) {
        return reply.code(202).send({ status: 'ignored', reason: 'fromMe-no-target' });
      }

      const patient = await upsertPatient({
        tenantId,
        phone: inbound.from,
        name: inbound.pushName,
      });
      const conversation = await getOrCreateActiveConversation({
        tenantId,
        patientId: patient.id,
      });

      // Pausa PERMANENTE — humano respondeu pelo celular, IA so volta se
      // alguem clicar "Devolver para IA" no dashboard. Mesma decisao
      // operacional aplicada quando humano responde pelo dashboard.
      const pauseUntil = new Date('2099-12-31T23:59:59Z');

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          aiPausedUntil: pauseUntil,
          lastMessageAt: new Date(),
        },
      });

      await addMessage({
        conversationId: conversation.id,
        role: 'human',
        content: inbound.text || (inbound.media ? `[${inbound.media.kind}]` : ''),
        metadata: {
          uazapiMessageId: inbound.id,
          source: 'whatsapp_phone',
          fromMe: true,
          pausedUntil: pauseUntil.toISOString(),
        },
      });

      // Cancela qualquer agent_turn pendente para nao responder agora
      try {
        const pending = await agentTurnQueue.getJob(agentTurnJobId(conversation.id));
        if (pending) await pending.remove().catch(() => undefined);
      } catch {
        /* ignore */
      }

      eventBus.emitDomain({
        type: 'conversation.ai_paused',
        tenantId,
        conversationId: conversation.id,
        pausedUntil: pauseUntil.toISOString(),
      });

      req.log.info(
        { conversationId: conversation.id, pauseUntil: pauseUntil.toISOString() },
        'IA pausada: humano respondeu pelo numero da clinica',
      );

      return reply.code(202).send({ status: 'human_takeover', pauseUntil });
    }

    // Fluxo normal: mensagem do paciente
    await incomingMessageQueue.add('process', {
      tenantId,
      from: inbound.from,
      pushName: inbound.pushName,
      text: inbound.text,
      providerMessageId: inbound.id,
      receivedAt: inbound.timestamp * 1000,
      media: inbound.media,
    });

    // O "visualizado" (✓✓ azul) é disparado JUNTO com o "Digitando..." pelo
    // sendText do primeiro chunk (flag `readMessages: true` na Uazapi).
    // Isso sincroniza com o tempo da IA processar: paciente vê ✓✓ azul e
    // "Digitando..." aparecer juntos, como uma pessoa que abre o app e
    // começa a responder. Sem setTimeout standalone aqui.

    return reply.code(202).send({ status: 'queued' });
  });
}
