/**
 * Helpers para business hours / silent hours do tenant.
 * IMPORTANTE: o servidor roda em UTC; usamos sempre `timezone` (default
 * America/Sao_Paulo) ao fazer comparacoes de hora local da clinica.
 */

export interface SilentHoursConfig {
  enabled?: boolean;
  start?: string; // HH:mm na timezone do tenant
  end?: string; // HH:mm
  offlineMessage?: string;
}

export interface BusinessHoursConfig {
  start?: string; // HH:mm
  end?: string; // HH:mm
  timezone?: string; // ex: 'America/Sao_Paulo'
}

const DEFAULT_TZ = 'America/Sao_Paulo';

/** Hora/min/dia da semana (0=dom..6=sab) na timezone alvo. */
function partsInTz(d: Date, tz: string): { hour: number; minute: number; weekday: number } {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
    hour12: false,
  });
  const parts = fmt.formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const hour = Number(get('hour') === '24' ? '0' : get('hour'));
  const minute = Number(get('minute'));
  const wkMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const weekday = wkMap[get('weekday')] ?? 0;
  return { hour, minute, weekday };
}

/** Retorna true se o horario atual está dentro da janela silenciosa (na timezone do tenant). */
export function isInSilentWindow(
  silent: SilentHoursConfig | undefined,
  options: { timezone?: string; now?: Date } = {},
): boolean {
  if (!silent?.enabled || !silent.start || !silent.end) return false;
  const { hour, minute } = partsInTz(options.now ?? new Date(), options.timezone ?? DEFAULT_TZ);
  const [startH = 0, startM = 0] = silent.start.split(':').map(Number);
  const [endH = 0, endM = 0] = silent.end.split(':').map(Number);
  const minutesNow = hour * 60 + minute;
  const minutesStart = startH * 60 + startM;
  const minutesEnd = endH * 60 + endM;
  if (minutesStart > minutesEnd) {
    return minutesNow >= minutesStart || minutesNow < minutesEnd;
  }
  return minutesNow >= minutesStart && minutesNow < minutesEnd;
}

/** Retorna true se está dentro do horário de atendimento da clínica (seg-sex; sábado meio expediente, na timezone do tenant). */
export function isWithinBusinessHours(
  business: BusinessHoursConfig | undefined,
  options: { now?: Date; saturdayEnd?: string } = {},
): boolean {
  const tz = business?.timezone ?? DEFAULT_TZ;
  const { hour, minute, weekday } = partsInTz(options.now ?? new Date(), tz);
  if (weekday === 0) return false; // domingo
  const startStr = business?.start ?? '08:00';
  const endStr = weekday === 6 ? options.saturdayEnd ?? '12:00' : business?.end ?? '18:00';
  const [sh = 0, sm = 0] = startStr.split(':').map(Number);
  const [eh = 0, em = 0] = endStr.split(':').map(Number);
  const minutesNow = hour * 60 + minute;
  return minutesNow >= sh * 60 + sm && minutesNow < eh * 60 + em;
}

/** Retorna a próxima janela de atendimento legível (ex: "amanhã às 8h" ou "segunda às 8h"). */
export function nextBusinessOpeningLabel(
  business: BusinessHoursConfig | undefined,
  options: { now?: Date } = {},
): string {
  const tz = business?.timezone ?? DEFAULT_TZ;
  const { weekday, hour, minute } = partsInTz(options.now ?? new Date(), tz);
  const startStr = business?.start ?? '08:00';
  const [sh = 8] = startStr.split(':').map(Number);

  // Mesmo dia, antes do horário?
  if (weekday >= 1 && weekday <= 5) {
    if (hour * 60 + minute < sh * 60) return `hoje às ${startStr}`;
  }
  if (weekday === 6 && hour * 60 + minute < sh * 60) return `hoje às ${startStr}`;

  // Próximos dias
  const dayLabels = [
    'domingo',
    'segunda-feira',
    'terça-feira',
    'quarta-feira',
    'quinta-feira',
    'sexta-feira',
    'sábado',
  ];
  for (let offset = 1; offset <= 7; offset++) {
    const next = (weekday + offset) % 7;
    if (next >= 1 && next <= 6) {
      if (offset === 1) return `amanhã (${dayLabels[next]}) às ${startStr}`;
      return `${dayLabels[next]} às ${startStr}`;
    }
  }
  return `próxima segunda às ${startStr}`;
}

/** Mensagem padrao quando o tenant nao configurou offlineMessage. */
export const DEFAULT_OFFLINE_MESSAGE =
  'Oi! No momento estamos fora do horário de atendimento. ' +
  'Assim que a equipe chegar pela manhã retornamos sua mensagem 💙';
