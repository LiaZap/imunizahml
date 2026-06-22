import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, prisma } from '@imuniza/db';

// IMPORTANTE: `persona` NAO eh aceita no PATCH. A persona da IA eh
// versionada no codigo (packages/db/prisma/demo-persona.ts) e
// aplicada via script. Defesa em profundidade: mesmo se o frontend
// tentar enviar, o schema rejeita silenciosamente (passthrough off
// + strict).
const configBody = z
  .object({
    greeting: z.string().min(1).optional(),
  businessHours: z
    .object({
      start: z.string(),
      end: z.string(),
      saturdayStart: z.string().optional(),
      saturdayEnd: z.string().optional(),
      saturdayClosed: z.boolean().optional(),
      timezone: z.string(),
    })
    .optional(),
  silentHours: z
    .object({
      enabled: z.boolean(),
      start: z.string(),
      end: z.string(),
      offlineMessage: z.string().optional(),
    })
    .optional(),
  quickTemplates: z.array(z.object({ label: z.string(), text: z.string() })).optional(),
  phone: z.string().optional(),
  reminders: z
    .object({
      /** Quanto tempo antes do agendamento disparar lembrete (em minutos). Ex.: 1440 = 24h */
      leadTimesMinutes: z.array(z.number().int().min(5).max(60 * 24 * 30)),
      /** Template da mensagem do lembrete. Aceita placeholders {NOME} {DATA} {HORA} {VACINA}. */
      messageTemplate: z.string().min(1).optional(),
      enabled: z.boolean().optional(),
    })
    .optional(),
  })
  .strict(); // rejeita campos desconhecidos (inclusive `persona`)

export async function settingsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const tenantId = req.session!.tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    return {
      id: tenant?.id,
      name: tenant?.name,
      slug: tenant?.slug,
      phone: tenant?.phone,
      config: tenant?.config ?? {},
    };
  });

  app.patch('/', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const role = req.session!.role;
    if (role !== 'admin' && role !== 'secretary') {
      return reply.code(403).send({ error: 'forbidden' });
    }

    const body = configBody.parse(req.body);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return reply.code(404).send({ error: 'not_found' });

    const currentConfig = (tenant.config as Record<string, unknown>) ?? {};
    const newConfig: Record<string, unknown> = { ...currentConfig };
    // persona NAO eh atualizavel via API — gerenciada via codigo
    if (body.greeting !== undefined) newConfig.greeting = body.greeting;
    if (body.businessHours !== undefined) newConfig.businessHours = body.businessHours;
    if (body.silentHours !== undefined) newConfig.silentHours = body.silentHours;
    if (body.quickTemplates !== undefined) newConfig.quickTemplates = body.quickTemplates;
    if (body.reminders !== undefined) newConfig.reminders = body.reminders;

    const updated = await prisma.tenant.update({
      where: { id: tenantId },
      data: {
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        config: newConfig as Prisma.InputJsonValue,
      },
    });

    return { id: updated.id, name: updated.name, phone: updated.phone, config: updated.config };
  });
}
