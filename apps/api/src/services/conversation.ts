import {
  Prisma,
  prisma,
  type Conversation,
  type Message,
  type MessageRole,
  type Patient,
} from '@imuniza/db';
import { eventBus } from '../events/bus.js';

export async function upsertPatient(params: {
  tenantId: string;
  phone: string;
  /** Nome vindo do pushName do WhatsApp. NÃO eh "nome confirmado" — vai pra
   *  profile.pushName, NUNCA pra patient.name. O patient.name so eh setado
   *  quando o paciente confirma como quer ser chamado (via
   *  update_patient_profile chamado pelo agente). */
  name?: string;
}): Promise<Patient> {
  const existing = await prisma.patient.findUnique({
    where: { tenantId_phone: { tenantId: params.tenantId, phone: params.phone } },
  });
  if (existing) {
    // So atualiza pushName no profile (nao toca em patient.name)
    if (params.name) {
      const current = (existing.profile as Record<string, unknown>) ?? {};
      const next = { ...current, pushName: params.name };
      return prisma.patient.update({
        where: { id: existing.id },
        data: { profile: next },
      });
    }
    return existing;
  }
  return prisma.patient.create({
    data: {
      tenantId: params.tenantId,
      phone: params.phone,
      // NAO seta patient.name a partir do pushName
      name: null,
      profile: params.name ? { pushName: params.name } : {},
    },
  });
}

export async function getOrCreateActiveConversation(params: {
  tenantId: string;
  patientId: string;
}): Promise<Conversation> {
  const existing = await prisma.conversation.findFirst({
    where: {
      tenantId: params.tenantId,
      patientId: params.patientId,
      status: { in: ['active', 'awaiting_handoff', 'assigned'] },
    },
    orderBy: { lastMessageAt: 'desc' },
  });

  if (existing) return existing;

  // Se a conversa foi FECHADA recentemente E o aiPausedUntil ainda vale
  // (cooldown pos-fechamento), reabrir essa conversa em vez de criar nova.
  // Assim a equipe nao precisa "fechar de novo" toda vez que o paciente
  // mandar mensagem dentro do cooldown.
  const recentlyClosed = await prisma.conversation.findFirst({
    where: {
      tenantId: params.tenantId,
      patientId: params.patientId,
      status: 'closed',
      aiPausedUntil: { gt: new Date() }, // cooldown ainda ativo
    },
    orderBy: { lastMessageAt: 'desc' },
  });
  if (recentlyClosed) {
    return prisma.conversation.update({
      where: { id: recentlyClosed.id },
      // Reabre como active mas mantem aiPausedUntil — IA continua em silencio
      // ate o cooldown expirar. Se a equipe quiser intervir, responde via
      // dashboard normalmente.
      data: { status: 'active' },
    });
  }

  return prisma.conversation.create({
    data: {
      tenantId: params.tenantId,
      patientId: params.patientId,
      status: 'active',
    },
  });
}

export async function addMessage(params: {
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata?: Prisma.InputJsonValue;
}): Promise<Message> {
  const message = await prisma.message.create({
    data: {
      conversationId: params.conversationId,
      role: params.role,
      content: params.content,
      metadata: params.metadata ?? Prisma.JsonNull,
    },
  });
  const conversation = await prisma.conversation.update({
    where: { id: params.conversationId },
    data: { lastMessageAt: message.createdAt },
    select: { tenantId: true },
  });

  if (params.role === 'user' || params.role === 'assistant' || params.role === 'human') {
    eventBus.emitDomain({
      type: 'message.created',
      tenantId: conversation.tenantId,
      conversationId: params.conversationId,
      messageId: message.id,
      role: params.role,
      content: params.content,
      createdAt: message.createdAt.toISOString(),
    });
  }

  return message;
}

export async function loadHistory(conversationId: string, limit = 20): Promise<Message[]> {
  const rows = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
  return rows.reverse();
}
