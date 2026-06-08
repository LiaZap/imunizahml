import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';
import type { FastifyBaseLogger } from 'fastify';
import type OpenAI from 'openai';
import { addMessage, loadHistory } from './conversation.js';
import { functionHandlers, type FunctionContext } from './functions.js';
import { ai } from './openai.js';
import { sendHumanized } from './humanizedSend.js';
import { getTenantConfig } from './tenant.js';
import {
  isWithinBusinessHours,
  nextBusinessOpeningLabel,
  type BusinessHoursConfig,
} from './businessHours.js';
import { prisma } from '@imuniza/db';

const MAX_TOOL_ITERATIONS = 8;

interface RunAgentInput {
  tenantId: string;
  conversationId: string;
  patientId: string;
  patientPhone: string;
  logger: FastifyBaseLogger;
}

interface TenantPersonaConfig {
  persona?: string;
  greeting?: string;
  businessHours?: { start: string; end: string; timezone: string };
}

type ChatMessage = OpenAI.Chat.Completions.ChatCompletionMessageParam;

export async function runAgent(input: RunAgentInput): Promise<void> {
  const tenant = await getTenantConfig(input.tenantId);
  const personaConfig = (tenant.config as TenantPersonaConfig | null) ?? {};

  const patient = await prisma.patient.findUnique({ where: { id: input.patientId } });
  const profile = patient?.profile ?? {};
  const history = await loadHistory(input.conversationId, 20);

  const system = buildSystemPrompt({
    clinicName: tenant.name,
    persona: personaConfig.persona ?? 'Seja acolhedora, clara e breve.',
    businessHours: personaConfig.businessHours,
    currentDate: new Date().toISOString().slice(0, 10),
  });

  // Contexto de horário: a IA continua atendendo, mas precisa saber se
  // está dentro do expediente para informar previsão de retorno da equipe.
  const businessHours = personaConfig.businessHours as BusinessHoursConfig | undefined;
  const inBusinessHours = isWithinBusinessHours(businessHours);
  const nextOpening = inBusinessHours ? null : nextBusinessOpeningLabel(businessHours);
  const tz = businessHours?.timezone ?? 'America/Sao_Paulo';
  const localTime = new Intl.DateTimeFormat('pt-BR', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'long',
    day: '2-digit',
    month: 'short',
  }).format(new Date());

  const businessContext = inBusinessHours
    ? `Estamos dentro do horário comercial. A equipe pode confirmar agendamentos AGORA ao receber o handoff.`
    : `**Estamos FORA do horário comercial** (agora: ${localTime}). Continue atendendo normalmente o paciente — informe, oriente, registre o perfil. ` +
      `Quando o paciente quiser agendar, mencione com cuidado que a equipe humana retorna ${nextOpening} para confirmar o horário, e ainda assim use \`request_handoff\` para deixar registrado. ` +
      `NÃO recuse perguntas só porque é noite/fim de semana — você está aqui justamente para acolher fora do expediente.`;

  const messages: ChatMessage[] = [
    { role: 'system', content: system },
    {
      role: 'system',
      content: `Perfil atual do paciente (JSON): ${JSON.stringify(profile)}. Telefone: ${input.patientPhone}.`,
    },
    { role: 'system', content: businessContext },
    // Filtra mensagens 'tool' do historico: elas sao resultados de
    // function calling intermedios. Nao salvamos o assistant.tool_calls
    // que as referencia, entao se mandassemos a 'tool' sozinha a OpenAI
    // rejeita com "messages with role 'tool' must be a response to a
    // preceeding message with 'tool_calls'". O texto final do assistant
    // ja foi salvo separadamente, entao a conversa fica integra.
    // Tambem dropa 'human' (atendente) e 'system' (interno) — assistant
    // do humano vira 'assistant' do ponto de vista da IA.
    ...history
      .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'human')
      .map<ChatMessage>((m) => {
        if (m.role === 'user') return { role: 'user', content: m.content };
        // 'human' (atendente) e 'assistant' (IA) sao ambos respostas da clinica
        return { role: 'assistant', content: m.content };
      }),
  ];

  const ctx: FunctionContext = {
    tenantId: input.tenantId,
    conversationId: input.conversationId,
    patientId: input.patientId,
    patientPhone: input.patientPhone,
    logger: input.logger,
  };

  let alreadySentInThisTurn = false;
  let lastFinalText: string | null = null;

  for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
    const completion = await ai.client.chat.completions.create({
      model: ai.chatModel,
      messages,
      tools: functionDefinitions,
      tool_choice: 'auto',
      temperature: 0.4,
    });

    const choice = completion.choices[0];
    if (!choice) break;

    const assistantMsg = choice.message;

    if (assistantMsg.tool_calls && assistantMsg.tool_calls.length > 0) {
      messages.push({
        role: 'assistant',
        content: assistantMsg.content ?? '',
        tool_calls: assistantMsg.tool_calls,
      });

      for (const call of assistantMsg.tool_calls) {
        if (call.type !== 'function') continue;
        const handler = functionHandlers[call.function.name];
        if (!handler) {
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify({ error: `unknown function ${call.function.name}` }),
          });
          continue;
        }

        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(call.function.arguments || '{}');
        } catch (err) {
          input.logger.error({ err, args: call.function.arguments }, 'bad tool args');
        }

        const result = await handler(parsedArgs, ctx);

        // Se a tool ja enviou para o paciente (ex: send_reply), marca
        // pra nao duplicar com o fallback no fim do turno.
        if (result.sideEffects?.sentToPatient) {
          alreadySentInThisTurn = true;
        }

        await addMessage({
          conversationId: input.conversationId,
          role: 'tool',
          content: result.output,
          metadata: { toolName: call.function.name, toolCallId: call.id },
        });

        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: result.output,
        });
      }
      continue;
    }

    const finalText = assistantMsg.content?.trim();
    if (finalText && alreadySentInThisTurn) {
      // Modelo emitiu texto final apos ja ter chamado send_reply. Isso
      // duplicaria a mensagem. So salva no historico sem enviar.
      await addMessage({
        conversationId: input.conversationId,
        role: 'assistant',
        content: finalText,
        metadata: { duplicateOfPriorSendReply: true, notSent: true },
      });
      input.logger.info(
        { finalTextLen: finalText.length },
        'agent fallback skipped — send_reply ja enviou neste turno',
      );
    } else if (finalText) {
      // Fallback humanizado: o modelo respondeu com texto direto, sem
      // chamar send_reply. Mesmo assim mandamos pro paciente quebrando
      // em chunks (sendHumanized salva cada um como Message).
      try {
        const result = await sendHumanized({
          conversationId: input.conversationId,
          patientPhone: input.patientPhone,
          text: finalText,
          metadataBase: { fallbackWithoutToolCall: true },
          logger: input.logger,
        });
        input.logger.info(
          { chunks: result.chunkCount },
          'agent emitted text without send_reply — relayed humanized',
        );
        lastFinalText = finalText;
      } catch (err) {
        input.logger.error({ err }, 'fallback humanized send failed');
      }
    }
    break;
  }

  // Se o loop terminou SEM o modelo emitir texto final (so tool_calls
  // ate atingir MAX_TOOL_ITERATIONS), o paciente fica sem resposta.
  // Loga warning + manda mensagem padrão pra nao deixar o paciente no escuro.
  if (!alreadySentInThisTurn && !lastFinalText) {
    input.logger.warn(
      { conversationId: input.conversationId, maxIterations: MAX_TOOL_ITERATIONS },
      'agent loop terminated WITHOUT final text (max tool iterations) — sending fallback msg',
    );
    try {
      await sendHumanized({
        conversationId: input.conversationId,
        patientPhone: input.patientPhone,
        text: 'Deixa eu verificar isso direitinho com nossa equipe e já te aviso, um instante!',
        metadataBase: { fallbackMaxIterations: true },
        logger: input.logger,
      });
    } catch (err) {
      input.logger.error({ err }, 'fallback max-iterations send failed');
    }
  }
}
