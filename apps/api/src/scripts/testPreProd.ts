/**
 * Suíte de validação pre-prod — foca nos comportamentos NOVOS introduzidos:
 *
 *  1. TRIAGEM antes de preço (pergunta nome + idade antes de chamar list_vaccines)
 *  2. GATE de nome no request_handoff (sem nome → patient_name_required)
 *  3. SMART-SPLIT acolhimento + pergunta em chunks separados
 *  4. SANITIZE de ponto final em chunks intermediários
 *  5. HPV / gripe NÃO devem dar falso "em falta" (bug do list_vaccines filtrando por idade)
 *
 * Roda direto contra a OpenAI com persona REAL do banco + functionDefinitions reais.
 * Mocka as tools (sem efeito colateral). Valida resposta + tool calls.
 *
 * Uso:
 *   cd apps/api && pnpm exec dotenv -e ../../.env.test.local -e ../../.env -- \
 *     tsx src/scripts/testPreProd.ts
 */
import { prisma } from '@imuniza/db';
import OpenAI from 'openai';
import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';
import { splitForHuman } from '../services/humanizedSend.js';

const MODEL = process.env.MODEL ?? 'gpt-4.1';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

interface Scenario {
  id: string;
  description: string;
  // Histórico de mensagens do user antes da pergunta final
  context?: Array<{ role: 'user' | 'assistant'; content: string }>;
  // Pergunta atual do paciente
  question: string;
  // Estado simulado do patient (afeta gate do handoff)
  patientNameSet?: boolean;
  // Validações sobre (resposta final, tools chamadas em sequência)
  checks: (out: { reply: string; tools: string[]; chunks: string[] }) => string[];
}

const mockVaccines = [
  { name: 'Hexavalente acelular', slug: 'hexavalente', ageMonths: [2, 4, 6], priceCash: 256, priceInstallment: 314.27, installments: 18, inStock: true, description: 'Protege contra 6 doenças' },
  { name: 'Influenza (gripe)', slug: 'gripe', ageMonths: [6, 7, 8, 9, 10, 11, 12], priceCash: 120, priceInstallment: 147.32, installments: 18, inStock: true, description: 'Anual' },
  { name: 'Eflueda (gripe alta dose)', slug: 'eflueda', ageMonths: [], priceCash: 330, priceInstallment: 405.12, installments: 18, inStock: true, description: '60+' },
  { name: 'HPV 9 (Gardasil 9)', slug: 'hpv9', ageMonths: [108, 120, 132, 144, 156, 168], priceCash: 924, priceInstallment: 1134.33, installments: 18, inStock: true, description: 'Câncer de colo' },
  { name: 'Pneumocócica 20', slug: 'pneumo-20', ageMonths: [2, 4, 6, 12], priceCash: 489, priceInstallment: 600.31, installments: 18, inStock: true, description: 'Pneumonia' },
  { name: 'Herpes Zóster (Shingrix)', slug: 'zoster', ageMonths: [], priceCash: 859, priceInstallment: 1054.95, installments: 18, inStock: true, description: '50+' },
];

function makeExecTool(opts: { patientNameSet: boolean }) {
  return function execTool(name: string, args: Record<string, unknown>): string {
    if (name === 'list_vaccines') {
      const nameLike = typeof args.nameLike === 'string' ? args.nameLike.toLowerCase() : null;
      const filtered = nameLike
        ? mockVaccines.filter((v) =>
            v.name.toLowerCase().includes(nameLike) ||
            v.slug.toLowerCase().includes(nameLike) ||
            (v.description ?? '').toLowerCase().includes(nameLike),
          )
        : mockVaccines;
      return JSON.stringify({
        priceCashMeaning: 'à vista (dinheiro ou PIX) — preço final já com desconto',
        priceInstallmentMeaning: 'total parcelado no cartão',
        stockMeaning: 'inStock=false: em falta',
        vaccines: filtered,
      });
    }
    if (name === 'recommend_vaccines') {
      const ageMonths = Number(args.ageMonths);
      return JSON.stringify({
        ageMonths,
        recommended: mockVaccines.filter((v) => v.ageMonths.includes(ageMonths)),
        packageAvailable: null,
      });
    }
    if (name === 'request_handoff') {
      // Simula o gate do código
      if (!opts.patientNameSet) {
        return JSON.stringify({
          ok: false,
          error: 'patient_name_required',
          message:
            'Antes de transferir pra equipe, pergunte o nome do paciente e registre com update_patient_profile({ name }). Só depois chame request_handoff de novo.',
        });
      }
      return JSON.stringify({ ok: true, status: 'awaiting_handoff' });
    }
    if (name === 'update_patient_profile') {
      // Se o agente passou name, marca patientNameSet pro próximo gate
      if (typeof args.name === 'string' && args.name.trim().length > 0) {
        opts.patientNameSet = true;
      }
      return JSON.stringify({ ok: true });
    }
    if (name === 'search_kb') return JSON.stringify({ results: [] });
    if (name === 'send_reply') return JSON.stringify({ ok: true, chunks: 1 });
    return JSON.stringify({ error: `unknown ${name}` });
  };
}

async function runScenario(persona: string, sc: Scenario): Promise<{ reply: string; tools: string[]; chunks: string[] }> {
  const system = buildSystemPrompt({
    clinicName: 'Clínica Imuniza',
    persona,
    businessHours: { start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
    currentDate: new Date().toISOString().slice(0, 10),
  });
  const opts = { patientNameSet: sc.patientNameSet ?? false };
  const exec = makeExecTool(opts);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'system', content: `Perfil atual do paciente (JSON): ${JSON.stringify(opts.patientNameSet ? { name: 'Ana' } : {})}. Telefone: 5511999999999.` },
    { role: 'system', content: 'Estamos dentro do horário comercial.' },
    ...((sc.context ?? []).map((m) => ({ role: m.role, content: m.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam)),
    { role: 'user', content: sc.question },
  ];

  const tools: string[] = [];
  let finalText = '';
  for (let iter = 0; iter < 10; iter++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: functionDefinitions,
      tool_choice: 'auto',
      temperature: 0.4,
    });
    const choice = completion.choices[0];
    if (!choice) break;
    const m = choice.message;
    if (m.tool_calls && m.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
      for (const call of m.tool_calls) {
        if (call.type !== 'function') continue;
        tools.push(call.function.name);
        const out = exec(call.function.name, JSON.parse(call.function.arguments || '{}'));
        messages.push({ role: 'tool', tool_call_id: call.id, content: out });
      }
      continue;
    }
    finalText = m.content?.trim() ?? '';
    break;
  }
  return { reply: finalText, tools, chunks: splitForHuman(finalText) };
}

// ─── Cenários ────────────────────────────────────────────────────────────

const SCENARIOS: Scenario[] = [
  // 1. TRIAGEM antes de preço — paciente pergunta gripe direto, IA deve perguntar nome+idade ANTES de soltar preço
  {
    id: 'triagem-gripe',
    description: 'Paciente pergunta preço da gripe sem contexto → IA deve perguntar nome+idade antes',
    question: 'qual o valor da vacina da gripe?',
    checks: ({ reply, tools }) => {
      const probs: string[] = [];
      if (tools.includes('list_vaccines')) probs.push('chamou list_vaccines antes da triagem');
      if (!/(?:nome|chamar|chama|qual\s+(?:a\s+)?idade|quantos\s+anos)/i.test(reply))
        probs.push('não pediu nome/idade na resposta');
      if (/R\$\s*\d/.test(reply)) probs.push('soltou preço sem triagem');
      return probs;
    },
  },
  {
    id: 'triagem-hpv',
    description: 'HPV idem — pode consultar catálogo pra confirmar existência, mas NÃO solta preço',
    question: 'tem HPV ai?',
    checks: ({ reply }) => {
      const probs: string[] = [];
      if (!/(?:nome|chamar|chama|qual\s+(?:a\s+)?idade|quantos\s+anos|pra\s+quem)/i.test(reply))
        probs.push('não pediu nome/idade/contexto');
      if (/R\$\s*\d/.test(reply)) probs.push('soltou preço sem triagem');
      return probs;
    },
  },

  // 2. HPV/gripe SEM falso "em falta"
  {
    id: 'hpv-adulto',
    description: 'Adulto pergunta HPV — não pode dizer "sem estoque"',
    context: [
      { role: 'assistant', content: 'Como posso te chamar?' },
      { role: 'user', content: 'Ana, 39 anos' },
    ],
    question: 'qual o preço da HPV?',
    checks: ({ reply, tools }) => {
      const probs: string[] = [];
      if (!tools.includes('list_vaccines') && !tools.includes('recommend_vaccines'))
        probs.push('não chamou tool de catálogo');
      if (/em\s+falta|sem\s+estoque|n[ãa]o\s+temos|aguardando|estamos\s+sem/i.test(reply))
        probs.push('disse que HPV está em falta (falso)');
      if (!/924|R\$\s*924/.test(reply) && !/HPV/i.test(reply))
        probs.push('não citou HPV nem o preço');
      return probs;
    },
  },
  {
    id: 'gripe-idoso',
    description: 'Idoso de 67 (com nome já registrado) → Eflueda',
    patientNameSet: true,
    context: [
      { role: 'user', content: 'sou o João, 67 anos' },
      { role: 'assistant', content: 'Prazer, João!' },
    ],
    question: 'qual o valor da vacina da gripe?',
    checks: ({ reply, tools }) => {
      const probs: string[] = [];
      if (!tools.includes('list_vaccines') && !tools.includes('recommend_vaccines'))
        probs.push('não chamou tool de catálogo');
      if (/em\s+falta|sem\s+estoque|n[ãa]o\s+temos\s+(a|essa)/i.test(reply))
        probs.push('disse que está em falta (falso)');
      if (!/120|330/.test(reply))
        probs.push('não citou preço da Influenza nem da Eflueda');
      return probs;
    },
  },

  // 3. GATE de nome no handoff — IA tenta handoff sem nome registrado, recebe erro, deve perguntar nome
  {
    id: 'gate-handoff-sem-nome',
    description: 'IA tenta handoff sem nome → gate retorna erro → IA pergunta nome',
    context: [
      { role: 'assistant', content: 'Como posso te ajudar?' },
      { role: 'user', content: 'quero agendar a hexavalente pro meu bebê de 2 meses' },
    ],
    question: 'pode marcar?',
    checks: ({ reply, tools }) => {
      const probs: string[] = [];
      // O gate força que se tentar handoff sem nome, vai dar erro. A IA precisa lidar.
      // Espera-se que EM ALGUM MOMENTO o agente: ou perguntou nome antes, ou tentou handoff (e o mock retornou erro) e perguntou nome depois.
      const askedName = /(?:nome|chamar|chama)/i.test(reply);
      if (!askedName) probs.push('não pediu o nome em nenhum momento');
      return probs;
    },
  },

  // 4. SMART-SPLIT: acolhimento + pergunta em chunks separados
  {
    id: 'smart-split-acolhimento-pergunta',
    description: 'Resposta com acolhimento curto + pergunta → splitForHuman deve gerar ≥2 chunks com pergunta isolada',
    question: 'qual o valor da gripe?',
    checks: ({ chunks }) => {
      const probs: string[] = [];
      // Espera que tenha pelo menos 2 chunks E que o último tenha '?'
      if (chunks.length < 2) probs.push(`smart-split não separou (chunks=${chunks.length})`);
      const last = chunks[chunks.length - 1] ?? '';
      if (!/\?/.test(last)) probs.push('último chunk não termina com pergunta');
      // Primeiro chunk deve ser curto (acolhimento, ≤120 chars)
      const first = chunks[0] ?? '';
      if (first.length > 200) probs.push(`primeiro chunk muito longo (${first.length} chars)`);
      return probs;
    },
  },

  // 5. SANITIZE ponto final — chunks intermediários não devem terminar com '.'
  {
    id: 'sanitize-ponto-final',
    description: 'Chunks intermediários não podem terminar em "." (só o último, opcional)',
    context: [
      { role: 'assistant', content: 'Como posso te chamar?' },
      { role: 'user', content: 'Ana, é pro meu bebê de 2 meses' },
    ],
    question: 'quais vacinas indicam?',
    checks: ({ chunks }) => {
      const probs: string[] = [];
      for (let i = 0; i < chunks.length - 1; i++) {
        const c = chunks[i]!;
        // Cada LINHA do chunk intermediário deve não terminar com "."
        for (const line of c.split('\n')) {
          if (/\.\s*$/.test(line.trim())) {
            probs.push(`chunk ${i} tem linha terminando em ponto: "${line.slice(0, 60)}…"`);
            break;
          }
        }
      }
      return probs;
    },
  },

  // 6. Bullets juntos no mesmo balão
  {
    id: 'bullets-juntos',
    description: 'Recomendação com 3 vacinas → bullets devem viajar JUNTOS num chunk só',
    context: [
      { role: 'assistant', content: 'Como posso te chamar?' },
      { role: 'user', content: 'Ana. É pro meu filho de 2 meses' },
    ],
    question: 'quais ele precisa tomar?',
    checks: ({ chunks }) => {
      const probs: string[] = [];
      const bulletChunks = chunks.filter((c) => /•/.test(c));
      const totalBullets = bulletChunks.reduce((acc, c) => acc + (c.match(/•/g)?.length ?? 0), 0);
      if (totalBullets >= 2 && bulletChunks.length > 1) {
        probs.push(`bullets espalhados em ${bulletChunks.length} chunks (devia ser 1)`);
      }
      return probs;
    },
  },
];

async function loadPersona(): Promise<string> {
  const t = await prisma.tenant.findFirst({ select: { config: true } });
  const p = (t?.config as Record<string, unknown> | null)?.persona;
  return typeof p === 'string' ? p : '';
}

async function main(): Promise<void> {
  const persona = await loadPersona();
  if (!persona) throw new Error('persona vazia no banco — rode demo-persona primeiro');

  console.log(`\n🧪 ${SCENARIOS.length} cenários — modelo: ${MODEL}\n`);
  const results: Array<{ sc: Scenario; probs: string[]; out: Awaited<ReturnType<typeof runScenario>> }> = [];

  for (let i = 0; i < SCENARIOS.length; i++) {
    const sc = SCENARIOS[i]!;
    process.stdout.write(`[${(i + 1).toString().padStart(2, '0')}/${SCENARIOS.length}] ${sc.id.padEnd(35)} `);
    try {
      const out = await runScenario(persona, sc);
      const probs = sc.checks(out);
      results.push({ sc, probs, out });
      console.log(probs.length === 0 ? '✅' : `❌ ${probs.length} problema(s)`);
    } catch (e) {
      console.log(`💥 ${(e as Error).message}`);
      results.push({ sc, probs: [`exception: ${(e as Error).message}`], out: { reply: '', tools: [], chunks: [] } });
    }
  }

  console.log('\n─── Resultados ───\n');
  const failed = results.filter((r) => r.probs.length > 0);
  console.log(`✅ ${results.length - failed.length} passou(aram)  |  ❌ ${failed.length} falhou(aram)\n`);

  for (const f of failed) {
    console.log(`\n❌ [${f.sc.id}] ${f.sc.description}`);
    console.log(`   pergunta: ${f.sc.question}`);
    for (const p of f.probs) console.log(`   • ${p}`);
    console.log(`   tools: [${f.out.tools.join(', ')}]`);
    console.log(`   chunks (${f.out.chunks.length}):`);
    f.out.chunks.forEach((c, idx) => console.log(`     ${idx + 1}. ${c.slice(0, 120).replace(/\n/g, '⏎')}`));
  }

  await prisma.$disconnect();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
