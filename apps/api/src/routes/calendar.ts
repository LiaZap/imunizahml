/**
 * Endpoint público que entrega um arquivo .ics com TODOS os agendamentos
 * do tenant. A secretária cola a URL no Google Calendar
 * ("Outros calendários → Inscrever-se via URL") e os eventos aparecem
 * automaticamente, atualizados pelo Google a cada poucas horas.
 *
 * Auth: token aleatório armazenado em tenant.config.icalToken.
 * Pode ser rotacionado em /calendar/rotate-token.
 */
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { prisma, Prisma } from '@imuniza/db';

const VACCINE_LABELS_LIMIT = 40;

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Formato iCalendar: 20260520T130000Z (UTC). */
function toIcsDate(d: Date): string {
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    'T' +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    'Z'
  );
}

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

/** Wrap de linhas a cada 75 caracteres conforme RFC 5545. */
function fold(line: string): string {
  const max = 73;
  if (line.length <= max) return line;
  const parts: string[] = [];
  for (let i = 0; i < line.length; i += max) {
    parts.push((i === 0 ? '' : ' ') + line.slice(i, i + max));
  }
  return parts.join('\r\n');
}

function buildIcs(events: string[]): string {
  return (
    [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Imuniza//Agenda//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:Imuniza — Agenda da Clínica',
      'X-WR-TIMEZONE:America/Sao_Paulo',
      ...events,
      'END:VCALENDAR',
    ]
      .map(fold)
      .join('\r\n') + '\r\n'
  );
}

function statusLabel(s: string): string {
  switch (s) {
    case 'scheduled':
      return 'Agendado';
    case 'attended':
      return 'Compareceu';
    case 'paid':
      return 'Pago';
    case 'no_show':
      return 'Não compareceu';
    case 'cancelled':
      return 'Cancelado';
    default:
      return s;
  }
}

function icalStatus(s: string): string {
  if (s === 'cancelled') return 'CANCELLED';
  if (s === 'attended' || s === 'paid' || s === 'no_show') return 'CONFIRMED';
  return 'TENTATIVE';
}

export async function publicCalendarRoutes(app: FastifyInstance): Promise<void> {
  // ── ENDPOINT PÚBLICO ─────────────────────────────
  // /calendar/:tenantSlug/:token/calendar.ics
  app.get<{ Params: { tenantSlug: string; token: string } }>(
    '/:tenantSlug/:token/calendar.ics',
    async (req, reply) => {
      const { tenantSlug, token } = req.params;
      const tenant = await prisma.tenant.findUnique({ where: { slug: tenantSlug } });
      if (!tenant) return reply.code(404).type('text/plain').send('Calendário não encontrado');

      const expected = (tenant.config as { icalToken?: string } | null)?.icalToken;
      if (!expected || expected !== token) {
        return reply.code(401).type('text/plain').send('Token inválido');
      }

      // Trazemos eventos dos últimos 30 dias e próximos 365 dias
      const from = new Date();
      from.setDate(from.getDate() - 30);
      const to = new Date();
      to.setDate(to.getDate() + 365);

      const appointments = await prisma.appointment.findMany({
        where: {
          tenantId: tenant.id,
          scheduledFor: { gte: from, lte: to },
        },
        include: {
          patient: { select: { name: true, phone: true } },
        },
        orderBy: { scheduledFor: 'asc' },
      });

      const now = toIcsDate(new Date());
      const events = appointments.map((a) => {
        const start = new Date(a.scheduledFor);
        const end = new Date(start.getTime() + 30 * 60_000); // 30 min default
        const patientName = a.patient.name?.trim() || a.patient.phone;
        const vaccines =
          a.vaccineSlugs.length > 0
            ? a.vaccineSlugs.join(', ').slice(0, VACCINE_LABELS_LIMIT)
            : 'aplicação';
        const summary = `${patientName} — ${vaccines}`;
        const descLines = [
          `Paciente: ${patientName}`,
          `Telefone: ${a.patient.phone}`,
          `Vacinas: ${a.vaccineSlugs.join(', ') || '-'}`,
          `Status: ${statusLabel(a.status)}`,
          a.notes ? `Notas: ${a.notes}` : '',
        ].filter(Boolean);

        return [
          'BEGIN:VEVENT',
          `UID:appt-${a.id}@imuniza`,
          `DTSTAMP:${now}`,
          `DTSTART:${toIcsDate(start)}`,
          `DTEND:${toIcsDate(end)}`,
          `SUMMARY:${icsEscape(summary)}`,
          `DESCRIPTION:${icsEscape(descLines.join('\n'))}`,
          `STATUS:${icalStatus(a.status)}`,
          `LAST-MODIFIED:${toIcsDate(new Date(a.updatedAt))}`,
          'END:VEVENT',
        ].join('\r\n');
      });

      reply
        .header('Content-Type', 'text/calendar; charset=utf-8')
        .header('Content-Disposition', `inline; filename="imuniza-${tenant.slug}.ics"`)
        // Cache curto pra Google atualizar com mais frequência (ele respeita parcialmente)
        .header('Cache-Control', 'public, max-age=300');
      return buildIcs(events);
    },
  );

}

// Rotas autenticadas (sob authGuard). Registradas no bloco protegido.
export async function adminCalendarRoutes(app: FastifyInstance): Promise<void> {
  app.get('/url', async (req) => {
    const tenantId = req.session!.tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return { url: null };
    let token = (tenant.config as { icalToken?: string } | null)?.icalToken;
    if (!token) {
      token = crypto.randomBytes(20).toString('hex');
      const cfg = (tenant.config as Record<string, unknown>) ?? {};
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { config: { ...cfg, icalToken: token } as Prisma.InputJsonValue },
      });
    }
    const base = process.env.API_BASE_URL ?? '';
    return {
      url: `${base}/calendar/${tenant.slug}/${token}/calendar.ics`,
      tenantSlug: tenant.slug,
      token,
    };
  });

  app.post('/rotate-token', async (req, reply) => {
    if (req.session!.role !== 'admin' && req.session!.role !== 'secretary')
      return reply.code(403).send({ error: 'forbidden' });
    const tenantId = req.session!.tenantId;
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) return reply.code(404).send({ error: 'not_found' });
    const newToken = crypto.randomBytes(20).toString('hex');
    const cfg = (tenant.config as Record<string, unknown>) ?? {};
    await prisma.tenant.update({
      where: { id: tenantId },
      data: { config: { ...cfg, icalToken: newToken } as Prisma.InputJsonValue },
    });
    const base = process.env.API_BASE_URL ?? '';
    return {
      url: `${base}/calendar/${tenant.slug}/${newToken}/calendar.ics`,
      token: newToken,
    };
  });
}
