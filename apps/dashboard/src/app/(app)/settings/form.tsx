'use client';

import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  BellRing,
  Building2,
  CalendarDays,
  Check,
  Clock,
  Copy,
  MessageCircle,
  Moon,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Zap,
} from 'lucide-react';
import { api } from '@/lib/api-client';
import type { TenantSettings } from '@/lib/types';

export function SettingsForm({ initial }: { initial: TenantSettings }) {
  const [persona, setPersona] = useState(initial.config.persona ?? '');
  const [greeting, setGreeting] = useState(initial.config.greeting ?? '');
  const [phone, setPhone] = useState(initial.phone ?? '');
  const [hoursStart, setHoursStart] = useState(initial.config.businessHours?.start ?? '08:00');
  const [hoursEnd, setHoursEnd] = useState(initial.config.businessHours?.end ?? '18:00');
  const [timezone, setTimezone] = useState(
    initial.config.businessHours?.timezone ?? 'America/Sao_Paulo',
  );
  const [silentEnabled, setSilentEnabled] = useState(
    initial.config.silentHours?.enabled ?? false,
  );
  const [silentStart, setSilentStart] = useState(initial.config.silentHours?.start ?? '22:00');
  const [silentEnd, setSilentEnd] = useState(initial.config.silentHours?.end ?? '07:00');
  const [templates, setTemplates] = useState(initial.config.quickTemplates ?? []);
  const [remindersEnabled, setRemindersEnabled] = useState(
    initial.config.reminders?.enabled ?? true,
  );
  const [reminderLeadTimes, setReminderLeadTimes] = useState<number[]>(
    initial.config.reminders?.leadTimesMinutes ?? [24 * 60, 60],
  );
  const [reminderTemplate, setReminderTemplate] = useState(
    initial.config.reminders?.messageTemplate ??
      'Oi {NOME}! 💙 Lembrete do seu agendamento {DATA} às {HORA} para {VACINA}. Qualquer coisa me chama por aqui.',
  );

  const [icalUrl, setIcalUrl] = useState<string | null>(null);
  const [icalLoading, setIcalLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Busca o URL do iCal na 1a renderização
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await api<{ url: string | null }>('/calendar/url');
        if (!cancelled && data?.url) setIcalUrl(data.url);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function regenerateIcalToken() {
    if (!confirm('Gerar um novo link? O link antigo deixará de funcionar e a secretária precisará atualizar no Google.')) return;
    setIcalLoading(true);
    try {
      const data = await api<{ url: string }>('/calendar/rotate-token', { method: 'POST', body: '{}' });
      setIcalUrl(data?.url ?? null);
    } catch (err) {
      alert(`Falha ao gerar novo link: ${(err as Error).message}`);
    } finally {
      setIcalLoading(false);
    }
  }

  async function copyIcal() {
    if (!icalUrl) return;
    try {
      await navigator.clipboard.writeText(icalUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; msg: string } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setStatus(null);
    try {
      await api('/settings', {
        method: 'PATCH',
        body: JSON.stringify({
          persona,
          greeting,
          phone: phone || undefined,
          businessHours: { start: hoursStart, end: hoursEnd, timezone },
          silentHours: { enabled: silentEnabled, start: silentStart, end: silentEnd },
          quickTemplates: templates.filter((t) => t.label.trim() && t.text.trim()),
          reminders: {
            enabled: remindersEnabled,
            leadTimesMinutes: reminderLeadTimes
              .filter((n) => Number.isFinite(n) && n >= 5)
              .sort((a, b) => b - a),
            messageTemplate: reminderTemplate,
          },
        }),
      });
      setStatus({ kind: 'ok', msg: 'Configurações salvas.' });
    } catch (err) {
      setStatus({ kind: 'error', msg: `Erro: ${(err as Error).message}` });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Section
        icon={Building2}
        title="Identidade da clínica"
        description="Nome e contato exibidos nos atendimentos."
      >
        <Field label="Nome da clínica">
          <input value={initial.name} disabled className="input bg-slate-50 text-slate-500" />
        </Field>
        <Field label="Telefone">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="+55 11 99999-9999"
            className="input"
          />
        </Field>
      </Section>

      <Section
        icon={Sparkles}
        title="Persona da IA"
        description="Tom de voz e instruções gerais. Mudanças afetam a próxima resposta."
      >
        <Field label="Instruções de persona">
          <textarea
            value={persona}
            onChange={(e) => setPersona(e.target.value)}
            rows={5}
            required
            className="input"
            placeholder="Ex.: Seja acolhedora, clara e breve. Use tom próximo, evite termos técnicos."
          />
        </Field>
      </Section>

      <Section
        icon={MessageCircle}
        title="Saudação do primeiro contato"
        description="Primeira mensagem enviada quando um paciente inicia a conversa."
      >
        <Field label="Mensagem de saudação">
          <textarea
            value={greeting}
            onChange={(e) => setGreeting(e.target.value)}
            rows={3}
            className="input"
            placeholder="Olá! Sou a assistente virtual da clínica..."
          />
        </Field>
      </Section>

      <Section
        icon={Clock}
        title="Horário de atendimento"
        description="A IA menciona esses horários quando relevante."
      >
        <div className="grid grid-cols-3 gap-3">
          <Field label="Abertura">
            <input
              type="time"
              value={hoursStart}
              onChange={(e) => setHoursStart(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Fechamento">
            <input
              type="time"
              value={hoursEnd}
              onChange={(e) => setHoursEnd(e.target.value)}
              className="input"
            />
          </Field>
          <Field label="Timezone">
            <input
              value={timezone}
              onChange={(e) => setTimezone(e.target.value)}
              className="input"
            />
          </Field>
        </div>
      </Section>

      <Section
        icon={Moon}
        title="Horário de silêncio (lembretes)"
        description="Lembretes automáticos não serão enviados nesse intervalo — ficam agendados para depois."
      >
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={silentEnabled}
            onChange={(e) => setSilentEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
          />
          <span className="text-slate-700">Ativar horário de silêncio</span>
        </label>
        {silentEnabled && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Início">
              <input
                type="time"
                value={silentStart}
                onChange={(e) => setSilentStart(e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Fim">
              <input
                type="time"
                value={silentEnd}
                onChange={(e) => setSilentEnd(e.target.value)}
                className="input"
              />
            </Field>
          </div>
        )}
      </Section>

      <Section
        icon={CalendarDays}
        title="Integração com Google Agenda"
        description="Cole o link abaixo no Google Agenda da secretária. Todos os agendamentos da plataforma aparecem automaticamente na agenda dela."
      >
        {icalUrl ? (
          <>
            <Field label="Link iCal (cole no Google Agenda)">
              <div className="flex items-center gap-2">
                <input
                  value={icalUrl}
                  readOnly
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="input flex-1 font-mono text-xs"
                />
                <button
                  type="button"
                  onClick={copyIcal}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
                <button
                  type="button"
                  onClick={regenerateIcalToken}
                  disabled={icalLoading}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  title="Gera um novo link (o antigo para de funcionar)"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${icalLoading ? 'animate-spin' : ''}`} />
                  Novo
                </button>
              </div>
            </Field>

            <div className="rounded-xl border border-brand/20 bg-brand-soft/30 p-4 text-xs text-brand-deep">
              <p className="mb-2 font-semibold">Como adicionar no Google Agenda:</p>
              <ol className="list-decimal space-y-1 pl-5">
                <li>Abre o Google Agenda (calendar.google.com) com a conta da clínica</li>
                <li>No menu lateral, em <b>"Outros agendas"</b>, clica em <b>"+"</b> → <b>"Inscrever-se via URL"</b></li>
                <li>Cola o link acima e confirma</li>
                <li>Pronto! Os agendamentos da plataforma aparecem em poucos minutos</li>
              </ol>
              <p className="mt-3 text-[11px] opacity-80">
                O Google atualiza a cada algumas horas. Para forçar uma atualização, basta abrir o Google Agenda.
              </p>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-slate-200 bg-white px-4 py-3 text-xs text-slate-500">
            Carregando link…
          </div>
        )}
      </Section>

      <Section
        icon={BellRing}
        title="Lembretes automáticos de agendamento"
        description="A IA envia lembretes via WhatsApp baseado nos horários da Agenda. Configure quanto tempo antes."
      >
        <label className="mb-3 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remindersEnabled}
            onChange={(e) => setRemindersEnabled(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
          />
          <span className="text-slate-700">Disparar lembretes automaticamente</span>
        </label>

        {remindersEnabled && (
          <>
            <Field label="Quando enviar (antes do agendamento)">
              <div className="space-y-2">
                {reminderLeadTimes.map((mins, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <select
                      value={mins}
                      onChange={(e) => {
                        const next = [...reminderLeadTimes];
                        next[i] = Number(e.target.value);
                        setReminderLeadTimes(next);
                      }}
                      className="input w-48"
                    >
                      <option value={15}>15 minutos antes</option>
                      <option value={30}>30 minutos antes</option>
                      <option value={60}>1 hora antes</option>
                      <option value={120}>2 horas antes</option>
                      <option value={180}>3 horas antes</option>
                      <option value={360}>6 horas antes</option>
                      <option value={720}>12 horas antes</option>
                      <option value={1440}>24 horas antes</option>
                      <option value={2880}>2 dias antes</option>
                      <option value={4320}>3 dias antes</option>
                      <option value={10080}>1 semana antes</option>
                    </select>
                    <button
                      type="button"
                      onClick={() => setReminderLeadTimes(reminderLeadTimes.filter((_, j) => j !== i))}
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setReminderLeadTimes([...reminderLeadTimes, 1440])}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-brand/30 hover:text-brand"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Adicionar outro lembrete
                </button>
              </div>
              <p className="mt-2 text-[11px] text-slate-500">
                Você pode configurar múltiplos lembretes — ex.: 24h e 1h antes.
              </p>
            </Field>

            <Field label="Mensagem do lembrete">
              <textarea
                value={reminderTemplate}
                onChange={(e) => setReminderTemplate(e.target.value)}
                rows={3}
                className="input"
                placeholder="Oi {NOME}! Lembrete do seu agendamento {DATA} às {HORA} para {VACINA}."
              />
              <p className="mt-1 text-[11px] text-slate-500">
                Placeholders disponíveis:{' '}
                <code className="rounded bg-slate-100 px-1">{'{NOME}'}</code>{' '}
                <code className="rounded bg-slate-100 px-1">{'{DATA}'}</code>{' '}
                <code className="rounded bg-slate-100 px-1">{'{HORA}'}</code>{' '}
                <code className="rounded bg-slate-100 px-1">{'{VACINA}'}</code>
              </p>
            </Field>
          </>
        )}
      </Section>

      <Section
        icon={Zap}
        title="Respostas rápidas do atendente"
        description="Atalhos com textos pré-definidos que aparecem no chat. Ótimos para respostas recorrentes."
      >
        <div className="space-y-2">
          {templates.map((t, i) => (
            <div key={i} className="flex items-start gap-2">
              <input
                value={t.label}
                onChange={(e) => {
                  const next = [...templates];
                  next[i] = { ...next[i]!, label: e.target.value };
                  setTemplates(next);
                }}
                placeholder="Rótulo"
                className="input w-40"
              />
              <textarea
                value={t.text}
                onChange={(e) => {
                  const next = [...templates];
                  next[i] = { ...next[i]!, text: e.target.value };
                  setTemplates(next);
                }}
                placeholder="Texto da resposta rápida"
                rows={2}
                className="input flex-1"
              />
              <button
                type="button"
                onClick={() => setTemplates(templates.filter((_, j) => j !== i))}
                className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-600"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setTemplates([...templates, { label: '', text: '' }])}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-brand/30 hover:text-brand"
          >
            <Plus className="h-3.5 w-3.5" />
            Adicionar resposta rápida
          </button>
        </div>
      </Section>

      <div className="sticky bottom-0 -mx-8 flex items-center justify-between gap-3 border-t border-slate-200 bg-white/80 px-8 py-4 backdrop-blur">
        {status ? (
          <p className={`text-sm ${status.kind === 'ok' ? 'text-brand-deep' : 'text-red-600'}`}>
            {status.msg}
          </p>
        ) : (
          <p className="text-xs text-slate-500">
            As mudanças valem imediatamente para novas conversas da IA.
          </p>
        )}
        <button
          type="submit"
          disabled={saving}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold text-white shadow-card hover:bg-brand-deep disabled:opacity-60"
        >
          <Check className="h-4 w-4" />
          {saving ? 'Salvando...' : 'Salvar alterações'}
        </button>
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.75rem;
          border: 1px solid rgb(226 232 240);
          background: white;
          padding: 0.6rem 0.8rem;
          font-size: 0.875rem;
          color: rgb(15 23 42);
          outline: none;
          transition: all 0.15s;
        }
        .input:focus {
          border-color: #1f7a66;
          box-shadow: 0 0 0 4px rgba(31, 122, 102, 0.12);
        }
      `}</style>
    </form>
  );
}

function Section({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof Building2;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-card">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <Icon className="h-5 w-5" strokeWidth={1.8} />
        </div>
        <div>
          <h3 className="font-display text-base font-bold text-slate-900">{title}</h3>
          <p className="text-xs text-slate-500">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-slate-600">
        {label}
      </span>
      {children}
    </label>
  );
}
