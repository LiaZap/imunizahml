import { notFound } from 'next/navigation';
import { BookOpen, Brain } from 'lucide-react';
import { apiGet } from '@/lib/api-server';
import { requireUser } from '@/lib/auth';
import type { KBDocumentSummary } from '@/lib/types';
import { KBManager } from './manager';

export default async function KBPage() {
  const user = await requireUser();
  if (user.role === 'secretary') notFound();

  const docs = (await apiGet<KBDocumentSummary[]>('/kb/documents')) ?? [];
  const totalChunks = docs.reduce((sum, d) => sum + (d._count?.chunks ?? 0), 0);
  const activeDocs = docs.filter((d) => d.active).length;

  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-brand">
            <Brain className="h-3.5 w-3.5" />
            Conhecimento da IA
          </div>
          <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900">Base de conhecimento</h1>
          <p className="mt-1 max-w-xl text-sm text-slate-500">
            Textos, protocolos e conteúdos consultados pela IA via busca semântica (RAG). Após
            editar, clique em <strong>Reindexar</strong> para regenerar os embeddings.
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm">
          <BookOpen className="h-4 w-4 text-brand" />
          <span className="text-slate-600">
            <strong className="text-slate-900">{activeDocs}</strong> ativos ·{' '}
            <strong className="text-slate-900">{totalChunks}</strong> chunks indexados
          </span>
        </div>
      </header>

      <KBManager initial={docs} />
    </div>
  );
}
