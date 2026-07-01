import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ArrowLeft,
  Baby,
  Bell,
  CalendarCheck,
  MessageCircle,
  Phone,
  Syringe,
} from 'lucide-react';
import { apiGet } from '@/lib/api-server';
import type { Appointment, PatientDetail, Vaccine } from '@/lib/types';
import { VaccinationForm } from './vaccination-form';
import { AppointmentsList } from './appointments-list';
import { PatientNameEditor } from './name-editor';

function initials(name: string | null, phone: string): string {
  if (name) {
    return name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }
  return phone.slice(-2);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR');
}

export default async function PatientDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [patient, vaccines, appointments] = await Promise.all([
    apiGet<PatientDetail>(`/patients/${id}`),
    apiGet<Vaccine[]>('/vaccines'),
    apiGet<Appointment[]>(`/appointments?patientId=${id}`),
  ]);
  if (!patient) notFound();

  const profile = patient.profile as {
    babyAgeMonths?: number;
    babyName?: string;
    medicalConditions?: string[];
    babyBirthDate?: string;
  };

  const scheduled = patient.reminders.filter((r) => r.status === 'scheduled');

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <Link
        href="/patients"
        className="mb-4 inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-brand"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Voltar para pacientes
      </Link>

      <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-soft text-xl font-bold text-brand-deep">
            {initials(patient.name, patient.phone)}
          </div>
          <div>
            <PatientNameEditor patientId={patient.id} initialName={patient.name} />
            <div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-slate-500">
              <span className="inline-flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                {patient.phone}
              </span>
              {typeof profile.babyAgeMonths === 'number' && (
                <span className="inline-flex items-center gap-1">
                  <Baby className="h-3.5 w-3.5" />
                  Bebê {profile.babyAgeMonths}m{profile.babyName ? ` · ${profile.babyName}` : ''}
                </span>
              )}
            </div>
            {profile.medicalConditions && profile.medicalConditions.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {profile.medicalConditions.map((c) => (
                  <span
                    key={c}
                    className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 ring-1 ring-amber-200"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2">
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
              <Syringe className="h-4 w-4 text-brand" />
              Histórico vacinal
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {patient.vaccinations.length}
              </span>
            </h2>

            <VaccinationForm patientId={patient.id} vaccines={vaccines ?? []} />

            {patient.vaccinations.length === 0 ? (
              <div className="mt-4 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-500">
                Nenhuma dose registrada ainda. Use o formulário acima para começar o prontuário.
              </div>
            ) : (
              <div className="mt-6 space-y-3">
                {patient.vaccinations.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-4 rounded-xl border border-slate-100 bg-white px-4 py-3"
                  >
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
                      <Syringe className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {v.vaccine?.name ?? v.vaccineSlug}
                      </div>
                      <div className="text-xs text-slate-500">
                        Dose {v.dose} · aplicada em {formatDate(v.appliedAt)}
                      </div>
                    </div>
                    {v.nextDueAt && (
                      <div className="text-right">
                        <div className="text-[11px] uppercase tracking-wider text-slate-400">
                          Próxima dose
                        </div>
                        <div className="text-sm font-semibold text-brand-deep">
                          {formatDate(v.nextDueAt)}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <AppointmentsSection appointments={appointments ?? []} />
          </div>

          {patient.conversations.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
              <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
                <MessageCircle className="h-4 w-4 text-brand" />
                Conversas recentes
              </h2>
              <div className="space-y-2">
                {patient.conversations.map((c) => (
                  <Link
                    key={c.id}
                    href={`/conversation/${c.id}`}
                    className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-sm hover:border-brand/30 hover:bg-brand-soft/30"
                  >
                    <div>
                      <span className="font-medium text-slate-700">
                        {c.status === 'active' && 'Em atendimento com IA'}
                        {c.status === 'awaiting_handoff' && 'Aguardando atendente'}
                        {c.status === 'assigned' && 'Com atendente humano'}
                        {c.status === 'closed' && 'Encerrada'}
                      </span>
                    </div>
                    <span className="text-xs text-slate-400">
                      {formatDate(c.lastMessageAt)}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </section>

        <section>
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
            <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
              <Bell className="h-4 w-4 text-brand" />
              Lembretes agendados
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                {scheduled.length}
              </span>
            </h2>
            {scheduled.length === 0 ? (
              <p className="text-sm text-slate-500">Nenhum lembrete na fila. Ao registrar uma dose, a próxima é agendada automaticamente.</p>
            ) : (
              <ul className="space-y-3">
                {scheduled.map((r) => (
                  <li
                    key={r.id}
                    className="rounded-xl border border-brand-soft bg-brand-soft/30 px-3 py-2"
                  >
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-brand-deep/70">
                      Dose {r.dose} · {r.vaccineSlug}
                    </div>
                    <div className="mt-0.5 text-sm font-medium text-brand-deep">
                      {formatDate(r.scheduledFor)}
                    </div>
                    <p className="mt-1 line-clamp-3 text-xs text-brand-deep/80">{r.message}</p>
                  </li>
                ))}
              </ul>
            )}

            {patient.reminders.filter((r) => r.status === 'sent').length > 0 && (
              <>
                <h3 className="mt-6 text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Enviados
                </h3>
                <ul className="mt-2 space-y-1">
                  {patient.reminders
                    .filter((r) => r.status === 'sent')
                    .slice(0, 5)
                    .map((r) => (
                      <li key={r.id} className="text-xs text-slate-500">
                        {r.vaccineSlug} dose {r.dose} · enviado{' '}
                        {r.sentAt ? formatDate(r.sentAt) : '—'}
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function AppointmentsSection({ appointments }: { appointments: Appointment[] }) {
  return (
    <>
      <h2 className="mb-4 flex items-center gap-2 font-display text-lg font-bold text-slate-900">
        <CalendarCheck className="h-4 w-4 text-brand" />
        Agendamentos
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
          {appointments.length}
        </span>
      </h2>
      <AppointmentsList initial={appointments} />
    </>
  );
}
