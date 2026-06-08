/**
 * Teste END-TO-END usando OpenAI real + Uazapi real.
 *
 * 1. Roda 5 cenários de conversa com OpenAI (mesma bateria do testGpt41.ts)
 * 2. Faz uma chamada de teste à Uazapi (sendText) para validar conectividade
 *
 * Carrega credenciais de .env.test.local (gitignored).
 *
 * Uso:
 *   pnpm exec tsx apps/api/src/scripts/testE2E.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import OpenAI from 'openai';
import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';
import { createUazapiClient } from '@imuniza/uazapi';

// ───── Carrega .env.test.local manualmente (sem dotenv-cli) ─────
function loadEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {};
  const content = fs.readFileSync(filePath, 'utf8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    env[key] = val;
  }
  return env;
}

const ENV_FILE = path.resolve(process.cwd(), '.env.test.local');
const fileEnv = loadEnvFile(ENV_FILE);

const cfg = {
  OPENAI_API_KEY: fileEnv.OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
  MODEL: fileEnv.MODEL || process.env.MODEL || 'gpt-4.1',
  UAZAPI_URL: fileEnv.UAZAPI_URL || process.env.UAZAPI_URL || '',
  UAZAPI_TOKEN: fileEnv.UAZAPI_TOKEN || process.env.UAZAPI_TOKEN || '',
  TEST_RECEIVER_PHONE: fileEnv.TEST_RECEIVER_PHONE || process.env.TEST_RECEIVER_PHONE || '',
};

if (!cfg.OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY ausente em .env.test.local');
  process.exit(1);
}

const client = new OpenAI({ apiKey: cfg.OPENAI_API_KEY });

// ───── Persona usada nos testes ─────
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

// ───── Mock das funções ─────
const mockVaccines = [
  { name: 'Hexavalente acelular', slug: 'hexavalente', ageMonths: [2, 4, 6], priceCash: 256, priceInstallment: 314.27, installments: 18, inStock: true, description: 'Protege contra 6 doenças' },
  { name: 'Pneumocócica 20', slug: 'pneumo-20', ageMonths: [2, 4, 6, 12], priceCash: 489, priceInstallment: 600.31, installments: 18, inStock: true, description: 'Cobertura ampla' },
  { name: 'Rotavírus pentavalente', slug: 'rotavirus', ageMonths: [2, 4, 6], priceCash: 312, priceInstallment: 383.02, installments: 18, inStock: true, description: 'Diarreia em bebês' },
  { name: 'Influenza (gripe)', slug: 'influenza', ageMonths: [6, 12], priceCash: 120, priceInstallment: 147.32, installments: 18, inStock: false, outOfStockNote: 'previsão para próxima semana', description: 'Vacina anual' },
];

function execTool(name: string, args: Record<string, unknown>): string {
  if (name === 'list_vaccines')
    return JSON.stringify({
      priceCashMeaning: 'preço final à vista, sem desconto extra',
      priceInstallmentMeaning: 'total parcelado em até `installments` vezes',
      stockMeaning: 'inStock=false significa em falta. Ofereça lista de espera (request_handoff reason=waitlist)',
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
  if (name === 'send_reply') return JSON.stringify({ ok: true, chunks: 1 });
  return JSON.stringify({ error: 'unknown function' });
}

interface TestResult {
  scenario: string;
  passed: number;
  failed: number;
  notes: string[];
  fullResponse: string;
  toolCalls: string[];
}

async function runConversation(
  scenarioName: string,
  patientMessages: string[],
  checks: Array<{ name: string; test: (full: string, tools: string[]) => boolean }>,
): Promise<TestResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: 'system', content: system },
  ];
  const toolsUsed: string[] = [];
  let fullAssistantText = '';

  console.log(`\n━━━ ${scenarioName} ━━━`);
  for (const userMsg of patientMessages) {
    console.log(`  👤 Paciente: ${userMsg}`);
    messages.push({ role: 'user', content: userMsg });

    let iter = 0;
    while (iter < 6) {
      iter++;
      const completion = await client.chat.completions.create({
        model: cfg.MODEL,
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
          toolsUsed.push(call.function.name);
          console.log(`  🔧 Chamou: ${call.function.name}`);
          messages.push({ role: 'tool', tool_call_id: call.id, content: execTool(call.function.name, args) });
        }
        continue;
      }
      const txt = m.content?.trim() ?? '';
      if (txt) {
        console.log(`  🤖 IA: ${txt.slice(0, 180)}${txt.length > 180 ? '...' : ''}`);
        fullAssistantText += '\n' + txt;
      }
      break;
    }
  }

  const result: TestResult = { scenario: scenarioName, passed: 0, failed: 0, notes: [], fullResponse: fullAssistantText, toolCalls: toolsUsed };
  for (const c of checks) {
    const ok = c.test(fullAssistantText, toolsUsed);
    if (ok) { result.passed++; console.log(`    ✓ ${c.name}`); }
    else { result.failed++; result.notes.push(c.name); console.log(`    ✗ ${c.name}`); }
  }
  return result;
}

async function testUazapi(): Promise<{ ok: boolean; detail: string }> {
  if (!cfg.UAZAPI_URL || !cfg.UAZAPI_TOKEN) {
    return { ok: false, detail: 'UAZAPI_URL ou UAZAPI_TOKEN não configurados' };
  }
  if (!cfg.TEST_RECEIVER_PHONE) {
    return { ok: false, detail: 'TEST_RECEIVER_PHONE não definido — pulando envio real' };
  }
  console.log(`\n━━━ Cenário 6: Envio real via Uazapi → ${cfg.TEST_RECEIVER_PHONE} ━━━`);
  try {
    const uaz = createUazapiClient({ baseUrl: cfg.UAZAPI_URL, token: cfg.UAZAPI_TOKEN });
    const sent = await uaz.sendText({
      number: cfg.TEST_RECEIVER_PHONE,
      text: `🧪 Teste E2E — modelo: ${cfg.MODEL}\nHorário: ${new Date().toLocaleString('pt-BR')}\n\nSe você recebeu essa mensagem, a integração Uazapi tá funcionando.`,
    });
    console.log(`  ✓ Mensagem enviada — id: ${sent.id}`);
    return { ok: true, detail: `messageId=${sent.id}` };
  } catch (err) {
    console.log(`  ✗ Falhou: ${(err as Error).message}`);
    return { ok: false, detail: (err as Error).message };
  }
}

async function main() {
  console.log(`\n🧪 TESTE E2E — modelo: ${cfg.MODEL}\n`);
  console.log(`   .env.test.local: ${fs.existsSync(ENV_FILE) ? '✅ encontrado' : '❌ não encontrado'}`);
  console.log(`   OpenAI key: ${cfg.OPENAI_API_KEY ? '✅' : '❌'}`);
  console.log(`   Uazapi token: ${cfg.UAZAPI_TOKEN ? '✅' : '❌'}`);
  console.log(`   Receiver phone: ${cfg.TEST_RECEIVER_PHONE || '(vazio — pula Uazapi)'}`);

  const results: TestResult[] = [];

  results.push(await runConversation('Cenário 1: Primeira saudação', ['oi'], [
    { name: 'NÃO contém "assistente virtual"', test: (s) => !/assistente virtual/i.test(s) },
    { name: 'NÃO contém coração 💙', test: (s) => !s.includes('💙') },
    { name: 'NÃO menciona LGPD/qualidade/registrada', test: (s) => !/conversa.*registrada|lgpd|para qualidade/i.test(s) },
    { name: 'Resposta curta (<500 chars)', test: (s) => s.length < 500 },
  ]));

  results.push(await runConversation('Cenário 2: Vacinas 2 meses', ['oi! meu bebê tem 2 meses, quais vacinas precisa?'], [
    { name: 'Chamou recommend_vaccines OU list_vaccines', test: (_s, t) => t.includes('recommend_vaccines') || t.includes('list_vaccines') },
    { name: 'Menciona Hexavalente', test: (s) => /hexavalente/i.test(s) },
    { name: 'Cita R$ 256 (à vista hexa)', test: (s) => /256/.test(s) },
    { name: 'Menciona 18x', test: (s) => /18x/i.test(s) },
    { name: 'NÃO diz "à vista tem desconto"', test: (s) => !/à vista.*(tem|com).*desconto|mais barato no pix|no pix.*tem desconto/i.test(s) },
  ]));

  results.push(await runConversation('Cenário 3: Gripe em falta', ['queria saber sobre a vacina da gripe'], [
    { name: 'Consultou DB (list_vaccines ou recommend)', test: (_s, t) => t.includes('list_vaccines') || t.includes('recommend_vaccines') },
    { name: 'Avisa que está em falta', test: (s) => /falta|sem.*estoque|não.*temos.*momento|estamos aguardando/i.test(s) },
    { name: 'Oferece lista de espera', test: (s) => /lista.*espera|avisar.*quando.*chegar|anotar.*nome/i.test(s) },
  ]));

  results.push(await runConversation('Cenário 4: Pedir handoff', ['quero marcar', 'meu filho tem 4 meses, hexavalente, amanhã de manhã?'], [
    { name: 'Chamou request_handoff', test: (_s, t) => t.includes('request_handoff') },
    { name: 'NÃO confirma agendamento próprio', test: (s) => !/agendado para|confirmado para|marcamos para você/i.test(s) },
  ]));

  results.push(await runConversation('Cenário 5: Sem duplicar saudação', ['oi', 'preço da pneumo 20?'], [
    { name: 'Só UMA saudação total', test: (s) => (s.match(/^(\s*)(olá|oi)/gim) ?? []).length <= 1 },
    { name: 'Cita R$ 489', test: (s) => /489/.test(s) },
  ]));

  // Cenário 6 — Uazapi
  const uazResult = await testUazapi();

  // ── Resumo ──
  let totalPass = 0;
  let totalFail = 0;
  for (const r of results) { totalPass += r.passed; totalFail += r.failed; }

  console.log(`\n━━━ RESUMO ${cfg.MODEL} ━━━`);
  for (const r of results) {
    const tag = r.failed === 0 ? '✅' : '⚠️';
    console.log(`${tag} ${r.scenario} → ${r.passed} OK, ${r.failed} falhou`);
    if (r.failed > 0) for (const n of r.notes) console.log(`   - ${n}`);
  }
  console.log(`\n${uazResult.ok ? '✅' : '⚠️'} Cenário 6: Uazapi → ${uazResult.detail}`);

  console.log(`\n━━━ TOTAL: ${totalPass} OK / ${totalFail} falhou ${uazResult.ok ? '(+ Uazapi OK)' : '(Uazapi: ' + uazResult.detail + ')'} ━━━\n`);

  if (totalFail > 0) process.exit(1);
}

main().catch((err) => { console.error(err); process.exit(1); });
