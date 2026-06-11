/**
 * Valida a logica das 3 camadas de defesa do agent_turn worker — pura,
 * sem precisar DB nem OpenAI. Mocka os objetos que o worker consultaria.
 *
 * As 3 camadas:
 *   1. status: assigned/awaiting_handoff/closed → BLOCK
 *   2. aiPausedUntil > now → BLOCK
 *   3. msg human apos aiResumedAt → BLOCK
 *
 * Roda em ~50ms.
 *
 * Uso:
 *   pnpm exec tsx src/scripts/testHumanBlocksAI.ts
 */

type Status = 'active' | 'assigned' | 'awaiting_handoff' | 'closed';

interface Conv {
  status: Status;
  aiPausedUntil: Date | null;
  metadata: { aiResumedAt?: string } | null;
}

interface Msg {
  role: 'user' | 'assistant' | 'tool' | 'human' | 'system';
  createdAt: Date;
}

/**
 * Mesma logica do agent_turn worker — mantida em sync com
 * workers/agentTurn.ts.
 */
function shouldAIRespond(conv: Conv, msgs: Msg[]): { block: boolean; reason: string } {
  if (conv.status === 'assigned' || conv.status === 'awaiting_handoff')
    return { block: true, reason: `status=${conv.status}` };
  if (conv.status === 'closed') return { block: true, reason: 'status=closed' };
  if (conv.aiPausedUntil && conv.aiPausedUntil.getTime() > Date.now())
    return { block: true, reason: `aiPausedUntil=${conv.aiPausedUntil.toISOString()}` };

  const aiResumedAt = conv.metadata?.aiResumedAt
    ? new Date(conv.metadata.aiResumedAt)
    : null;
  const humans = msgs
    .filter((m) => m.role === 'human')
    .filter((m) => !aiResumedAt || m.createdAt.getTime() > aiResumedAt.getTime());
  if (humans.length > 0)
    return { block: true, reason: `humanMsg at ${humans[0]!.createdAt.toISOString()}` };

  return { block: false, reason: 'IA pode responder' };
}

interface TestCase {
  name: string;
  conv: Conv;
  msgs: Msg[];
  expectBlock: boolean;
}

const now = new Date();
const PAST = new Date(now.getTime() - 60 * 60_000);
const RECENT_PAST = new Date(now.getTime() - 5 * 60_000);
const FUTURE = new Date(now.getTime() + 60 * 60_000);
const FAR_FUTURE = new Date('2099-12-31T23:59:59Z');

const cases: TestCase[] = [
  {
    name: 'IA pode responder em conversa active sem msgs human',
    conv: { status: 'active', aiPausedUntil: null, metadata: {} },
    msgs: [{ role: 'user', createdAt: now }],
    expectBlock: false,
  },
  {
    name: 'Camada 1: status=assigned bloqueia',
    conv: { status: 'assigned', aiPausedUntil: null, metadata: {} },
    msgs: [],
    expectBlock: true,
  },
  {
    name: 'Camada 1: status=closed bloqueia',
    conv: { status: 'closed', aiPausedUntil: null, metadata: {} },
    msgs: [],
    expectBlock: true,
  },
  {
    name: 'Camada 1: status=awaiting_handoff bloqueia',
    conv: { status: 'awaiting_handoff', aiPausedUntil: null, metadata: {} },
    msgs: [],
    expectBlock: true,
  },
  {
    name: 'Camada 2: aiPausedUntil futuro bloqueia',
    conv: { status: 'active', aiPausedUntil: FUTURE, metadata: {} },
    msgs: [],
    expectBlock: true,
  },
  {
    name: 'Camada 2: aiPausedUntil far-future (humano permanente) bloqueia',
    conv: { status: 'active', aiPausedUntil: FAR_FUTURE, metadata: {} },
    msgs: [],
    expectBlock: true,
  },
  {
    name: 'Camada 2: aiPausedUntil passado NAO bloqueia',
    conv: { status: 'active', aiPausedUntil: PAST, metadata: {} },
    msgs: [{ role: 'user', createdAt: now }],
    expectBlock: false,
  },
  {
    name: 'Camada 3: msg human sem aiResumedAt bloqueia',
    conv: { status: 'active', aiPausedUntil: null, metadata: {} },
    msgs: [{ role: 'human', createdAt: RECENT_PAST }],
    expectBlock: true,
  },
  {
    name: 'Camada 3: msg human ANTES de aiResumedAt NAO bloqueia',
    conv: {
      status: 'active',
      aiPausedUntil: null,
      metadata: { aiResumedAt: now.toISOString() },
    },
    msgs: [{ role: 'human', createdAt: PAST }, { role: 'user', createdAt: now }],
    expectBlock: false,
  },
  {
    name: 'Camada 3: msg human DEPOIS de aiResumedAt bloqueia',
    conv: {
      status: 'active',
      aiPausedUntil: null,
      metadata: { aiResumedAt: PAST.toISOString() },
    },
    msgs: [{ role: 'human', createdAt: RECENT_PAST }],
    expectBlock: true,
  },
  {
    name: 'Fluxo completo: resumed + nova msg human bloqueia',
    conv: {
      status: 'active',
      aiPausedUntil: null,
      metadata: { aiResumedAt: new Date(now.getTime() - 10 * 60_000).toISOString() },
    },
    msgs: [
      { role: 'human', createdAt: new Date(now.getTime() - 30 * 60_000) }, // antes do resume
      { role: 'human', createdAt: RECENT_PAST }, // depois do resume → bloqueia
    ],
    expectBlock: true,
  },
  {
    name: 'Fluxo completo: resumed + so msg user NAO bloqueia',
    conv: {
      status: 'active',
      aiPausedUntil: null,
      metadata: { aiResumedAt: new Date(now.getTime() - 10 * 60_000).toISOString() },
    },
    msgs: [
      { role: 'human', createdAt: new Date(now.getTime() - 30 * 60_000) }, // antes do resume
      { role: 'user', createdAt: RECENT_PAST }, // paciente, nao humano
    ],
    expectBlock: false,
  },
];

console.log(`\nTeste: humano bloqueia IA (${cases.length} cenários)\n`);
let passed = 0;
for (const c of cases) {
  const { block, reason } = shouldAIRespond(c.conv, c.msgs);
  const pass = block === c.expectBlock;
  const expectedStr = c.expectBlock ? 'BLOCK' : 'PASS';
  const gotStr = block ? `BLOCK` : `PASS`;
  if (pass) passed++;
  console.log(`[${pass ? '✅' : '❌'}] ${c.name.padEnd(60)} esperado=${expectedStr} obtido=${gotStr} (${reason})`);
}

console.log(`\n=== RESULTADO ===`);
console.log(`Passou: ${passed}/${cases.length}\n`);
process.exit(passed === cases.length ? 0 : 1);
