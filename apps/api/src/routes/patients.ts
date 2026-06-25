import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma, prisma } from '@imuniza/db';
import { computeNextDueDate, scheduleReminder } from '../services/vaccinationSchedule.js';

const paramsSchema = z.object({ id: z.string().uuid() });

const listQuery = z.object({
  search: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

const updateBody = z.object({
  name: z.string().optional(),
  profile: z
    .object({
      babyAgeMonths: z.number().int().nonnegative().optional(),
      babyName: z.string().optional(),
      babyBirthDate: z.string().optional(),
      medicalConditions: z.array(z.string()).optional(),
      notes: z.string().optional(),
    })
    .optional(),
});

const vaccinationBody = z.object({
  vaccineSlug: z.string(),
  dose: z.number().int().positive(),
  appliedAt: z.string(),
  notes: z.string().optional(),
});

export async function patientsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const tenantId = req.session!.tenantId;
    const q = listQuery.parse(req.query);
    return prisma.patient.findMany({
      where: {
        tenantId,
        ...(q.search
          ? {
              OR: [
                { phone: { contains: q.search } },
                { name: { contains: q.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { updatedAt: 'desc' },
      take: q.limit,
      include: {
        _count: {
          select: {
            conversations: true,
            vaccinations: true,
            // Inclui contagem total de agendamentos. A UI mostra esse
            // numero no card pra equipe ver "quem tem coisa marcada"
            // ja na listagem, sem precisar abrir cada paciente.
            appointments: true,
          },
        },
      },
    });
  });

  app.get('/:id', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    const patient = await prisma.patient.findFirst({
      where: { id, tenantId },
      include: {
        vaccinations: {
          orderBy: { appliedAt: 'desc' },
          include: { vaccine: { select: { name: true, slug: true } } },
        },
        reminders: {
          orderBy: { scheduledFor: 'asc' },
          take: 20,
        },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 10,
          select: {
            id: true,
            status: true,
            lastMessageAt: true,
            createdAt: true,
          },
        },
      },
    });
    if (!patient) return reply.code(404).send({ error: 'not_found' });
    return patient;
  });

  app.patch('/:id', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    const body = updateBody.parse(req.body);
    const patient = await prisma.patient.findFirst({ where: { id, tenantId } });
    if (!patient) return reply.code(404).send({ error: 'not_found' });

    const currentProfile = (patient.profile as Record<string, unknown>) ?? {};
    const nextProfile = body.profile ? { ...currentProfile, ...body.profile } : currentProfile;

    return prisma.patient.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        profile: nextProfile as Prisma.InputJsonValue,
      },
    });
  });

  app.post('/:id/vaccinations', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    const body = vaccinationBody.parse(req.body);

    const [patient, vaccine] = await Promise.all([
      prisma.patient.findFirst({ where: { id, tenantId } }),
      prisma.vaccine.findFirst({ where: { tenantId, slug: body.vaccineSlug } }),
    ]);
    if (!patient) return reply.code(404).send({ error: 'patient_not_found' });

    const profile = (patient.profile as {
      babyAgeMonths?: number;
      babyBirthDate?: string;
    }) ?? {};

    const appliedAt = new Date(body.appliedAt);
    const nextDueAt = await computeNextDueDate({
      tenantId,
      vaccineSlug: body.vaccineSlug,
      appliedAt,
      currentDose: body.dose,
      babyAgeMonthsAtApplication: profile.babyAgeMonths,
      babyBirthDate: profile.babyBirthDate ? new Date(profile.babyBirthDate) : null,
    });

    const vaccination = await prisma.patientVaccination.create({
      data: {
        tenantId,
        patientId: id,
        vaccineId: vaccine?.id,
        vaccineSlug: body.vaccineSlug,
        dose: body.dose,
        appliedAt,
        nextDueAt,
        notes: body.notes,
      },
    });

    // Agenda lembrete se houver próxima dose
    if (nextDueAt && vaccine) {
      await scheduleReminder({
        tenantId,
        patientId: id,
        vaccineSlug: body.vaccineSlug,
        dose: body.dose + 1,
        nextDueAt,
        vaccineName: vaccine.name,
        patientName: patient.name ?? null,
      });
    }

    return reply.code(201).send(vaccination);
  });

  app.delete('/:id/vaccinations/:vaccinationId', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    const { vaccinationId } = z
      .object({ vaccinationId: z.string().uuid() })
      .parse(req.params);

    const existing = await prisma.patientVaccination.findFirst({
      where: { id: vaccinationId, patientId: id, tenantId },
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    await prisma.patientVaccination.delete({ where: { id: vaccinationId } });
    return reply.code(204).send();
  });

  app.get('/:id/reminders', async (req) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    return prisma.vaccinationReminder.findMany({
      where: { tenantId, patientId: id },
      orderBy: { scheduledFor: 'asc' },
    });
  });

  app.post('/:id/reminders/:reminderId/cancel', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { reminderId } = z.object({ reminderId: z.string().uuid() }).parse(req.params);
    const existing = await prisma.vaccinationReminder.findFirst({
      where: { id: reminderId, tenantId },
    });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    return prisma.vaccinationReminder.update({
      where: { id: reminderId },
      data: { status: 'cancelled' },
    });
  });
}
