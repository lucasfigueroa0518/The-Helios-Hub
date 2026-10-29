import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import { spendFor } from '@/lib/reel-ai-drama/cost';
import { jsonlLog } from '@/lib/reel-ai-drama/reporting/llm';
import { ReportingError, reportingKill, reportStory, runReporting, SUBMIT_FACT_SHEET_TOOL } from '@/lib/reel-ai-drama/reporting/report';
import { independentCount, isVerbatim, siteOf, validateFactSheet } from '@/lib/reel-ai-drama/reporting/validate';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import type { FactSheet, Pitch } from '@/lib/reel-ai-drama/types';

import { scratchExplainersDb } from './explainers-pglite';

const FIX = path.join(__dirname, 'fixtures', 'reel-ai-drama', 'harvest');
const pitch = JSON.parse(fs.readFileSync(path.join(FIX, 'pitch.json'), 'utf8')) as Pitch;
const sheet = () => JSON.parse(fs.readFileSync(path.join(FIX, 'factsheet.json'), 'utf8')) as FactSheet;

async function freshJob() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  const { rows: [p] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.pitches (title, pitch, event_key) VALUES ('t', '{}'::jsonb, 'k') RETURNING id`);
  const { rows: [job] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.jobs (pitch_id, mode, spend_cap_usd) VALUES ($1, 'production', 8) RETURNING id`, [p.id]);
  return { db, jobId: job.id };
}

const usage = (extra: Record<string, unknown> = {}) => ({ input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, ...extra });
const message = (content: unknown[], stop: string, u = usage()) =>
  ({ id: `msg_${Math.random()}`, type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', content, stop_reason: stop, stop_sequence: null, usage: u }) as unknown as Anthropic.Message;

// ── validateFactSheet ───────────────────────────────────────────────────────

test('a clean sheet passes; ids, sources and the verdict are kept', () => {
  const { sheet: out, problems } = validateFactSheet(sheet());
  assert.equal(out.facts.length, 1);
  assert.equal(out.facts[0].confidence, 'confirmed');
  assert.equal(out.verdict.holds, true);
  assert.ok(problems.every((p) => /unchecked/.test(p)), problems.join('; '));
});

test('independent sources are different sites and different publishers', () => {
  assert.equal(siteOf('https://news.bbc.co.uk/x'), 'bbc.co.uk');
  assert.equal(siteOf('https://blog.openai.com/a'), 'openai.com');
  const sources = [
    { id: 'S1', url: 'https://example-news.com/a', title: '', publisher: 'Example News', date: null, kind: 'news' },
    { id: 'S2', url: 'https://www.example-news.com/b', title: '', publisher: 'Example News', date: null, kind: 'news' },
    { id: 'S3', url: 'https://wire.example/c', title: '', publisher: 'Example News', date: null, kind: 'news' },
    { id: 'S4', url: 'https://other.example/d', title: '', publisher: 'Other Paper', date: null, kind: 'news' },
  ];
  assert.equal(independentCount(['S1', 'S2', 'S3'], sources), 1);
  assert.equal(independentCount(['S1', 'S4'], sources), 2);
});

test('a confirmed key fact on one source becomes single_source; an unsourced key fact kills', () => {
  const s = sheet();
  s.facts = [
    { id: 'F1', text: 'one', source_ids: ['S1'], key: true, confidence: 'confirmed' },
    { id: 'F2', text: 'two', source_ids: ['S9'], key: true, confidence: 'confirmed' },
    { id: 'F2', text: 'dup', source_ids: ['S1'], key: false, confidence: 'confirmed' },
  ];
  s.timeline = [
    { date: '2026-10-01', event: 'kept', fact_ids: ['F1', 'F7'] },
    { date: '2026-10-02', event: 'orphan', fact_ids: ['F2'] },
  ];
  const { sheet: out, problems } = validateFactSheet(s);
  assert.deepEqual(out.facts.map((f) => [f.id, f.confidence]), [['F1', 'single_source']]);
  assert.equal(out.verdict.holds, false);
  assert.match(out.verdict.reason, /F2/);
  assert.deepEqual(out.timeline.map((t) => t.fact_ids), [['F1']]);
  assert.ok(problems.some((p) => /repeats/.test(p)));
  assert.equal(reportingKill(out), 'facts_dont_hold');
});

test('quotes and artifacts must be word for word on a fetched source page, with a real source', () => {
  assert.ok(isVerbatim('"We’re  not done," she said', 'and then: “We\'re not done,” she said to staff.'));
  assert.ok(isVerbatim('the start … the end', 'the start of it and later the end of it'));
  assert.ok(!isVerbatim('we are finished', 'we are not finished'));
  const s = sheet();
  s.quotes = [
    { id: 'Q1', speaker: 'Board', text: 'no longer has confidence', source_id: 'S2', date: null, context: '' },
    { id: 'Q2', speaker: 'Board', text: 'invented words', source_id: 'S2', date: null, context: '' },
    { id: 'Q3', speaker: 'Board', text: 'anything', source_id: 'S99', date: null, context: '' },
  ];
  const fetched = new Map([['https://openai.com/index/board-statement/', 'The board no longer has confidence in his ability to lead OpenAI.']]);
  const { sheet: out, problems } = validateFactSheet(s, { fetched });
  assert.deepEqual(out.quotes.map((q) => q.id), ['Q1']);
  assert.equal(out.artifacts.length, 1, 'the artifact text is on the fetched statement page');
  assert.ok(problems.some((p) => /Q2 is not word for word/.test(p)));
  assert.ok(problems.some((p) => /Q3 names unknown source/.test(p)));
});

// ── reportStory ─────────────────────────────────────────────────────────────

test('reportStory resumes on pause_turn, caches the prefix, logs, records cost and checks the sheet', async () => {
  const { db, jobId } = await freshJob();
  const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-rep-'));
  const calls: Anthropic.MessageCreateParamsNonStreaming[] = [];
  const replies = [
    message(
      [
        { type: 'server_tool_use', id: 's1', name: 'web_fetch', input: { url: 'https://openai.com/index/board-statement' } },
        {
          type: 'web_fetch_tool_result',
          tool_use_id: 's1',
          content: { type: 'web_fetch_result', url: 'https://openai.com/index/board-statement', content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: 'The board no longer has confidence in his ability to lead.' } } },
        },
      ],
      'pause_turn',
      usage({ server_tool_use: { web_search_requests: 3 } }),
    ),
    message([{ type: 'tool_use', id: 't1', name: 'submit_fact_sheet', input: sheet() }], 'tool_use'),
  ];
  const problems: string[] = [];
  const result = await runReporting(
    {
      db,
      create: async (params) => {
        calls.push(JSON.parse(JSON.stringify(params)));
        return replies.shift()!;
      },
      loadPrompt: (name) => `PROMPT:${name}`,
      model: 'claude-sonnet-5-5',
      log: jsonlLog('reporting', jobId, logDir),
      onProblem: (p) => problems.push(p),
      now: () => new Date('2026-10-28T12:00:00Z'),
    },
    pitch,
    { jobId, mode: 'production' },
  );
  assert.equal(calls.length, 2);
  const first = calls[0];
  assert.deepEqual(first.tool_choice, { type: 'auto' });
  assert.deepEqual((first.system as { text: string; cache_control?: unknown }[])[0], { type: 'text', text: 'PROMPT:reporting', cache_control: { type: 'ephemeral', ttl: '1h' } });
  const tools = first.tools as { name: string; type?: string; cache_control?: unknown; strict?: boolean }[];
  assert.deepEqual(tools.map((t) => t.type ?? t.name), ['web_search_20250305', 'web_fetch_20250910', 'submit_fact_sheet']);
  assert.ok(tools[2].cache_control && tools[2].strict === false, 'the fact-sheet schema is too large to be strict');
  assert.match(String(first.messages[0].content), /Today: 2026-10-28/);
  assert.equal(calls[1].messages.length, 2, 'the continuation resends the paused assistant turn');
  assert.equal(calls[1].messages[1].role, 'assistant');
  assert.equal(result.sheet.verdict.holds, true);
  assert.equal(result.webSearches, 3);
  assert.ok(result.usd > 0.03, 'tokens plus three searches');
  assert.ok(Math.abs((await spendFor(db, { jobId })) - result.usd) < 1e-9);
  const lines = fs.readFileSync(path.join(logDir, `reporting-${jobId}.jsonl`), 'utf8').trim().split('\n');
  assert.equal(lines.length, 3);
  assert.ok(!problems.some((p) => /artifact A1/.test(p)), 'the artifact was checked against the fetched page');
});

test('a sheet whose verdict does not hold comes back for the kill', async () => {
  const { db, jobId } = await freshJob();
  const s = sheet();
  s.verdict = { holds: false, reason: 'The statement was a hoax.' };
  const out = await reportStory(
    { db, create: async () => message([{ type: 'tool_use', id: 't', name: SUBMIT_FACT_SHEET_TOOL.name, input: s }], 'tool_use'), loadPrompt: () => 'p', model: 'claude-sonnet-5-5', log: () => undefined },
    pitch,
    { jobId, mode: 'production' },
  );
  assert.equal(reportingKill(out), 'facts_dont_hold');
});

test('a turn that never submits fails with its cost recorded', async () => {
  const { db, jobId } = await freshJob();
  await assert.rejects(
    runReporting({ db, create: async () => message([{ type: 'text', text: 'done' }], 'end_turn'), loadPrompt: () => 'p', model: 'claude-sonnet-5-5', log: () => undefined }, pitch, { jobId, mode: 'production' }),
    (e: unknown) => e instanceof ReportingError && /without submit_fact_sheet/.test(e.message) && e.usd > 0,
  );
  assert.ok((await spendFor(db, { jobId })) > 0);
});

test('non-strict tool input: nested JSON sent as text is parsed back', async () => {
  const { coerceJsonStrings } = await import('@/lib/reel-ai-drama/tool-input');
  const out = coerceJsonStrings({ verdict: '{"holds":true,"reason":"ok"}', facts: '[{"id":"F1"}]', summary: 'plain {not json' }) as Record<string, unknown>;
  assert.deepEqual(out.verdict, { holds: true, reason: 'ok' });
  assert.deepEqual(out.facts, [{ id: 'F1' }]);
  assert.equal(out.summary, 'plain {not json');
});
