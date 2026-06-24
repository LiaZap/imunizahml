/**
 * Quando um agendamento é criado/movido, gera/atualiza VaccinationReminder
 * para cada lead time configurado em tenant.config.reminders.leadTimesMinutes.
 * Os reminders existentes são apagados antes de recriar (idempotente).
 */
import { prisma, ReminderStatus } from '@imuniza/db';

interface ReminderConfig {
  enabled?: boolean;
  leadTimesMinutes?: number[];
  messageTemplate?: string;
}

const DEFAULT_TEMPLATE =
  'Oi {NOME}! 💙 Lembrete do seu agendamento {DATA} às {HORA} para {VACINA}. Qualquer coisa me chama por aqui.';

function fillTemplate(
  template: string,
  vars: { name: string; date: string; time: string; vaccine: string },
): string {
  return template
    .replace(/\{NOME\}/g, vars.name)
    .replace(/\{DATA\}/g, vars.date)
    .replace(/\{HORA\}/g, vars.time)
    .replace(/\{VACINA\}/g, vars.vaccine);
}

// IMPORTANTE: o servidor roda em UTC. Sem `timeZone`, toLocaleDateString/Time
// retorna o horario UTC, nao o horario local da clinica. Causou bug em prod
// onde lembrete de agendamento as 11:45 BRT saia como 14:45 (UTC).
const DEFAULT_TZ = 'America/Sao_Paulo';

function formatDate(d: Date, tz: string = DEFAULT_TZ): string {
  return d.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: tz,
  });
}
function formatTime(d: Date, tz: string = DEFAULT_TZ): string {
  return d.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz,
  });
}

/**
 * Cria reminders para um Appointment baseado na config do tenant.
 * Apaga reminders antigos do mesmo appointment antes (idempotente).
 *
 * Identificamos os reminders deste appointment via metadata-like:
 * vaccineSlug = `appt:<id>` (uma convenção interna que o dispatcher
 * já consegue tratar).
 */
export async function scheduleAppointmentReminders(appointmentId: string): Promise<number> {
  const appt = await prisma.appointment.findUnique({
    where: { id: appointmentId },
    include: {
      tenant: { select: { config: true } },
      patient: { select: { name: true } },
    },
  });
  if (!appt) return 0;

  // Apenas para status que ainda fazem sentido lembrar
  if (appt.status !== 'scheduled' && appt.status !== 'attended') {
    // Cancela qualquer pendente
    await prisma.vaccinationReminder.deleteMany({
      where: {
        tenantId: appt.tenantId,
        patientId: appt.patientId,
        vaccineSlug: `appt:${appt.id}`,
        status: 'scheduled',
      },
    });
    return 0;
  }

  const tenantConfig = (appt.tenant.config ?? {}) as {
    reminders?: ReminderConfig;
    businessHours?: { timezone?: string };
  };
  const config = tenantConfig.reminders ?? {};
  const tz = tenantConfig.businessHours?.timezone || DEFAULT_TZ;
  if (config.enabled === false) return 0;
  const leadTimes = (config.leadTimesMinutes ?? [24 * 60, 60]).filter(
    (n) => Number.isFinite(n) && n >= 5,
  );
  if (leadTimes.length === 0) return 0;

  // Apaga reminders pendentes anteriores deste appointment (re-agendamento)
  await prisma.vaccinationReminder.deleteMany({
    where: {
      tenantId: appt.tenantId,
      patientId: appt.patientId,
      vaccineSlug: `appt:${appt.id}`,
      status: 'scheduled',
    },
  });

  const apptDate = new Date(appt.scheduledFor);
  const vaccineLabel =
    appt.vaccineSlugs.length > 0
      ? appt.vaccineSlugs.length === 1
        ? appt.vaccineSlugs[0]!
        : `${appt.vaccineSlugs[0]} e mais ${appt.vaccineSlugs.length - 1}`
      : 'sua aplicação';

  const template = config.messageTemplate?.trim() || DEFAULT_TEMPLATE;
  const message = fillTemplate(template, {
    name: appt.patient.name?.split(' ')[0] ?? 'tudo bem',
    date: formatDate(apptDate, tz),
    time: formatTime(apptDate, tz),
    vaccine: vaccineLabel,
  });

  let created = 0;
  for (const minutes of leadTimes) {
    const scheduledFor = new Date(apptDate.getTime() - minutes * 60_000);
    if (scheduledFor.getTime() <= Date.now()) continue; // ja passou

    await prisma.vaccinationReminder.create({
      data: {
        tenantId: appt.tenantId,
        patientId: appt.patientId,
        vaccineSlug: `appt:${appt.id}`,
        dose: 0,
        scheduledFor,
        message,
        status: ReminderStatus.scheduled,
      },
    });
    created++;
  }

  return created;
}

/** Cancela reminders pendentes do appointment (usado no DELETE). */
export async function cancelAppointmentReminders(appointmentId: string): Promise<number> {
  const result = await prisma.vaccinationReminder.deleteMany({
    where: {
      vaccineSlug: `appt:${appointmentId}`,
      status: 'scheduled',
    },
  });
  return result.count;
}
