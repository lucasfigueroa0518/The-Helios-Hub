/**
 * Helios Social rebuild — M0 skeleton tests.
 *
 * Offline only: stubbed stages, no Claude, no Jev, no network, no DB
 * (CLAUDE.md; spec §9).
 */
import assert from 'node:assert/strict';
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { priceAnthropicUsage, usageBucketsFromMessage } from '@/lib/anthropic-pricing';
import { DAILY_CAP_USD, createCostMeter } from '@/lib/social/pipeline/cost-meter';
import { DAY_SCOPE_ID, runDay } from '@/lib/social/pipeline/orchestrator';
import {
  createFileSetAsideLog,
  createInMemorySetAsideLog,
  dayKey,
} from '@/lib/social/pipeline/set-aside-log';
import { STUB_ARTICLES, createStubStages, type StubOptions } from '@/lib/social/pipeline/stubs';
import { STAGE_ORDER, type StageName } from '@/lib/social/pipeline/types';

const NOW = new Date('2026-10-04T15:00:00Z');

function day(stubOpts: StubOptions = {}, extra: { capUsd?: number; targetPosts?: number } = {}) {
  const log = createInMemorySetAsideLog();
  const meter = createCostMeter({ capUsd: extra.capUsd });
  return {
    log,
    meter,
    result: runDay({
      articles: STUB_ARTICLES,
      stages: createStubStages(stubOpts),
      meter,
      log,
      now: NOW,
      targetPosts: extra.targetPosts,
    }),
  };
}

test('dry run: 2 posts, each through all 7 stages in order, no set-asides', async () => {
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const { result } = day({ calls });
  const r = await result;
  assert.equal(r.stopReason, 'target-reached');
  assert.equal(r.posts.length, 2);
  assert.deepEqual(r.posts.map((p) => p.storyId), ['story-a', 'story-b']);
  for (const post of r.posts) assert.deepEqual(post.stages, [...STAGE_ORDER]);
  assert.deepEqual(r.setAsides, []);
  // story-c is a backup and never runs.
  assert.ok(!calls.some((c) => c.storyId === 'story-c'));
  // Scoring runs once for the day.
  assert.equal(calls.filter((c) => c.stage === 'jev-scoring').length, 1);
  assert.ok(r.costUsd > 0 && r.costUsd < DAILY_CAP_USD);
});

test('a stage failure sets the story aside and the next-ranked story fills the slot', async () => {
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const { result, log } = day({
    calls,
    failures: [{ stage: 'fact-checker', reasonCode: 'main-claim-false', storyId: 'story-a' }],
  });
  const r = await result;
  assert.equal(r.stopReason, 'target-reached');
  assert.deepEqual(r.posts.map((p) => p.storyId), ['story-b', 'story-c']);
  assert.equal(r.setAsides.length, 1);
  const [entry] = r.setAsides;
  assert.equal(entry!.storyId, 'story-a');
  assert.equal(entry!.stage, 'fact-checker');
  assert.equal(entry!.reasonCode, 'main-claim-false');
  assert.equal(entry!.kind, 'should-not-run');
  assert.equal(entry!.day, '2026-10-04');
  assert.deepEqual(await log.forDay(NOW), r.setAsides);
  // Each stage runs once: no retry, no loop.
  assert.equal(calls.filter((c) => c.storyId === 'story-a' && c.stage === 'fact-checker').length, 1);
  assert.ok(!calls.some((c) => c.storyId === 'story-a' && c.stage === 'design'));
});

test('pipeline faults are classified as such', async () => {
  const r = await day({ failures: [{ stage: 'design', reasonCode: 'render-failed', storyId: 'story-b' }] }).result;
  assert.equal(r.setAsides[0]!.kind, 'pipeline-fault');
  assert.equal(r.setAsides[0]!.stage, 'design');
});

test('running out of stories stops the day short of target', async () => {
  const r = await day({ failures: [{ stage: 'writer', reasonCode: 'malformed-output' }] }).result;
  assert.equal(r.stopReason, 'out-of-stories');
  assert.equal(r.posts.length, 0);
  assert.equal(r.setAsides.length, 3);
});

test('the cost cap stops the day and logs cost-cap', async () => {
  // Reporter at $2 each: story-a finishes at ~$2.43 spent, story-b's
  // reporter pushes spend past the $4 cap, so story-b's writer never runs.
  const calls: Array<{ stage: StageName; storyId: string }> = [];
  const { result, meter } = day({ calls, costUsd: { reporter: 2 } }, { capUsd: 4 });
  const r = await result;
  assert.equal(r.stopReason, 'cost-cap');
  assert.equal(r.posts.length, 1);
  const cap = r.setAsides.at(-1)!;
  assert.equal(cap.reasonCode, 'cost-cap');
  assert.equal(cap.storyId, 'story-b');
  assert.equal(cap.stage, 'writer');
  assert.ok(!calls.some((c) => c.storyId === 'story-b' && c.stage === 'writer'));
  assert.ok(meter.capReached());
});

test('cost cap before scoring logs against the day', async () => {
  const log = createInMemorySetAsideLog();
  const r = await runDay({
    articles: STUB_ARTICLES,
    stages: createStubStages(),
    meter: createCostMeter({ alreadySpentUsd: DAILY_CAP_USD }),
    log,
    now: NOW,
  });
  assert.equal(r.stopReason, 'cost-cap');
  assert.equal(r.setAsides[0]!.storyId, DAY_SCOPE_ID);
});

test('default daily cap is $5', () => {
  assert.equal(DAILY_CAP_USD, 5);
  assert.equal(createCostMeter().capUsd, 5);
});

test('cost meter prices Claude usage with the shared pricing table', () => {
  const message = {
    id: 'msg_stub',
    usage: {
      input_tokens: 1200,
      output_tokens: 3000,
      cache_read_input_tokens: 20000,
      cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 8000 },
    },
  };
  const modelId = 'claude-opus-5-5';
  const expected = Number(priceAnthropicUsage(usageBucketsFromMessage(message, '1h'), { modelId }).costUsd);
  const meter = createCostMeter();
  const charged = meter.chargeClaude('writer', message, modelId);
  assert.equal(charged, expected);
  assert.ok(expected > 0);
  assert.equal(meter.byStage().writer, expected);
  assert.equal(meter.remaining(), DAILY_CAP_USD - expected);
});

test('set-asides expire with the day (America/New_York)', async () => {
  const log = createInMemorySetAsideLog();
  // 03:30 UTC on Oct 5 is still Oct 4 in New York.
  const lateEvening = new Date('2026-10-05T03:30:00Z');
  assert.equal(dayKey(lateEvening), '2026-10-04');
  await log.record({ storyId: 's', stage: 'writer', reasonCode: 'over-limit', detail: 'x' }, lateEvening);
  assert.equal((await log.forDay(NOW)).length, 1);
  assert.equal((await log.forDay(new Date('2026-10-05T15:00:00Z'))).length, 0);
});

test('file set-aside log appends JSONL and scopes reads to the day', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'social-set-aside-'));
  const file = path.join(dir, 'log.jsonl');
  const log = createFileSetAsideLog({ path: file });
  assert.deepEqual(await log.forDay(NOW), []);
  await log.record({ storyId: 'a', stage: 'editor', reasonCode: 'malformed-output', detail: 'x' }, NOW);
  await log.record({ storyId: 'b', stage: 'design', reasonCode: 'render-failed', detail: 'y' }, new Date('2026-10-06T15:00:00Z'));
  const today = await log.forDay(NOW);
  assert.deepEqual(today.map((e) => e.storyId), ['a']);
  assert.equal((await fsp.readFile(file, 'utf8')).trim().split('\n').length, 2);
  await fsp.rm(dir, { recursive: true, force: true });
});

// ── Boundary guards (plan M0 accept; Reels boundary) ───────────────────

/** Modules removed by the rebuild (plan §Leave behind). Nothing may import them. */
const LEFT_BEHIND = [
  'social/editorial/v2/orchestrate',
  'social/editorial/v2/field-repair',
  'social/editorial/v2/fact-check-cut',
  'social/editorial/v2/jev-gate',
  'social/editorial/v2/caption',
  'social/editorial/v2/enforce-structure',
  'social/editorial/v2/test-runner-support',
  'social/ingest/extract-packet',
  'social/ingest/shadow-haiku-judge',
  'social/pipeline/generate',
  'social/editorial/strategy',
  'social/editorial/copy',
  'social/editorial/fact-sheet',
  'social/editorial/story-plan',
  'social/editorial/hook-mine',
  'social/editorial/archetype',
  'social/editorial/qa',
  'social/editorial/polish',
  'social/editorial/repair',
  'social/photos/subjects',
  'social/photos/picker',
  'social/render/layout-picker',
  'social/render/photo-assigner',
];

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fsp.readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await sourceFiles(p)));
    else if (/\.(ts|tsx|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const IMPORT_RE = /(?:from\s+|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g;

function importsOf(text: string): string[] {
  return [...text.matchAll(IMPORT_RE)].map((m) => m[1]!);
}

test('no file imports a left-behind module', async () => {
  const root = process.cwd();
  const files = (await Promise.all(['lib', 'app', 'scripts', 'tests'].map((d) => sourceFiles(path.join(root, d))))).flat();
  const hits: string[] = [];
  for (const f of files) {
    for (const spec of importsOf(await fsp.readFile(f, 'utf8'))) {
      const normalized = spec.replace(/\.(ts|tsx|js)$/, '');
      if (LEFT_BEHIND.some((m) => normalized.endsWith(m) || normalized.endsWith(`${m}/index`))) {
        hits.push(`${path.relative(root, f)} → ${spec}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test('nothing under lib/social imports Trial Reels code', async () => {
  const root = process.cwd();
  const files = await sourceFiles(path.join(root, 'lib', 'social'));
  const hits: string[] = [];
  for (const f of files) {
    for (const spec of importsOf(await fsp.readFile(f, 'utf8'))) {
      if (/(^|\/)lib\/reels(\/|$)/.test(spec)) hits.push(`${path.relative(root, f)} → ${spec}`);
    }
  }
  assert.deepEqual(hits, []);
});
