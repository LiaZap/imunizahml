'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

const REFRESH_DEBOUNCE_MS = 1_000;

export function MetricsRealtime() {
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
    es.addEventListener('conversation.closed', scheduleRefresh);
    return () => {
      if (timer) clearTimeout(timer);
      es.close();
    };
  }, [router]);
  return null;
}
