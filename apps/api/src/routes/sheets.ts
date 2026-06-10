/**
 * Rotas pra sincronização da planilha de vacinas.
 *
 * GET   /sheets/config         (admin) — config atual (spreadsheetId, lastSync...)
 * PATCH /sheets/config         (admin) — atualiza spreadsheetId / range
 * POST  /sheets/vaccines/preview (admin) — dry-run, mostra como vai ficar
 * POST  /sheets/vaccines/sync    (admin) — aplica upsert no banco
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { loadSheetsConfig, saveSheetsConfig } from '../services/googleSheets.js';
import { syncVaccinesFromSheet } from '../services/vaccineSyncFromSheet.js';
import { loadGoogleConfig } from '../services/googleCalendar.js';

function ensureAdmin(req: { session: { role?: string } | null }): boolean {
  return req.session?.role === 'admin' || req.session?.role === 'secretary';
}

export async function sheetsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/config', async (req, reply) => {
    if (!ensureAdmin(req as never)) return reply.code(403).send({ error: 'forbidden' });
    const cfg = await loadSheetsConfig(req.session!.tenantId);
    const googleCfg = await loadGoogleConfig(req.session!.tenantId);
    return {
      googleConnected: !!googleCfg,
      spreadsheetId: cfg?.spreadsheetId ?? null,
      range: cfg?.range ?? null,
      lastSyncAt: cfg?.lastSyncAt ?? null,
      lastSyncCount: cfg?.lastSyncCount ?? null,
    };
  });

  const patchBody = z.object({
    spreadsheetId: z.string().min(1).max(120),
    range: z.string().max(200).optional(),
  });

  app.patch('/config', async (req, reply) => {
    if (!ensureAdmin(req as never)) return reply.code(403).send({ error: 'forbidden' });
    const body = patchBody.parse(req.body);
    const current = await loadSheetsConfig(req.session!.tenantId);
    await saveSheetsConfig(req.session!.tenantId, {
      ...(current ?? {}),
      spreadsheetId: body.spreadsheetId.trim(),
      range: body.range?.trim() || undefined,
    });
    return { ok: true };
  });

  app.post('/vaccines/preview', async (req, reply) => {
    if (!ensureAdmin(req as never)) return reply.code(403).send({ error: 'forbidden' });
    try {
      const report = await syncVaccinesFromSheet(req.session!.tenantId, /* dryRun */ true);
      return report;
    } catch (err) {
      req.log.error({ err }, 'sheets preview failed');
      return reply.code(400).send({ error: (err as Error).message });
    }
  });

  app.post('/vaccines/sync', async (req, reply) => {
    if (!ensureAdmin(req as never)) return reply.code(403).send({ error: 'forbidden' });
    try {
      const report = await syncVaccinesFromSheet(req.session!.tenantId, /* dryRun */ false);
      return report;
    } catch (err) {
      req.log.error({ err }, 'sheets sync failed');
      return reply.code(400).send({ error: (err as Error).message });
    }
  });
}
