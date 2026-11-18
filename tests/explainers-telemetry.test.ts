/**
 * Session B cost telemetry, offline: a canned Agent SDK stream (no model, no network). Covers the
 * per-agent, per-turn, per-tool and per-round records, the jsonl stream, the summary files and the
 * breakdown rows, and that the breakdown never moves jobs.spend_usd.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { runAgentSession, SNAPS_FOR_WORLD, SNAPS_PER_FRAME, type AgentMessage, type AgentQuery } from '@/lib/explainers/render/agent';
import { SpendMeter } from '@/lib/explainers/render/meter';
import { agentOfLabel, finishSessionBTelemetry, rewriteSessionBTelemetry, imageTokens, measureToolResult, priceTurn, roundKindOf, SessionBTelemetry } from '@/lib/explainers/render/telemetry';
import { addTopics, recordCost } from '@/lib/explainers/repository';
import { scratchExplainersDb } from './explainers-pglite';

const MODEL = 'claude-sonnet-5-5';
const secrets = { anthropicApiKey: 'k', heygenApiKey: 'h', voiceId: 'v' };
// a 100×100 PNG header (signature + IHDR), base64
const png = (() => {
  const b = Buffer.alloc(33);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12);
  b.writeUInt32BE(100, 16);
  b.writeUInt32BE(100, 20);
  return b.toString('base64');
})();

type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
const assistant = (id: string, usage: Usage, content: unknown[], parent: string | null = null): AgentMessage => ({
  type: 'assistant', session_id: 's', parent_tool_use_id: parent, message: { id, model: MODEL, usage, content },
});
const toolUse = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const toolResult = (id: string, content: unknown, parent: string | null = null, isError = false): AgentMessage => ({
  type: 'user', session_id: 's', parent_tool_use_id: parent, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});
const result = (usd: number): AgentMessage => ({ type: 'result', session_id: 's', subtype: 'success', is_error: false, total_cost_usd: usd, num_turns: 3, duration_ms: 1234, modelUsage: {}, errors: [] });

const sumUsd = (usages: Usage[]) => usages.reduce((x, u) => x + priceTurn(MODEL, u).usd, 0);

function frameStream(prefix: string): { messages: AgentMessage[]; sdkUsd: number } {
  const u1: Usage = { input_tokens: 500, output_tokens: 800, cache_creation_input_tokens: 90_000 };
  const u2: Usage = { input_tokens: 200, output_tokens: 1200, cache_read_input_tokens: 90_000 };
  const u3: Usage = { input_tokens: 100, output_tokens: 300, cache_read_input_tokens: 91_000 };
  return {
    sdkUsd: sumUsd([u1, u2, u3]) + 0.01, // the SDK's total carries a small gap
    messages: [
      // turn 1 streams as two blocks with the same id and usage: counted once
      assistant(`${prefix}-1`, u1, [{ type: 'text', text: 'writing' }]),
      assistant(`${prefix}-1`, u1, [toolUse(`${prefix}-t1`, 'Write', { file_path: 'assets/frames/02-define.js', content: 'x' })]),
      toolResult(`${prefix}-t1`, 'File written'),
      assistant(`${prefix}-2`, u2, [toolUse(`${prefix}-t2`, 'Bash', { command: 'node assets/kit/snap.mjs 02-define 1,2' }), toolUse(`${prefix}-t3`, 'Bash', { command: 'node assets/kit/try.mjs frame 02-define' })]),
      toolResult(`${prefix}-t2`, '{"ok":true,"pngs":["a.png"]}'),
      toolResult(`${prefix}-t3`, '{"ok":true}'),
      assistant(`${prefix}-3`, u3, [toolUse(`${prefix}-t4`, 'Read', { file_path: 'snaps/a.png' })]),
      toolResult(`${prefix}-t4`, [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } }, { type: 'text', text: 'still' }]),
      result(sumUsd([u1, u2, u3]) + 0.01),
    ],
  };
}

const query = (messages: AgentMessage[]): AgentQuery => () => (async function* () { yield* messages; })();

async function runRound(t: SessionBTelemetry, label: string, messages: AgentMessage[], model = MODEL) {
  const obs = t.observe(label, model);
  const r = await runAgentSession({
    query: query(messages), prompt: 'p', projectDir: '/nope', homeDir: '/h', tmpDir: '/t', model, frameWorkerModel: model,
    meter: new SpendMeter(100), secrets, log: () => {}, onMessage: obs.onMessage,
  });
  obs.end(r);
  return r;
}

test('labels map to agents and round kinds', () => {
  assert.equal(agentOfLabel('scene-builder:fix'), 'scene-builder');
  assert.equal(agentOfLabel('frame:checks:05-payoff'), 'frame:05-payoff');
  assert.equal(agentOfLabel('repair:05-payoff'), 'frame:05-payoff');
  assert.equal(agentOfLabel('orchestrator'), 'orchestrator');
  assert.equal(roundKindOf('frame:02-define'), 'build');
  assert.equal(roundKindOf('frame:checks:02-define'), 'checks');
  assert.equal(roundKindOf('scene-builder'), 'build');
  assert.equal(roundKindOf('scene-builder:fix'), 'fix');
  assert.equal(imageTokens(png), Math.ceil(10_000 / 750));
  const m = measureToolResult([{ type: 'text', text: 'abcd' }, { type: 'image', source: { data: png } }]);
  assert.equal(m.bytes, 4);
  assert.equal(m.images, 1);
});

test('session B telemetry: agents, turns, tools, rounds, files, rows, no double counting', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbt-'));
  const { db, pg } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'What is an API?', scope: 'Explain an API call.', origin: 'manual' }]);
  const { rows: [job] } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model)
     VALUES ($1, 'running', 'click', 'development', 5, $2, $2) RETURNING id`,
    [topic.id, MODEL],
  );
  assert.ok(job?.id, 'a job row');
  let clock = 1_000;
  const tel = new SessionBTelemetry({ dir: path.join(dir, 'telemetry'), jobId: job.id, now: () => (clock += 100) });

  // scene builder, one round
  const world = frameStream('w');
  const rWorld = await runRound(tel, 'scene-builder', world.messages);
  // frame 02: a build round and a checks round
  const f1 = frameStream('f1');
  const r1 = await runRound(tel, 'frame:02-define', f1.messages);
  const f2 = frameStream('f2');
  const r2 = await runRound(tel, 'frame:checks:02-define', f2.messages);

  // an orchestrator session with a subagent (agent runner): subagent turns carry parent_tool_use_id
  const uo: Usage = { input_tokens: 1000, output_tokens: 400, cache_creation_input_tokens: 20_000 };
  const us: Usage = { input_tokens: 300, output_tokens: 900, cache_read_input_tokens: 50_000 };
  const orch: AgentMessage[] = [
    assistant('o-1', uo, [toolUse('task-1', 'Task', { subagent_type: 'frame-worker-tech', description: 'frame 05' })]),
    assistant('s-1', us, [toolUse('s-t1', 'Read', { file_path: 'frame.md' })], 'task-1'),
    toolResult('s-t1', 'x'.repeat(4000), 'task-1'),
    toolResult('task-1', 'done'),
    result(sumUsd([uo, us])),
  ];
  const rOrch = await runRound(tel, 'orchestrator', orch);

  // 3. the jsonl stream already holds every turn and tool, before the summary
  const lines = fs.readFileSync(path.join(dir, 'telemetry', 'session-b.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.filter((l) => l.kind === 'turn').length, 3 * 3 + 2, 'turns deduplicated by message id');
  assert.equal(lines.filter((l) => l.kind === 'tool').length, 3 * 4 + 2);
  assert.equal(lines.filter((l) => l.kind === 'round_end').length, 4);

  // the spend: today's phase rows, from the SDK's result totals
  for (const r of [rWorld, r1, r2, rOrch]) await recordCost(db, { jobId: job.id, mode: 'development', vendor: 'anthropic', component: `session_b:${MODEL}`, usd: r.totalCostUsd });
  const spendBefore = Number((await db.query<{ spend_usd: string }>('SELECT spend_usd FROM explainers.jobs WHERE id = $1', [job.id])).rows[0].spend_usd);
  const eventsBefore = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM explainers.cost_events WHERE job_id = $1', [job.id])).rows[0].n);

  const summary = await finishSessionBTelemetry(tel, db);
  assert.ok(summary);

  // 1. per agent, reconciled to the SDK totals
  const byAgent = new Map(summary.agents.map((a) => [a.agent, a]));
  const frame = byAgent.get('frame:02-define')!;
  assert.equal(frame.rounds, 2);
  assert.equal(frame.turns, 6);
  assert.deepEqual(frame.models, [MODEL]);
  assert.ok(frame.wallMs > 0);
  assert.ok(Math.abs(frame.sdkUsd - (f1.sdkUsd + f2.sdkUsd)) < 1e-5);
  assert.ok(Math.abs(frame.gapUsd - 0.02) < 1e-5, `gap ${frame.gapUsd}`);
  assert.ok(summary.notes.some((n) => /frame:02-define/.test(n)), 'the gap is noted');
  const sub = byAgent.get('orchestrator>frame-worker-tech:frame 05')!;
  assert.equal(sub.turns, 1, 'the subagent turn is attributed to the subagent');
  assert.equal(sub.cacheRead, 50_000);
  assert.equal(byAgent.get('orchestrator')!.gapUsd, 0, 'orchestrator + subagent priced turns reconcile to its SDK total');
  // 2. per-turn buckets and the cache hit ratio
  assert.equal(frame.cacheWrite, 180_000);
  assert.equal(frame.cacheRead, 362_000);
  assert.equal(frame.fresh, 1600);
  assert.ok(frame.cacheHitRatio > 0.6 && frame.cacheHitRatio < 0.7);
  // 3. per tool: text and images apart
  assert.equal(frame.tools.Read.images, 2);
  assert.equal(frame.tools.Read.imageTokens, 2 * Math.ceil(10_000 / 750));
  assert.equal(frame.tools.Bash.calls, 4);
  assert.equal(sub.tools.Read.approxTokens, 1000);
  // 4. revision loops vs budget
  const loops = new Map(summary.loops.map((l) => [l.agent, l]));
  assert.deepEqual([loops.get('frame:02-define')!.snapsUsed, loops.get('frame:02-define')!.snapsBudget], [2, SNAPS_PER_FRAME]);
  assert.equal(loops.get('frame:02-define')!.fixRoundsUsed, 1);
  assert.deepEqual(loops.get('frame:02-define')!.rounds.map((r) => [r.kind, r.tryRuns, r.boundsRuns]), [['build', 1, 0], ['checks', 1, 0]]);
  assert.ok(Math.abs(loops.get('frame:02-define')!.rounds[1].usd - f2.sdkUsd) < 1e-5, '$ per round');
  assert.equal(loops.get('scene-builder')!.snapsBudget, SNAPS_FOR_WORLD);
  // 5. top 10, files, rows
  assert.equal(summary.top.length, 10);
  assert.ok(summary.top.every((l, i) => i === 0 || summary.top[i - 1].usd >= l.usd));
  const md = fs.readFileSync(path.join(dir, 'telemetry', 'session-b-summary.md'), 'utf8');
  assert.match(md, /## Top cost lines/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'telemetry', 'session-b-summary.json'), 'utf8')).totals.rounds === 4);
  if (process.env.PRINT_TELEMETRY_MD) console.log(md);

  const breakdown = (await db.query<{ component: string; usd: string }>('SELECT component, usd FROM explainers.cost_breakdown WHERE job_id = $1 ORDER BY component', [job.id])).rows;
  assert.ok(breakdown.some((r) => r.component === 'session_b:agent:frame:02-define'));
  assert.ok(breakdown.some((r) => r.component === 'session_b:round:02-define:2'));
  assert.ok(breakdown.some((r) => r.component === 'session_b:round:scene-builder:1'));
  // no double counting: the job's spend and its cost events are untouched
  const spendAfter = Number((await db.query<{ spend_usd: string }>('SELECT spend_usd FROM explainers.jobs WHERE id = $1', [job.id])).rows[0].spend_usd);
  const eventsAfter = Number((await db.query<{ n: string }>('SELECT count(*) AS n FROM explainers.cost_events WHERE job_id = $1', [job.id])).rows[0].n);
  assert.equal(spendAfter, spendBefore);
  assert.equal(eventsAfter, eventsBefore);
  assert.ok(Math.abs(spendAfter - summary.totals.sdkUsd) < 1e-4, 'the spend is the SDK totals');
  await pg.close();
});

test('after the repair pass: the summary is rewritten with the repair round and the breakdown rows are replaced', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sbt-'));
  const { db, pg } = await scratchExplainersDb();
  const [topic] = await addTopics(db, [{ title: 'What is DNS?', scope: 'Explain DNS.', origin: 'manual' }]);
  const { rows: [job] } = await db.query<{ id: string }>(
    `INSERT INTO explainers.jobs (topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model)
     VALUES ($1, 'running', 'click', 'development', 5, $2, $2) RETURNING id`,
    [topic.id, MODEL],
  );
  let clock = 1_000;
  const tel = new SessionBTelemetry({ dir: path.join(dir, 'telemetry'), jobId: job.id, now: () => (clock += 100) });
  const r1 = await runRound(tel, 'frame:02-define', frameStream('a').messages);
  await recordCost(db, { jobId: job.id, mode: 'development', vendor: 'anthropic', component: `session_b:${MODEL}`, usd: r1.totalCostUsd });
  // a non-session_b breakdown row for the job is left alone
  await db.query(`INSERT INTO explainers.cost_breakdown (job_id, component, usd) VALUES ($1, 'picture_check:x', 1)`, [job.id]);
  const pre = await finishSessionBTelemetry(tel, db);
  assert.ok(pre);
  const rowsOf = async () => (await db.query<{ component: string; usd: string }>(`SELECT component, usd FROM explainers.cost_breakdown WHERE job_id = $1 AND component LIKE 'session\\_b:%' ORDER BY component`, [job.id])).rows;
  const preRows = await rowsOf();

  // the repair round (code runner label), then the rewrite
  const rRepair = await runRound(tel, 'repair:02-define', frameStream('b').messages);
  await recordCost(db, { jobId: job.id, mode: 'development', vendor: 'anthropic', component: `repair:${MODEL}`, usd: rRepair.totalCostUsd });
  const spendBefore = Number((await db.query<{ spend_usd: string }>('SELECT spend_usd FROM explainers.jobs WHERE id = $1', [job.id])).rows[0].spend_usd);
  const eventsBefore = (await db.query('SELECT component, usd FROM explainers.cost_events WHERE job_id = $1 ORDER BY created_at, component', [job.id])).rows;

  const post = await rewriteSessionBTelemetry(tel, db, job.id);
  assert.ok(post);
  assert.equal(post.totals.rounds, 2);
  assert.ok(post.rounds.some((r) => r.roundKind === 'repair'), 'the repair round is in the summary');
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'telemetry', 'session-b-summary.json'), 'utf8'));
  assert.equal(json.totals.rounds, 2);
  assert.match(fs.readFileSync(path.join(dir, 'telemetry', 'session-b-summary.md'), 'utf8'), /repair/);

  const postRows = await rowsOf();
  const components = postRows.map((r) => r.component);
  assert.equal(new Set(components).size, components.length, 'no duplicated components');
  assert.ok(components.includes('session_b:round:02-define:2'), 'the repair round row');
  assert.equal(postRows.length, preRows.length + 1, 'replaced, not appended: same agent row, one more round row');
  assert.ok(Number(postRows.find((r) => r.component === 'session_b:agent:frame:02-define')!.usd) > Number(preRows.find((r) => r.component === 'session_b:agent:frame:02-define')!.usd), 'the agent row now carries the repair round');
  assert.equal((await db.query('SELECT 1 FROM explainers.cost_breakdown WHERE job_id = $1 AND component = $2', [job.id, 'picture_check:x'])).rows.length, 1);
  // rewriting again changes nothing (idempotent replace)
  await rewriteSessionBTelemetry(tel, db, job.id);
  assert.deepEqual(await rowsOf(), postRows);

  // spend and cost events untouched
  const spendAfter = Number((await db.query<{ spend_usd: string }>('SELECT spend_usd FROM explainers.jobs WHERE id = $1', [job.id])).rows[0].spend_usd);
  assert.equal(spendAfter, spendBefore);
  assert.deepEqual((await db.query('SELECT component, usd FROM explainers.cost_events WHERE job_id = $1 ORDER BY created_at, component', [job.id])).rows, eventsBefore);
  await pg.close();
});

test('the post-repair rewrite fails open', async () => {
  const tel = new SessionBTelemetry({ jobId: 'j' });
  const broken = { query: async () => { throw new Error('db down'); }, transaction: async () => { throw new Error('db down'); } };
  assert.equal(await rewriteSessionBTelemetry(tel, broken as never, 'j'), null);
});
