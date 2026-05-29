import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '@imuniza/db';
import { requireRole } from '../plugins/authGuard.js';

const paramsSchema = z.object({ id: z.string().uuid() });

const createBody = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  password: z.string().min(6),
  role: z.enum(['admin', 'attendant', 'secretary']).default('attendant'),
});

const updateBody = z.object({
  name: z.string().optional(),
  password: z.string().min(6).optional(),
  role: z.enum(['admin', 'attendant', 'secretary']).optional(),
  active: z.boolean().optional(),
});

export async function usersRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireRole('admin'));

  app.get('/', async (req) => {
    const tenantId = req.session!.tenantId;
    return prisma.user.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
      },
    });
  });

  app.post('/', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const body = createBody.parse(req.body);
    const passwordHash = await bcrypt.hash(body.password, 10);
    const created = await prisma.user.create({
      data: {
        tenantId,
        email: body.email.toLowerCase(),
        name: body.name,
        passwordHash,
        role: body.role,
      },
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    });
    return reply.code(201).send(created);
  });

  app.patch('/:id', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    const body = updateBody.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name;
    if (body.role !== undefined) data.role = body.role;
    if (body.active !== undefined) data.active = body.active;
    if (body.password) data.passwordHash = await bcrypt.hash(body.password, 10);

    const updated = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, active: true, createdAt: true },
    });
    return updated;
  });

  app.delete('/:id', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    if (id === req.session!.sub) return reply.code(400).send({ error: 'cannot_delete_self' });
    const existing = await prisma.user.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await prisma.user.delete({ where: { id } });
    return reply.code(204).send();
  });
}
