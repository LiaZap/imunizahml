import { notFound } from 'next/navigation';
import { Settings as SettingsIcon } from 'lucide-react';
import { apiGet } from '@/lib/api-server';
import { requireUser } from '@/lib/auth';
import type { TenantSettings } from '@/lib/types';
import { SettingsForm } from './form';
import { WhatsappConnection } from './whatsapp-connection';

export default async function SettingsPage() {
  const user = await requireUser();
  if (user.role !== 'admin' && user.role !== 'secretary') notFound();
  const settings = await apiGet<TenantSettings>('/settings');
  if (!settings) return <div className="p-4 sm:p-6 lg:p-8">Não foi possível carregar as configurações.</div>;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
          <SettingsIcon className="h-3.5 w-3.5" />
          Configurações gerais
        </div>
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">Clínica &amp; IA</h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Ajuste o tom de voz da assistente, mensagem de boas-vindas e horário de atendimento.
          Alterações afetam as próximas respostas da IA.
        </p>
      </header>
      <WhatsappConnection />
      <SettingsForm initial={settings} />
    </div>
  );
}
