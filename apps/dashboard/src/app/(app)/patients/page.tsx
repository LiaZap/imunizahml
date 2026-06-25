import Link from 'next/link';
import { CalendarCheck, Phone, Syringe, UserRound } from 'lucide-react';
import { apiGet } from '@/lib/api-server';
import type { PatientSummary } from '@/lib/types';
import { PatientsSearch } from './search';

interface PageProps {
  searchParams: Promise<{ search?: string }>;
}

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

export default async function PatientsPage({ searchParams }: PageProps) {
  const { search } = await searchParams;
  const qs = search ? `?search=${encodeURIComponent(search)}` : '';
  const patients = (await apiGet<PatientSummary[]>(`/patients${qs}`)) ?? [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
            <UserRound className="h-3.5 w-3.5" />
            Prontuário digital
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">Pacientes</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Catálogo completo com histórico de vacinação e próximas doses automáticas.
          </p>
        </div>
        <PatientsSearch initial={search ?? ''} />
      </header>

      {patients.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft">
            <UserRound className="h-7 w-7 text-brand" strokeWidth={1.8} />
          </div>
          <div className="mt-4 font-display text-lg font-semibold text-slate-900">
            {search ? 'Nenhum paciente encontrado' : 'Nenhum paciente cadastrado'}
          </div>
          <p className="mt-1 text-sm text-slate-500">
            Pacientes são criados automaticamente no primeiro contato via WhatsApp.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {patients.map((p) => {
            const profile = p.profile as {
              babyAgeMonths?: number;
              babyName?: string;
              medicalConditions?: string[];
            };
            return (
              <Link
                key={p.id}
                href={`/patients/${p.id}`}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 transition hover:-translate-y-0.5 hover:shadow-premium"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-soft font-semibold text-brand-deep">
                    {initials(p.name, p.phone)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold text-slate-900">
                      {p.name ?? 'Sem nome'}
                    </div>
                    <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                      <Phone className="h-3 w-3" />
                      {p.phone}
                    </div>
                    {typeof profile.babyAgeMonths === 'number' && (
                      <div className="mt-1 text-xs text-slate-500">
                        Bebê {profile.babyAgeMonths}m
                        {profile.babyName ? ` · ${profile.babyName}` : ''}
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1">
                    <Syringe className="h-3 w-3 text-brand" />
                    <strong className="text-slate-700">{p._count?.vaccinations ?? 0}</strong> vacinas
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <CalendarCheck className="h-3 w-3 text-violet-600" />
                    <strong className="text-slate-700">{p._count?.appointments ?? 0}</strong>{' '}
                    agend
                  </span>
                  <span>
                    <strong className="text-slate-700">{p._count?.conversations ?? 0}</strong> conversas
                  </span>
                  <span className="ml-auto text-slate-400">desde {formatDate(p.createdAt)}</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
