/**
 * Integração com Google Calendar via OAuth 2.0.
 *
 * Fluxo:
 * - Admin clica em "Conectar Google" → /google/oauth/start
 * - Backend redireciona para Google consent screen
 * - Google retorna em /google/oauth/callback com `code`
 * - Trocamos code por { access_token, refresh_token }
 * - Salvamos refresh_token em tenant.config.googleCalendar.refreshToken
 * - Em todo create/update/delete de Appointment, push para a agenda configurada
 */
import { google, type calendar_v3 } from 'googleapis';
import { prisma, Prisma } from '@imuniza/db';
import { env } from '../env.js';

export interface GoogleCalendarConfig {
  refreshToken: string;
  /** ID do calendário a ser usado. 'primary' por padrão. */
  calendarId: string;
  connectedEmail?: string;
  connectedAt?: string;
}

export function isGoogleOAuthConfigured(): boolean {
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_OAUTH_REDIRECT_URI);
}

function newOAuth2Client() {
  return new google.auth.OAuth2(
    env.GOOGLE_CLIENT_ID,
    env.GOOGLE_CLIENT_SECRET,
    env.GOOGLE_OAUTH_REDIRECT_URI,
  );
}

/** URL para iniciar consent screen. */
export function buildAuthUrl(state: string): string {
  const client = newOAuth2Client();
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent', // força retornar refresh_token sempre
    scope: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/userinfo.email',
      // Sheets read-only — pra sincronizar a tabela de vacinas da clínica
      'https://www.googleapis.com/auth/spreadsheets.readonly',
    ],
    state,
  });
}

/** Troca o `code` retornado pelo Google por tokens. */
export async function exchangeCodeForTokens(code: string): Promise<{
  refreshToken: string;
  accessToken: string;
  email?: string;
}> {
  const client = newOAuth2Client();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      'Google nao retornou refresh_token. Revogue o acesso e tente novamente (com prompt=consent).',
    );
  }
  client.setCredentials(tokens);

  // Recupera email do usuário autorizado
  let email: string | undefined;
  try {
    const oauth2 = google.oauth2({ version: 'v2', auth: client });
    const { data } = await oauth2.userinfo.get();
    email = data.email ?? undefined;
  } catch {
    /* ignore */
  }

  return {
    refreshToken: tokens.refresh_token,
    accessToken: tokens.access_token ?? '',
    email,
  };
}

/** Salva config OAuth do Google no tenant. */
export async function saveGoogleConfig(
  tenantId: string,
  config: GoogleCalendarConfig,
): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error('tenant not found');
  const cfg = (tenant.config as Record<string, unknown>) ?? {};
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { config: { ...cfg, googleCalendar: { ...config } } as unknown as Prisma.InputJsonValue },
  });
}

/** Carrega config do tenant. Retorna null se desconectado. */
export async function loadGoogleConfig(
  tenantId: string,
): Promise<GoogleCalendarConfig | null> {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { config: true },
  });
  const cfg = (tenant?.config as { googleCalendar?: GoogleCalendarConfig } | null)?.googleCalendar;
  return cfg ?? null;
}

/** Remove a integração. */
export async function disconnectGoogle(tenantId: string): Promise<void> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) return;
  const cfg = { ...(tenant.config as Record<string, unknown>) };
  delete cfg.googleCalendar;
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { config: cfg as Prisma.InputJsonValue },
  });
}

/** Constrói o cliente do Calendar com auth válido. */
export function buildCalendarClient(refreshToken: string): calendar_v3.Calendar {
  const client = newOAuth2Client();
  client.setCredentials({ refresh_token: refreshToken });
  return google.calendar({ version: 'v3', auth: client });
}

/** Push de um Appointment pro Google. Insert se sem eventId; update senão. */
export async function upsertEvent(input: {
  tenantId: string;
  appointment: {
    id: string;
    scheduledFor: Date;
    notes: string | null;
    vaccineSlugs: string[];
    status: string;
    patient: { name: string | null; phone: string };
  };
  existingEventId?: string;
}): Promise<string | null> {
  const cfg = await loadGoogleConfig(input.tenantId);
  if (!cfg) return null;

  const calendar = buildCalendarClient(cfg.refreshToken);
  const start = new Date(input.appointment.scheduledFor);
  // Duracao padrao do bloco de aplicacao = 15 min (padrao operacional
  // da clinica, decisao da dona — agendamentos sao de 15 em 15).
  const end = new Date(start.getTime() + 15 * 60_000);
  const patientName = input.appointment.patient.name?.trim() || input.appointment.patient.phone;
  const vacc =
    input.appointment.vaccineSlugs.length > 0
      ? input.appointment.vaccineSlugs.join(', ')
      : 'aplicação';
  const summary = `${patientName} — ${vacc}`;
  const description = [
    `Paciente: ${patientName}`,
    `Telefone: ${input.appointment.patient.phone}`,
    `Vacinas: ${input.appointment.vaccineSlugs.join(', ') || '-'}`,
    `Status: ${input.appointment.status}`,
    input.appointment.notes ? `Notas: ${input.appointment.notes}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const event: calendar_v3.Schema$Event = {
    summary,
    description,
    start: { dateTime: start.toISOString(), timeZone: 'America/Sao_Paulo' },
    end: { dateTime: end.toISOString(), timeZone: 'America/Sao_Paulo' },
    status: input.appointment.status === 'cancelled' ? 'cancelled' : 'confirmed',
  };

  if (input.existingEventId) {
    const res = await calendar.events.update({
      calendarId: cfg.calendarId,
      eventId: input.existingEventId,
      requestBody: event,
    });
    return res.data.id ?? input.existingEventId;
  }

  const res = await calendar.events.insert({
    calendarId: cfg.calendarId,
    requestBody: event,
  });
  return res.data.id ?? null;
}

/** Deleta evento do Google. Tolerante a 404 (já removido). */
export async function deleteEvent(input: {
  tenantId: string;
  eventId: string;
}): Promise<void> {
  const cfg = await loadGoogleConfig(input.tenantId);
  if (!cfg) return;
  const calendar = buildCalendarClient(cfg.refreshToken);
  try {
    await calendar.events.delete({
      calendarId: cfg.calendarId,
      eventId: input.eventId,
    });
  } catch (err) {
    const code = (err as { code?: number }).code;
    if (code === 404 || code === 410) return; // já deletado
    throw err;
  }
}

/** Lista calendários do usuário (pra UI escolher). */
export async function listCalendars(tenantId: string): Promise<
  Array<{ id: string; summary: string; primary: boolean }>
> {
  const cfg = await loadGoogleConfig(tenantId);
  if (!cfg) return [];
  const calendar = buildCalendarClient(cfg.refreshToken);
  const res = await calendar.calendarList.list();
  return (res.data.items ?? []).map((c) => ({
    id: c.id ?? '',
    summary: c.summary ?? '(sem nome)',
    primary: !!c.primary,
  }));
}
