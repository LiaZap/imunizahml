'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Pause, Play, Loader2 } from 'lucide-react';

function formatUntil(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  if (sameDay) return `hoje às ${time}`;
  return `${d.toLocaleDateString('pt-BR')} às ${time}`;
}

function remainingLabel(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'expirando...';
  const totalMin = Math.ceil(ms / 60_000);
  if (totalMin < 60) return `${totalMin} min restantes`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `${h}h restantes` : `${h}h ${m}min restantes`;
}

/**
 * Considera "indefinido" qualquer data sentinela far-future (>= ano 2090).
 * O backend usa 2099-12-31 pra sinalizar que a pausa só sai com botão.
 */
function isIndefinite(iso: string): boolean {
  const d = new Date(iso);
  return d.getFullYear() >= 2090;
}

export function AiPauseBanner({
  conversationId,
  pausedUntil,
  canResume,
}: {
  conversationId: string;
  pausedUntil: string | null;
  canResume: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [tick, setTick] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Atualiza label de tempo restante a cada 60s
  useEffect(() => {
    if (!pausedUntil) return;
    const timer = setInterval(() => setTick((v) => v + 1), 60_000);
    return () => clearInterval(timer);
  }, [pausedUntil]);

  if (!pausedUntil) return null;
  const until = new Date(pausedUntil).getTime();
  if (Number.isNaN(until) || until <= Date.now()) return null;

  // Força rerender para atualizar o tick sem warning
  void tick;

  async function handleResume() {
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/resume-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      startTransition(() => {
        router.refresh();
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao retomar');
    }
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700">
        <Pause className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-violet-900">
          IA pausada
        </div>
        <p className="text-sm leading-relaxed text-violet-900">
          {isIndefinite(pausedUntil) ? (
            <>
              Um humano respondeu nesta conversa. A IA só volta a responder quando alguém clicar em{' '}
              <b>Devolver para IA</b>.
            </>
          ) : (
            <>
              Um humano respondeu pelo WhatsApp da clínica. A IA volta a responder automaticamente{' '}
              <b>{formatUntil(pausedUntil)}</b>{' '}
              <span className="text-violet-700">({remainingLabel(pausedUntil)})</span>.
            </>
          )}
        </p>
        {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
      </div>
      {canResume && (
        <button
          onClick={handleResume}
          disabled={isPending}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-semibold text-violet-800 shadow-sm hover:bg-violet-100 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          Devolver para IA
        </button>
      )}
    </div>
  );
}
