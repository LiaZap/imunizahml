import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '@imuniza/db';

const paramsSchema = z.object({ id: z.string().uuid() });

const vaccineBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1),
  ageMonths: z.array(z.number().int().nonnegative()),
  priceCash: z.number().nonnegative(),
  priceInstallment: z.number().nonnegative(),
  installments: z.number().int().positive().default(3),
  active: z.boolean().default(true),
  inStock: z.boolean().default(true),
  outOfStockNote: z.string().nullish(),
});

const vaccineUpdate = vaccineBody.partial();

const packageBody = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1),
  items: z.array(z.object({ vaccineSlug: z.string(), doses: z.number().int().positive() })),
  priceCash: z.number().nonnegative(),
  priceInstallment: z.number().nonnegative(),
  installments: z.number().int().positive().default(5),
  active: z.boolean().default(true),
});

const packageUpdate = packageBody.partial();

function serializeVaccine<T extends { priceCash: unknown; priceInstallment: unknown }>(v: T) {
  return {
    ...v,
    priceCash: Number(v.priceCash),
    priceInstallment: Number(v.priceInstallment),
  };
}

export async function vaccinesRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const tenantId = req.session!.tenantId;
    const vaccines = await prisma.vaccine.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return vaccines.map(serializeVaccine);
  });

  app.post('/', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const body = vaccineBody.parse(req.body);
    const vaccine = await prisma.vaccine.create({ data: { tenantId, ...body } });
    return reply.code(201).send(serializeVaccine(vaccine));
  });

  app.patch('/:id', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const tenantId = req.session!.tenantId;
    const existing = await prisma.vaccine.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const body = vaccineUpdate.parse(req.body);
    const updated = await prisma.vaccine.update({ where: { id }, data: body });
    return serializeVaccine(updated);
  });

  app.delete('/:id', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const tenantId = req.session!.tenantId;
    const existing = await prisma.vaccine.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await prisma.vaccine.delete({ where: { id } });
    return reply.code(204).send();
  });

  // ─────────────── IMPORT CSV (em lote) ───────────────
  // Aceita rows: [{ name, description?, ageMonths?, priceCash, priceInstallment?,
  // installments?, active? }] e faz upsert por slug (gerado a partir do nome).
  const importBody = z.object({
    rows: z
      .array(
        z.object({
          name: z.string().min(1),
          slug: z.string().optional(),
          description: z.string().optional(),
          ageMonths: z.array(z.number().int().nonnegative()).optional(),
          priceCash: z.number().nonnegative(),
          priceInstallment: z.number().nonnegative().optional(),
          installments: z.number().int().positive().optional(),
          active: z.boolean().optional(),
        }),
      )
      .min(1)
      .max(500),
  });

  app.post('/import', async (req, reply) => {
    if (req.session!.role !== 'admin')
      return reply.code(403).send({ error: 'forbidden' });
    const tenantId = req.session!.tenantId;
    const body = importBody.parse(req.body);

    const slugify = (s: string) =>
      s
        .toLowerCase()
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');

    let created = 0;
    let updated = 0;
    const errors: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < body.rows.length; i++) {
      const r = body.rows[i]!;
      try {
        const slug = r.slug?.trim() || slugify(r.name);
        const installments = r.installments ?? 3;
        const priceInstallment = r.priceInstallment ?? Number((r.priceCash * 1.07).toFixed(2));
        const ageMonths = r.ageMonths ?? [];

        const existing = await prisma.vaccine.findFirst({
          where: { tenantId, slug },
        });
        if (existing) {
          await prisma.vaccine.update({
            where: { id: existing.id },
            data: {
              name: r.name,
              description: r.description ?? existing.description,
              ageMonths,
              priceCash: r.priceCash,
              priceInstallment,
              installments,
              active: r.active ?? existing.active,
            },
          });
          updated++;
        } else {
          await prisma.vaccine.create({
            data: {
              tenantId,
              name: r.name,
              slug,
              description: r.description ?? r.name,
              ageMonths,
              priceCash: r.priceCash,
              priceInstallment,
              installments,
              active: r.active ?? true,
            },
          });
          created++;
        }
      } catch (err) {
        errors.push({ row: i + 1, error: (err as Error).message });
      }
    }

    return { created, updated, errors, total: body.rows.length };
  });

  app.get('/packages', async (req) => {
    const tenantId = req.session!.tenantId;
    const packages = await prisma.vaccinePackage.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
    });
    return packages.map(serializeVaccine);
  });

  app.post('/packages', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const body = packageBody.parse(req.body);
    const pkg = await prisma.vaccinePackage.create({ data: { tenantId, ...body } });
    return reply.code(201).send(serializeVaccine(pkg));
  });

  app.patch('/packages/:id', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const tenantId = req.session!.tenantId;
    const existing = await prisma.vaccinePackage.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    const body = packageUpdate.parse(req.body);
    const updated = await prisma.vaccinePackage.update({ where: { id }, data: body });
    return serializeVaccine(updated);
  });

  app.delete('/packages/:id', async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const tenantId = req.session!.tenantId;
    const existing = await prisma.vaccinePackage.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await prisma.vaccinePackage.delete({ where: { id } });
    return reply.code(204).send();
  });
}
