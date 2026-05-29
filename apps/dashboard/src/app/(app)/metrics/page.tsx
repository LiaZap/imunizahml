import {
  Activity,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  Download,
  MessageSquare,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';
import { notFound } from 'next/navigation';
import { apiGet } from '@/lib/api-server';
import { requireUser } from '@/lib/auth';
import type {
  FunnelData,
  HourlyPoint,
  MessagesBreakdown,
  MetricsOverview,
  WeeklyPoint,
} from '@/lib/types';
import { WeeklyChart } from './weekly-chart';
import { HourlyChart } from './hourly-chart';
import { MetricsRealtime } from './realtime';
import { FunnelSection } from './funnel';
import { BreakdownCard } from './breakdown-card';

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone = 'slate',
}: {
  icon: typeof Activity;
  label: string;
  value: number | string;
  hint?: string;
  tone?: 'brand' | 'accent' | 'slate' | 'violet';
}) {
  const tones = {
    brand: 'from-brand/90 via-brand to-brand-deep text-white',
    accent: 'from-accent to-accent/80 text-accent-foreground',
    slate: 'from-white to-slate-50 text-slate-800',
    violet: 'from-violet-500 to-violet-700 text-white',
  } as const;
  const isLight = tone === 'brand' || tone === 'accent' || tone === 'violet';
  return (
    <div
      className={`relative overflow-hidden rounded-2xl bg-gradient-to-br p-5 shadow-card ring-1 ring-black/5 ${tones[tone]}`}
    >
      <div className="pointer-events-none absolute -right-6 -top-6 h-24 w-24 rounded-full bg-white/10 blur-2xl" />
      <div className="relative flex items-start justify-between">
        <div>
          <div
            className={`font-display text-4xl font-extrabold leading-none ${
              isLight ? '' : 'text-slate-900'
            }`}
          >
            {value}
          </div>
          <div
            className={`mt-2 text-xs font-semibold uppercase tracking-wider ${
              isLight ? 'text-white/80' : 'text-slate-600'
            }`}
          >
            {label}
          </div>
          {hint && (
            <div className={`mt-1 text-[11px] ${isLight ? 'text-white/70' : 'text-slate-500'}`}>
              {hint}
            </div>
          )}
        </div>
        <Icon
          className={`h-5 w-5 ${isLight ? 'text-white/70' : 'text-slate-500'}`}
          strokeWidth={1.8}
        />
      </div>
    </div>
  );
}

export default async function MetricsPage() {
  const user = await requireUser();
  if (user.role === 'secretary') notFound();

  const [overview, weekly, hourly, breakdown, funnel] = await Promise.all([
    apiGet<MetricsOverview>('/metrics/overview'),
    apiGet<WeeklyPoint[]>('/metrics/weekly'),
    apiGet<HourlyPoint[]>('/metrics/hourly'),
    apiGet<MessagesBreakdown & {
      escalations: number;
      conversations: number;
      escalationRate: number;
      from: string;
      to: string;
    }>('/metrics/breakdown?days=7'),
    apiGet<FunnelData>('/metrics/funnel?days=30'),
  ]);

  const stats = overview ?? {
    active: 0,
    awaitingHandoff: 0,
    assignedActive: 0,
    closedToday: 0,
    messagesToday: 0,
    handoffsToday: 0,
    patientsToday: 0,
    aiMessagesToday: 0,
  };
  const weeklyData = weekly ?? [];
  const hourlyData = hourly ?? [];
  const breakdownData = breakdown ?? {
    user: 0,
    assistant: 0,
    human: 0,
    escalations: 0,
    conversations: 0,
    escalationRate: 0,
    from: '',
    to: '',
  };

  const weeklyTotalMsgs = weeklyData.reduce((a, b) => a + b.messages, 0);
  const weeklyAvg = weeklyData.length > 0 ? Math.round(weeklyTotalMsgs / weeklyData.length) : 0;
  const busiestDay = weeklyData.reduce<WeeklyPoint | null>(
    (best, d) => (!best || d.messages > best.messages ? d : best),
    null,
  );
  const peakHour = hourlyData.reduce<HourlyPoint | null>(
    (best, d) => (!best || d.messages > best.messages ? d : best),
    null,
  );

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <MetricsRealtime />

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
            Tempo real
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">Métricas</h1>
          <p className="mt-1 text-sm text-slate-500">
            Visão completa da IA, fila humana e engajamento dos pacientes.
          </p>
        </div>
        <a
          href={`/api/reports/monthly?year=${new Date().getFullYear()}&month=${new Date().getMonth() + 1}`}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-brand/30 hover:text-brand-deep"
        >
          <Download className="h-4 w-4" />
          Relatório PDF do mês
        </a>
      </header>

      <section className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-5">
        <Kpi
          icon={Activity}
          label="Conversas ativas"
          value={stats.active + stats.assignedActive + stats.awaitingHandoff}
          hint={`${stats.active} IA · ${stats.assignedActive} humano · ${stats.awaitingHandoff} fila`}
          tone="brand"
        />
        <Kpi
          icon={MessageSquare}
          label="Mensagens hoje"
          value={stats.messagesToday}
          hint={`${stats.aiMessagesToday ?? 0} enviadas pela IA`}
          tone="accent"
        />
        <Kpi
          icon={UserPlus}
          label="Pacientes novos"
          value={stats.patientsToday ?? 0}
          hint="primeiros contatos hoje"
          tone="violet"
        />
        <Kpi
          icon={Users}
          label="Escalonamento (7d)"
          value={`${breakdownData.escalationRate}%`}
          hint={`${breakdownData.escalations} de ${breakdownData.conversations} conversas`}
          tone="slate"
        />
        <Kpi
          icon={CheckCircle2}
          label="Encerradas hoje"
          value={stats.closedToday}
          hint={`${stats.handoffsToday ?? 0} handoffs para humanos`}
          tone="slate"
        />
      </section>

      <section className="mb-8 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
                  <TrendingUp className="h-4 w-4 text-brand" />
                  Últimos 7 dias
                </h2>
                <p className="text-xs text-slate-500">
                  Volume de mensagens e encaminhamentos diários.
                </p>
              </div>
              <div className="text-right">
                <div className="font-display text-2xl font-extrabold text-slate-900">
                  {weeklyTotalMsgs}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-slate-500">
                  mensagens · média {weeklyAvg}/dia
                </div>
              </div>
            </div>
            <WeeklyChart data={weeklyData} />
            {busiestDay && busiestDay.messages > 0 && (
              <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-medium text-brand-deep">
                <Calendar className="h-3.5 w-3.5" />
                Dia mais movimentado:{' '}
                <span className="font-semibold">
                  {new Date(busiestDay.date + 'T00:00:00').toLocaleDateString('pt-BR', {
                    weekday: 'long',
                    day: '2-digit',
                    month: 'short',
                  })}
                </span>{' '}
                — {busiestDay.messages} msgs
              </div>
            )}
          </div>
        </div>

        <div>
          <BreakdownCard initial={breakdown} />
        </div>
      </section>

      {funnel && (
        <section className="mb-8">
          <FunnelSection data={funnel} />
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="flex items-center gap-2 font-display text-lg font-bold text-slate-900">
                <Clock className="h-4 w-4 text-brand" />
                Distribuição por hora (hoje)
              </h2>
              <p className="text-xs text-slate-500">Quando os pacientes mais conversam.</p>
            </div>
            {peakHour && peakHour.messages > 0 && (
              <div className="text-right">
                <div className="text-[11px] uppercase tracking-wider text-slate-500">Pico</div>
                <div className="font-display text-xl font-bold text-slate-900">
                  {String(peakHour.hour).padStart(2, '0')}h
                </div>
              </div>
            )}
          </div>
          <HourlyChart data={hourlyData} />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-brand-soft via-white to-accent-soft p-6 shadow-card">
          <h2 className="font-display text-lg font-bold text-slate-900">Insights</h2>
          <p className="mb-4 text-xs text-slate-500">
            Resumo automático da operação.
          </p>
          <ul className="space-y-3 text-sm">
            <Insight
              ok={stats.awaitingHandoff === 0}
              text={
                stats.awaitingHandoff === 0
                  ? 'Nenhum paciente aguardando atendimento humano.'
                  : `${stats.awaitingHandoff} paciente(s) aguardando na fila.`
              }
            />
            <Insight
              ok={breakdownData.assistant > breakdownData.human}
              text={`A IA está respondendo ${breakdownData.assistant} mensagem(ns) vs. ${breakdownData.human} do atendente nesta semana.`}
            />
            <Insight
              ok={(stats.patientsToday ?? 0) > 0}
              text={
                (stats.patientsToday ?? 0) > 0
                  ? `${stats.patientsToday} paciente(s) novos entraram em contato hoje.`
                  : 'Nenhum paciente novo hoje — confira campanhas.'
              }
            />
            <Insight
              ok={peakHour !== null && peakHour.messages > 0}
              text={
                peakHour && peakHour.messages > 0
                  ? `Horário de pico hoje: ${String(peakHour.hour).padStart(2, '0')}h com ${peakHour.messages} mensagens.`
                  : 'Ainda sem dados de pico para hoje.'
              }
            />
          </ul>
        </div>
      </section>
    </div>
  );
}

function Insight({ ok, text }: { ok: boolean; text: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span
        className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${
          ok ? 'bg-brand-soft text-brand' : 'bg-amber-100 text-amber-700'
        }`}
      >
        {ok ? (
          <CheckCircle2 className="h-3 w-3" strokeWidth={2.5} />
        ) : (
          <Activity className="h-3 w-3" strokeWidth={2.5} />
        )}
      </span>
      <span className="text-slate-700">{text}</span>
    </li>
  );
}
