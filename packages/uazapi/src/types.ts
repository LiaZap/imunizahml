export interface UazapiConfig {
  baseUrl: string;
  token: string;
  instance?: string;
}

export interface SendTextInput {
  number: string;
  text: string;
  /**
   * Atraso em ms ANTES do envio. Durante esse tempo aparece "Digitando..."
   * na conversa do paciente. É o jeito oficial da Uazapi de mostrar typing.
   */
  delayMs?: number;
  /** Marca o chat como lido após envio (remove contador de não lidas). */
  readChat?: boolean;
  /** Marca as últimas 10 mensagens recebidas como lidas (check duplo azul). */
  readMessages?: boolean;
  /** ID da mensagem para responder (reply / quote). */
  replyId?: string;
}

export interface SendTextResponse {
  id: string;
  status: string;
  raw?: unknown;
}

export type SendMediaKind = 'image' | 'audio' | 'video' | 'document';

export interface SendMediaInput {
  number: string;
  kind: SendMediaKind;
  /** URL pública, caminho do arquivo ou base64 aceito pela Uazapi. */
  file: string;
  /** Texto acompanhante (caption para imagem/vídeo, corpo para documento). */
  text?: string;
  /** Nome exibido quando kind === 'document'. */
  filename?: string;
  delayMs?: number;
}

export type SendMediaResponse = SendTextResponse;

export type InstanceConnectionState =
  | 'connected'
  | 'connecting'
  | 'disconnected'
  | 'pairing'
  | 'unknown';

export interface InstanceStatus {
  state: InstanceConnectionState;
  /** QR code em data URL ou base64 puro, quando disponível. */
  qrcode?: string;
  /** Código de pareamento curto (8 chars), quando disponível. */
  pairCode?: string;
  /** Telefone conectado (E.164 sem +). */
  phone?: string;
  profileName?: string;
  raw?: unknown;
}

export type InboundMediaKind = 'audio' | 'image' | 'document' | 'video';

export interface InboundMessage {
  id: string;
  /**
   * Numero do paciente (o "outro lado"). Funciona igual em ambas direcoes:
   * quando fromMe = false, eh quem enviou; quando fromMe = true, eh o
   * destinatario (o paciente a quem o numero da clinica respondeu).
   */
  from: string;
  text: string;
  pushName?: string;
  timestamp: number;
  /** True quando a mensagem saiu do proprio numero da clinica (humano ou AI). */
  fromMe: boolean;
  /**
   * True quando a mensagem foi enviada pela API (echo do nosso send).
   * False/undefined quando foi digitada no celular da clinica.
   * Usado pra desambiguar fromMe sem depender do dedup por messageId
   * (que tem race condition — webhook chega antes da Message ser salva).
   */
  sentByApi?: boolean;
  media?: {
    kind: InboundMediaKind;
    mimetype?: string;
    url?: string;
    caption?: string;
    seconds?: number;
  };
  raw: unknown;
}

export interface DownloadedMedia {
  mimetype: string;
  buffer: Buffer;
}
