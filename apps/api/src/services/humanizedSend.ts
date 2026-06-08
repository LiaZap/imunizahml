/**
 * Envio humanizado: divide a resposta da IA em mensagens menores
 * (parágrafos / frases) e envia cada uma com delay proporcional
 * ao tempo de leitura — simula uma pessoa digitando.
 */
import type { FastifyBaseLogger } from 'fastify';
import { uazapi } from './uazapi.js';
import { addMessage } from './conversation.js';

const MAX_CHUNKS = 7;
const MIN_CHUNK_LEN = 18;
const SINGLE_CHUNK_THRESHOLD = 110; // só envia inteiro se for bem curto e sem quebras
const LONG_PARAGRAPH = 180; // se um parágrafo passa disso, ainda subdivide por sentença

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

  const hasBullets = /(^|\n)\s*•\s+/.test(trimmed);

  // Texto bem curto, sem quebras nem bullets → 1 mensagem só
  if (trimmed.length < SINGLE_CHUNK_THRESHOLD && !trimmed.includes('\n\n') && !hasBullets) {
    return [trimmed];
  }

  // 1ª camada: split por parágrafos (\n\n+)
  let parts = trimmed
    .split(/\n\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // 2ª camada: dentro de cada parágrafo, se houver bullets, cada bullet vira sub-parte
  const afterBullets: string[] = [];
  for (const p of parts) {
    if (/(^|\n)\s*•\s+/.test(p)) {
      // Separa o texto introdutório (antes do 1º bullet) dos bullets em si
      const lines = p.split(/\n/);
      const intro: string[] = [];
      const bullets: string[] = [];
      let started = false;
      for (const ln of lines) {
        if (/^\s*•\s+/.test(ln)) {
          started = true;
          bullets.push(ln.trim());
        } else if (!started) {
          intro.push(ln);
        } else {
          // Linha de continuação do bullet anterior
          if (bullets.length > 0) {
            bullets[bullets.length - 1] = `${bullets[bullets.length - 1]} ${ln.trim()}`;
          } else {
            intro.push(ln);
          }
        }
      }
      const introText = intro.join(' ').trim();
      if (introText) afterBullets.push(introText);
      for (const b of bullets) afterBullets.push(b);
    } else {
      afterBullets.push(p);
    }
  }
  parts = afterBullets;

  // 3ª camada: parágrafos longos vão pra split por sentença
  const sentenceSplit: string[] = [];
  for (const p of parts) {
    if (p.length > LONG_PARAGRAPH) {
      const sents = p
        .split(/(?<=[.!?])\s+(?=[A-ZÀ-Úa-zÀ-ú])/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (sents.length > 1) {
        sentenceSplit.push(...sents);
        continue;
      }
    }
    sentenceSplit.push(p);
  }
  parts = sentenceSplit;

  // Dedup de saudacao: se o chunk 2+ comecar com "Ola/Oi/Tudo bem/Bom dia"
  // E o chunk anterior tambem comecou com saudacao, remove a saudacao do
  // segundo (mantem so o conteudo). Evita "Ola!" + "Oi! Como posso..." picados.
  const SALUTATION_RE =
    /^\s*(ol[aá]|oi|tudo bem|bom dia|boa tarde|boa noite|ei!?)[\s,!.?]*/i;
  const isSalutation = (s: string) => SALUTATION_RE.test(s);
  const stripSalutation = (s: string) => s.replace(SALUTATION_RE, '').trim();

  const dedupedSalutations: string[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i]!;
    if (i > 0 && isSalutation(p) && dedupedSalutations.some(isSalutation)) {
      const stripped = stripSalutation(p);
      if (stripped) dedupedSalutations.push(stripped);
    } else {
      dedupedSalutations.push(p);
    }
  }
  parts = dedupedSalutations;

  // Mescla pedaços muito curtos com o anterior (evita emoji sozinho)
  const merged: string[] = [];
  for (const p of parts) {
    const last = merged[merged.length - 1];
    if (last && p.length < MIN_CHUNK_LEN) {
      merged[merged.length - 1] = `${last}\n${p}`;
    } else {
      merged.push(p);
    }
  }

  // Limita ao máximo, agrupando o "rabo" no último
  if (merged.length > MAX_CHUNKS) {
    const head = merged.slice(0, MAX_CHUNKS - 1);
    const tail = merged.slice(MAX_CHUNKS - 1).join('\n');
    return [...head, tail];
  }

  return merged.length > 0 ? merged : [trimmed];
}

/**
 * Delay em ms entre mensagens. Simula pessoa digitando: pausa curta
 * proporcional ao tamanho da próxima frase. Como agora geramos mais
 * chunks (até 7), as pausas são mais enxutas pra a conversa fluir.
 */
export function humanDelayMs(previousText: string): number {
  const base = 450;
  const readTime = Math.min(previousText.length * 22, 1800);
  const jitter = Math.floor(Math.random() * 350);
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
/**
 * Tempo de "digitação" antes de enviar um chunk.
 * Janela 10-15s para parecer pessoa real digitando no celular.
 * Texto curto fica perto de 10s, texto longo perto de 15s.
 */
function typingDurationMs(text: string): number {
  const minMs = 10_000;
  const maxMs = 15_000;
  // Quanto maior o texto, mais perto do maximo (saturando em 150 chars)
  const lengthRatio = Math.min(1, text.length / 150);
  const base = minMs + Math.floor(lengthRatio * (maxMs - minMs));
  const jitter = Math.floor(Math.random() * 1000) - 500; // ±500ms
  return Math.max(minMs, Math.min(maxMs, base + jitter));
}

export async function sendHumanized(input: HumanizedSendInput): Promise<HumanizedSendResult> {
  const chunks = splitForHuman(input.text);
  const ids: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!;

    if (i > 0) {
      // Pausa entre chunks (depois da chegada da mensagem anterior — leitura)
      const delay = humanDelayMs(chunks[i - 1]!);
      await new Promise((r) => setTimeout(r, delay));
    }

    // Tempo de digitação (a Uazapi mostra "Digitando..." durante esse tempo
    // se passarmos via param `delay` no sendText).
    const typing = typingDurationMs(chunk);

    try {
      const sent = await uazapi.sendText({
        number: input.patientPhone,
        text: chunk,
        delayMs: typing,
        // Só no primeiro chunk: marca as mensagens do paciente como lidas (check duplo azul)
        readMessages: i === 0,
        readChat: i === 0,
      });
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
