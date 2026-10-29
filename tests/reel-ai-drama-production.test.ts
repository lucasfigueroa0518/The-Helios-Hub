import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type { Queryable } from '@/lib/explainers/db';
import type { SessionResult } from '@/lib/explainers/render/agent';
import { localArtifactStore } from '@/lib/explainers/storage';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { labData } from '@/lib/reel-ai-drama/lab';
import { cutLines, draftProblems, reconcilePlan } from '@/lib/reel-ai-drama/production/draft';
import { addFlag, claimNextJob, failStaleJobs, finishJob, getJob, getPitch, listArtifacts, requestJob, setStage } from '@/lib/reel-ai-drama/production/jobs';
import { calibrateRoute, developRoute, labRoute, makeRoute, settingsPostRoute } from '@/lib/reel-ai-drama/production/routes';
import { runJob, type ProductionDeps } from '@/lib/reel-ai-drama/production/run';
import { slotsOpen, weekStart, weeklyTick } from '@/lib/reel-ai-drama/production/schedule';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS, saveSetting } from '@/lib/reel-ai-drama/settings';
import type { DirectorPlan, FactSheet, Pitch, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';

import { scratchExplainersDb } from './explainers-pglite';

// ── Fixtures (canned; nothing here calls a model, a search, HeyGen or the network) ──────────────

async function freshDb() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}

const PITCH: Pitch = {
  title: 'The fixture deal',
  logline: 'A founder wants the deal. The board says no.',
  pitch: 'A fixture pitch.',
  story_type: 'deal',
  era: 'race',
  event_date: '2023-11-17',
  date_precision: 'day',
  cast: [{ name: 'Founder', role: 'CEO', kind: 'person', player_id: null, want: 'the deal' }],
  central_figure: 'Founder',
  scene: 'a call on a Friday',
  turn: 'the board fires him',
  implication: 'governance matters',
  why_now: null,
  engine: 'countdown',
  expected_visuals: [],
  sources: [{ url: 'https://example.com/a', title: 'A', publisher: 'Ex', date: null }],
};

const FACTS: FactSheet = {
  summary: 'It happened.',
  timeline: [],
  facts: [{ id: 'F1', text: 'It happened.', source_ids: ['S1'], key: true, confidence: 'confirmed' }],
  sources: [{ id: 'S1', url: 'https://example.com/a', title: 'A', publisher: 'Ex', date: null, kind: 'news' }],
  quotes: [],
  artifacts: [],
  cast: [],
  places: [],
  verdict: { holds: true, reason: 'The core holds.' },
};

const asset = (id: string, extra: Partial<VisualsInventory['assets'][number]> = {}): VisualsInventory['assets'][number] => ({
  id,
  kind: 'person_photo',
  file: `media/${id}.jpg`,
  url: `https://example.com/${id}.jpg`,
  source_page: null,
  credit: 'Ex',
  license: null,
  shows: `photo ${id}`,
  people: [],
  qids: [],
  place: null,
  date_taken: null,
  date_confidence: 'unknown',
  width: 1080,
  height: 1920,
  phash: null,
  character_image: false,
  made: false,
  upscaled: false,
  flags: [],
  ...extra,
});

const INVENTORY: VisualsInventory = {
  assets: [asset('V1', { phash: 'p1', flags: ['key_moment'] }), asset('V2', { character_image: true }), asset('V3')],
  usable_count: 20,
  counts: {},
  kill: null,
  usd: 0,
};

const line = (id: string, text: string) => ({ id, text, on_screen: null, fact_ids: ['F1'], must_show: null });
const DRAFT: WriterDraft = {
  title: 'The fixture deal',
  engine: 'countdown',
  hook: { on_screen: 'FIRED', line_id: 'L1' },
  rungs: [
    { id: 'R1', purpose: 'setup', lines: [line('L1', 'He wanted the deal.'), line('L2', 'The board met.')] },
    { id: 'R2', purpose: 'turn', lines: [line('L3', 'They fired him.')] },
  ],
  turn_rung_id: 'R2',
  landing_rung_id: 'R2',
  close_question: 'Would you have signed?',
  word_count: 11,
};

const frame = (n: number, lineIds: string[], assetIds: string[]) => ({
  n,
  name: `F${n}`,
  line_ids: lineIds,
  treatment: 'photo',
  asset_ids: assetIds,
  purpose: `purpose ${n}`,
  motion: 'push',
  marks: '',
  sound: '',
  music: 'hold' as const,
  on_screen: null,
});
// V1 returns in frame 3 with the same job (MD-46: an image may repeat when it says the same thing again).
// Staging varies (a place, a map, a portrait), so no type repeats even after a cut (the variety check, MD-60, stays quiet).
const PLAN: DirectorPlan = { frames: [frame(1, ['L1'], ['V1']), { ...frame(2, ['L2'], ['V2']), treatment: 'map' }, { ...frame(3, ['L3'], ['V1']), purpose: 'purpose 1', shows: [{ person: 'A. Founder', asset_id: 'V1', treatment: 'photo' }] }], lines_back: [] };

async function insertPitch(db: Queryable, title = 'The fixture deal', status = 'pooled', rank = 0.9): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, status, rank_score, drama_score, material_score, visuals_grade, drama, visuals_card)
     VALUES ($1, $2::jsonb, $3, $4, $5, 0.8, 0.7, 'green', $6::jsonb, $7::jsonb) RETURNING id`,
    [
      title,
      JSON.stringify({ ...PITCH, title }),
      `key:${title}`,
      status,
      rank,
      JSON.stringify({ score: 0.8, notes: { central_want: 'clear' } }),
      JSON.stringify({ grade: 'green', faces: [], specific_count: 4, kinds: ['person_photo'], counts: {}, gaps: ['no map'], sample: [], usd: 0.1 }),
    ],
  );
  return rows[0].id;
}

const session = (usd = 0): SessionResult => ({ sessionId: 's', subtype: 'success', isError: false, totalCostUsd: usd, modelUsage: {}, capped: false, denials: [], errors: [], lastText: '' });
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Overrides = { [K in keyof ProductionDeps]?: Partial<ProductionDeps[K]> };

/** Every builder stubbed; `calls` records the order. */
function stubDeps(db: Queryable, over: Overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-prod-'));
  const calls: string[] = [];
  const seen: Record<string, unknown[]> = {};
  const note = (name: string, arg?: unknown) => {
    calls.push(name);
    (seen[name] ??= []).push(arg);
  };
  const deps: ProductionDeps = {
    db,
    store: localArtifactStore(path.join(root, 'storage')),
    jobsRoot: path.join(root, 'jobs'),
    secrets: { anthropicApiKey: 'test', heygenApiKey: 'test' },
    voiceId: 'voice-1',
    prompts: (name) => `PROMPT:${name}`,
    jev: () => ({ callCount: 0, ask: async () => { throw new Error('no live Jev in tests'); } }) as unknown as DramaJevRunner,
    pool: { nextForProduction: async () => (note('nextForProduction'), null), ...over.pool },
    reporting: { reportStory: async () => (note('reportStory'), clone(FACTS)), ...over.reporting },
    harvest: {
      harvestVisuals: async (i) => {
        note('harvestVisuals', i);
        fs.mkdirSync(path.join(i.jobDir, 'media'), { recursive: true });
        fs.writeFileSync(path.join(i.jobDir, 'media', 'V1.jpg'), 'jpg');
        return clone(INVENTORY);
      },
      recordUses: async (_db, _jobId, uses) => note('recordUses', uses),
      ...over.harvest,
    },
    writing: {
      writeScript: async () => (note('writeScript'), clone(DRAFT)),
      reviseScript: async (i) => (note('reviseScript', i), clone(i.draft)),
      directReel: async (i) => (note('directReel', i), clone(PLAN)),
      writePost: async (i) => (note('writePost', i), { caption: 'cap', credits: ['Ex'], question: 'q?' }),
      ...over.writing,
    },
    checks: {
      checkFacts: async () => (note('checkFacts'), { unsupported: [] }),
      checkIntegrity: async () => (note('checkIntegrity'), { problems: [] }),
      checkFirstViewer: async () => (note('checkFirstViewer'), { hookSeconds: 1, understood: true, problems: [] }),
      ...over.checks,
    },
    render: {
      kitGuide: 'KIT',
      prepareWorkspace: async ({ jobsRoot, jobId }) => {
        note('prepareWorkspace');
        const jobDir = path.join(jobsRoot, jobId);
        fs.rmSync(jobDir, { recursive: true, force: true });
        const ws = { jobDir, projectDir: path.join(jobDir, 'project'), homeDir: path.join(jobDir, 'home'), tmpDir: path.join(jobDir, 'tmp') };
        for (const d of [ws.projectDir, ws.homeDir, ws.tmpDir]) fs.mkdirSync(d, { recursive: true });
        return ws;
      },
      writeProjectFiles: (dir, i) => {
        note('writeProjectFiles', i);
        fs.writeFileSync(path.join(dir, 'SCRIPT.md'), '# script');
        fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), '# storyboard');
      },
      runVoice: async () => note('runVoice'),
      assembleProject: async () => (note('assembleProject'), { ok: true, problems: [] }),
      renderVideo: async (dir) => {
        note('renderVideo');
        const f = path.join(dir, 'renders', 'video.mp4');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'mp4');
        return f;
      },
      contactSheet: async (dir) => {
        note('contactSheet');
        const f = path.join(dir, 'snapshots', 'contact-sheet.png');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'png');
        return f;
      },
      videoSeconds: async () => 62,
      ...over.render,
    },
    agent: {
      runSession: async (i) => {
        note(`session:${i.prompt.split('\n')[0]}`, i);
        i.log({ type: 'stub_session' });
        i.meter.settleSession(0);
        return session();
      },
      ...over.agent,
    },
  };
  return { deps, calls, seen, root };
}

async function queuedJob(db: Queryable, title?: string, trigger: 'auto' | 'click' = 'click') {
  const pitchId = await insertPitch(db, title);
  const req = await requestJob(db, { pitchId, trigger, settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  const job = await claimNextJob(db);
  assert.ok(job);
  return { pitchId, job };
}

// ── Jobs ────────────────────────────────────────────────────────────────────

test('job state transitions move the pitch with the job', async () => {
  const db = await freshDb();
  const pitchId = await insertPitch(db);
  const req = await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS });
  assert.ok(req.ok);
  assert.equal((await getPitch(db, pitchId))?.status, 'picked');
  assert.deepEqual(await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS }), { ok: false, reason: 'not_makeable' });
  assert.deepEqual(await requestJob(db, { pitchId: '00000000-0000-0000-0000-000000000000', trigger: 'click', settings: DEFAULT_SETTINGS }), { ok: false, reason: 'not_found' });

  const job = await claimNextJob(db);
  assert.equal(job?.status, 'running');
  assert.equal(job?.stage, 'pick');
  assert.equal(job?.spend_cap_usd, 8);
  assert.equal(job?.models.orchestrator, DEFAULT_SETTINGS.orchestrator_model);
  assert.equal(await claimNextJob(db), null);
  await setStage(db, job!.id, 'writer');
  await addFlag(db, job!.id, { check: 'facts', detail: 'one' });
  const mid = await getJob(db, job!.id);
  assert.equal(mid?.stage, 'writer');
  assert.equal(mid?.flags[0].check, 'facts');

  await finishJob(db, job!.id, { status: 'failed', error: 'x' });
  assert.equal((await getPitch(db, pitchId))?.status, 'pooled');

  await requestJob(db, { pitchId, trigger: 'auto', settings: DEFAULT_SETTINGS });
  const second = await claimNextJob(db);
  await finishJob(db, second!.id, { status: 'killed', killReason: 'too_few_visuals' });
  const killed = await getPitch(db, pitchId);
  assert.equal(killed?.status, 'killed');
  assert.equal(killed?.reject_reason, 'too_few_visuals');
  assert.equal((await getJob(db, second!.id))?.kill_reason, 'too_few_visuals');
  assert.deepEqual(await requestJob(db, { pitchId, trigger: 'click', settings: DEFAULT_SETTINGS }), { ok: false, reason: 'not_makeable' });

  const other = await insertPitch(db, 'Other');
  await requestJob(db, { pitchId: other, trigger: 'click', settings: DEFAULT_SETTINGS });
  const third = await claimNextJob(db);
  assert.equal(await failStaleJobs(db, 'restart'), 0, 'a job that just started may belong to another worker');
  assert.equal(await failStaleJobs(db, 'restart', 0), 1);
  assert.equal((await getJob(db, third!.id))?.status, 'failed');

  await requestJob(db, { pitchId: other, trigger: 'click', settings: DEFAULT_SETTINGS });
  const fourth = await claimNextJob(db);
  await finishJob(db, fourth!.id, { status: 'ok' });
  assert.equal((await getPitch(db, other))?.status, 'made');
  assert.equal((await requestJob(db, { pitchId: other, trigger: 'auto', settings: DEFAULT_SETTINGS })).ok, false);
  assert.equal((await requestJob(db, { pitchId: other, trigger: 'click', settings: DEFAULT_SETTINGS })).ok, true);
  assert.deepEqual(await requestJob(db, { pitchId: other, trigger: 'click', settings: DEFAULT_SETTINGS }), { ok: false, reason: 'not_makeable' });
});

// ── The run ─────────────────────────────────────────────────────────────────

test('a stubbed run goes from pitch to ok with every stage in order and artifacts written', async () => {
  const db = await freshDb();
  const { pitchId, job } = await queuedJob(db);
  const { deps, calls, seen } = stubDeps(db);
  const out = await runJob(deps, job);
  assert.deepEqual(out, { status: 'ok' });
  const order = calls.filter((c) => c !== 'harvestVisuals');
  assert.deepEqual(order, [
    'reportStory',
    'writeScript',
    'directReel',
    'checkFacts',
    'prepareWorkspace',
    'writeProjectFiles',
    'runVoice',
    'checkIntegrity',
    'session:PROMPT:build-workflow',
    'assembleProject',
    'renderVideo',
    'contactSheet',
    'checkFirstViewer',
    'writePost',
    'recordUses',
  ]);
  assert.ok(calls.indexOf('harvestVisuals') < calls.indexOf('writeScript'));

  const done = await getJob(db, job.id);
  assert.equal(done?.status, 'ok');
  assert.equal(done?.stage, 'deliver');
  assert.equal((await getPitch(db, pitchId))?.status, 'made');
  const kinds = new Set((await listArtifacts(db, job.id)).map((a) => a.kind));
  for (const k of ['fact_sheet', 'inventory', 'writer_draft', 'director_plan', 'facts_check', 'script_md', 'storyboard_md', 'integrity_check', 'breakage', 'first_viewer', 'video', 'contact_sheet', 'post_text', 'delivery_report', 'transcript_log'] as const) {
    assert.ok(kinds.has(k), `artifact ${k}`);
  }
  const report = JSON.parse((await listArtifacts(db, job.id)).find((a) => a.kind === 'delivery_report')!.content!);
  assert.equal(report.seconds, 62);
  assert.deepEqual(report.usd_unknown_parts, ['voice']);
  assert.ok(report.video.endsWith('video.mp4'));
  // The harvest's media landed in the job dir the project files read.
  assert.ok(fs.existsSync(path.join(deps.jobsRoot, job.id, 'media', 'V1.jpg')));

  // recordUses: each shown asset once, keyed by phash else URL; the character image marked.
  const uses = seen.recordUses[0] as { assetKey: string; purpose: string; characterImage: boolean }[];
  assert.deepEqual(uses.map((u) => [u.assetKey, u.characterImage]), [
    ['p1', false],
    ['https://example.com/V2.jpg', true],
  ]);
  assert.deepEqual((seen.writePost[0] as { usedAssetIds: string[] }).usedAssetIds, ['V1', 'V2']);
});

test('a reporting kill kills the job and the pitch, and queues the next pitch', async () => {
  const db = await freshDb();
  const { pitchId, job } = await queuedJob(db, 'First', 'auto');
  const nextId = await insertPitch(db, 'Second', 'pooled', 0.5);
  const { deps, calls } = stubDeps(db, {
    reporting: { reportStory: async () => ({ ...clone(FACTS), verdict: { holds: false, reason: 'The core does not hold.' } }) },
    pool: { nextForProduction: async () => getPitch(db, nextId) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'killed');
  assert.equal(out.status === 'killed' && out.killReason, 'facts_dont_hold');
  assert.ok(!calls.includes('writeScript'));
  assert.equal((await getJob(db, job.id))?.status, 'killed');
  assert.equal((await getPitch(db, pitchId))?.status, 'killed');
  assert.equal((await getPitch(db, nextId))?.status, 'picked');
  const next = await claimNextJob(db);
  assert.equal(next?.pitch_id, nextId);
  assert.equal(out.status === 'killed' && out.nextJobId, next?.id);
});

test('a harvest kill kills the job and the pitch, and queues the next pitch', async () => {
  const db = await freshDb();
  const { pitchId, job } = await queuedJob(db, 'First', 'auto');
  const nextId = await insertPitch(db, 'Second', 'pooled', 0.5);
  const { deps, calls } = stubDeps(db, {
    harvest: { harvestVisuals: async () => ({ ...clone(INVENTORY), usable_count: 9, kill: { reason: 'too_few_visuals' } }) },
    pool: { nextForProduction: async () => getPitch(db, nextId) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status === 'killed' && out.killReason, 'too_few_visuals');
  assert.ok(!calls.includes('writeScript'));
  assert.equal((await getPitch(db, pitchId))?.reject_reason, 'too_few_visuals');
  assert.equal((await claimNextJob(db))?.pitch_id, nextId);

  // Under min_visuals with no kill from the harvest still kills (MD-33).
  const db2 = await freshDb();
  const { job: job2 } = await queuedJob(db2);
  const { deps: deps2 } = stubDeps(db2, { harvest: { harvestVisuals: async () => ({ ...clone(INVENTORY), usable_count: 3 }) } });
  const out2 = await runJob(deps2, job2);
  assert.equal(out2.status === 'killed' && out2.killReason, 'too_few_visuals');
});

test('the director sends lines back once: one revise round, then the script locks', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const back = [{ line_id: 'L2', why: 'no picture', suggestion: 'say what we see' }];
  let directs = 0;
  const { deps, calls } = stubDeps(db, { writing: { directReel: async () => (directs++, { ...clone(PLAN), lines_back: back }) } });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'ok');
  assert.equal(calls.filter((c) => c === 'reviseScript').length, 1);
  assert.equal(directs, 2);
});

test('an unsupported line gets one fix, then is cut and the plan follows', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let factCalls = 0;
  const { deps, calls, seen } = stubDeps(db, {
    checks: { checkFacts: async () => (factCalls++, { unsupported: [{ line_id: 'L2', why: 'no source says the board met' }] }) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'ok');
  assert.equal(factCalls, 2);
  assert.equal(calls.filter((c) => c === 'reviseScript').length, 1);
  const written = seen.writeProjectFiles[0] as { draft: WriterDraft; plan: DirectorPlan };
  assert.deepEqual(written.draft.rungs.flatMap((r) => r.lines.map((l) => l.id)), ['L1', 'L3']);
  assert.deepEqual(written.plan.frames.map((f) => [f.n, f.line_ids]), [
    [1, ['L1']],
    [2, ['L3']],
  ]);
  const flags = (await getJob(db, job.id))!.flags;
  assert.equal(flags.length, 1);
  assert.equal(flags[0].check, 'facts');
  assert.match(flags[0].detail, /Cut line L2/);
});

test('integrity and the first viewer get one fix; measured breakage gets two rebuilds (and one after the first-viewer fix), then ships flagged', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, calls, seen } = stubDeps(db, {
    checks: {
      checkIntegrity: async () => ({ problems: [{ frame: 2, asset_id: 'V2', why: 'the photo shows someone else' }] }),
      checkFirstViewer: async () => ({ hookSeconds: 3, understood: false, problems: ['lost at frame 2'] }),
    },
    render: { assembleProject: async () => ({ ok: true, problems: ['frame 2: caption overlaps a face'] }) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'ok');
  // Integrity: the director re-asked once for frame 2.
  const directs = (seen.directReel as { fix?: { problems: unknown[] } }[]).filter((d) => d.fix);
  assert.equal(directs.length, 1);
  // Sessions: the build, two breakage rebuilds (MD-58), the first-viewer fix, one rebuild after it.
  assert.deepEqual(
    calls.filter((c) => c.startsWith('session:')),
    ['session:PROMPT:build-workflow', 'session:PROMPT:fix', 'session:PROMPT:fix', 'session:PROMPT:fix', 'session:PROMPT:fix'],
  );
  assert.equal(calls.filter((c) => c === 'renderVideo').length, 2);
  const checks = (await getJob(db, job.id))!.flags.map((f) => f.check);
  assert.ok(checks.includes('integrity'));
  assert.ok(checks.includes('breakage'));
  assert.ok(checks.includes('first_viewer'));
  assert.equal(checks.filter((c) => c === 'integrity').length, 1);
});

test('the spend cap stops the job as capped', async () => {
  const db = await freshDb();
  const { pitchId, job } = await queuedJob(db);
  const { deps, calls } = stubDeps(db, {
    writing: {
      writeScript: async (_i, ctx) => {
        await recordCost(db, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'anthropic', component: 'writer', usd: 9 });
        return clone(DRAFT);
      },
    },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'failed');
  assert.equal(out.status === 'failed' && out.capped, true);
  assert.ok(!calls.includes('directReel'));
  const done = await getJob(db, job.id);
  assert.equal(done?.capped, true);
  assert.equal(done?.flags[0].check, 'cost');
  assert.equal((await getPitch(db, pitchId))?.status, 'pooled');
});

test('a capped agent session fails the job as capped', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps } = stubDeps(db, { agent: { runSession: async () => ({ ...session(8.5), capped: true }) } });
  const out = await runJob(deps, job);
  assert.equal(out.status === 'failed' && out.capped, true);
  assert.equal((await getJob(db, job.id))?.spend_usd, 8.5);
});

test('the cut keeps the script valid, and an empty script is refused', () => {
  const cut = cutLines(DRAFT, ['L3']);
  assert.equal(cut.turn_rung_id, 'R1');
  assert.deepEqual(draftProblems(cut), []);
  assert.deepEqual(draftProblems(cutLines(DRAFT, ['L1', 'L2', 'L3'])), ['The script has no lines left.']);
  const hookCut = cutLines(DRAFT, ['L1']);
  assert.equal(hookCut.hook.line_id, 'L2');
  const plan = reconcilePlan(hookCut, { frames: [...PLAN.frames, frame(4, [], [])], lines_back: [] });
  assert.deepEqual(plan.frames.map((f) => f.line_ids), [['L2'], ['L3'], []]);
});

// ── The weekly clock ───────────────────────────────────────────────────────

function scheduleDeps(db: Queryable) {
  const log: string[] = [];
  return {
    log,
    deps: {
      db,
      runDevelopmentSession: async () => {
        log.push('develop');
        await db.query(`INSERT INTO reel_ai_drama.sessions (status, mode, trigger) VALUES ('ok', 'development', 'auto')`);
      },
      tendPool: async () => (log.push('tend'), { faded: 0, rechecked: 0 }),
      nextForProduction: async (d: Queryable) => {
        const { rows } = await d.query<{ id: string }>(`SELECT id FROM reel_ai_drama.pitches WHERE status = 'pooled' ORDER BY rank_score DESC LIMIT 1`);
        return rows[0] ? getPitch(d, rows[0].id) : null;
      },
    },
  };
}

test('weekStart is Monday midnight in New York, and slots spread over the week', () => {
  const start = weekStart(new Date('2026-10-28T15:00:00Z')); // a Wednesday
  assert.equal(start.toISOString(), '2026-10-26T04:00:00.000Z');
  assert.equal(weekStart(new Date('2026-11-04T15:00:00Z')).toISOString(), '2026-11-02T05:00:00.000Z'); // after DST ends
  assert.equal(slotsOpen(3, start, new Date(start.getTime() + 3600_000)), 1);
  assert.equal(slotsOpen(3, start, new Date(start.getTime() + 2.4 * 86_400_000)), 2);
  assert.equal(slotsOpen(3, start, new Date(start.getTime() + 6 * 86_400_000)), 3);
  assert.equal(slotsOpen(0, start, start), 0);
});

test('weeklyTick does nothing while auto is off', async () => {
  const db = await freshDb();
  await insertPitch(db);
  const { deps, log } = scheduleDeps(db);
  const out = await weeklyTick(deps, new Date('2026-10-28T15:00:00Z'));
  assert.equal(out.auto, false);
  assert.deepEqual(log, []);
  assert.deepEqual(out.requested, []);
});

test('weeklyTick: one development session a week under the cap; per_week jobs spread, kills replaced', async () => {
  const db = await freshDb();
  await saveSetting(db, 'auto', true);
  for (const [i, t] of ['A', 'B', 'C', 'D'].entries()) await insertPitch(db, t, 'pooled', 1 - i / 10);
  const { deps, log } = scheduleDeps(db);
  const monday = new Date('2026-10-26T05:00:00Z'); // Monday 01:00 New York

  const first = await weeklyTick(deps, monday);
  assert.equal(first.development, 'ran');
  assert.deepEqual(log, ['tend', 'develop']);
  assert.equal(first.requested.length, 1);
  const again = await weeklyTick(deps, new Date(monday.getTime() + 3600_000));
  assert.equal(again.development, 'already_ran');
  assert.equal(again.requested.length, 0);

  // A killed job doesn't hold its slot.
  const killed = await claimNextJob(db);
  await finishJob(db, killed!.id, { status: 'killed', killReason: 'too_few_visuals' });
  const refill = await weeklyTick(deps, new Date(monday.getTime() + 2 * 3600_000));
  assert.equal(refill.requested.length, 1);

  // Saturday: all three slots open; two more are queued, then the pool's fourth pitch is left.
  const saturday = await weeklyTick(deps, new Date(monday.getTime() + 5 * 86_400_000));
  assert.equal(saturday.jobsDue, 3);
  assert.equal(saturday.requested.length, 2);
  assert.equal((await weeklyTick(deps, new Date(monday.getTime() + 6 * 86_400_000))).requested.length, 0);
});

test('weeklyTick skips development once the week is spent', async () => {
  const db = await freshDb();
  await saveSetting(db, 'auto', true);
  await saveSetting(db, 'per_week', 0);
  await recordCost(db, { mode: 'development', vendor: 'anthropic', component: 'producer', usd: 3.2 });
  const { deps, log } = scheduleDeps(db);
  const out = await weeklyTick(deps, new Date());
  assert.equal(out.development, 'capped');
  assert.deepEqual(log, []);
  assert.equal(out.jobsDue, 0);
});

// ── The lab and its routes ─────────────────────────────────────────────────

test('labData shows the ranked pool, the ledger, jobs, costs, deliveries and calibration', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db, 'Made one');
  const { deps } = stubDeps(db);
  await runJob(deps, job);
  await insertPitch(db, 'Low', 'pooled', 0.2);
  await insertPitch(db, 'High', 'pooled', 0.95);
  await db.query(`INSERT INTO reel_ai_drama.cells (player_id, story_type, era) VALUES ('openai', 'deal', 'race')`);
  const { rows: [s] } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.sessions (status, mode, trigger) VALUES ('ok', 'development', 'click') RETURNING id`);
  await recordCost(db, { sessionId: s.id, mode: 'development', vendor: 'anthropic', component: 'producer', usd: 0.5 });
  const calibrationFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rad-cal-')), 'latest.json');
  fs.writeFileSync(calibrationFile, JSON.stringify({ at: '2026-10-28T00:00:00Z', report: { ok: true } }));

  const lab = await labData(db, { calibrationFile });
  assert.deepEqual(lab.pool.filter((p) => p.status === 'pooled').map((p) => p.title), ['High', 'Low']);
  const high = lab.pool[0];
  assert.equal(high.centralFigure, 'Founder');
  assert.equal(high.storyType, 'deal');
  assert.equal(high.visuals?.grade, 'green');
  assert.deepEqual(high.visuals?.gaps, ['no map']);
  assert.equal(high.drama.notes.central_want, 'clear');
  assert.equal(lab.ledger.total, 1);
  assert.equal(lab.ledger.cells[0].playerId, 'openai');
  assert.equal(lab.sessions[0].usd, 0.5);
  assert.equal(lab.costs.devWeekUsd, 0.5);
  assert.equal(lab.jobs[0].status, 'ok');
  assert.ok(lab.jobs[0].videoId);
  assert.equal(lab.deliveries.length, 1);
  assert.equal(lab.deliveries[0].post?.caption, 'cap');
  assert.deepEqual(lab.calibration, { at: '2026-10-28T00:00:00Z', report: { ok: true } });
});

test('route handlers: session check, make, settings, develop under the cap, calibrate', async () => {
  const db = await freshDb();
  const ok = { session: async () => ({ email: 't' }), db: async () => db };
  const json = (body: unknown) => new Request('http://x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.equal((await labRoute({ session: async () => null, db: async () => db })).status, 401);
  const lab = await labRoute({ ...ok, calibrationFile: '/nonexistent/latest.json' });
  assert.equal(lab.status, 200);
  const body = (await lab.json()) as Record<string, unknown>;
  for (const k of ['settings', 'pool', 'ledger', 'sessions', 'jobs', 'costs', 'deliveries', 'calibration']) assert.ok(k in body, k);

  assert.equal((await makeRoute(json({ pitchId: 'nope' }), ok)).status, 400);
  const pitchId = await insertPitch(db);
  const made = await makeRoute(json({ pitchId }), ok);
  assert.equal(made.status, 200);
  assert.equal(((await made.json()) as { ok: boolean }).ok, true);
  assert.equal((await makeRoute(json({ pitchId }), ok)).status, 409);

  assert.equal((await settingsPostRoute(json({ key: 'nope', value: 1 }), ok)).status, 400);
  assert.equal((await settingsPostRoute(json({ key: 'visuals_check_cap_usd', value: 0.9 }), ok)).status, 400);
  const saved = await settingsPostRoute(json({ key: 'per_week', value: 2 }), ok);
  assert.equal(((await saved.json()) as { settings: { per_week: number } }).settings.per_week, 2);

  let developed = 0;
  const dev = await developRoute(json({}), { ...ok, develop: async () => (developed++, { pitches: 3 }) });
  assert.equal(dev.status, 200);
  assert.equal(developed, 1);
  await recordCost(db, { mode: 'development', vendor: 'anthropic', component: 'producer', usd: 3 });
  assert.equal((await developRoute(json({}), { ...ok, develop: async () => (developed++, {}) })).status, 409);
  assert.equal(developed, 1);

  const calibrationFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rad-cal-')), 'latest.json');
  const cal = await calibrateRoute(json({}), { ...ok, calibrate: async () => ({ ranked: ['a'] }), calibrationFile });
  assert.equal(cal.status, 200);
  assert.deepEqual(JSON.parse(fs.readFileSync(calibrationFile, 'utf8')).report, { ranked: ['a'] });
});

// ── Review fixes (planning/AI Mini Docs/notes/review.md) ──────────────────────

test('#3 #21 every revision gets the inventory; lines the facts fix rewrote re-plan only their frames', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let factCalls = 0;
  const { deps, seen } = stubDeps(db, {
    writing: {
      directReel: async (i) => {
        (seen.directReel ??= []).push(i);
        const p = clone(PLAN);
        if (i.fix) p.frames[1]!.motion = 'push to the new words';
        return p;
      },
      reviseScript: async (i) => {
        (seen.reviseScript ??= []).push(i);
        const d = clone(i.draft);
        d.rungs[0]!.lines[1]!.text = 'The board met that night.';
        return d;
      },
    },
    checks: { checkFacts: async () => ({ unsupported: factCalls++ === 0 ? [{ line_id: 'L2', why: 'no source says when' }] : [] }) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'ok');
  const revise = seen.reviseScript![0] as { inventory: VisualsInventory };
  assert.deepEqual(revise.inventory.assets.map((a) => a.id), ['V1', 'V2', 'V3']);
  const fixes = (seen.directReel as { fix?: { kind?: string; problems: { frame: number; why: string }[] } }[]).filter((d) => d.fix);
  assert.equal(fixes.length, 1);
  assert.equal(fixes[0]!.fix!.kind, 'script_revised');
  assert.deepEqual(fixes[0]!.fix!.problems.map((p) => p.frame), [2]);
  assert.match(fixes[0]!.fix!.problems[0]!.why, /L2 now reads "The board met that night\."/);
  const written = seen.writeProjectFiles![0] as { plan: DirectorPlan };
  assert.equal(written.plan.frames[1]!.motion, 'push to the new words');
  assert.equal(written.plan.frames[0]!.motion, 'push', 'other frames keep their plan');
});

test('#22 a cut hook line clears its words and flags the reel', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, seen } = stubDeps(db, {
    writing: { directReel: async () => ({ ...clone(PLAN), frames: clone(PLAN).frames.map((f) => (f.n === 1 ? { ...f, line_ids: ['L1', 'L2'], on_screen: 'FIRED' } : f)).filter((f) => f.n !== 2).map((f, i) => ({ ...f, n: i + 1 })) }) },
    checks: { checkFacts: async () => ({ unsupported: [{ line_id: 'L1', why: 'unsupported' }] }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  const written = seen.writeProjectFiles![0] as { draft: WriterDraft; plan: DirectorPlan };
  assert.deepEqual(written.draft.hook, { on_screen: '', line_id: 'L2' });
  assert.equal(written.plan.frames[0]!.on_screen, null);
  const flags = (await getJob(db, job.id))!.flags;
  assert.ok(flags.some((f) => f.check === 'facts' && /hook line was cut/.test(f.detail)));
});

test('#2 #27 a close question voiced too long is flagged, never stretched; first-viewer warnings ship without a fix', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, calls } = stubDeps(db, {
    render: {
      writeProjectFiles: (dir) => {
        fs.writeFileSync(path.join(dir, 'SCRIPT.md'), '# script');
        fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), '## Frame 1 — A\n\n- treatment: photo\n\n## Frame 2 — Close\n\n- treatment: close\n');
      },
      runVoice: async (dir) => {
        fs.writeFileSync(path.join(dir, 'audio_meta.json'), JSON.stringify({ voices: [{ frame: 1, duration_s: 3 }, { frame: 2, duration_s: 2.9 }] }));
      },
    },
    checks: { checkFirstViewer: async () => ({ hookSeconds: 1, understood: true, problems: [], warnings: ['The viewer would likely stop watching (2 of 5).'] }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(calls.filter((c) => c === 'session:PROMPT:fix').length, 0, 'warnings get no paid fix session');
  const flags = (await getJob(db, job.id))!.flags;
  assert.ok(flags.some((f) => f.check === 'voice' && /voiced in 2.9s/.test(f.detail)));
  assert.ok(flags.some((f) => f.check === 'first_viewer' && /2 of 5/.test(f.detail)));
});

test('variety gets one director fix round; the plan\'s makes are made into the inventory, a failed make falls back and is flagged', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const fixes: string[] = [];
  const samePhotos: DirectorPlan = { frames: [frame(1, ['L1'], ['V1']), frame(2, ['L2'], ['V2']), frame(3, ['L3'], ['V1'])], lines_back: [] };
  const withMakes: DirectorPlan = {
    ...clone(PLAN),
    frames: clone(PLAN).frames.map((f) => (f.n === 2 ? { ...f, asset_ids: ['M1'] } : f.n === 3 ? { ...f, asset_ids: ['M2'] } : f)),
    makes: [
      { id: 'M1', kind: 'setting', brief: 'a long table set for a private dinner', people: [], from_assets: [], seed: null },
      { id: 'M2', kind: 'expression', brief: 'the founder, worried', people: ['A. Founder'], from_assets: ['V1'], seed: null },
    ],
  };
  const made: unknown[] = [];
  const { deps, seen } = stubDeps(db, {
    writing: {
      directReel: async (i) => {
        fixes.push(i.fix?.kind ?? 'first');
        return clone(i.fix?.kind === 'variety' ? withMakes : samePhotos);
      },
    },
    render: {
      makeAssets: async (i) => {
        made.push(i.plan.makes);
        return { assets: [asset('M1', { made: true, made_kind: 'setting' })], usd: 0.04, problems: ['M2: the image model failed'] };
      },
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.deepEqual(fixes, ['first', 'variety']);
  assert.equal(made.length, 1);
  const written = seen.writeProjectFiles[0] as { plan: DirectorPlan; inventory: VisualsInventory };
  assert.ok(written.inventory.assets.some((a) => a.id === 'M1'), 'the made asset joins the inventory');
  assert.ok(!written.plan.frames.some((f) => f.asset_ids.includes('M2')), 'a failed make falls back to existing assets');
  const flags = (await getJob(db, job.id))!.flags;
  assert.ok(flags.some((f) => /Make: M2: the image model failed/.test(f.detail)));
});
