import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),

  OPENAI_API_KEY: z.string().min(1),
  OPENAI_CHAT_MODEL: z.string().default('gpt-4.1'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  UAZAPI_URL: z.string().url(),
  UAZAPI_TOKEN: z.string().default(''),
  UAZAPI_INSTANCE: z.string().default(''),
  UAZAPI_WEBHOOK_SECRET: z.string().min(8),

  /** Delay do debounce das mensagens do paciente antes da IA responder (ms).
   *  8s dá respiro pra mensagens picadas típicas do WhatsApp (várias frases
   *  curtas em sequência) sem disparar a IA antes do paciente terminar. */
  MESSAGE_BUFFER_MS: z.coerce.number().int().min(0).max(30_000).default(8000),

  /** Quanto tempo a IA fica pausada depois que um humano respondeu pelo numero real. */
  AI_HUMAN_OVERRIDE_PAUSE_MS: z.coerce
    .number()
    .int()
    .min(60_000)
    .max(24 * 60 * 60_000)
    .default(2 * 60 * 60_000),

  API_PORT: z.coerce.number().int().positive().default(3001),
  API_BASE_URL: z.string().url(),
  DASHBOARD_BASE_URL: z.string().url(),

  AUTH_SECRET: z.string().min(16),
  AUTH_URL: z.string().url(),

  /** OAuth do Google Calendar (opcional — se nao setado, integracao fica desligada) */
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_OAUTH_REDIRECT_URI: z.string().default(''),

  DEFAULT_TENANT_NAME: z.string().default('Clinica Imuniza'),
  DEFAULT_ADMIN_EMAIL: z.string().email().default('admin@imuniza.local'),
  DEFAULT_ADMIN_PASSWORD: z.string().default('change-me'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment variables:\n${details}`);
  }
  return parsed.data;
}
