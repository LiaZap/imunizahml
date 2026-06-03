import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, AppointmentStatus, Prisma } from '@imuniza/db';
import {
  scheduleAppointmentReminders,
  cancelAppointmentReminders,
} from '../services/appointmentReminders.js';
import {
  upsertEvent as upsertGoogleEvent,
  deleteEvent as deleteGoogleEvent,
  loadGoogleConfig,
} from '../services/googleCalendar.js';

const paramsSchema = z.object({ id: z.string().uuid() });

const createBody = z.object({
  patientId: z.string().uuid(),
  conversationId: z.string().uuid().optional(),
  scheduledFor: z.string(),
  vaccineSlugs: z.array(z.string()).default([]),
  expectedValue: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

const updateBody = z.object({
  status: z.enum(['scheduled', 'attended', 'no_show', 'paid', 'cancelled']).optional(),
  scheduledFor: z.string().optional(),
  vaccineSlugs: z.array(z.string()).optional(),
  expectedValue: z.number().nonnegative().optional(),
  paidValue: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

function serialize<T extends { expectedValue: unknown; paidValue: unknown }>(a: T) {
  return {
    ...a,
    expectedValue: a.expectedValue != null ? Number(a.expectedValue) : null,
    paidValue: a.paidValue != null ? Number(a.paidValue) : null,
  };
}

export async function appointmentsRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (req) => {
    const tenantId = req.session!.tenantId;
    const q = req.query as { status?: string; patientId?: string };
    const rows = await prisma.appointment.findMany({
      where: {
        tenantId,
        ...(q.status ? { status: q.status as AppointmentStatus } : {}),
        ...(q.patientId ? { patientId: q.patientId } : {}),
      },
      orderBy: { scheduledFor: 'desc' },
      include: {
        patient: { select: { id: true, name: true, phone: true } },
      },
      take: 100,
    });
    return rows.map(serialize);
  });

  app.post('/', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const body = createBody.parse(req.body);
    const patient = await prisma.patient.findFirst({
      where: { id: body.patientId, tenantId },
    });
    if (!patient) return reply.code(404).send({ error: 'patient_not_found' });

    const created = await prisma.appointment.create({
      data: {
        tenantId,
        patientId: body.patientId,
        conversationId: body.conversationId,
        scheduledFor: new Date(body.scheduledFor),
        vaccineSlugs: body.vaccineSlugs,
        expectedValue: body.expectedValue,
        notes: body.notes,
        createdByUserId: req.session!.sub,
      },
    });

    // Agenda lembretes baseados no config do tenant
    try {
      const count = await scheduleAppointmentReminders(created.id);
      req.log.info({ appointmentId: created.id, reminders: count }, 'reminders scheduled');
    } catch (err) {
      req.log.error({ err, appointmentId: created.id }, 'failed to schedule reminders');
    }

    // Push para Google Calendar (se conectado)
    void pushToGoogle(tenantId, created.id, req);

    return reply.code(201).send(serialize(created));
  });

  app.patch('/:id', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    const body = updateBody.parse(req.body);

    const existing = await prisma.appointment.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });

    const updated = await prisma.appointment.update({
      where: { id },
      data: {
        ...(body.status ? { status: body.status as AppointmentStatus } : {}),
        ...(body.scheduledFor ? { scheduledFor: new Date(body.scheduledFor) } : {}),
        ...(body.vaccineSlugs ? { vaccineSlugs: body.vaccineSlugs } : {}),
        ...(body.expectedValue != null ? { expectedValue: body.expectedValue } : {}),
        ...(body.paidValue != null ? { paidValue: body.paidValue } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });

    // Re-agenda lembretes (ou cancela se status virou cancelled/no_show)
    if (body.status || body.scheduledFor || body.vaccineSlugs) {
      try {
        await scheduleAppointmentReminders(updated.id);
      } catch (err) {
        req.log.error({ err, appointmentId: updated.id }, 'failed to reschedule reminders');
      }
    }

    // Push para Google (update se ja tinha eventId, insert senao)
    void pushToGoogle(tenantId, updated.id, req);

    return serialize(updated);
  });

  app.delete('/:id', async (req, reply) => {
    const tenantId = req.session!.tenantId;
    const { id } = paramsSchema.parse(req.params);
    const existing = await prisma.appointment.findFirst({ where: { id, tenantId } });
    if (!existing) return reply.code(404).send({ error: 'not_found' });
    await cancelAppointmentReminders(id).catch(() => undefined);

    // Remove do Google se tinha evento
    const meta = (existing.metadata as { googleEventId?: string } | null) ?? {};
    if (meta.googleEventId) {
      try {
        await deleteGoogleEvent({ tenantId, eventId: meta.googleEventId });
      } catch (err) {
        req.log.error({ err, appointmentId: id }, 'failed to delete google event');
      }
    }

    await prisma.appointment.delete({ where: { id } });
    return reply.code(204).send();
  });
}

async function pushToGoogle(
  tenantId: string,
  appointmentId: string,
  req: { log: { error: (obj: unknown, msg?: string) => void; info: (obj: unknown, msg?: string) => void } },
): Promise<void> {
  try {
    const cfg = await loadGoogleConfig(tenantId);
    if (!cfg) return; // não conectado

    const appt = await prisma.appointment.findFirst({
      where: { id: appointmentId, tenantId },
      include: { patient: { select: { name: true, phone: true } } },
    });
    if (!appt) return;

    const meta = (appt.metadata as { googleEventId?: string } | null) ?? {};
    const eventId = await upsertGoogleEvent({
      tenantId,
      appointment: appt,
      existingEventId: meta.googleEventId,
    });

    if (eventId && eventId !== meta.googleEventId) {
      await prisma.appointment.update({
        where: { id: appointmentId },
        data: { metadata: { ...meta, googleEventId: eventId } as Prisma.InputJsonValue },
      });
    }
    req.log.info({ appointmentId, eventId }, 'google calendar event upserted');
  } catch (err) {
    req.log.error({ err, appointmentId }, 'failed to push to google calendar');
  }
}
