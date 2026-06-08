import type {
  DownloadedMedia,
  InboundMediaKind,
  InboundMessage,
  InstanceConnectionState,
  InstanceStatus,
  SendMediaInput,
  SendMediaResponse,
  SendTextInput,
  SendTextResponse,
  UazapiConfig,
} from './types.js';

export class UazapiClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(config: UazapiConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.token = config.token;
  }

  async sendText(input: SendTextInput): Promise<SendTextResponse> {
    const body: Record<string, unknown> = {
      number: input.number,
      text: input.text,
      delay: input.delayMs ?? 0,
    };
    if (input.readChat) body.readchat = true;
    if (input.readMessages) body.readmessages = true;
    if (input.replyId) body.replyid = input.replyId;

    const res = await fetch(`${this.baseUrl}/send/text`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: this.token },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Uazapi send/text failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { messageid?: string; id?: string; status?: string };
    return {
      id: json.messageid ?? json.id ?? '',
      status: json.status ?? 'sent',
      raw: json,
    };
  }

  /**
   * Envia mídia (imagem, áudio, vídeo ou documento) via POST /send/media.
   * Campo `file` aceita URL pública, caminho local ou base64, conforme docs Uazapi.
   */
  async sendMedia(input: SendMediaInput): Promise<SendMediaResponse> {
    const body: Record<string, unknown> = {
      number: input.number,
      type: input.kind,
      file: input.file,
      delay: input.delayMs ?? 0,
    };
    if (input.text) body.text = input.text;
    if (input.kind === 'document' && input.filename) body.docName = input.filename;

    const res = await fetch(`${this.baseUrl}/send/media`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: this.token },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Uazapi send/media failed (${res.status}): ${text}`);
    }

    const json = (await res.json()) as { messageid?: string; id?: string; status?: string };
    return {
      id: json.messageid ?? json.id ?? '',
      status: json.status ?? 'sent',
      raw: json,
    };
  }

  /**
   * Envia presença (digitando / gravando / disponível) para o paciente.
   * Aparece como "digitando..." ou "gravando..." na conversa do WhatsApp.
   *
   * Estados aceitos pela Uazapi:
   *   - composing  → "digitando..."
   *   - recording  → "gravando áudio..."
   *   - paused     → para de mostrar
   *   - available  → online
   *   - unavailable → offline
   */
  async sendPresence(input: {
    number: string;
    presence: 'composing' | 'recording' | 'paused' | 'available' | 'unavailable';
    /** Quantos ms manter o presence ativo antes de auto-parar (algumas versões aceitam). */
    delay?: number;
  }): Promise<void> {
    // Endpoints comuns da Uazapi para presence
    const endpoints = [
      `${this.baseUrl}/message/presence`,
      `${this.baseUrl}/sender/presence`,
      `${this.baseUrl}/instance/presence`,
    ];

    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: this.token },
          body: JSON.stringify({
            number: input.number,
            presence: input.presence,
            delay: input.delay ?? 0,
          }),
        });
        if (res.ok) return; // sucesso, sai
      } catch {
        /* tenta próximo endpoint */
      }
    }
    // Se falhar em todos, não é fatal — só não aparece o "digitando"
  }

  /**
   * Marca uma mensagem como lida (check duplo azul) na conversa do paciente.
   * Aparece como "visualizado" no celular dele.
   */
  async markAsRead(input: {
    number: string;
    messageId: string;
  }): Promise<void> {
    const endpoints = [
      `${this.baseUrl}/message/markRead`,
      `${this.baseUrl}/message/read`,
      `${this.baseUrl}/messages/markRead`,
      `${this.baseUrl}/chat/markRead`,
    ];
    for (const endpoint of endpoints) {
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', token: this.token },
          body: JSON.stringify({
            number: input.number,
            messageid: input.messageId,
            id: input.messageId,
          }),
        });
        if (res.ok) return;
      } catch {
        /* tenta próximo endpoint */
      }
    }
  }

  /**
   * Inicia a conexão da instância. Se já estiver desconectada, a Uazapi gera QR
   * e/ou código de pareamento; com `phone`, força o uso de pairing code numérico.
   */
  async connectInstance(phone?: string): Promise<InstanceStatus> {
    const res = await fetch(`${this.baseUrl}/instance/connect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', token: this.token },
      body: JSON.stringify(phone ? { phone } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Uazapi instance/connect failed (${res.status}): ${text}`);
    }
    const json = (await res.json()) as Record<string, unknown>;
    return this.toInstanceStatus(json);
  }

  /** Consulta o estado atual da instância (QR ainda válido, já conectada, etc). */
  async getInstanceStatus(): Promise<InstanceStatus> {
    // /instance/status é o mais comum, /instance/info aparece em algumas versões.
    const endpoints = [`${this.baseUrl}/instance/status`, `${this.baseUrl}/instance`];
    let lastErr: string = '';
    for (const endpoint of endpoints) {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json', token: this.token },
      });
      if (res.ok) {
        const json = (await res.json()) as Record<string, unknown>;
        return this.toInstanceStatus(json);
      }
      lastErr = `${endpoint} -> ${res.status}`;
    }
    throw new Error(`Uazapi instance status failed: ${lastErr}`);
  }

  /** Desconecta a instância atual (força logout). */
  async disconnectInstance(): Promise<void> {
    const endpoints = [
      `${this.baseUrl}/instance/disconnect`,
      `${this.baseUrl}/instance/logout`,
    ];
    for (const endpoint of endpoints) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', token: this.token },
      });
      if (res.ok) return;
    }
    throw new Error('Uazapi instance disconnect failed');
  }

  /** Normaliza as variações de formato que a Uazapi retorna. */
  private toInstanceStatus(json: Record<string, unknown>): InstanceStatus {
    const pickString = (obj: Record<string, unknown>, keys: string[]): string | undefined => {
      for (const k of keys) {
        const v = obj[k];
        if (typeof v === 'string' && v.length > 0) return v;
      }
      return undefined;
    };

    // Alguns endpoints retornam { instance: {...}, qrcode: "..."}
    const instanceBag = (json.instance as Record<string, unknown>) ?? json;

    const rawState =
      pickString(instanceBag, ['status', 'state', 'connectionStatus']) ??
      pickString(json, ['status', 'state']);

    let state: InstanceConnectionState = 'unknown';
    if (rawState) {
      const s = rawState.toLowerCase();
      if (s.includes('connected') || s === 'open') state = 'connected';
      else if (s.includes('connect') || s === 'loading') state = 'connecting';
      else if (s.includes('pair') || s.includes('qr')) state = 'pairing';
      else if (s.includes('disconn') || s === 'close' || s === 'closed') state = 'disconnected';
    }

    const qrcode =
      pickString(json, ['qrcode', 'qr', 'base64', 'qr_base64']) ??
      pickString(instanceBag, ['qrcode', 'qr', 'base64', 'qr_base64']);

    const pairCode =
      pickString(json, ['paircode', 'pairingCode', 'pairCode', 'code']) ??
      pickString(instanceBag, ['paircode', 'pairingCode', 'pairCode', 'code']);

    const phone =
      pickString(instanceBag, ['phone', 'owner', 'ownerJid', 'wa_number']) ??
      pickString(json, ['phone', 'owner']);

    const profileName =
      pickString(instanceBag, ['profileName', 'name', 'pushName', 'wa_name']) ??
      pickString(json, ['profileName', 'name']);

    const normalizedPhone = phone?.replace(/@.*/, '').replace(/^\+/, '') || undefined;
    // Estritamente: "connected" so eh real se houver um numero pareado.
    // A Uazapi marca state=connected mesmo quando a instancia existe sem WhatsApp pareado.
    // Tambem ignoramos "phone" suspeito (vazio, "0", "null") como sentinela.
    const hasValidPhone =
      !!normalizedPhone && normalizedPhone.length >= 8 && /^\d+$/.test(normalizedPhone);

    if (state === 'connected' && !hasValidPhone) {
      // Instancia de pe mas sem WhatsApp pareado: mostra como pairing/disconnected
      // pra UI exibir o botao "Conectar" em vez de "Desconectar".
      state = qrcode || pairCode ? 'pairing' : 'disconnected';
    }

    return {
      state,
      qrcode,
      pairCode,
      phone: hasValidPhone ? normalizedPhone : undefined,
      profileName: hasValidPhone ? profileName : undefined,
      raw: json,
    };
  }

  /**
   * Baixa a mídia de uma mensagem (áudio/imagem/doc/vídeo).
   * Tenta primeiro a URL direta contida no webhook (quando houver);
   * se falhar, chama o endpoint oficial da Uazapi que recupera + descriptografa.
   */
  async downloadMedia(params: {
    messageId: string;
    url?: string;
  }): Promise<DownloadedMedia> {
    const attempts: string[] = [];

    // 1) URL direta (caso já venha completa e pública)
    if (params.url) {
      try {
        const res = await fetch(params.url);
        if (res.ok) {
          const buffer = Buffer.from(await res.arrayBuffer());
          return {
            mimetype: res.headers.get('content-type') ?? 'application/octet-stream',
            buffer,
          };
        }
        attempts.push(`direct-url -> ${res.status}`);
      } catch (err) {
        attempts.push(`direct-url -> err:${(err as Error).message}`);
      }
    }

    // 2) Vários endpoints conhecidos da Uazapi (varia por versão)
    const endpoints = [
      // Mais comuns na Uazapi atual
      `${this.baseUrl}/message/download`,
      `${this.baseUrl}/message/downloadMedia`,
      `${this.baseUrl}/messages/download`,
      `${this.baseUrl}/messages/downloadMedia`,
      `${this.baseUrl}/api/v1/message/download`,
      `${this.baseUrl}/api/message/download`,
      `${this.baseUrl}/getMedia`,
    ];

    // Vários formatos de body que a Uazapi pode aceitar
    const bodies: Array<Record<string, unknown>> = [
      { id: params.messageId, messageid: params.messageId },
      { messageid: params.messageId },
      { messageId: params.messageId },
      { id: params.messageId },
    ];

    for (const endpoint of endpoints) {
      for (const body of bodies) {
        try {
          const res = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', token: this.token },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            attempts.push(`${endpoint} (${Object.keys(body).join(',')}) -> ${res.status}`);
            continue;
          }
          // Tenta como JSON primeiro
          const ct = res.headers.get('content-type') ?? '';
          if (ct.includes('application/json')) {
            const json = (await res.json()) as {
              file?: string;
              base64?: string;
              data?: string;
              mediaBase64?: string;
              fileBase64?: string;
              mimetype?: string;
              mimeType?: string;
              url?: string;
              downloadUrl?: string;
            };
            const b64 = json.file ?? json.base64 ?? json.data ?? json.mediaBase64 ?? json.fileBase64;
            if (b64) {
              return {
                mimetype: json.mimetype ?? json.mimeType ?? 'application/octet-stream',
                buffer: Buffer.from(b64, 'base64'),
              };
            }
            // Resposta pode vir com URL pra download (segunda etapa)
            const downloadUrl = json.url ?? json.downloadUrl;
            if (downloadUrl) {
              const sub = await fetch(downloadUrl);
              if (sub.ok) {
                const buffer = Buffer.from(await sub.arrayBuffer());
                return {
                  mimetype: sub.headers.get('content-type') ?? 'application/octet-stream',
                  buffer,
                };
              }
              attempts.push(`${endpoint} -> ${downloadUrl} -> ${sub.status}`);
            } else {
              attempts.push(`${endpoint} ok mas sem b64/url no JSON`);
            }
          } else {
            // Resposta direta (binário)
            const buffer = Buffer.from(await res.arrayBuffer());
            if (buffer.byteLength > 0) {
              return {
                mimetype: ct || 'application/octet-stream',
                buffer,
              };
            }
            attempts.push(`${endpoint} -> binário vazio`);
          }
        } catch (err) {
          attempts.push(`${endpoint} -> err:${(err as Error).message}`);
        }
      }
    }

    throw new Error(
      `Uazapi media download failed for ${params.messageId}. Tentativas: ${attempts.slice(0, 6).join(' | ')}`,
    );
  }

  /**
   * Tipos de mensagem Uazapi/WhatsApp que o sistema aceita. Qualquer outro
   * tipo (reactionMessage, stickerMessage, buttonsResponseMessage,
   * protocolMessage, callMessage, etc.) eh descartado sem ruido.
   */
  static readonly ACCEPTED_MESSAGE_TYPES: ReadonlySet<string> = new Set([
    'conversation',
    'ephemeralmessage',
    'extendedtextmessage',
    'audiomessage',
    'imagemessage',
    'videomessage',
    'documentmessage',
  ]);

  /** Campo `type` (shortcut) aceito quando `messageType` nao vier. */
  static readonly ACCEPTED_CONTENT_TYPES: ReadonlySet<string> = new Set([
    'text',
    'audio',
    'ptt',
    'image',
    'video',
    'document',
  ]);

  parseInbound(payload: unknown): InboundMessage | null {
    const envelope = payload as {
      EventType?: string;
      event?: string;
      chat?: {
        name?: string;
        wa_name?: string;
        wa_contactName?: string;
        lead_fullName?: string;
        lead_name?: string;
        wa_isGroup?: boolean;
      };
      message?: {
        id?: string;
        messageid?: string;
        chatid?: string;
        sender_pn?: string;
        senderName?: string;
        fromMe?: boolean;
        isGroup?: boolean;
        type?: string;
        messageType?: string;
        mediaType?: string;
        content?: string | Record<string, unknown>;
        text?: string;
        caption?: string;
        fileName?: string;
        mimeType?: string;
        mimetype?: string;
        fileURL?: string;
        mediaURL?: string;
        url?: string;
        seconds?: number;
        messageTimestamp?: number | string;
      };
    };

    const msg = envelope?.message;
    if (!msg) return null;

    // Ignorar mensagens de grupo (o bot é 1:1 por enquanto)
    if (msg.isGroup || envelope.chat?.wa_isGroup) return null;

    const fromMe = msg.fromMe === true;

    // Extrair telefone: chatid = "5511xxx@s.whatsapp.net" → "5511xxx"
    const rawFrom = msg.sender_pn ?? msg.chatid ?? '';
    const from = rawFrom.replace(/@.*/, '').replace(/:\d+$/, '');
    if (!from) return null;

    // Tipo de mídia — Uazapi usa 'type' (text/image/audio/video/document)
    // ou 'messageType' (Conversation/ImageMessage/AudioMessage/EphemeralMessage/...)
    const rawType = (msg.type ?? '').toLowerCase();
    const rawMessageType = (msg.messageType ?? '').toLowerCase();
    const mediaTypeLower = (msg.mediaType ?? '').toLowerCase();

    // Allowlist explícita: rejeita reaction, sticker, buttons, protocol, call, etc.
    // EphemeralMessage entra aqui; como é wrapper, o conteúdo real fica exposto em
    // msg.type/msg.text/msg.mediaType como se fosse normal.
    const messageTypeAllowed =
      rawMessageType !== '' && UazapiClient.ACCEPTED_MESSAGE_TYPES.has(rawMessageType);
    const contentTypeAllowed =
      rawType !== '' && UazapiClient.ACCEPTED_CONTENT_TYPES.has(rawType);

    if (!messageTypeAllowed && !contentTypeAllowed) {
      return null;
    }

    // EphemeralMessage: o tipo real vem em msg.type ou msg.mediaType.
    // Se mesmo assim nao identificarmos sub-tipo, tratamos como texto
    // (a maioria das efêmeras são de texto).
    const isText =
      rawType === 'text' ||
      rawMessageType === 'conversation' ||
      rawMessageType === 'extendedtextmessage' ||
      (rawMessageType === 'ephemeralmessage' && !rawType && !mediaTypeLower);
    const isAudio =
      rawType === 'audio' ||
      rawType === 'ptt' ||
      rawMessageType === 'audiomessage' ||
      mediaTypeLower === 'audio';
    const isImage =
      rawType === 'image' ||
      rawMessageType === 'imagemessage' ||
      mediaTypeLower === 'image';
    const isVideo =
      rawType === 'video' ||
      rawMessageType === 'videomessage' ||
      mediaTypeLower === 'video';
    const isDocument =
      rawType === 'document' ||
      rawMessageType === 'documentmessage' ||
      mediaTypeLower === 'document';

    // content pode vir como string (texto) ou objeto (mídia com {url, mimeType, ...})
    const contentObj =
      msg.content && typeof msg.content === 'object' && !Array.isArray(msg.content)
        ? (msg.content as Record<string, unknown>)
        : null;
    const contentStr = typeof msg.content === 'string' ? msg.content : '';

    let text = msg.text ?? (isText ? contentStr : '') ?? '';
    let media: InboundMessage['media'];

    // URL da mídia: procura nos campos diretos OU dentro do content (quando é objeto)
    const mediaUrl =
      msg.fileURL ??
      msg.mediaURL ??
      msg.url ??
      (contentObj?.url as string | undefined) ??
      (contentObj?.fileURL as string | undefined) ??
      (contentObj?.mediaURL as string | undefined) ??
      (contentObj?.downloadUrl as string | undefined);
    const mime =
      msg.mimeType ??
      msg.mimetype ??
      (contentObj?.mimeType as string | undefined) ??
      (contentObj?.mimetype as string | undefined);
    const seconds =
      msg.seconds ??
      (contentObj?.seconds as number | undefined) ??
      (contentObj?.duration as number | undefined);

    if (isAudio) {
      media = { kind: 'audio' as InboundMediaKind, mimetype: mime, url: mediaUrl, seconds };
      if (!text) text = '[áudio]';
    } else if (isImage) {
      media = { kind: 'image' as InboundMediaKind, mimetype: mime, url: mediaUrl, caption: msg.caption };
      if (!text) text = msg.caption ?? '[imagem]';
    } else if (isVideo) {
      media = { kind: 'video' as InboundMediaKind, mimetype: mime, url: mediaUrl, caption: msg.caption };
      if (!text) text = msg.caption ?? '[vídeo]';
    } else if (isDocument) {
      media = { kind: 'document' as InboundMediaKind, mimetype: mime, url: mediaUrl };
      if (!text) text = msg.fileName ?? '[documento]';
    }

    if (!text && !media) return null;

    // Uazapi manda timestamp em ms. InboundMessage usa segundos.
    const rawTs =
      typeof msg.messageTimestamp === 'string'
        ? Number.parseInt(msg.messageTimestamp, 10)
        : (msg.messageTimestamp ?? Date.now());
    const timestamp = rawTs > 1e12 ? Math.floor(rawTs / 1000) : rawTs;

    const pushName =
      msg.senderName ||
      envelope.chat?.lead_fullName ||
      envelope.chat?.lead_name ||
      envelope.chat?.wa_contactName ||
      envelope.chat?.wa_name ||
      envelope.chat?.name;

    return {
      id: msg.messageid ?? msg.id ?? '',
      from,
      text,
      pushName: pushName || undefined,
      timestamp,
      fromMe,
      media,
      raw: payload,
    };
  }
}

export function createUazapiClient(config: UazapiConfig): UazapiClient {
  return new UazapiClient(config);
}
