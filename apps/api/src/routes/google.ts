/**
 * Rotas OAuth do Google Calendar.
 *
 * /google/oauth/start    (admin) — gera URL e redireciona pro Google
 * /google/oauth/callback (público, mas valida state) — recebe code, troca por tokens
 * /google/oauth/status   (admin) — info se está conectado
 * /google/oauth/disconnect (admin) — remove integração
 * /google/calendars      (admin) — lista calendários disponíveis
 * /google/calendar/select (admin) — escolhe qual calendário usar
 */
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma, Prisma } from '@imuniza/db';
import {
  buildAuthUrl,
  disconnectGoogle,
  exchangeCodeForTokens,
  isGoogleOAuthConfigured,
  listCalendars,
  loadGoogleConfig,
  saveGoogleConfig,
} from '../services/googleCalendar.js';
import { env } from '../env.js';

// Cache em memória de states pendentes (state → { tenantId, expiresAt })
const pendingStates = new Map<string, { tenantId: string; expiresAt: number }>();

function genState(tenantId: string): string {
  const state = crypto.randomBytes(20).toString('hex');
  pendingStates.set(state, { tenantId, expiresAt: Date.now() + 10 * 60_000 });
  // Limpa expirados
  for (const [k, v] of pendingStates) {
    if (v.expiresAt < Date.now()) pendingStates.delete(k);
  }
  return state;
}

function consumeState(state: string): string | null {
  const data = pendingStates.get(state);
  if (!data || data.expiresAt < Date.now()) return null;
  pendingStates.delete(state);
  return data.tenantId;
}

// ───── ROTAS AUTENTICADAS (admin only) ─────
export async function googleAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get('/oauth/start', async (req, reply) => {
    if (req.session!.role !== 'admin' && req.session!.role !== 'secretary')
      return reply.code(403).send({ error: 'forbidden' });
    if (!isGoogleOAuthConfigured()) {
      return reply.code(503).send({
        error: 'google_oauth_not_configured',
        detail: 'Defina GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_OAUTH_REDIRECT_URI.',
      });
    }
    const state = genState(req.session!.tenantId);
    const url = buildAuthUrl(state);
    // Devolve URL pro frontend abrir em nova aba (e não tentar redirecionar dentro de fetch)
    return { url };
  });

  app.get('/oauth/status', async (req) => {
    const cfg = await loadGoogleConfig(req.session!.tenantId);
    return {
      configured: isGoogleOAuthConfigured(),
      connected: !!cfg,
      email: cfg?.connectedEmail ?? null,
      calendarId: cfg?.calendarId ?? null,
      connectedAt: cfg?.connectedAt ?? null,
    };
  });

  app.post('/oauth/disconnect', async (req, reply) => {
    if (req.session!.role !== 'admin' && req.session!.role !== 'secretary')
      return reply.code(403).send({ error: 'forbidden' });
    await disconnectGoogle(req.session!.tenantId);
    return { ok: true };
  });

  app.get('/calendars', async (req, reply) => {
    try {
      const list = await listCalendars(req.session!.tenantId);
      return { calendars: list };
    } catch (err) {
      req.log.error({ err }, 'listCalendars failed');
      return reply.code(502).send({ error: 'google_api_failed' });
    }
  });

  const selectBody = z.object({ calendarId: z.string().min(1) });
  app.post('/calendar/select', async (req, reply) => {
    if (req.session!.role !== 'admin' && req.session!.role !== 'secretary')
      return reply.code(403).send({ error: 'forbidden' });
    const body = selectBody.parse(req.body);
    const cfg = await loadGoogleConfig(req.session!.tenantId);
    if (!cfg) return reply.code(400).send({ error: 'not_connected' });
    await saveGoogleConfig(req.session!.tenantId, { ...cfg, calendarId: body.calendarId });
    return { ok: true, calendarId: body.calendarId };
  });
}

// ───── ROTA PÚBLICA (callback do Google) ─────
export async function googlePublicRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    '/oauth/callback',
    async (req, reply) => {
      const { code, state, error } = req.query;
      const dashboard = env.DASHBOARD_BASE_URL;

      if (error) {
        return reply.redirect(`${dashboard}/settings?google=error&reason=${encodeURIComponent(error)}`);
      }
      if (!code || !state) {
        return reply.redirect(`${dashboard}/settings?google=error&reason=missing_params`);
      }
      const tenantId = consumeState(state);
      if (!tenantId) {
        return reply.redirect(`${dashboard}/settings?google=error&reason=invalid_state`);
      }

      try {
        const { refreshToken, email } = await exchangeCodeForTokens(code);

        // Pega o tenant atual e salva o refresh_token + calendar primary por padrão
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { config: true },
        });
        const cfg = (tenant?.config as Record<string, unknown>) ?? {};
        await prisma.tenant.update({
          where: { id: tenantId },
          data: {
            config: {
              ...cfg,
              googleCalendar: {
                refreshToken,
                calendarId: 'primary',
                connectedEmail: email,
                connectedAt: new Date().toISOString(),
              },
            } as Prisma.InputJsonValue,
          },
        });

        return reply.redirect(`${dashboard}/settings?google=ok`);
      } catch (err) {
        req.log.error({ err }, 'google oauth callback failed');
        return reply.redirect(`${dashboard}/settings?google=error&reason=exchange_failed`);
      }
    },
  );
}
