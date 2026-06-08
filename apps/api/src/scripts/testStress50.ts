/**
 * Stress test: 50 perguntas variadas de pacientes reais.
 *
 * Checa: duplicação de mensagem, "assistente virtual", coração 💙,
 * inventar preço (sem chamar tool), formato R$, parcelamento 18x,
 * handoff quando necessário, etc.
 *
 * Uso:
 *   pnpm exec dotenv -e .env.test.local -e .env -- tsx apps/api/src/scripts/testStress50.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';

function loadEnv(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const eq = t.indexOf('=');
    if (eq === -1) continue;
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const f = loadEnv(path.resolve(process.cwd(), '.env.test.local'));
const OPENAI_API_KEY = f.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '';
const MODEL = f.MODEL || process.env.MODEL || 'gpt-4.1';
if (!OPENAI_API_KEY) { console.error('faltou OPENAI_API_KEY'); process.exit(1); }

const client = new OpenAI({ apiKey: OPENAI_API_KEY });

const PERSONA_TEST = `Você é a atendente da Clínica Imuniza no WhatsApp. Aja como uma atendente real. NUNCA se identifique como "assistente virtual", "robô", "IA" ou "bot". NÃO use coração 💙. Use *negrito* (UM asterisco). Foco em AGENDAR.

Quando perguntarem preço, use list_vaccines ou recommend_vaccines (NÃO invente).
Quando o paciente quiser marcar, use request_handoff.

Formato canônico de preço:
> *{Nome}* R$ {priceCash} à vista (dinheiro ou PIX), ou R$ {priceInstallment} podendo parcelar em até {installments}x

NÃO some todos os preços em "total". Apresente um por um.
Saudação curta na primeira mensagem. Não repita "Olá" várias vezes.`;

const system = buildSystemPrompt({
  clinicName: 'Clínica Imuniza',
  persona: PERSONA_TEST,
  businessHours: { start: '08:00', end: '18:00', timezone: 'America/Sao_Paulo' },
  currentDate: new Date().toISOString().slice(0, 10),
});

const mockVaccines = [
  { name: 'Hexavalente acelular', slug: 'hexavalente', ageMonths: [2, 4, 6], priceCash: 256, priceInstallment: 314.27, installments: 18, inStock: true, description: 'Protege contra 6 doenças' },
  { name: 'Pneumocócica 20', slug: 'pneumo-20', ageMonths: [2, 4, 6, 12], priceCash: 489, priceInstallment: 600.31, installments: 18, inStock: true, description: 'Cobertura ampla' },
  { name: 'Rotavírus pentavalente', slug: 'rotavirus', ageMonths: [2, 4, 6], priceCash: 312, priceInstallment: 383.02, installments: 18, inStock: true, description: 'Diarreia em bebês' },
  { name: 'Meningocócica ACWY', slug: 'acwy', ageMonths: [3, 5, 12, 132], priceCash: 389, priceInstallment: 486.12, installments: 18, inStock: true, description: 'Meningite ACWY' },
  { name: 'Meningocócica B', slug: 'meningo-b', ageMonths: [3, 5, 12], priceCash: 689, priceInstallment: 845.84, installments: 18, inStock: true, description: 'Meningite B' },
  { name: 'Tríplice viral', slug: 'triplice', ageMonths: [12, 15], priceCash: 140.80, priceInstallment: 172.85, installments: 18, inStock: true, description: 'SCR' },
  { name: 'Influenza (gripe)', slug: 'gripe', ageMonths: [6, 12], priceCash: 120, priceInstallment: 147.32, installments: 18, inStock: false, outOfStockNote: 'previsão próxima semana', description: 'Anual' },
  { name: 'HPV 9 (Gardasil)', slug: 'hpv9', ageMonths: [108, 132], priceCash: 924, priceInstallment: 1134.33, installments: 18, inStock: true, description: 'Câncer de colo' },
  { name: 'Febre amarela', slug: 'fa', ageMonths: [9, 48], priceCash: 156, priceInstallment: 191.51, installments: 18, inStock: true, description: 'Endêmica' },
  { name: 'Hepatite A infantil', slug: 'hepa-inf', ageMonths: [12, 18], priceCash: 186, priceInstallment: 228.34, installments: 18, inStock: true, description: 'Hep A pediátrica' },
];

const mockHumanSent = { count: 0, lastMessages: [] as string[] };

function execTool(name: string, args: Record<string, unknown>): string {
  if (name === 'list_vaccines')
    return JSON.stringify({
      priceCashMeaning: 'preço final à vista, sem desconto extra',
      priceInstallmentMeaning: 'total parcelado em até N vezes',
      stockMeaning: 'inStock=false: em falta. Ofereça lista de espera (request_handoff reason=waitlist)',
      vaccines: mockVaccines,
    });
  if (name === 'recommend_vaccines') {
    const ageMonths = Number(args.ageMonths);
    return JSON.stringify({
      ageMonths,
      recommended: mockVaccines.filter((v) => v.ageMonths.includes(ageMonths)),
      packageAvailable: null,
    });
  }
  if (name === 'request_handoff') return JSON.stringify({ ok: true, summary: args.summary, reason: args.reason });
  if (name === 'update_patient_profile') return JSON.stringify({ ok: true });
  if (name === 'search_kb') return JSON.stringify({ results: [], note: 'Nenhum resultado na base. Use as funções de vacinas ou request_handoff.' });
  if (name === 'send_reply') {
    mockHumanSent.count++;
    const text = String(args.text || '');
    mockHumanSent.lastMessages.push(text);
    return JSON.stringify({ ok: true, chunks: 1 });
  }
  return JSON.stringify({ error: `unknown ${name}` });
}

interface Issue { idx: number; question: string; problems: string[]; sends: number; reply: string; tools: string[] }
const issues: Issue[] = [];

// 50 perguntas variadas
const SCENARIOS: Array<{ q: string; checks: (full: string, tools: string[], sends: number) => string[] }> = [
  // ── 1-5: Primeiras mensagens / saudações ──
  { q: 'oi', checks: (s) => generic(s) },
  { q: 'bom dia', checks: (s) => generic(s) },
  { q: 'olá! tudo bem?', checks: (s) => generic(s) },
  { q: 'oi tudo bem com vocês?', checks: (s) => generic(s) },
  { q: 'ei!', checks: (s) => generic(s) },

  // ── 6-15: Perguntas de preço (devem usar tool, formato R$, 18x) ──
  { q: 'qual o preço da hexavalente?', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '256')] },
  { q: 'quanto custa a pneumo 20?', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '489')] },
  { q: 'valor da rotavírus por favor', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '312')] },
  { q: 'preço da meningo ACWY', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '389')] },
  { q: 'quanto é a HPV?', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '924')] },
  { q: 'qual valor da meningococica b', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '689')] },
  { q: 'preço da hepatite a infantil', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines'])] },
  { q: 'tríplice viral quanto custa', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '140')] },
  { q: 'quanto custa a febre amarela', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines', 'recommend_vaccines']), ...requirePrice(s, '156')] },
  { q: 'todas as vacinas e preços', checks: (s, t) => [...generic(s), ...requireTool(t, ['list_vaccines'])] },

  // ── 16-25: Perguntas por idade ──
  { q: 'meu filho tem 2 meses, o que ele precisa?', checks: (s, t) => [...generic(s), ...requireTool(t, ['recommend_vaccines', 'list_vaccines']), ...requireMention(s, 'hexavalente')] },
  { q: 'bebê de 4 meses, quais vacinas?', checks: (s, t) => [...generic(s), ...requireTool(t, ['recommend_vaccines', 'list_vaccines'])] },
  { q: 'minha filha tem 6 meses, que vacinas faltam pra ela?', checks: (s, t) => [...generic(s), ...requireTool(t, ['recommend_vaccines', 'list_vaccines'])] },
  { q: 'bebezinha de 3 meses, indica quais?', checks: (s, t) => [...generic(s), ...requireTool(t, ['recommend_vaccines', 'list_vaccines'])] },
  { q: 'filho com 12 meses precisa de quais?', checks: (s, t) => [...generic(s), ...requireTool(t, ['recommend_vaccines', 'list_vaccines'])] },
  { q: 'criança de 4 anos, quais reforços?', checks: (s, t) => [...generic(s), ...requireTool(t, ['recommend_vaccines', 'list_vaccines'])] },
  { q: 'adolescente de 9 anos precisa do HPV?', checks: (s, t) => [...generic(s), ...requireMention(s, 'hpv')] },
  { q: 'criança de 15 meses indicação', checks: (s, t) => [...generic(s), ...requireTool(t, ['recommend_vaccines', 'list_vaccines'])] },
  { q: 'gestante 25 semanas precisa de quais?', checks: (s, t) => generic(s) },
  { q: 'idoso de 70 anos quais vacinas?', checks: (s, t) => generic(s) },

  // ── 26-32: Agendamento (deve chamar handoff) ──
  { q: 'quero marcar uma hora', checks: (s, t, ss) => [...generic(s), ...requireTool(t, ['request_handoff']), ...requireNoConfirm(s)] },
  { q: 'pode agendar pra mim?', checks: (s, t) => [...generic(s), ...requireTool(t, ['request_handoff']), ...requireNoConfirm(s)] },
  { q: 'tem horário amanhã 10h?', checks: (s, t) => [...generic(s), ...requireNoConfirm(s)] },
  { q: 'quero levar meu filho semana que vem', checks: (s, t) => [...generic(s), ...requireTool(t, ['request_handoff'])] },
  { q: 'agenda pra sexta de manhã', checks: (s, t) => [...generic(s), ...requireTool(t, ['request_handoff']), ...requireNoConfirm(s)] },
  { q: 'consigo encaixe hoje?', checks: (s, t) => [...generic(s), ...requireNoConfirm(s)] },
  { q: 'pode marcar a hexa pra ele', checks: (s, t) => [...generic(s), ...requireTool(t, ['request_handoff']), ...requireNoConfirm(s)] },

  // ── 33-38: Vacina em falta (gripe) — deve oferecer lista espera ──
  { q: 'tem vacina da gripe?', checks: (s, t) => [...generic(s), ...requireMention(s, ['falta', 'sem estoque', 'aguardando'])] },
  { q: 'qual valor da gripe?', checks: (s, t) => [...generic(s), ...requireMention(s, ['falta', 'sem estoque', 'aguardando'])] },
  { q: 'quero tomar a gripe', checks: (s, t) => [...generic(s), ...requireMention(s, ['falta', 'sem estoque', 'aguardando'])] },
  { q: 'vacina influenza disponível?', checks: (s, t) => [...generic(s), ...requireMention(s, ['falta', 'sem estoque', 'aguardando'])] },
  { q: 'pode marcar a gripe?', checks: (s, t) => [...generic(s), ...requireMention(s, ['falta', 'sem estoque', 'aguardando', 'lista', 'espera'])] },
  { q: 'eu e meu filho queremos tomar gripe', checks: (s, t) => [...generic(s), ...requireMention(s, ['falta', 'sem estoque', 'aguardando', 'lista'])] },

  // ── 39-45: Perguntas operacionais ──
  { q: 'qual o horário de vocês?', checks: (s, t) => [...generic(s), ...requireMention(s, ['08:00', '8h', '8:00', '18', 'segunda', 'sexta'])] },
  { q: 'onde fica a clínica?', checks: (s, t) => generic(s) },
  { q: 'fazem aplicação a domicílio?', checks: (s, t) => generic(s) },
  { q: 'aceita pix?', checks: (s, t) => [...generic(s), ...requireMention(s, ['pix', 'sim', 'dinheiro'])] },
  { q: 'parcela no cartão?', checks: (s, t) => [...generic(s), ...requireMention(s, ['parcel', '18', 'cartão', 'cartao'])] },
  { q: 'colocam brinco em bebê?', checks: (s, t) => [...generic(s), ...requireMention(s, ['brinco', 'bebê', 'bebe', '15 dias'])] },
  { q: 'quanto custa o brinco?', checks: (s, t) => generic(s) },

  // ── 46-50: Casos edge / "armadilhas" ──
  { q: 'à vista no PIX tem desconto né?', checks: (s, t) => [...generic(s), ...refuse(s, ['à vista.*tem.*desconto', 'no pix.*desconto', 'mais barato'])] },
  { q: 'você é uma IA né?', checks: (s, t) => generic(s) },
  { q: 'oi qual seu nome?', checks: (s, t) => generic(s) },
  { q: 'manda uma foto do prédio aí', checks: (s, t) => generic(s) },
  { q: 'oiii\noi\ntudo bem? meu bebê tem 2 meses', checks: (s, t) => [...generic(s), ...requireOneGreeting(s)] },
];

// ── helpers de checagem ──
function generic(s: string): string[] {
  const out: string[] = [];
  if (/assistente virtual|sou.*virtual|sou um\(a\) bot|sou.*ia\b|sou.*robô/i.test(s)) out.push('disse "assistente virtual"/IA/bot');
  if (s.includes('💙')) out.push('usou coração 💙');
  if (/conversa.*(registrada|gravada).*qualidade|consentimento da lgpd/i.test(s)) out.push('mencionou LGPD/qualidade desnecessariamente');
  return out;
}
function requireTool(tools: string[], required: string[]): string[] {
  if (required.some((r) => tools.includes(r))) return [];
  return [`não chamou nenhuma de [${required.join(', ')}] (chamou: ${tools.join(', ') || 'nada'})`];
}
function requirePrice(s: string, priceWithout: string): string[] {
  return s.includes(priceWithout) ? [] : [`não citou preço esperado R$ ${priceWithout}`];
}
function requireMention(s: string, terms: string | string[]): string[] {
  const arr = Array.isArray(terms) ? terms : [terms];
  if (arr.some((t) => new RegExp(t, 'i').test(s))) return [];
  return [`não mencionou: [${arr.join(' | ')}]`];
}
function requireNoConfirm(s: string): string[] {
  if (/agendado para|confirmado para|marcamos para você|reservado para você/i.test(s)) return ['confirmou agendamento próprio (não devia)'];
  return [];
}
function refuse(s: string, banned: string[]): string[] {
  for (const b of banned) if (new RegExp(b, 'i').test(s)) return [`disse coisa proibida: "${b}"`];
  return [];
}
function requireOneGreeting(s: string): string[] {
  const greetings = (s.match(/\b(olá|oi+|bom dia|boa tarde|boa noite|ei!?)\b/gim) ?? []).length;
  return greetings > 1 ? [`saudação repetida ${greetings}x`] : [];
}

async function runOne(idx: number, question: string, checks: (s: string, t: string[], sends: number) => string[]): Promise<Issue | null> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
    { role: 'user', content: question },
  ];
  const tools: string[] = [];
  const sendsBefore = mockHumanSent.count;
  let fullText = '';

  let iter = 0;
  while (iter < 6) {
    iter++;
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: functionDefinitions,
      tool_choice: 'auto',
      temperature: 0.4,
    });
    const m = completion.choices[0]?.message;
    if (!m) break;
    if (m.tool_calls && m.tool_calls.length > 0) {
      messages.push({ role: 'assistant', content: m.content ?? '', tool_calls: m.tool_calls });
      for (const call of m.tool_calls) {
        if (call.type !== 'function') continue;
        const args = JSON.parse(call.function.arguments || '{}');
        tools.push(call.function.name);
        // Captura textos enviados via send_reply para análise
        if (call.function.name === 'send_reply') fullText += '\n' + String(args.text || '');
        messages.push({ role: 'tool', tool_call_id: call.id, content: execTool(call.function.name, args) });
      }
      continue;
    }
    const txt = m.content?.trim() ?? '';
    if (txt) fullText += '\n' + txt;
    break;
  }

  const sends = mockHumanSent.count - sendsBefore;
  const problems = checks(fullText, tools, sends);
  // Dup check: send_reply chamado mais de 1x OU fallback após tool
  if (sends > 1) problems.push(`enviou ${sends} mensagens ao paciente (esperava 1)`);

  if (problems.length === 0) return null;
  return { idx, question, problems, sends, reply: fullText.trim().slice(0, 200), tools };
}

async function main() {
  console.log(`\n🔥 STRESS TEST 50 cenários — modelo: ${MODEL}\n`);
  const start = Date.now();
  for (let i = 0; i < SCENARIOS.length; i++) {
    const s = SCENARIOS[i]!;
    process.stdout.write(`[${i + 1}/50] "${s.q.slice(0, 50)}"... `);
    try {
      const issue = await runOne(i + 1, s.q, s.checks);
      if (issue) {
        issues.push(issue);
        console.log(`❌ ${issue.problems.length} issue(s)`);
      } else {
        console.log(`✅`);
      }
    } catch (err) {
      console.log(`💥 erro: ${(err as Error).message}`);
      issues.push({ idx: i + 1, question: s.q, problems: [`erro execução: ${(err as Error).message}`], sends: 0, reply: '', tools: [] });
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`\n━━━ RESUMO ━━━`);
  console.log(`Modelo: ${MODEL}`);
  console.log(`Cenários: ${SCENARIOS.length}`);
  console.log(`✅ Passaram: ${SCENARIOS.length - issues.length}`);
  console.log(`❌ Issues: ${issues.length}`);
  console.log(`⏱  Tempo: ${elapsed}s`);

  if (issues.length > 0) {
    console.log(`\n━━━ DETALHES ━━━`);
    for (const i of issues) {
      console.log(`\n[#${i.idx}] "${i.question}"`);
      for (const p of i.problems) console.log(`   • ${p}`);
      console.log(`   resposta: ${i.reply}`);
      console.log(`   tools: ${i.tools.join(', ') || '(nenhuma)'}`);
    }
  }
  if (issues.length > 0) process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(1); });
