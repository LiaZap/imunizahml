'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Listener SSE da fila. Cada router.refresh() faz re-fetch da pagina
 * inteira — durante esse intervalo o conteudo some e reaparece.
 *
 * Bug observado: ao receber rajada de eventos (paciente envia 5 msgs
 * picadas em 3s), vira 5 refreshes em cadeia e a fila pisca / "perde"
 * conversas ate o ultimo refresh consolidar. Debouncing pra 1s soluciona.
 */
const REFRESH_DEBOUNCE_MS = 1_000;

export function QueueRealtime() {
  const router = useRouter();

  useEffect(() => {
    const es = new EventSource('/api/events/conversations');
    let timer: ReturnType<typeof setTimeout> | null = null;

    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        router.refresh();
      }, REFRESH_DEBOUNCE_MS);
    };

    es.addEventListener('message.created', scheduleRefresh);
    es.addEventListener('conversation.handoff_requested', scheduleRefresh);
    es.addEventListener('conversation.assigned', scheduleRefresh);
    es.addEventListener('conversation.closed', scheduleRefresh);

    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [router]);

  return null;
}
