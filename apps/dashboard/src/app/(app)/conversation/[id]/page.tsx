import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Phone, Sparkles } from 'lucide-react';
import { apiGet } from '@/lib/api-server';
import { requireUser } from '@/lib/auth';
import type { Conversation, TenantSettings, Vaccine } from '@/lib/types';
import { ChatPanel } from './chat-panel';
import { AiPauseBanner } from './ai-pause-banner';

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

function statusBadge(status: Conversation['status']) {
  const map = {
    active: { label: 'IA atendendo', cls: 'bg-brand-soft text-brand-deep' },
    awaiting_handoff: { label: 'Aguardando humano', cls: 'bg-amber-50 text-amber-700' },
    assigned: { label: 'Em atendimento', cls: 'bg-accent-soft text-accent-foreground' },
    closed: { label: 'Encerrada', cls: 'bg-slate-100 text-slate-600' },
  } as const;
  return map[status];
}

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const [conversation, settings, vaccines] = await Promise.all([
    apiGet<Conversation>(`/conversations/${id}`),
    apiGet<TenantSettings>('/settings'),
    apiGet<Vaccine[]>('/vaccines'),
  ]);
  if (!conversation) notFound();

  const badge = statusBadge(conversation.status);
  const templates = settings?.config.quickTemplates ?? [];

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col p-4 sm:p-6 lg:h-screen lg:p-8">
      <header className="mb-4">
        <Link
          href="/queue"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 transition hover:text-brand"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Voltar à fila
        </Link>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 sm:gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-base font-semibold text-brand-deep sm:h-14 sm:w-14 sm:text-lg">
              {initials(conversation.patient.name, conversation.patient.phone)}
            </div>
            <div className="min-w-0">
              <h1 className="font-display text-xl font-bold text-slate-900 sm:text-2xl">
                {conversation.patient.name ?? 'Paciente'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1">
                  <Phone className="h-3 w-3" /> {conversation.patient.phone}
                </span>
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${badge.cls}`}
                >
                  {badge.label}
                </span>
                {conversation.assignedTo && (
                  <span className="text-slate-500">
                    · Atendente:{' '}
                    <span className="font-medium text-slate-700">
                      {conversation.assignedTo.name}
                    </span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <AiPauseBanner
          conversationId={conversation.id}
          pausedUntil={conversation.aiPausedUntil ?? null}
          canResume={
            user.role === 'admin' ||
            user.role === 'attendant' ||
            user.role === 'secretary'
          }
        />

        {conversation.handoffs?.[0]?.summary && (
          <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-amber-900">
                Resumo do handoff
              </div>
              <p className="mt-0.5 text-sm leading-relaxed text-amber-900">
                {conversation.handoffs[0].summary}
              </p>
            </div>
          </div>
        )}
      </header>

      <ChatPanel
        conversation={conversation}
        currentUserId={user.id}
        templates={templates}
        vaccines={vaccines ?? []}
      />
    </div>
  );
}
