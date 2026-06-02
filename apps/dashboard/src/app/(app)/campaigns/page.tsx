import { notFound } from 'next/navigation';
import { Megaphone } from 'lucide-react';
import { apiGet } from '@/lib/api-server';
import { requireUser } from '@/lib/auth';
import type { Campaign } from '@/lib/types';
import { CampaignsManager } from './manager';

export default async function CampaignsPage() {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'secretary') notFound();
  const campaigns = (await apiGet<Campaign[]>('/campaigns')) ?? [];

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
          <Megaphone className="h-3.5 w-3.5" />
          Marketing direto
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">Campanhas</h1>
        <p className="mt-1 max-w-xl text-sm text-slate-500">
          Envie mensagens em massa para segmentos de pacientes — chegada de novas vacinas, promoções ou
          campanhas sazonais.
        </p>
      </header>

      <CampaignsManager initial={campaigns} />
    </div>
  );
}
