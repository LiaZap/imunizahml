'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowRight, CalendarCheck, HeartPulse, Lock, Mail, Stethoscope } from 'lucide-react';
import { api, ApiError } from '@/lib/api-client';
import { LogoMark } from '@/components/logo';

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

const features = [
  {
    icon: Stethoscope,
    title: 'Orientação clínica 24h',
    text: 'IA humanizada tira dúvidas sobre vacinas direto no WhatsApp.',
  },
  {
    icon: CalendarCheck,
    title: 'Agendamento assistido',
    text: 'Quando o paciente quer agendar, a conversa vai para a sua equipe.',
  },
  {
    icon: HeartPulse,
    title: 'Protocolos vivos',
    text: 'Preços e esquemas vacinais sempre atualizados pelo dashboard.',
  },
];

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  // O destino default eh resolvido por role apos autenticar (via /).
  // Se o user veio de uma URL especifica (?next=), respeita ela.
  const next = params.get('next') ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      router.replace(next);
      router.refresh();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setError('E-mail ou senha incorretos.');
      } else {
        setError('Não foi possível entrar. Tente novamente em instantes.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative min-h-screen bg-slate-50">
      {/* Gradient + noise backdrop */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-brand-gradient"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-brand-radial"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-60 mix-blend-overlay bg-noise"
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col lg:grid lg:grid-cols-[1.1fr_1fr] lg:items-center lg:gap-12 lg:px-10 lg:py-12">
        {/* LEFT — brand panel */}
        <section className="hidden flex-col justify-between px-10 pt-16 text-white lg:flex">
          {/* Wrapper que corta o padding transparente da arte — container 40 de altura, imagem maior com overflow-hidden centraliza e "recorta" top/bottom. */}
          <div className="relative -ml-6 flex h-32 items-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Clínica Imuniza"
              className="h-72 w-auto max-w-none object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = (e.currentTarget.nextElementSibling as HTMLElement | null);
                if (fb) fb.style.display = 'flex';
              }}
            />
            <div style={{ display: 'none' }}>
              <LogoMark variant="light" size="lg" />
            </div>
          </div>

          <div className="max-w-md">
            <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium uppercase tracking-wider text-white/90 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" />
              Plataforma Imuniza
            </div>
            <h1 className="font-display text-4xl font-extrabold leading-tight tracking-tight">
              Atendimento humanizado,<br />no tempo da sua clínica.
            </h1>
            <p className="mt-4 max-w-sm text-base text-white/80">
              IA no WhatsApp 24h, fila de agendamento para a equipe e painel de métricas em tempo
              real — tudo integrado em um único lugar.
            </p>

            <ul className="mt-10 space-y-5">
              {features.map((f) => (
                <li key={f.title} className="flex items-start gap-4">
                  <f.icon
                    strokeWidth={1.6}
                    className="mt-0.5 h-6 w-6 shrink-0 text-accent"
                  />
                  <div>
                    <div className="text-sm font-semibold text-white">{f.title}</div>
                    <div className="mt-0.5 text-[13px] leading-relaxed text-white/70">{f.text}</div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="pb-2 text-xs text-white/50">© Clínica Imuniza</div>
        </section>

        {/* MOBILE header com a logo real */}
        <section className="flex flex-col items-center gap-3 px-6 pb-6 pt-12 text-white lg:hidden">
          <div className="relative flex h-20 w-64 items-center justify-center overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Clínica Imuniza"
              className="h-48 w-auto max-w-none object-contain"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
                const fb = e.currentTarget.nextElementSibling as HTMLElement | null;
                if (fb) fb.style.display = 'flex';
              }}
            />
            <div style={{ display: 'none' }}>
              <LogoMark variant="light" size="lg" />
            </div>
          </div>
          <p className="max-w-xs text-center text-sm text-white/85">
            Plataforma de atendimento humanizado via WhatsApp.
          </p>
        </section>

        {/* RIGHT — form card */}
        <section className="relative mx-4 mb-8 mt-2 lg:mx-0 lg:mb-0 lg:mt-0">
          <div className="rounded-3xl bg-white p-6 shadow-premium ring-1 ring-black/5 sm:p-8 lg:p-10">
            <div className="mb-6">
              <h2 className="font-display text-2xl font-bold text-slate-900">Bem-vindo</h2>
              <p className="mt-1 text-sm text-slate-500">
                Entre com seu e-mail e senha corporativos.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-5">
              <Field
                label="E-mail"
                icon={Mail}
                type="email"
                autoComplete="email"
                value={email}
                onChange={setEmail}
                placeholder=""
              />
              <Field
                label="Senha"
                icon={Lock}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={setPassword}
                placeholder="••••••••"
              />

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                className="group relative flex w-full items-center justify-center gap-2 overflow-hidden rounded-xl bg-brand-gradient px-4 py-3 text-sm font-semibold text-white shadow-card transition hover:brightness-110 active:brightness-95 disabled:cursor-wait disabled:opacity-60"
              >
                <span>{loading ? 'Entrando...' : 'Entrar'}</span>
                {!loading && (
                  <ArrowRight className="h-4 w-4 transition group-hover:translate-x-0.5" />
                )}
              </button>
            </form>

            <p className="mt-8 text-center text-xs text-slate-400">
              Problemas para entrar? Fale com o administrador da clínica.
            </p>
          </div>

          <div className="mt-4 text-center text-xs text-white/70 lg:hidden">
            © Clínica Imuniza
          </div>
        </section>
      </div>
    </main>
  );
}

interface FieldProps {
  label: string;
  type: string;
  icon: typeof Mail;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
  placeholder?: string;
}

function Field({ label, type, icon: Icon, value, onChange, autoComplete, placeholder }: FieldProps) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </span>
      <div className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 transition focus-within:border-brand focus-within:bg-white focus-within:shadow-[0_0_0_4px_rgba(31,122,102,0.12)]">
        <Icon className="h-4 w-4 text-slate-400 transition group-focus-within:text-brand" />
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
          autoComplete={autoComplete}
          placeholder={placeholder}
          className="w-full bg-transparent py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
        />
      </div>
    </label>
  );
}
