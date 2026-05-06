'use client';

import { useState } from 'react';
import { Upload, X, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api-client';

interface ParsedRow {
  name: string;
  slug?: string;
  description?: string;
  ageMonths?: number[];
  priceCash: number;
  priceInstallment?: number;
  installments?: number;
  active?: boolean;
  _raw: string;
  _err?: string;
}

const SAMPLE = `name,description,ageMonths,priceCash,priceInstallment,installments
Hexavalente acelular,Protege contra 6 doenças importantes,"2,4,6",256,273.75,3
Pneumocócica 20,Cobertura de 20 sorotipos,"2,4,6",489,522.90,3
Rotavírus pentavalente,Protege contra rotavírus,"2,4,6",312,333.63,3`;

function parseNumber(s: string): number | null {
  if (!s) return null;
  // Aceita 1.234,56 ou 1234.56
  const cleaned = s.replace(/\./g, '').replace(',', '.').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function parseAges(s: string | undefined): number[] {
  if (!s) return [];
  return s
    .split(/[;,]/)
    .map((x) => x.trim())
    .map((x) => Number(x))
    .filter((n) => Number.isFinite(n) && n >= 0);
}

function parseCsv(csv: string): ParsedRow[] {
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headerLine = lines[0]!;
  const headers = headerLine.split(',').map((h) => h.trim().toLowerCase());

  const idx = (name: string) => headers.indexOf(name);

  const result: ParsedRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i]!;
    if (!raw.trim()) continue;

    // Parser simples — respeita aspas duplas
    const fields: string[] = [];
    let inQuotes = false;
    let buf = '';
    for (const ch of raw) {
      if (ch === '"') {
        inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        fields.push(buf);
        buf = '';
      } else {
        buf += ch;
      }
    }
    fields.push(buf);

    const get = (name: string) => fields[idx(name)]?.trim() ?? '';

    const name = get('name') || get('nome');
    const priceCash = parseNumber(get('pricecash') || get('preco') || get('preço') || get('valor'));

    if (!name || priceCash == null) {
      result.push({
        name: name || '(sem nome)',
        priceCash: 0,
        _raw: raw,
        _err: !name ? 'campo "name" vazio' : 'campo "priceCash" invalido',
      });
      continue;
    }

    result.push({
      name,
      slug: get('slug') || undefined,
      description: get('description') || get('descricao') || undefined,
      ageMonths: parseAges(get('agemonths') || get('idades')),
      priceCash,
      priceInstallment:
        parseNumber(get('priceinstallment') || get('precoparcelado')) ?? undefined,
      installments: Number(get('installments') || get('parcelas')) || undefined,
      active: get('active')
        ? get('active').toLowerCase() === 'true' || get('active') === '1'
        : undefined,
      _raw: raw,
    });
  }
  return result;
}

export function VaccinesImportModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [csv, setCsv] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{
    created: number;
    updated: number;
    errors: Array<{ row: number; error: string }>;
    total: number;
  } | null>(null);

  function handlePreview() {
    const parsed = parseCsv(csv);
    setRows(parsed);
    setResult(null);
  }

  async function handleImport() {
    const valid = rows.filter((r) => !r._err);
    if (valid.length === 0) return;
    setImporting(true);
    try {
      const payload = {
        rows: valid.map(({ _raw, _err, ...r }) => {
          void _raw;
          void _err;
          return r;
        }),
      };
      const res = await api('/vaccines/import', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      setResult(res as typeof result);
      router.refresh();
    } catch (err) {
      alert(`Falha: ${(err as Error).message}`);
    } finally {
      setImporting(false);
    }
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsv(text);
    setRows(parseCsv(text));
    setResult(null);
  }

  const validCount = rows.filter((r) => !r._err).length;
  const errorCount = rows.length - validCount;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-white shadow-premium"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-bold text-slate-900">Importar tabela de vacinas</h2>
            <p className="text-xs text-slate-500">
              Cole CSV ou faça upload do arquivo. A IA passa a usar os preços novos automaticamente.
            </p>
          </div>
          <button onClick={onClose} className="flex h-8 w-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {!result && (
            <>
              <div className="rounded-xl bg-brand-soft/50 p-3 text-xs text-brand-deep">
                <strong>Formato:</strong> primeira linha com cabeçalho. Colunas obrigatórias:{' '}
                <code className="rounded bg-white px-1">name</code>{' '}
                <code className="rounded bg-white px-1">priceCash</code>. Opcionais:{' '}
                <code className="rounded bg-white px-1">description</code>,{' '}
                <code className="rounded bg-white px-1">ageMonths</code> (ex: <i>"2,4,6"</i>),{' '}
                <code className="rounded bg-white px-1">priceInstallment</code>,{' '}
                <code className="rounded bg-white px-1">installments</code>,{' '}
                <code className="rounded bg-white px-1">active</code>. Aceita preços com vírgula.
                Match por <code className="rounded bg-white px-1">slug</code> (ou gera do nome) — atualiza se já existe.
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <label className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 cursor-pointer">
                  <Upload className="h-4 w-4" />
                  Selecionar arquivo .csv
                  <input type="file" accept=".csv,text/csv" className="hidden" onChange={handleFile} />
                </label>
                <button
                  type="button"
                  onClick={() => setCsv(SAMPLE)}
                  className="text-xs font-medium text-brand hover:text-brand-deep underline"
                >
                  usar exemplo
                </button>
              </div>

              <textarea
                value={csv}
                onChange={(e) => setCsv(e.target.value)}
                onBlur={handlePreview}
                placeholder="cole aqui o conteúdo do CSV..."
                rows={8}
                className="w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs outline-none focus:border-brand/40 focus:ring-2 focus:ring-brand/20"
              />

              {rows.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-3 text-xs">
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-emerald-700">
                      <CheckCircle2 className="h-3 w-3" />
                      {validCount} válidas
                    </span>
                    {errorCount > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-50 px-2 py-0.5 text-rose-700">
                        <AlertTriangle className="h-3 w-3" />
                        {errorCount} com erro
                      </span>
                    )}
                  </div>
                  <div className="max-h-64 overflow-auto rounded-xl border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 sticky top-0">
                        <tr>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">#</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Nome</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Idades (m)</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-600">À vista</th>
                          <th className="px-2 py-1.5 text-right font-semibold text-slate-600">Parcelado</th>
                          <th className="px-2 py-1.5 text-left font-semibold text-slate-600">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r, i) => (
                          <tr key={i} className={r._err ? 'bg-rose-50' : 'border-t border-slate-100'}>
                            <td className="px-2 py-1.5 text-slate-500">{i + 1}</td>
                            <td className="px-2 py-1.5 font-medium text-slate-800">{r.name}</td>
                            <td className="px-2 py-1.5 text-slate-600">{r.ageMonths?.join(', ') ?? '—'}</td>
                            <td className="px-2 py-1.5 text-right text-slate-600">
                              {r.priceCash > 0 ? `R$ ${r.priceCash.toFixed(2).replace('.', ',')}` : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right text-slate-600">
                              {r.priceInstallment ? `R$ ${r.priceInstallment.toFixed(2).replace('.', ',')}` : '—'}
                            </td>
                            <td className="px-2 py-1.5 text-rose-700">{r._err ?? 'ok'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}

          {result && (
            <div className="rounded-xl bg-emerald-50 p-4 text-sm text-emerald-900">
              <div className="mb-2 flex items-center gap-2 font-semibold">
                <CheckCircle2 className="h-5 w-5" />
                Importação concluída
              </div>
              <ul className="list-disc pl-6 text-xs">
                <li>{result.created} vacinas criadas</li>
                <li>{result.updated} vacinas atualizadas</li>
                <li>{result.errors.length} erros</li>
              </ul>
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-4">
          <button
            onClick={onClose}
            className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Fechar
          </button>
          {!result && (
            <button
              onClick={handleImport}
              disabled={validCount === 0 || importing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-4 py-2 text-sm font-semibold text-white shadow-card hover:bg-brand-deep disabled:opacity-50"
            >
              <Upload className="h-4 w-4" />
              {importing ? 'Importando...' : `Importar ${validCount} vacinas`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
