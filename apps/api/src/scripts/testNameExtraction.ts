/**
 * Valida que a IA distingue o nome de QUEM ESTA DIGITANDO do nome de OUTRA
 * PESSOA (filho, mãe, marido, etc).
 *
 * Roda com gpt-4.1 + persona real do arquivo + mock das tools.
 * Inspeciona os argumentos passados pra update_patient_profile.
 *
 * Uso (de apps/api):
 *   pnpm exec dotenv -e ../../.env.test.local -e ../../.env -- tsx src/scripts/testNameExtraction.ts
 */
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MODEL = process.env.MODEL || 'gpt-4.1';
if (!OPENAI_API_KEY) { console.error('faltou OPENAI_API_KEY'); process.exit(1); }
const client = new OpenAI({ apiKey: OPENAI_API_KEY });

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const personaFile = path.resolve(__dirname, '../../../../packages/db/prisma/demo-persona.ts');
const personaSrc = fs.readFileSync(personaFile, 'utf8');
const match = personaSrc.match(/const PERSONA = `([\s\S]+?)`;/);
if (!match) { console.error('persona não encontrada'); process.exit(1); }
const persona = match[1]!;

const system = buildSystemPrompt({
  clinicName: 'Clínica Imuniza',
  persona,
  businessHours: { start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
  currentDate: new Date().toISOString().slice(0, 10),
});

const mockVaccines = [
  { name: 'Hexavalente', slug: 'hex', ageMonths: [2, 4, 6], priceCash: 256, priceInstallment: 273.74, installments: 3, inStock: true, description: '6 doenças' },
  { name: 'Influenza (gripe)', slug: 'gripe', ageMonths: [6,12], priceCash: 120, priceInstallment: 128.32, installments: 3, inStock: true, description: 'Gripe' },
  { name: 'HPV 9', slug: 'hpv', ageMonths: [108, 132], priceCash: 924, priceInstallment: 988.03, installments: 3, inStock: true, description: 'HPV' },
  { name: 'Eflueda (gripe alta dose)', slug: 'eflueda', ageMonths: [], priceCash: 330, priceInstallment: 352.87, installments: 3, inStock: true, description: 'Gripe 60+' },
  { name: 'Herpes Zóster (Shingrix)', slug: 'zoster', ageMonths: [], priceCash: 859, priceInstallment: 918.53, installments: 3, inStock: true, description: 'Cobreiro' },
];

interface ProfileUpdate { name?: string; babyName?: string; babyAgeMonths?: number; [k: string]: unknown }
const profileUpdates: ProfileUpdate[] = [];
const toolsCalled: string[] = [];

// Normaliza pra comparar nomes ignorando acentos/case
const norm = (s: string | undefined): string =>
  (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const includesNorm = (haystack: string | undefined, needle: string): boolean =>
  norm(haystack).includes(norm(needle));

function execTool(name: string, args: Record<string, unknown>): string {
  toolsCalled.push(name);
  if (name === 'update_patient_profile') {
    profileUpdates.push(args as ProfileUpdate);
    return JSON.stringify({ ok: true });
  }
  if (name === 'list_vaccines') {
    const nameLike = String(args.nameLike ?? '').toLowerCase();
    const filtered = nameLike ? mockVaccines.filter((v) => v.name.toLowerCase().includes(nameLike) || (v.description ?? '').toLowerCase().includes(nameLike)) : mockVaccines;
    return JSON.stringify({ vaccines: filtered });
  }
  if (name === 'recommend_vaccines') {
    const age = Number(args.ageMonths);
    return JSON.stringify({ ageMonths: age, recommended: mockVaccines.filter((v) => v.ageMonths.includes(age)) });
  }
  if (name === 'list_packages') return JSON.stringify({ packages: [] });
  if (name === 'request_handoff') return JSON.stringify({ ok: true });
  if (name === 'search_kb') return JSON.stringify({ results: [] });
  if (name === 'send_reply') return JSON.stringify({ ok: true, chunks: 1 });
  return JSON.stringify({ error: `unknown ${name}` });
}

interface Scenario {
  id: string;
  title: string;
  conversation: Array<{ role: 'user' | 'assistant'; content: string }>;
  expect: (text: string, updates: ProfileUpdate[]) => string[];
}

const SCENARIOS: Scenario[] = [
  {
    id: 'filha-cecilia',
    title: 'É pra minha filha Cecília → babyName, name pergunta de novo',
    conversation: [
      { role: 'user', content: 'gostaria de saber sobre vacinas' },
      { role: 'assistant', content: 'Olá! Como posso te chamar? E essa vacina é pra você ou pra outra pessoa?' },
      { role: 'user', content: 'É pra minha filha, ela se chama Cecília, tem 11 anos' },
    ],
    expect: (text, updates) => {
      const issues: string[] = [];
      const setName = updates.find((u) => typeof u.name === 'string')?.name;
      const reperguntou = /como.*chamar|seu nome|chamo voce|te chamo|prefere/i.test(text);
      if (setName && includesNorm(setName, 'cecilia')) issues.push(`❌ registrou Cecília como name do paciente (deveria ser babyName)`);
      // OK se: registrou babyName=Cecília agora OU reperguntou (vai registrar no próximo turn)
      const setBabyName = updates.find((u) => typeof u.babyName === 'string')?.babyName;
      const okBabyName = (setBabyName && includesNorm(setBabyName, 'cecilia')) || reperguntou;
      if (!okBabyName) issues.push(`⚠️ não registrou babyName='Cecília' nem reperguntou`);
      if (!reperguntou) issues.push(`⚠️ não reperguntou o nome de quem está digitando`);
      return issues;
    },
  },
  {
    id: 'mae-dona-lourdes',
    title: 'É pra minha mãe Dona Lourdes → name pergunta de novo',
    conversation: [
      { role: 'user', content: 'quanto custa a vacina herpes zoster' },
      { role: 'assistant', content: 'Como te chamar? E essa vacina é pra você ou pra outra pessoa?' },
      { role: 'user', content: 'É pra minha mãe, ela se chama Dona Lourdes, tem 68 anos' },
    ],
    expect: (text, updates) => {
      const issues: string[] = [];
      const setName = updates.find((u) => typeof u.name === 'string')?.name;
      if (setName && includesNorm(setName, 'lourdes')) issues.push(`❌ registrou Dona Lourdes como name do paciente que está digitando`);
      if (!/como.*chamar|seu nome|chamo voce|te chamo|prefere/i.test(text)) {
        issues.push(`⚠️ não reperguntou o nome de quem está digitando`);
      }
      return issues;
    },
  },
  {
    id: 'marido-joao',
    title: 'É pro meu marido João → name pergunta de novo',
    conversation: [
      { role: 'user', content: 'quero saber valor da gripe' },
      { role: 'assistant', content: 'Olá! Como te chamar? E essa vacina é pra você ou pra outra pessoa?' },
      { role: 'user', content: 'É pro meu marido, João, ele tem 42 anos' },
    ],
    expect: (text, updates) => {
      const issues: string[] = [];
      const setName = updates.find((u) => typeof u.name === 'string')?.name;
      if (setName && includesNorm(setName, 'joao')) issues.push(`❌ registrou João como name do paciente (é o marido)`);
      if (!/como.*chamar|seu nome|chamo voce|te chamo|prefere/i.test(text)) {
        issues.push(`⚠️ não reperguntou o nome de quem está digitando`);
      }
      return issues;
    },
  },
  {
    id: 'sou-maria-pra-filha',
    title: 'Sou Maria, pra minha filha Cecília → name=Maria, babyName=Cecília',
    conversation: [
      { role: 'user', content: 'preciso de vacinas pra minha filha' },
      { role: 'assistant', content: 'Olá! Como te chamar? E qual a idade dela?' },
      { role: 'user', content: 'Sou a Maria, é pra minha filha Cecília, ela tem 2 meses' },
    ],
    expect: (_text, updates) => {
      const issues: string[] = [];
      const setName = updates.find((u) => typeof u.name === 'string')?.name;
      const setBabyName = updates.find((u) => typeof u.babyName === 'string')?.babyName;
      if (!setName || !includesNorm(setName, 'maria')) issues.push(`❌ não registrou name='Maria'`);
      if (setName && includesNorm(setName, 'cecilia')) issues.push(`❌ registrou Cecília como name (deveria ser babyName)`);
      if (!setBabyName || !includesNorm(setBabyName, 'cecilia')) issues.push(`⚠️ não registrou babyName='Cecília'`);
      return issues;
    },
  },
  {
    id: 'sou-maria-pra-mae',
    title: 'Sou Maria, pra minha mãe Dona Lourdes → name=Maria',
    conversation: [
      { role: 'user', content: 'quero a vacina shingrix' },
      { role: 'assistant', content: 'Como te chamar? E pra quem é?' },
      { role: 'user', content: 'Sou a Maria, é pra minha mãe Dona Lourdes, ela tem 65 anos' },
    ],
    expect: (_text, updates) => {
      const issues: string[] = [];
      const setName = updates.find((u) => typeof u.name === 'string')?.name;
      if (!setName || !includesNorm(setName, 'maria')) issues.push(`❌ não registrou name='Maria'`);
      if (setName && includesNorm(setName, 'lourdes')) issues.push(`❌ registrou Dona Lourdes como name (paciente é Maria)`);
      return issues;
    },
  },
  {
    id: 'adulto-sozinho',
    title: 'Adulto sozinho: "Me chama de Cecília" + 35 anos → name=Cecília',
    conversation: [
      { role: 'user', content: 'qual o valor da vacina da gripe' },
      { role: 'assistant', content: 'Como te chamar? E é pra você?' },
      { role: 'user', content: 'Me chama de Cecília, é pra mim mesmo, tenho 35 anos' },
    ],
    expect: (_text, updates) => {
      const issues: string[] = [];
      const setName = updates.find((u) => typeof u.name === 'string')?.name;
      if (!setName || !includesNorm(setName, 'cecilia')) issues.push(`❌ não registrou name='Cecília' (vacina é pra ela mesma)`);
      return issues;
    },
  },
];

async function runOne(s: Scenario): Promise<{ id: string; title: string; reply: string; updates: ProfileUpdate[]; issues: string[] }> {
  toolsCalled.length = 0;
  profileUpdates.length = 0;

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'system', content: 'Perfil atual do paciente (JSON): {}. Telefone: 5511999999999.' },
    ...s.conversation.map((c) => ({ role: c.role, content: c.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam),
  ];

  let finalText = '';
  for (let i = 0; i < 6; i++) {
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: functionDefinitions,
      tool_choice: 'auto',
      temperature: 0.3,
    });
    const choice = completion.choices[0];
    if (!choice) break;
    const m = choice.message;
    if (m.tool_calls?.length) {
      messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
      for (const call of m.tool_calls) {
        if (call.type !== 'function') continue;
        const args = JSON.parse(call.function.arguments || '{}');
        messages.push({ role: 'tool', tool_call_id: call.id, content: execTool(call.function.name, args) });
      }
      continue;
    }
    finalText = (m.content ?? '').trim();
    break;
  }

  const issues = s.expect(finalText, [...profileUpdates]);
  return { id: s.id, title: s.title, reply: finalText, updates: [...profileUpdates], issues };
}

async function main(): Promise<void> {
  console.log(`\nTeste extração de nome (model: ${MODEL}, ${SCENARIOS.length} cenários)\n`);
  const results = [];
  for (let i = 0; i < SCENARIOS.length; i++) {
    process.stdout.write(`[${i + 1}/${SCENARIOS.length}] ${SCENARIOS[i]!.title.slice(0, 55).padEnd(57)} `);
    const r = await runOne(SCENARIOS[i]!);
    results.push(r);
    console.log(r.issues.length === 0 ? '✅' : `❌ ${r.issues.length}`);
  }

  const failed = results.filter((r) => r.issues.length > 0);
  console.log(`\n=== RESULTADO ===\nPassou: ${results.length - failed.length}/${results.length}\nFalhou: ${failed.length}/${results.length}\n`);

  if (failed.length > 0) {
    console.log('--- FALHAS ---\n');
    for (const r of failed) {
      console.log(`[${r.id}] ${r.title}`);
      console.log(`  updates: ${JSON.stringify(r.updates)}`);
      console.log(`  reply: ${r.reply.slice(0, 250).replace(/\n/g, '⏎')}`);
      for (const iss of r.issues) console.log(`  ${iss}`);
      console.log('');
    }
  }
  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => { console.error(err); process.exit(1); });
