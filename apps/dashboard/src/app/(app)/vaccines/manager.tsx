'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Baby, Check, Pencil, Plus, Sparkles, Syringe, Trash2, Upload, X } from 'lucide-react';
import { VaccinesImportModal } from './import-modal';
import { api } from '@/lib/api-client';
import type { Vaccine, VaccinePackage } from '@/lib/types';

function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseAges(input: string): number[] {
  return input
    .split(',')
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function formatBRL(n: number): string {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function ageRangeLabel(ages: number[]): string {
  if (ages.length === 0) return 'Sem idade definida';
  if (ages.length === 1) return `${ages[0]} meses`;
  const min = Math.min(...ages);
  const max = Math.max(...ages);
  return `${min}–${max} meses`;
}

function vaccineTone(ages: number[]): { card: string; chip: string; icon: string } {
  const min = ages.length > 0 ? Math.min(...ages) : 0;
  if (min < 3)
    return {
      card: 'from-brand/10 to-white',
      chip: 'bg-brand-soft text-brand-deep',
      icon: 'text-brand',
    };
  if (min < 7)
    return {
      card: 'from-accent-soft to-white',
      chip: 'bg-accent-soft text-accent-foreground',
      icon: 'text-accent-foreground',
    };
  return {
    card: 'from-violet-50 to-white',
    chip: 'bg-violet-50 text-violet-700',
    icon: 'text-violet-600',
  };
}

const emptyForm = {
  id: '',
  name: '',
  slug: '',
  description: '',
  ageMonthsText: '',
  priceCash: '',
  priceInstallment: '',
  installments: '3',
  active: true,
};

export function VaccinesManager({
  initial,
  packages,
}: {
  initial: Vaccine[];
  packages: VaccinePackage[];
}) {
  const [vaccines, setVaccines] = useState(initial);
  const [showImport, setShowImport] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [panelOpen, setPanelOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setForm(emptyForm);
    setError(null);
    setPanelOpen(true);
  }

  function startEdit(v: Vaccine) {
    setForm({
      id: v.id,
      name: v.name,
      slug: v.slug,
      description: v.description,
      ageMonthsText: v.ageMonths.join(', '),
      priceCash: String(v.priceCash),
      priceInstallment: String(v.priceInstallment),
      installments: String(v.installments),
      active: v.active,
    });
    setError(null);
    setPanelOpen(true);
  }

  function close() {
    setPanelOpen(false);
    setError(null);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    const payload = {
      name: form.name.trim(),
      slug: form.slug.trim() || slugify(form.name),
      description: form.description.trim(),
      ageMonths: parseAges(form.ageMonthsText),
      priceCash: Number(form.priceCash),
      priceInstallment: Number(form.priceInstallment),
      installments: Number(form.installments),
      active: form.active,
    };
    try {
      if (form.id) {
        const updated = await api<Vaccine>(`/vaccines/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
        setVaccines((prev) => prev.map((v) => (v.id === updated.id ? updated : v)));
      } else {
        const created = await api<Vaccine>('/vaccines', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
        setVaccines((prev) => [...prev, created]);
      }
      close();
    } catch (err) {
      setError(`Erro: ${(err as Error).message}`);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (!confirm('Remover esta vacina?')) return;
    await api(`/vaccines/${id}`, { method: 'DELETE' });
    setVaccines((prev) => prev.filter((v) => v.id !== id));
  }

  async function toggleStock(v: Vaccine) {
    const next = !(v.inStock ?? true);
    let note: string | null | undefined = v.outOfStockNote;
    if (!next) {
      const input = prompt(
        'Marcar como EM FALTA. A IA passa a oferecer lista de espera ao paciente.\n\n' +
          'Quer adicionar uma observação? (ex.: "previsão maio/26")\nDeixe em branco se não tiver.',
        v.outOfStockNote ?? '',
      );
      if (input === null) return; // cancelou
      note = input.trim() || null;
    } else {
      note = null;
    }
    try {
      const updated = await api<Vaccine>(`/vaccines/${v.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ inStock: next, outOfStockNote: note }),
      });
      setVaccines((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
    } catch (err) {
      alert(`Falha: ${(err as Error).message}`);
    }
  }

  return (
    <>
      {packages.length > 0 && (
        <section className="mb-8">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
            <Sparkles className="h-4 w-4" />
            Pacote em destaque
          </div>
          {packages.map((pkg) => (
            <div
              key={pkg.id}
              className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-brand via-brand-deep to-brand p-6 text-white shadow-premium"
            >
              <div className="pointer-events-none absolute -right-10 -top-10 h-48 w-48 rounded-full bg-accent/20 blur-3xl" />
              <div className="relative flex flex-wrap items-end justify-between gap-6">
                <div className="max-w-xl">
                  <div className="mb-2 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold uppercase tracking-wider backdrop-blur">
                    <Baby className="h-3 w-3" /> {pkg.items.length} vacinas inclusas
                  </div>
                  <h3 className="font-display text-2xl font-extrabold">{pkg.name}</h3>
                  <p className="mt-2 text-sm text-white/80">{pkg.description}</p>
                </div>
                <div className="text-right">
                  <div className="text-[11px] uppercase tracking-wider text-white/70">À vista</div>
                  <div className="font-display text-3xl font-extrabold">
                    {formatBRL(pkg.priceCash)}
                  </div>
                  <div className="mt-1 text-xs text-white/70">
                    ou {pkg.installments}x de{' '}
                    {formatBRL(pkg.priceInstallment / pkg.installments)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
            <Syringe className="h-4 w-4" />
            Vacinas cadastradas
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
              {vaccines.length}
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowImport(true)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition hover:border-brand/30 hover:text-brand-deep"
            >
              <Upload className="h-4 w-4" />
              Importar CSV
            </button>
            <button
              onClick={startNew}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-card transition hover:bg-brand-deep"
            >
              <Plus className="h-4 w-4" />
              Nova vacina
            </button>
          </div>
        </div>
        {showImport && <VaccinesImportModal onClose={() => setShowImport(false)} />}

        {vaccines.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-12 text-center text-sm text-slate-500">
            Nenhuma vacina cadastrada ainda.
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {vaccines.map((v) => {
              const tone = vaccineTone(v.ageMonths);
              return (
                <div
                  key={v.id}
                  className={`group relative overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br ${tone.card} p-5 transition hover:-translate-y-0.5 hover:shadow-premium`}
                >
                  <div className="flex items-start justify-between">
                    <div
                      className={`flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm ${tone.icon}`}
                    >
                      <Syringe className="h-5 w-5" strokeWidth={1.8} />
                    </div>
                    <div className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${tone.chip}`}>
                      {ageRangeLabel(v.ageMonths)}
                    </div>
                  </div>

                  <h3 className="mt-4 font-display text-base font-bold text-slate-900">
                    {v.name}
                  </h3>
                  <p className="mt-1 line-clamp-2 text-xs text-slate-600">{v.description}</p>

                  <div className="mt-4 flex items-end justify-between">
                    <div>
                      <div className="text-[11px] uppercase tracking-wider text-slate-500">À vista</div>
                      <div className="font-display text-xl font-extrabold text-slate-900">
                        {formatBRL(v.priceCash)}
                      </div>
                      <div className="text-[11px] text-slate-500">
                        ou {v.installments}x de {formatBRL(v.priceInstallment / v.installments)}
                      </div>
                    </div>

                    <div className="flex gap-1 opacity-0 transition group-hover:opacity-100">
                      <button
                        onClick={() => startEdit(v)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-brand"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => onDelete(v.id)}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-600 shadow-sm ring-1 ring-slate-200 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-1.5">
                    {!v.active && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                        Inativa
                      </span>
                    )}
                    {v.inStock === false && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-700 ring-1 ring-rose-200">
                        Em falta
                        {v.outOfStockNote ? ` · ${v.outOfStockNote}` : ''}
                      </span>
                    )}
                    <button
                      onClick={() => toggleStock(v)}
                      className={`ml-auto inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold transition ${
                        v.inStock === false
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100'
                          : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
                      }`}
                      title={v.inStock === false ? 'Marcar de volta em estoque' : 'Marcar como em falta'}
                    >
                      {v.inStock === false ? '✓ Voltar ao estoque' : 'Marcar em falta'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {panelOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
          onClick={close}
          role="presentation"
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="fixed right-0 top-0 flex h-screen w-full max-w-md flex-col overflow-y-auto bg-white shadow-premium"
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {form.id ? 'Editar vacina' : 'Nova vacina'}
                </h3>
                <p className="text-xs text-slate-500">
                  Dados visíveis pela IA em cada resposta.
                </p>
              </div>
              <button
                onClick={close}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="flex-1 space-y-4 px-6 py-5">
              <Field label="Nome">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="input"
                />
              </Field>
              <Field label="Slug (opcional)">
                <input
                  value={form.slug}
                  onChange={(e) => setForm({ ...form, slug: e.target.value })}
                  placeholder="gerado automaticamente"
                  className="input"
                />
              </Field>
              <Field label="Descrição">
                <textarea
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  required
                  rows={3}
                  className="input"
                />
              </Field>
              <Field label="Idades (meses, separadas por vírgula)">
                <input
                  value={form.ageMonthsText}
                  onChange={(e) => setForm({ ...form, ageMonthsText: e.target.value })}
                  placeholder="2, 4, 6"
                  className="input"
                />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="À vista (R$)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.priceCash}
                    onChange={(e) => setForm({ ...form, priceCash: e.target.value })}
                    required
                    className="input"
                  />
                </Field>
                <Field label="Parcelado (R$)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.priceInstallment}
                    onChange={(e) => setForm({ ...form, priceInstallment: e.target.value })}
                    required
                    className="input"
                  />
                </Field>
              </div>
              <Field label="Nº parcelas">
                <input
                  type="number"
                  value={form.installments}
                  onChange={(e) => setForm({ ...form, installments: e.target.value })}
                  className="input"
                />
              </Field>

              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm({ ...form, active: e.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                />
                <span className="text-slate-700">Ativa (visível para a IA)</span>
              </label>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
            </form>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={close}
                className="rounded-xl border border-slate-200 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                Cancelar
              </button>
              <button
                type="submit"
                onClick={onSubmit}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-brand-deep disabled:opacity-60"
              >
                <Check className="h-4 w-4" />
                {saving ? 'Salvando...' : 'Salvar'}
              </button>
            </div>
          </aside>
        </div>
      )}

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
    </>
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
