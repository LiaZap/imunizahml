/**
 * Teste local do gpt-4.1 com o system prompt + function calling da Imuniza.
 *
 * Roda cenários reais (sem DB, sem Redis, sem Uazapi) — só valida que o
 * modelo segue a persona, formata preço certo e chama as funções esperadas.
 *
 * Uso:
 *   OPENAI_API_KEY=sk-xxxxx pnpm exec tsx apps/api/src/scripts/testGpt41.ts
 *
 * Ou customizar:
 *   OPENAI_API_KEY=sk-xxx MODEL=gpt-4.1-mini pnpm exec tsx apps/api/src/scripts/testGpt41.ts
 */
import OpenAI from 'openai';
import { buildSystemPrompt, functionDefinitions } from '@imuniza/ai';

if (!process.env.OPENAI_API_KEY) {
  console.error('Defina OPENAI_API_KEY no ambiente.');
  process.exit(1);
}

const MODEL = process.env.MODEL ?? 'gpt-4.1';
const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Persona simplificada para os testes (idêntica ao espírito da persona real)
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

// Mock das funções (simula o que viria do DB)
const mockVaccines = [
  {
    name: 'Hexavalente acelular',
    slug: 'hexavalente',
    ageMonths: [2, 4, 6],
    priceCash: 256,
    priceInstallment: 314.27,
    installments: 18,
    inStock: true,
    description: 'Protege contra 6 doenças',
  },
  {
    name: 'Pneumocócica 20',
    slug: 'pneumo-20',
    ageMonths: [2, 4, 6, 12],
    priceCash: 489,
    priceInstallment: 600.31,
    installments: 18,
    inStock: true,
    description: 'Cobertura ampla',
  },
  {
    name: 'Rotavírus pentavalente',
    slug: 'rotavirus',
    ageMonths: [2, 4, 6],
    priceCash: 312,
    priceInstallment: 383.02,
    installments: 18,
    inStock: true,
    description: 'Diarreia em bebês',
  },
  {
    name: 'Influenza (gripe)',
    slug: 'influenza',
    ageMonths: [6, 12],
    priceCash: 120,
    priceInstallment: 147.32,
    installments: 18,
    inStock: false,
    outOfStockNote: 'previsão para próxima semana',
    description: 'Vacina anual',
  },
];

function execTool(name: string, args: Record<string, unknown>): string {
  if (name === 'list_vaccines') {
    return JSON.stringify({
      priceCashMeaning: 'preço final à vista, sem desconto extra',
      priceInstallmentMeaning: 'total parcelado em até `installments` vezes',
      stockMeaning:
        'inStock=false significa em falta. Informe e ofereça lista de espera (request_handoff com reason=waitlist)',
      vaccines: mockVaccines,
    });
  }
  if (name === 'recommend_vaccines') {
    const ageMonths = Number(args.ageMonths);
    return JSON.stringify({
      ageMonths,
      priceCashMeaning: 'preço final à vista, sem desconto extra',
      recommended: mockVaccines.filter((v) => v.ageMonths.includes(ageMonths)),
      packageAvailable: null,
    });
  }
  if (name === 'request_handoff') {
    return JSON.stringify({
      ok: true,
      summary: args.summary,
      reason: args.reason,
    });
  }
  if (name === 'update_patient_profile') {
    return JSON.stringify({ ok: true });
  }
  if (name === 'send_reply') {
    return JSON.stringify({ ok: true, chunks: 1 });
  }
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
  checks: Array<{
    name: string;
    test: (full: string, tools: string[]) => boolean;
  }>,
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

    let iterations = 0;
    while (iterations < 6) {
      iterations++;
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
        messages.push({
          role: 'assistant',
          content: m.content ?? '',
          tool_calls: m.tool_calls,
        });
        for (const call of m.tool_calls) {
          if (call.type !== 'function') continue;
          const args = JSON.parse(call.function.arguments || '{}');
          toolsUsed.push(call.function.name);
          console.log(`  🔧 Chamou: ${call.function.name}(${call.function.arguments.slice(0, 60)}...)`);
          const result = execTool(call.function.name, args);
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            content: result,
          });
        }
        continue;
      }
      const txt = m.content?.trim() ?? '';
      if (txt) {
        console.log(`  🤖 IA: ${txt.slice(0, 150)}${txt.length > 150 ? '...' : ''}`);
        fullAssistantText += '\n' + txt;
      }
      break;
    }
  }

  const result: TestResult = {
    scenario: scenarioName,
    passed: 0,
    failed: 0,
    notes: [],
    fullResponse: fullAssistantText,
    toolCalls: toolsUsed,
  };
  for (const c of checks) {
    const ok = c.test(fullAssistantText, toolsUsed);
    if (ok) {
      result.passed++;
      console.log(`    ✓ ${c.name}`);
    } else {
      result.failed++;
      result.notes.push(c.name);
      console.log(`    ✗ ${c.name}`);
    }
  }
  return result;
}

async function main() {
  console.log(`\n🧪 Teste do modelo: ${MODEL}\n`);
  const results: TestResult[] = [];

  // Cenário 1: primeira mensagem
  results.push(
    await runConversation(
      'Cenário 1: Primeira saudação',
      ['oi'],
      [
        {
          name: 'NÃO contém "assistente virtual"',
          test: (s) => !/assistente virtual/i.test(s),
        },
        {
          name: 'NÃO contém coração 💙',
          test: (s) => !s.includes('💙'),
        },
        {
          name: 'NÃO contém "conversa registrada" / "qualidade" / "LGPD"',
          test: (s) =>
            !/conversa.*registrada|gravacao da conversa|lgpd|para qualidade/i.test(s),
        },
        {
          name: 'Resposta é curta (< 500 chars)',
          test: (s) => s.length < 500,
        },
      ],
    ),
  );

  // Cenário 2: bebê de 2 meses
  results.push(
    await runConversation(
      'Cenário 2: Mãe perguntando vacinas de 2 meses',
      ['oi! meu bebê tem 2 meses, quais vacinas precisa?'],
      [
        {
          name: 'Chamou recommend_vaccines OU list_vaccines',
          test: (_s, t) => t.includes('recommend_vaccines') || t.includes('list_vaccines'),
        },
        {
          name: 'Menciona Hexavalente',
          test: (s) => /hexavalente/i.test(s),
        },
        {
          name: 'Formato preço: "R$ X" + "à vista"',
          test: (s) => /R\$\s?256.*à vista/i.test(s) || /256.*vista/i.test(s),
        },
        {
          name: 'Menciona parcelamento 18x',
          test: (s) => /18x/i.test(s),
        },
        {
          name: 'NÃO diz "à vista TEM desconto" (já é o preço final)',
          test: (s) => !/à vista.*tem desconto|à vista.*com desconto|à vista.*fica.*barato/i.test(s),
        },
      ],
    ),
  );

  // Cenário 3: vacina em falta
  results.push(
    await runConversation(
      'Cenário 3: Gripe em falta (oferecer lista de espera)',
      ['queria saber sobre a vacina da gripe'],
      [
        {
          name: 'Chamou list_vaccines ou recommend_vaccines',
          test: (_s, t) => t.includes('list_vaccines') || t.includes('recommend_vaccines'),
        },
        {
          name: 'Menciona que está em falta',
          test: (s) => /falta|sem.*estoque|não.*temos.*momento|chegará|estamos.*aguardando/i.test(s),
        },
        {
          name: 'Oferece lista de espera (avisar quando chegar)',
          test: (s) => /lista.*espera|avisar.*quando.*chegar|anotar.*nome/i.test(s),
        },
      ],
    ),
  );

  // Cenário 4: pedir handoff
  results.push(
    await runConversation(
      'Cenário 4: Paciente quer agendar',
      ['quero marcar', 'vou levar meu filho de 4 meses pra hexavalente, pode ser amanhã de manhã?'],
      [
        {
          name: 'Chamou request_handoff',
          test: (_s, t) => t.includes('request_handoff'),
        },
        {
          name: 'NÃO confirmou agendamento próprio',
          test: (s) => !/agendado para|agendamento confirmado|marcamos para você/i.test(s),
        },
      ],
    ),
  );

  // Cenário 5: tentar duplicar saudação
  results.push(
    await runConversation(
      'Cenário 5: Resposta única, sem duplicar saudação',
      ['oi', 'preço da pneumo 20?'],
      [
        {
          name: 'Só UMA saudação na resposta total',
          test: (s) => (s.match(/^(\s*)(olá|oi)/gim) ?? []).length <= 1,
        },
        {
          name: 'Menciona R$ 489',
          test: (s) => /489/.test(s),
        },
      ],
    ),
  );

  // ━━━ Resumo final ━━━
  let totalPass = 0;
  let totalFail = 0;
  for (const r of results) {
    totalPass += r.passed;
    totalFail += r.failed;
  }

  console.log(`\n━━━ Resumo do teste com ${MODEL} ━━━`);
  for (const r of results) {
    const tag = r.failed === 0 ? '✅' : '⚠️';
    console.log(`${tag} ${r.scenario} → ${r.passed} OK, ${r.failed} falhou`);
    if (r.failed > 0) {
      for (const n of r.notes) console.log(`   - ${n}`);
    }
  }
  console.log(`\nTOTAL: ${totalPass} OK / ${totalFail} falhou`);

  if (totalFail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
