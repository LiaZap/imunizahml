/**
 * Suite E2E ampla: testa comportamento da IA com todas as regras vigentes.
 *
 * Cenários cobertos:
 *  - Triagem com NOME antes de preço
 *  - Anti-alucinação de parcelas (3x sempre, nunca 12x/18x)
 *  - Mais parcelas → handoff (com nome)
 *  - HPV template oficial (Nonavalente, 9 tipos...)
 *  - Coadministração: pode aplicar várias no mesmo dia
 *  - Febre Amarela: EXCEÇÃO 30 dias antes/depois
 *  - Pacotes 2-6m, HPV 9, 1a-1a6m
 *  - Brinco
 *  - Gripe (Influenza + Eflueda 60+)
 *  - Bebê 3 meses: Meningo ACWY + B
 *
 * Uso (a partir de apps/api):
 *   pnpm exec dotenv -e ../../.env.test.local -e ../../.env -- tsx src/scripts/testE2EBehavior.ts
 */
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.MODEL || 'gpt-4.1';
if (!OPENAI_API_KEY) {
  console.error('faltou OPENAI_API_KEY');
  process.exit(1);
}
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Extrai a persona do arquivo demo-persona.ts (entre crase + 'const PERSONA = `' e a próxima `)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const personaFile = path.resolve(
  __dirname,
  '../../../../packages/db/prisma/demo-persona.ts',
);
const personaSrc = fs.readFileSync(personaFile, 'utf8');
const match = personaSrc.match(/const PERSONA = `([\s\S]+?)`;/);
if (!match) {
  console.error('não encontrou PERSONA no arquivo');
  process.exit(1);
}
const persona = match[1]!;

const system = buildSystemPrompt({
  clinicName: 'Clínica Imuniza',
  persona,
  businessHours: { start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
  currentDate: new Date().toISOString().slice(0, 10),
});

const mockVaccines = [
  { name: 'Hexavalente acelular', slug: 'hexavalente', ageMonths: [2, 4, 6], priceCash: 256, priceInstallment: 273.74, installments: 3, inStock: true, description: '6 doenças' },
  { name: 'Pneumocócica 20', slug: 'pneumo-20', ageMonths: [2, 4, 6, 12], priceCash: 489, priceInstallment: 522.89, installments: 3, inStock: true, description: 'Pneumonia' },
  { name: 'Rotavírus pentavalente', slug: 'rotavirus', ageMonths: [2, 4, 6], priceCash: 312, priceInstallment: 333.62, installments: 3, inStock: true, description: 'Diarreia bebês' },
  { name: 'Meningocócica ACWY', slug: 'acwy', ageMonths: [3, 5, 12], priceCash: 389, priceInstallment: 415.96, installments: 3, inStock: true, description: 'Meningite ACWY' },
  { name: 'Meningocócica B', slug: 'meningo-b', ageMonths: [3, 5, 12], priceCash: 689, priceInstallment: 736.75, installments: 3, inStock: true, description: 'Meningite B' },
  { name: 'Tríplice viral', slug: 'triplice', ageMonths: [12, 15], priceCash: 140.80, priceInstallment: 150.56, installments: 3, inStock: true, description: 'SCR' },
  { name: 'Influenza (gripe)', slug: 'gripe', ageMonths: [6, 12], priceCash: 120, priceInstallment: 128.32, installments: 3, inStock: true, description: 'Gripe anual' },
  { name: 'Eflueda (gripe alta dose)', slug: 'eflueda', ageMonths: [], priceCash: 330, priceInstallment: 352.87, installments: 3, inStock: true, description: 'Gripe 60+' },
  { name: 'HPV 9 (Gardasil 9)', slug: 'hpv9', ageMonths: [108, 132], priceCash: 924, priceInstallment: 988.03, installments: 3, inStock: true, description: 'HPV' },
  { name: 'Qdenga (dengue)', slug: 'qdenga', ageMonths: [], priceCash: 590, priceInstallment: 630.89, installments: 3, inStock: true, description: 'Dengue' },
  { name: 'Herpes Zóster (Shingrix GSK)', slug: 'herpes-zoster', ageMonths: [], priceCash: 859, priceInstallment: 918.53, installments: 3, inStock: true, description: 'Cobreiro' },
  { name: 'Arexvy (VSR adulto)', slug: 'arexvy', ageMonths: [], priceCash: 1690, priceInstallment: 1807.12, installments: 3, inStock: true, description: 'VSR adulto' },
  { name: 'Febre amarela', slug: 'febre-amarela', ageMonths: [9, 48], priceCash: 156, priceInstallment: 166.81, installments: 3, inStock: true, description: 'Febre amarela' },
  { name: 'Hepatite A — adulto', slug: 'hepa-adulto', ageMonths: [], priceCash: 276, priceInstallment: 295.13, installments: 3, inStock: true, description: 'Hep A' },
  { name: 'Aplicação/perfuração de brincos', slug: 'brincos', ageMonths: [], priceCash: 140, priceInstallment: 149.70, installments: 3, inStock: true, description: 'Brincos bebês 15 dias+' },
];

const mockPackages = [
  { name: 'Pacote 2 a 6 meses', slug: 'pacote-2-6m', priceCash: 5067, priceInstallment: 5418.14, installments: 3 },
  { name: 'Pacote HPV 9 (3 doses)', slug: 'pacote-hpv9', priceCash: 2712, priceInstallment: 2899.94, installments: 3 },
  { name: 'Pacote 1 ano a 1 ano e 6 meses', slug: 'pacote-1a-1a6m', priceCash: 3067, priceInstallment: 3279.54, installments: 3 },
];

const toolsCalled: string[] = [];
const lastSends: string[] = [];
const profileUpdates: Record<string, unknown>[] = [];
let handoffCalled = false;

function execTool(name: string, args: Record<string, unknown>): string {
  toolsCalled.push(name);
  if (name === 'list_packages') {
    const nameLike = String(args.nameLike ?? '').toLowerCase();
    const filtered = nameLike
      ? mockPackages.filter((p) => p.name.toLowerCase().includes(nameLike) || p.slug.toLowerCase().includes(nameLike))
      : mockPackages;
    return JSON.stringify({ packages: filtered });
  }
  if (name === 'list_vaccines') {
    const nameLike = String(args.nameLike ?? '').toLowerCase();
    const filtered = nameLike
      ? mockVaccines.filter(
          (v) =>
            v.name.toLowerCase().includes(nameLike) ||
            v.slug.toLowerCase().includes(nameLike) ||
            (v.description ?? '').toLowerCase().includes(nameLike),
        )
      : mockVaccines;
    return JSON.stringify({ vaccines: filtered });
  }
  if (name === 'recommend_vaccines') {
    const age = Number(args.ageMonths);
    return JSON.stringify({
      ageMonths: age,
      recommended: mockVaccines.filter((v) => v.ageMonths.includes(age)),
      packageAvailable: mockPackages[0],
    });
  }
  if (name === 'request_handoff') {
    handoffCalled = true;
    return JSON.stringify({ ok: true });
  }
  if (name === 'update_patient_profile') {
    profileUpdates.push(args);
    return JSON.stringify({ ok: true, profile: args });
  }
  if (name === 'search_kb') return JSON.stringify({ results: [] });
  if (name === 'send_reply') {
    lastSends.push(String(args.text ?? ''));
    return JSON.stringify({ ok: true, chunks: 1 });
  }
  return JSON.stringify({ error: `unknown ${name}` });
}

interface Scenario {
  id: string;
  title: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  expect: (full: string, tools: string[], profileUpd: Record<string, unknown>[], handoff: boolean) => string[];
}

// Helpers
const required = (cond: boolean, msg: string): string[] => (cond ? [] : [msg]);
const contains = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase());
const noBadInstallments = (s: string): string[] => {
  const issues: string[] = [];
  for (const wrong of ['6x', '10x', '12x', '18x', '24x', '36x', '48x']) {
    if (new RegExp(`\\b${wrong}\\b`, 'i').test(s)) issues.push(`alucinou ${wrong}`);
  }
  return issues;
};

const SCENARIOS: Scenario[] = [
  {
    id: 'gripe-adulto-3x',
    title: 'Adulto pergunta gripe — formato 3x correto',
    conversation: [
      { role: 'user', content: 'qual o valor da vacina da gripe' },
      { role: 'assistant', content: 'Olá! Aplicamos sim a vacina da gripe. Como posso te chamar? E essa vacina é pra você ou pra outra pessoa? Qual a idade?' },
      { role: 'user', content: 'Sou a Ana, é pra mim, 35 anos' },
    ],
    expect: (full, tools) => [
      ...required(tools.includes('update_patient_profile'), 'não registrou nome'),
      ...required(tools.includes('list_vaccines') || tools.includes('recommend_vaccines'), 'não consultou vacinas'),
      ...required(full.includes('120') || full.includes('42,77') || full.includes('42.77'), 'preço da gripe não apareceu'),
      ...required(/\b3x\b/i.test(full), 'não mostrou 3x'),
      ...noBadInstallments(full),
    ],
  },
  {
    id: 'hpv-template',
    title: 'HPV — usa template oficial',
    conversation: [
      { role: 'user', content: 'queria saber sobre a vacina do hpv' },
      { role: 'assistant', content: 'Olá! Como posso te chamar? E essa vacina é pra você ou pra outra pessoa? Qual a idade?' },
      { role: 'user', content: 'Sou Maria, pra minha filha de 11 anos' },
    ],
    expect: (full) => [
      ...required(contains(full, 'nonavalente') || contains(full, '9 tipos'), 'template HPV não usado (sem "Nonavalente" / "9 tipos")'),
      ...required(contains(full, 'colo do útero') || contains(full, 'colo de útero'), 'não mencionou câncer de colo'),
      ...required(/\b3x\b/i.test(full), 'sem 3x'),
      ...required(contains(full, '924') || contains(full, '329'), 'sem preço HPV'),
      ...noBadInstallments(full),
    ],
  },
  {
    id: 'qdenga-anti-18x',
    title: 'Qdenga — não pode alucinar 18x',
    conversation: [
      { role: 'user', content: 'qual o valor da qdenga' },
      { role: 'assistant', content: 'Oi! Como te chamar? E é pra quem?' },
      { role: 'user', content: 'sou Pedro, pra mim mesmo, 30 anos' },
    ],
    expect: (full) => [
      ...required(contains(full, '590') || contains(full, '210'), 'sem preço Qdenga'),
      ...required(/\b3x\b/i.test(full), 'sem 3x'),
      ...noBadInstallments(full),
    ],
  },
  {
    id: 'mais-parcelas-handoff',
    title: 'Paciente pede mais parcelas → handoff (com nome)',
    conversation: [
      { role: 'user', content: 'qual o valor da hexavalente?' },
      { role: 'assistant', content: 'Olá! Como te chamar? E pra quem é?' },
      { role: 'user', content: 'Sou João, é pro meu filho de 2 meses' },
      { role: 'assistant', content: '[apresenta hexavalente em 3x]' },
      { role: 'user', content: 'consigo parcelar em mais vezes? tipo 12x?' },
    ],
    expect: (full, tools, prof, handoff) => [
      ...required(handoff, 'não chamou request_handoff'),
      ...required(prof.some((p) => typeof p.name === 'string'), 'sem nome registrado antes do handoff'),
      ...required(contains(full, 'equipe') || contains(full, 'orçamento'), 'sem mensagem "equipe vai te passar orçamento"'),
    ],
  },
  {
    id: 'bebe-3m-pediatricas',
    title: 'Bebê 3 meses — recomenda Meningo ACWY + B',
    conversation: [
      { role: 'user', content: 'meu filho tem 3 meses, quais vacinas pra ele?' },
      { role: 'assistant', content: 'Como te chamar?' },
      { role: 'user', content: 'Sou Lúcia' },
    ],
    expect: (full) => [
      ...required(contains(full, 'meningo') || contains(full, 'ACWY'), 'não recomendou Meningo ACWY'),
      ...required(/\b3x\b/i.test(full), 'sem 3x'),
      ...noBadInstallments(full),
    ],
  },
  {
    id: 'coadministracao-geral',
    title: 'Pode aplicar várias vacinas no mesmo dia? → SIM',
    conversation: [
      { role: 'user', content: 'consigo aplicar várias vacinas pro meu bebê no mesmo dia?' },
      { role: 'assistant', content: 'Como te chamar?' },
      { role: 'user', content: 'Sou Carla' },
    ],
    expect: (full) => [
      ...required(contains(full, 'sim') || contains(full, 'pode'), 'não confirmou que pode'),
      ...required(contains(full, 'mesmo dia') || contains(full, 'juntas'), 'não confirmou "mesmo dia"'),
    ],
  },
  {
    id: 'febre-amarela-excecao',
    title: 'Febre Amarela — exceção 30 dias antes/depois',
    conversation: [
      { role: 'user', content: 'posso aplicar febre amarela junto com outras vacinas no mesmo dia?' },
      { role: 'assistant', content: 'Como te chamar? E é pra quem?' },
      { role: 'user', content: 'Sou Eduardo, pra mim, 40 anos' },
    ],
    expect: (full) => [
      ...required(contains(full, 'febre amarela'), 'não falou de febre amarela'),
      ...required(contains(full, '30 dias') || contains(full, 'intervalo'), 'não mencionou intervalo 30 dias'),
      ...required(contains(full, 'exceção') || contains(full, 'única') || contains(full, 'separad'), 'não destacou que é exceção'),
    ],
  },
  {
    id: 'pacote-hpv-3-doses',
    title: 'Tem pacote HPV com as 3 doses? → SIM, R$ 2.712',
    conversation: [
      { role: 'user', content: 'quanto custa a vacina HPV?' },
      { role: 'assistant', content: 'Como te chamar? Pra quem é? Qual a idade?' },
      { role: 'user', content: 'Sou Fernanda, pra minha filha de 11 anos' },
      { role: 'assistant', content: '[apresenta HPV 9 R$ 924 em 3x]' },
      { role: 'user', content: 'tem pacote com as 3 doses?' },
    ],
    expect: (full, tools) => [
      ...required(tools.includes('list_packages'), 'não chamou list_packages'),
      ...required(contains(full, '2712') || contains(full, '2.712') || contains(full, '966'), 'sem preço do pacote HPV 9 (R$ 2.712 ou 3x R$ 966,65)'),
      ...required(!contains(full, 'não temos') && !contains(full, 'sem pacote'), 'IA disse que NÃO tem pacote (deveria ter)'),
      ...noBadInstallments(full),
    ],
  },
  {
    id: 'pacote-2-6m',
    title: 'Pacote 2-6 meses → SIM, R$ 5.067',
    conversation: [
      { role: 'user', content: 'tem pacote pra bebê de 2 a 6 meses?' },
      { role: 'assistant', content: 'Como te chamar?' },
      { role: 'user', content: 'Sou Bia' },
    ],
    expect: (full, tools) => [
      ...required(tools.includes('list_packages'), 'não chamou list_packages'),
      ...required(contains(full, '5067') || contains(full, '5.067') || contains(full, '1.806') || contains(full, '1806'), 'sem preço do pacote 2-6m'),
      ...noBadInstallments(full),
    ],
  },
  {
    id: 'brinco',
    title: 'Pergunta sobre brinco → preço aparece',
    conversation: [
      { role: 'user', content: 'vocês fazem colocação de brincos? quanto custa?' },
      { role: 'assistant', content: 'Olá! Como te chamar? E qual a idade do bebê?' },
      { role: 'user', content: 'Sou Patrícia, minha bebê tem 1 mês' },
    ],
    expect: (full) => [
      ...required(contains(full, '140') || contains(full, 'brinco'), 'sem preço/menção brinco'),
      ...required(contains(full, '15 dias') || contains(full, 'agendar'), 'sem menção ao tempo mínimo OU agendamento'),
    ],
  },
];

interface RunResult { id: string; title: string; reply: string; tools: string[]; issues: string[]; handoff: boolean }

async function runOne(s: Scenario): Promise<RunResult> {
  toolsCalled.length = 0;
  lastSends.length = 0;
  profileUpdates.length = 0;
  handoffCalled = false;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'system', content: `Perfil atual do paciente (JSON): {}. Telefone: 5511999999999.` },
    ...s.conversation.map((c) => ({ role: c.role, content: c.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
  ];

  for (let i = 0; i < 8; i++) {
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
    if (m.tool_calls?.length) {
      messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
      for (const call of m.tool_calls) {
        if (call.type !== 'function') continue;
        const args = JSON.parse(call.function.arguments || '{}');
        const out = execTool(call.function.name, args);
        messages.push({ role: 'tool', tool_call_id: call.id, content: out });
      }
      continue;
    }
    const text = (m.content ?? '').trim();
    const full = [...lastSends, text].filter(Boolean).join(' ⏎ ');
    const issues = s.expect(full, toolsCalled, profileUpdates, handoffCalled);
    return { id: s.id, title: s.title, reply: full, tools: [...toolsCalled], issues, handoff: handoffCalled };
  }
  return { id: s.id, title: s.title, reply: '(sem resposta)', tools: [...toolsCalled], issues: ['no-final-text'], handoff: handoffCalled };
}

async function main(): Promise<void> {
  console.log(`\nE2E behavior test (model: ${MODEL}, ${SCENARIOS.length} cenários)\n`);
  const results: RunResult[] = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    process.stdout.write(`[${i + 1}/${SCENARIOS.length}] ${SCENARIOS[i]!.title.slice(0, 50).padEnd(52)} `);
    const r = await runOne(SCENARIOS[i]!);
    results.push(r);
    if (r.issues.length === 0) console.log('✅');
    else console.log(`❌ ${r.issues.length} issue(s)`);
  }

  const passed = results.filter((r) => r.issues.length === 0).length;
  const failed = results.length - passed;
  console.log(`\n=== RESULTADO ===`);
  console.log(`Passou: ${passed}/${results.length}`);
  console.log(`Falhou: ${failed}/${results.length}\n`);

  if (failed > 0) {
    console.log('--- FALHAS ---\n');
    for (const r of results.filter((r) => r.issues.length > 0)) {
      console.log(`[${r.id}] ${r.title}`);
      console.log(`  tools: ${r.tools.join(', ') || '(none)'}`);
      console.log(`  reply: ${r.reply.slice(0, 400).replace(/\n/g, '⏎')}`);
      for (const iss of r.issues) console.log(`  ❌ ${iss}`);
      console.log('');
    }
  }

  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
