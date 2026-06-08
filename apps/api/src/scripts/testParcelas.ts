/**
 * Anti-alucinacao de parcelas.
 *
 * Mocka as tools com installments=3 (estado real do banco) e roda perguntas
 * de preco. Verifica se a IA usa EXATAMENTE 3x — sem cair em 12x/18x/24x.
 *
 * Uso (a partir de apps/api):
 *   pnpm exec dotenv -e ../../.env.test.local -e ../../.env -- tsx src/scripts/testParcelas.ts
 */
import OpenAI from 'openai';
import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';
import { prisma } from '@imuniza/db';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.MODEL || 'gpt-4.1';
if (!OPENAI_API_KEY) {
  console.error('faltou OPENAI_API_KEY');
  process.exit(1);
}

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

// Pega a persona real do banco — testamos a que esta em producao
const tenant = await prisma.tenant.findFirst({ select: { name: true, config: true } });
const personaConfig = (tenant?.config as { persona?: string }) ?? {};
const system = buildSystemPrompt({
  clinicName: tenant?.name ?? 'Clínica Imuniza',
  persona: personaConfig.persona ?? '',
  businessHours: { start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
  currentDate: new Date().toISOString().slice(0, 10),
});

// Mock das vacinas com installments=3 (estado real do banco apos
// rodar update-pricing-3x.ts). priceInstallment = priceCash * 1.0693.
const mockVaccines = [
  { name: 'Hexavalente acelular', slug: 'hexavalente', ageMonths: [2, 4, 6], priceCash: 256, priceInstallment: 273.74, installments: 3, inStock: true, description: '6 doencas' },
  { name: 'Pneumocócica 20', slug: 'pneumo-20', ageMonths: [2, 4, 6, 12], priceCash: 489, priceInstallment: 522.89, installments: 3, inStock: true, description: 'Cobertura ampla' },
  { name: 'Rotavírus pentavalente', slug: 'rotavirus', ageMonths: [2, 4, 6], priceCash: 312, priceInstallment: 333.62, installments: 3, inStock: true, description: 'Diarreia bebes' },
  { name: 'Meningocócica ACWY', slug: 'acwy', ageMonths: [3, 5, 12], priceCash: 389, priceInstallment: 415.96, installments: 3, inStock: true, description: 'Meningite' },
  { name: 'Meningocócica B', slug: 'meningo-b', ageMonths: [3, 5, 12], priceCash: 689, priceInstallment: 736.75, installments: 3, inStock: true, description: 'Meningite B' },
  { name: 'Tríplice viral', slug: 'triplice', ageMonths: [12, 15], priceCash: 140.80, priceInstallment: 150.56, installments: 3, inStock: true, description: 'SCR' },
  { name: 'Influenza (gripe)', slug: 'gripe', ageMonths: [6, 12], priceCash: 120, priceInstallment: 128.32, installments: 3, inStock: true, description: 'Anual' },
  { name: 'HPV 9 (Gardasil 9)', slug: 'hpv9', ageMonths: [108, 132], priceCash: 924, priceInstallment: 988.03, installments: 3, inStock: true, description: 'Cancer colo' },
  { name: 'Qdenga (dengue)', slug: 'qdenga', ageMonths: [], priceCash: 590, priceInstallment: 630.89, installments: 3, inStock: true, description: 'Dengue 4-60a' },
  { name: 'Eflueda (gripe alta dose)', slug: 'eflueda', ageMonths: [], priceCash: 330, priceInstallment: 352.87, installments: 3, inStock: true, description: 'Gripe 60+' },
  { name: 'Herpes Zóster (Shingrix GSK)', slug: 'herpes-zoster', ageMonths: [], priceCash: 859, priceInstallment: 918.53, installments: 3, inStock: true, description: 'Cobreiro' },
  { name: 'Arexvy (VSR adulto)', slug: 'arexvy', ageMonths: [], priceCash: 1690, priceInstallment: 1807.12, installments: 3, inStock: true, description: 'VSR' },
];

const toolsCalled: string[] = [];
const lastSends: string[] = [];

function execTool(name: string, args: Record<string, unknown>): string {
  toolsCalled.push(name);
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
    return JSON.stringify({
      priceCashMeaning: 'a vista — preco final com desconto',
      priceInstallmentMeaning: 'total parcelado em installments vezes',
      vaccines: filtered,
    });
  }
  if (name === 'recommend_vaccines') {
    const age = Number(args.ageMonths);
    return JSON.stringify({
      ageMonths: age,
      recommended: mockVaccines.filter((v) => v.ageMonths.includes(age)),
      packageAvailable: null,
    });
  }
  if (name === 'request_handoff') return JSON.stringify({ ok: true });
  if (name === 'update_patient_profile') return JSON.stringify({ ok: true });
  if (name === 'search_kb') return JSON.stringify({ results: [] });
  if (name === 'send_reply') {
    lastSends.push(String(args.text ?? ''));
    return JSON.stringify({ ok: true, chunks: 1 });
  }
  return JSON.stringify({ error: `unknown ${name}` });
}

interface Scenario {
  q: string;
  ageContext: string; // resposta de triagem (idade + nome)
  vaccine: { name: string; priceCash: number; expectedParcela: string };
}

// Cenarios casados: cada pergunta usa uma idade onde a vacina FAZ sentido.
// O foco eh verificar que a IA NUNCA mostra 18x/12x/24x — sempre 3x.
const SCENARIOS: Scenario[] = [
  // Pediatricas (bebes 2-12m)
  { q: 'meu filho de 2 meses, preço da hexavalente?', ageContext: 'Sou a Ana, é pra meu filho de 2 meses', vaccine: { name: 'Hexavalente', priceCash: 256, expectedParcela: '91,25' } },
  { q: 'quanto custa a pneumo 20 pra bebê?', ageContext: 'Sou a Ana, é pra meu bebê de 4 meses', vaccine: { name: 'Pneumo 20', priceCash: 489, expectedParcela: '174,30' } },
  { q: 'preço da rotavírus', ageContext: 'Sou a Ana, é pra meu filho de 2 meses', vaccine: { name: 'Rotavírus', priceCash: 312, expectedParcela: '111,21' } },
  { q: 'meningo ACWY quanto é pra bebê de 3 meses', ageContext: 'Sou a Ana, é pra meu filho de 3 meses', vaccine: { name: 'ACWY', priceCash: 389, expectedParcela: '138,65' } },
  { q: 'quanto a meningo B', ageContext: 'Sou a Ana, é pra meu filho de 3 meses', vaccine: { name: 'Meningo B', priceCash: 689, expectedParcela: '245,58' } },
  { q: 'valor da tríplice viral', ageContext: 'Sou a Ana, é pra meu filho de 12 meses', vaccine: { name: 'Tríplice', priceCash: 140.8, expectedParcela: '50,19' } },

  // Adultos
  { q: 'qual o valor da gripe', ageContext: 'Sou a Ana, é pra mim mesmo, 35 anos', vaccine: { name: 'Influenza', priceCash: 120, expectedParcela: '42,77' } },
  { q: 'quanto custa a HPV', ageContext: 'Sou a Ana, é pra minha filha de 11 anos', vaccine: { name: 'HPV', priceCash: 924, expectedParcela: '329,34' } },
  { q: 'preço da Qdenga', ageContext: 'Sou o João, é pra mim, 25 anos', vaccine: { name: 'Qdenga', priceCash: 590, expectedParcela: '210,30' } },
  { q: 'valor da Eflueda', ageContext: 'Sou a Maria, é pra mim, 67 anos', vaccine: { name: 'Eflueda', priceCash: 330, expectedParcela: '117,62' } },
  { q: 'herpes zoster quanto é', ageContext: 'Sou o José, é pra mim, 55 anos', vaccine: { name: 'Zoster', priceCash: 859, expectedParcela: '306,18' } },
  { q: 'qual o valor do Arexvy', ageContext: 'Sou a Lucia, é pra mim, 70 anos', vaccine: { name: 'Arexvy', priceCash: 1690, expectedParcela: '602,37' } },
];

interface RunResult { idx: number; q: string; reply: string; tools: string[]; issues: string[] }

async function runOne(s: Scenario, idx: number): Promise<RunResult> {
  toolsCalled.length = 0;
  lastSends.length = 0;
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    {
      role: 'system',
      content: `Perfil atual do paciente (JSON): {}. Telefone: 5511999999999.`,
    },
    { role: 'user', content: s.q },
    { role: 'assistant', content: 'Como posso te chamar? E essa vacina é pra você mesmo ou pra outra pessoa? E qual a idade?' },
    { role: 'user', content: s.ageContext },
  ];

  // Loop ate emitir texto final ou chegar em 6 iteracoes
  for (let i = 0; i < 6; i++) {
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
    // Junta send_reply enviado com o texto final pra ter analise completa
    const full = [...lastSends, text].filter(Boolean).join(' ⏎ ');
    const issues = check(full, s, toolsCalled);
    return { idx, q: s.q, reply: full, tools: [...toolsCalled], issues };
  }
  return { idx, q: s.q, reply: '(sem resposta)', tools: [...toolsCalled], issues: ['no-final-text'] };
}

function check(reply: string, s: Scenario, tools: string[]): string[] {
  const issues: string[] = [];
  const lower = reply.toLowerCase();

  // (1) Chamou tool de preco?
  if (!tools.includes('list_vaccines') && !tools.includes('recommend_vaccines')) {
    issues.push('NAO chamou list_vaccines/recommend_vaccines — pode ter inventado preco');
  }

  // (2) Menciona 3x?
  const has3x = /\b3x\b/i.test(reply) || reply.includes('3 vezes');
  if (!has3x) issues.push('NAO mencionou 3x');

  // (3) Tem valor de parcela correto?
  if (!reply.includes(s.vaccine.expectedParcela)) {
    issues.push(`parcela esperada R$ ${s.vaccine.expectedParcela} NAO aparece`);
  }

  // (4) ALUCINACAO — menciona parcelamento diferente de 3x?
  const wrongInstallments = ['6x', '10x', '12x', '18x', '24x', '36x', '48x', '60x', '120x'];
  for (const wrong of wrongInstallments) {
    if (new RegExp(`\\b${wrong}\\b`, 'i').test(reply)) {
      issues.push(`🚨 ALUCINACAO: mencionou ${wrong} (deveria ser 3x)`);
    }
  }

  // (5) NAO deve mostrar valor total parcelado preemptivamente
  // (priceInstallment do banco)
  if (reply.includes('R$ ' + (s.vaccine.priceCash * 1.0693).toFixed(2).replace('.', ','))) {
    issues.push('mostrou o TOTAL parcelado (deveria mostrar so a parcela)');
  }

  return issues;
}

async function main(): Promise<void> {
  console.log(`\nTeste anti-alucinacao de parcelas (modelo: ${MODEL}, ${SCENARIOS.length} cenarios)\n`);
  const results: RunResult[] = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    process.stdout.write(`[${i + 1}/${SCENARIOS.length}] ${SCENARIOS[i]!.q.slice(0, 40).padEnd(42)} `);
    const r = await runOne(SCENARIOS[i]!, i);
    results.push(r);
    if (r.issues.length === 0) console.log('✅');
    else console.log(`❌ ${r.issues.length} issue(s)`);
  }

  console.log('\n=== RESULTADOS ===\n');
  const failed = results.filter((r) => r.issues.length > 0);
  const passed = results.length - failed.length;
  console.log(`Passou: ${passed}/${results.length}`);
  console.log(`Falhou: ${failed.length}/${results.length}\n`);

  if (failed.length > 0) {
    console.log('--- FALHAS ---\n');
    for (const r of failed) {
      console.log(`#${r.idx + 1} "${r.q}"`);
      console.log(`  tools: ${r.tools.join(', ') || '(none)'}`);
      console.log(`  reply: ${r.reply.slice(0, 300)}`);
      for (const iss of r.issues) console.log(`  ❌ ${iss}`);
      console.log('');
    }
  }

  await prisma.$disconnect();
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  prisma.$disconnect();
  process.exit(1);
});
