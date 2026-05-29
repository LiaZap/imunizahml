import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { uazapi } from '../services/uazapi.js';

const connectBody = z.object({
  phone: z
    .string()
    .trim()
    .regex(/^\+?\d{10,15}$/, 'Telefone deve conter apenas dígitos (DDI+DDD+numero)')
    .transform((v) => v.replace(/\D/g, ''))
    .optional(),
});

export async function instanceRoutes(app: FastifyInstance): Promise<void> {
  app.get('/status', async (req, reply) => {
    if (req.session!.role !== 'admin' && req.session!.role !== 'secretary')
      return reply.code(403).send({ error: 'forbidden' });
    try {
      return await uazapi.getInstanceStatus();
    } catch (err) {
      req.log.error({ err }, 'instance status failed');
      return reply.code(502).send({ error: 'uazapi_unreachable' });
    }
  });

  app.post('/connect', async (req, reply) => {
    if (req.session!.role !== 'admin' && req.session!.role !== 'secretary')
      return reply.code(403).send({ error: 'forbidden' });
    const body = connectBody.parse(req.body ?? {});
    try {
      return await uazapi.connectInstance(body.phone);
    } catch (err) {
      req.log.error({ err }, 'instance connect failed');
      return reply.code(502).send({ error: 'uazapi_unreachable' });
    }
  });

  app.post('/disconnect', async (req, reply) => {
    if (req.session!.role !== 'admin' && req.session!.role !== 'secretary')
      return reply.code(403).send({ error: 'forbidden' });
    try {
      await uazapi.disconnectInstance();
      return { ok: true };
    } catch (err) {
      req.log.error({ err }, 'instance disconnect failed');
      return reply.code(502).send({ error: 'uazapi_unreachable' });
    }
  });
}
