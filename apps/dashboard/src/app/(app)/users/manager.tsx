'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import { Check, Plus, ShieldCheck, Trash2, UserRound, X } from 'lucide-react';
import { api } from '@/lib/api-client';
import type { UserRecord } from '@/lib/types';

export function UsersManager({
  initial,
  currentUserId,
}: {
  initial: UserRecord[];
  currentUserId: string;
}) {
  const [users, setUsers] = useState(initial);
  const [panelOpen, setPanelOpen] = useState(false);
  const [form, setForm] = useState({
    id: '',
    email: '',
    name: '',
    password: '',
    role: 'attendant' as 'admin' | 'attendant' | 'secretary',
    active: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setForm({ id: '', email: '', name: '', password: '', role: 'attendant', active: true });
    setError(null);
    setPanelOpen(true);
  }

  function startEdit(u: UserRecord) {
    setForm({ id: u.id, email: u.email, name: u.name, password: '', role: u.role, active: u.active });
    setError(null);
    setPanelOpen(true);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      if (form.id) {
        const patch: Record<string, unknown> = {
          name: form.name,
          role: form.role,
          active: form.active,
        };
        if (form.password) patch.password = form.password;
        const updated = await api<UserRecord>(`/users/${form.id}`, {
          method: 'PATCH',
          body: JSON.stringify(patch),
        });
        setUsers((prev) => prev.map((u) => (u.id === updated.id ? updated : u)));
      } else {
        const created = await api<UserRecord>('/users', {
          method: 'POST',
          body: JSON.stringify({
            email: form.email,
            name: form.name,
            password: form.password,
            role: form.role,
          }),
        });
        setUsers((prev) => [...prev, created]);
      }
      setPanelOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function onDelete(id: string) {
    if (id === currentUserId) {
      alert('Você não pode remover sua própria conta.');
      return;
    }
    if (!confirm('Remover este usuário?')) return;
    await api(`/users/${id}`, { method: 'DELETE' });
    setUsers((prev) => prev.filter((u) => u.id !== id));
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-slate-500">
          <UserRound className="h-4 w-4" />
          Usuários ativos
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
            {users.length}
          </span>
        </h2>
        <button
          onClick={startNew}
          className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-brand-deep"
        >
          <Plus className="h-4 w-4" />
          Novo usuário
        </button>
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-4 py-2 text-left">Nome</th>
              <th className="px-4 py-2 text-left">E-mail</th>
              <th className="px-4 py-2 text-left">Papel</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand-deep">
                      {u.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium text-slate-900">{u.name}</div>
                      {u.id === currentUserId && (
                        <div className="text-[11px] text-brand">você</div>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-600">{u.email}</td>
                <td className="px-4 py-3">
                  {u.role === 'admin' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-semibold text-brand-deep">
                      <ShieldCheck className="h-3 w-3" /> Admin
                    </span>
                  ) : u.role === 'secretary' ? (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-semibold text-accent-foreground">
                      Secretária
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                      Atendente
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {u.active ? (
                    <span className="text-xs text-brand-deep">Ativo</span>
                  ) : (
                    <span className="text-xs text-slate-400">Inativo</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button
                    onClick={() => startEdit(u)}
                    className="mr-2 text-xs text-blue-600 hover:underline"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => onDelete(u.id)}
                    disabled={u.id === currentUserId}
                    className="text-xs text-red-600 hover:underline disabled:opacity-40"
                  >
                    <Trash2 className="inline h-3 w-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {panelOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/30 backdrop-blur-sm"
          onClick={() => setPanelOpen(false)}
          role="presentation"
        >
          <aside
            onClick={(e) => e.stopPropagation()}
            className="fixed right-0 top-0 flex h-screen w-full max-w-md flex-col overflow-y-auto bg-white shadow-premium"
          >
            <div className="flex items-start justify-between border-b border-slate-100 px-6 py-5">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {form.id ? 'Editar usuário' : 'Novo usuário'}
                </h3>
                <p className="text-xs text-slate-500">
                  Senhas são armazenadas com bcrypt (nunca em texto puro).
                </p>
              </div>
              <button
                onClick={() => setPanelOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={onSubmit} className="flex-1 space-y-4 px-6 py-5">
              <Field label="E-mail">
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  required
                  disabled={!!form.id}
                  className="input disabled:bg-slate-50 disabled:text-slate-500"
                />
              </Field>
              <Field label="Nome">
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  required
                  className="input"
                />
              </Field>
              <Field label={form.id ? 'Nova senha (deixe em branco p/ manter)' : 'Senha inicial'}>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  required={!form.id}
                  minLength={6}
                  className="input"
                />
              </Field>
              <Field label="Papel">
                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      role: e.target.value as 'admin' | 'attendant' | 'secretary',
                    })
                  }
                  className="input"
                >
                  <option value="attendant">Atendente</option>
                  <option value="secretary">Secretária</option>
                  <option value="admin">Administrador</option>
                </select>
              </Field>
              {form.id && (
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={form.active}
                    onChange={(e) => setForm({ ...form, active: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300 text-brand focus:ring-brand"
                  />
                  <span className="text-slate-700">Ativo</span>
                </label>
              )}
              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {error}
                </div>
              )}
            </form>

            <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
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
