/**
 * Envio humanizado: divide a resposta da IA em mensagens menores
 * (parágrafos / frases) e envia cada uma com delay proporcional
 * ao tempo de leitura — simula uma pessoa digitando.
 */
import type { FastifyBaseLogger } from 'fastify';
import { uazapi } from './uazapi.js';
import { addMessage } from './conversation.js';

const MAX_CHUNKS = 4;
const MIN_CHUNK_LEN = 30;
const SINGLE_CHUNK_THRESHOLD = 220; // se a msg toda for curta, manda 1 só

/**
 * WhatsApp usa markdown próprio: *negrito*, _italico_, ~tachado~, ```mono```.
 * O modelo tende a usar markdown padrão (** **). Sanitiza antes de mandar.
 */
function sanitizeForWhatsApp(text: string): string {
  return text
    // **negrito** -> *negrito* (preserva pelo menos 1 char dentro)
    .replace(/\*\*(.+?)\*\*/gs, '*$1*')
    // __palavra__ -> _palavra_  (markdown bold com _ vira italico)
    .replace(/__(.+?)__/gs, '_$1_')
    // ~~tachado~~ -> ~tachado~
    .replace(/~~(.+?)~~/gs, '~$1~')
    // links Markdown [texto](url) -> texto (url)
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 ($2)')
    // Cabeçalhos Markdown (# ## ###) viram negrito do WhatsApp
    .replace(/^(#{1,6})\s+(.+)$/gm, '*$2*')
    // Bullets com '- ' viram '• ' (mais limpo no WhatsApp)
    .replace(/^(\s*)-\s+/gm, '$1• ');
}

/** Quebra texto em pedaços naturais (já sanitizado para WhatsApp). */
export function splitForHuman(rawText: string): string[] {
  const trimmed = sanitizeForWhatsApp(rawText).trim();
  if (!trimmed) return [];

  // Texto curto vai inteiro
  if (trimmed.length < SINGLE_CHUNK_THRESHOLD && !trimmed.includes('\n\n')) {
    return [trimmed];
  }

  // 1ª tentativa: quebrar por parágrafos
  let parts = trimmed
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // Se ainda for 1 só parágrafo mas longo, quebra por sentença
  if (parts.length === 1 && trimmed.length > 320) {
    parts = trimmed
      .split(/(?<=[.!?])\s+(?=[A-ZÀ-Ú])/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // Mescla pedaços muito curtos no anterior
  const merged: string[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && (last.length < MIN_CHUNK_LEN || p.length < MIN_CHUNK_LEN)) {
      merged[merged.length - 1] = `${last}\n\n${p}`;
    } else {
      merged.push(p);
    }
  }

  // Limita ao máximo, agrupando o "rabo" no último
  if (merged.length > MAX_CHUNKS) {
    const head = merged.slice(0, MAX_CHUNKS - 1);
    const tail = merged.slice(MAX_CHUNKS - 1).join('\n\n');
    return [...head, tail];
  }

  return merged.length > 0 ? merged : [trimmed];
}

/**
 * Delay em ms entre mensagens. Aprox. 25 char/s leitura
 * + variação aleatória pra parecer humano.
 */
export function humanDelayMs(previousText: string): number {
  const base = 800;
  const readTime = Math.min(previousText.length * 35, 3500);
  const jitter = Math.floor(Math.random() * 400);
  return base + readTime + jitter;
}

interface HumanizedSendInput {
  conversationId: string;
  patientPhone: string;
  text: string;
  metadataBase?: Record<string, unknown>;
  logger?: FastifyBaseLogger;
}

interface HumanizedSendResult {
  chunkCount: number;
  uazapiMessageIds: string[];
}

/**
 * Envia mensagem humanizada (chunks com delay) E salva cada chunk
 * como Message individual no banco com seu uazapiMessageId.
 */
export async function sendHumanized(input: HumanizedSendInput): Promise<HumanizedSendResult> {
  const chunks = splitForHuman(input.text);
  const ids: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;

    if (i > 0) {
      const delay = humanDelayMs(chunks[i - 1]!);
      await new Promise((r) => setTimeout(r, delay));
    }

    try {
      const sent = await uazapi.sendText({ number: input.patientPhone, text: chunk });
      ids.push(sent.id);
      await addMessage({
        conversationId: input.conversationId,
        role: 'assistant',
        content: chunk,
        metadata: {
          ...(input.metadataBase ?? {}),
          uazapiMessageId: sent.id,
          chunkIndex: i,
          chunkTotal: chunks.length,
        },
      });
    } catch (err) {
      input.logger?.error({ err, chunkIndex: i }, 'humanized send chunk failed');
      // Salva mesmo se Uazapi falhar (pra dashboard ter o histórico)
      await addMessage({
        conversationId: input.conversationId,
        role: 'assistant',
        content: chunk,
        metadata: {
          ...(input.metadataBase ?? {}),
          chunkIndex: i,
          chunkTotal: chunks.length,
          sendError: (err as Error).message,
        },
      });
      throw err; // propaga pro chamador decidir
    }
  }

  return { chunkCount: chunks.length, uazapiMessageIds: ids };
}
