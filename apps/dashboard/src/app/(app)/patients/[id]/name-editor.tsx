'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Pencil, X } from 'lucide-react';
import { api } from '@/lib/api-client';

interface Props {
  patientId: string;
  initialName: string | null;
}

/**
 * Nome do paciente editavel inline. Clica no lapis, digita, salva.
 * Usa PATCH /patients/:id que ja existe. Router.refresh apos salvar.
 */
export function PatientNameEditor({ patientId, initialName }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialName ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = value.trim();
    if (!clean) {
      setError('Nome não pode ficar vazio.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api(`/patients/${patientId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: clean }),
      });
      setEditing(false);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (!editing) {
    return (
      <button
        onClick={() => {
          setEditing(true);
          setValue(initialName ?? '');
          setError(null);
        }}
        className="group inline-flex items-center gap-2 text-left"
        title="Clique para editar o nome"
      >
        <h1 className="font-display text-2xl font-bold text-slate-900">
          {initialName ?? 'Paciente sem nome'}
        </h1>
        <Pencil className="h-4 w-4 text-slate-300 transition group-hover:text-brand" />
      </button>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex items-center gap-2">
      <input
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Nome do paciente"
        className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-display text-xl font-bold text-slate-900 outline-none focus:border-brand focus:ring-2 focus:ring-brand/20"
        disabled={saving}
      />
      <button
        type="submit"
        disabled={saving}
        className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-white hover:bg-brand-deep disabled:opacity-50"
        title="Salvar"
      >
        <Check className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => {
          setEditing(false);
          setValue(initialName ?? '');
          setError(null);
        }}
        disabled={saving}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:bg-slate-50"
        title="Cancelar"
      >
        <X className="h-4 w-4" />
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </form>
  );
}
