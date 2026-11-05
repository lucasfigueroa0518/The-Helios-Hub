import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import type Anthropic from '@anthropic-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import { localArtifactStore } from '@/lib/explainers/storage';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { viewerVerdict } from '@/lib/reel-ai-drama/checks/first-viewer';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { labData } from '@/lib/reel-ai-drama/lab';
import { cutLines, draftProblems, reconcilePlan } from '@/lib/reel-ai-drama/production/draft';
import { addArtifact, addFlag, claimNextJob, failStaleJobs, finishJob, getJob, getPitch, listArtifacts, requestJob, setStage } from '@/lib/reel-ai-drama/production/jobs';
import { calibrateRoute, developRoute, labRoute, makeRoute, settingsPostRoute } from '@/lib/reel-ai-drama/production/routes';
import { CAP_BACKSTOP, CONTENT_ITEMS, contentPassProblems, firstViewerRouting, runJob, withBlueprint, type ProductionDeps } from '@/lib/reel-ai-drama/production/run';
import type { SolverDeps, SolverKit } from '@/lib/reel-ai-drama/production/solver';
import { slotsOpen, weekStart, weeklyTick } from '@/lib/reel-ai-drama/production/schedule';
import type { Sheet } from '@/lib/reel-ai-drama/render/sheets';
import type { VoiceInput } from '@/lib/reel-ai-drama/render/voice';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS, saveSetting } from '@/lib/reel-ai-drama/settings';
import type { Blueprint, DirectorPlan, FactSheet, Pitch, StoryNotes, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import type { RevisionNote } from '@/lib/reel-ai-drama/writing/writer';

import { scratchExplainersDb } from './explainers-pglite';

// ── Fixtures (canned; nothing here calls a model, a search, HeyGen or the network) ──────────────

async function freshDb() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}

const PITCH: Pitch = {
  title: 'The fixture deal',
  brief: 'A founder wants the deal. The board says no.',
  story_type: 'deal',
  era: 'race',
  event_date: '2023-11-17',
  date_precision: 'day',
  cast: [{ name: 'Founder', role: 'CEO', kind: 'person', player_id: null }],
  why_now: null,
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
  hook: { on_screen: 'FIRED', line_id: 'L1' },
  rungs: [
    { id: 'R1', purpose: 'setup', lines: [line('L1', 'He wanted the deal.'), line('L2', 'The board met.')] },
    { id: 'R2', purpose: 'turn', lines: [line('L3', 'They fired him.')] },
  ],
  peak_rung_id: 'R2',
  landing_rung_id: 'R2',
  close_question: 'Would you have signed?',
  word_count: 11,
  central: ['Founder'],
};

const NO_NOTES: StoryNotes = { tell_back: 'A founder wants the deal; the board fires him.', notes: [] };

const frame = (n: number, lineIds: string[], assetIds: string[]) => ({
  n,
  name: `F${n}`,
  line_ids: lineIds,
  treatment: 'photo',
  asset_ids: assetIds,
  purpose: `purpose ${n}`,
  music: 'hold' as const,
  on_screen: null,
});
// Staging varies (a place, a map, a portrait), so no type repeats even after a cut (the variety check, MD-60, stays quiet).
const PLAN: DirectorPlan = { frames: [frame(1, ['L1'], ['V1']), { ...frame(2, ['L2'], ['V2']), treatment: 'map' }, { ...frame(3, ['L3'], ['V3']), purpose: 'purpose 3', shows: [{ person: 'A. Founder', asset_id: 'V3', treatment: 'photo' }] }], lines_back: [] };

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

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Overrides = { [K in keyof ProductionDeps]?: Partial<ProductionDeps[K]> };

/**
 * Iteration 11 §3: labelled sheets of each frame's moments for the reviewers and the solver, and with `viewer`, unlabelled
 * sheets of the whole reel (their moments say nothing) for the first viewer. `frames` null: every frame of the fixture.
 */
function stubSheets(dir: string, frames: number[] | null, viewer: boolean): { review: Sheet[]; viewer: Sheet[] } {
  const ns = frames ?? [1, 2, 3];
  const moment = (n: number, what: string) => ({ frame: n, id: `0${n}-f`, t: 1, reel_t: (n - 1) * 3 + 1, what, source: 'edge' as const });
  return {
    review: ns.map((n) => ({ frame: n, file: path.join(dir, `frame-${n}.jpg`), moments: [moment(n, `frame ${n} lands`)] })),
    viewer: viewer ? [{ frame: 1, file: path.join(dir, 'viewer-1.jpg'), moments: ns.map((n) => moment(n, '')) }] : [],
  };
}

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
      writeScript: async (i) => (note('writeScript', i), clone(DRAFT)),
      editStory: async (i) => (note('editStory', i), clone(NO_NOTES)),
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
      compileReel: async (i) => {
        note('compileReel', i);
        return { frames: i.plan.frames.map((f) => ({ n: f.n, id: `0${f.n}-f`, treatment: f.treatment, plain: (i.plain ?? []).includes(f.n) })), problems: [] };
      },
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
      reelSheets: async (_dir, _video, i) => (note('reelSheets', i), stubSheets(i.dir, i.frames, i.viewer)),
      videoSeconds: async () => 62,
      ...over.render,
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
    'editStory',
    'directReel',
    'checkFacts',
    'prepareWorkspace',
    'writeProjectFiles',
    'runVoice',
    'checkIntegrity',
    'compileReel',
    'assembleProject',
    'renderVideo',
    'contactSheet',
    'reelSheets',
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
  for (const k of ['fact_sheet', 'inventory', 'story_notes', 'writer_draft', 'director_plan', 'facts_check', 'script_md', 'storyboard_md', 'integrity_check', 'breakage', 'first_viewer', 'video', 'contact_sheet', 'post_text', 'delivery_report'] as const) {
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
    ['https://example.com/V3.jpg', false],
  ]);
  assert.deepEqual((seen.writePost[0] as { usedAssetIds: string[] }).usedAssetIds, ['V1', 'V2', 'V3']);
});

test('MD-65: a reporting doubt never stops the reel: it ships with a warning', async () => {
  const db = await freshDb();
  const { pitchId, job } = await queuedJob(db, 'First', 'auto');
  const { deps, calls } = stubDeps(db, {
    reporting: { reportStory: async () => ({ ...clone(FACTS), verdict: { holds: false, reason: 'The core does not hold.' } }) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'ok');
  assert.ok(calls.includes('writeScript'));
  assert.equal((await getPitch(db, pitchId))?.status, 'made');
  const flags = (await getJob(db, job.id))!.flags;
  assert.ok(flags.some((f) => f.check === 'reporting' && /The core does not hold/.test(f.detail)));
});

test('MD-65: thin visuals never stop the reel: it ships with a warning', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db, 'First', 'auto');
  const { deps, calls } = stubDeps(db, {
    harvest: { harvestVisuals: async () => ({ ...clone(INVENTORY), usable_count: 9, kill: { reason: 'too_few_visuals' } }) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'ok');
  assert.ok(calls.includes('writeScript'));
  assert.ok((await getJob(db, job.id))!.flags.some((f) => f.check === 'harvest' && /too_few_visuals/.test(f.detail)));
});

test('a resumed job reuses its kept fact sheet and inventory instead of reporting and harvesting again', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, calls } = stubDeps(db);
  const media = path.join(deps.jobsRoot, '_harvest', job.id, 'media');
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, 'V1.jpg'), 'jpg');
  await addArtifact(db, { jobId: job.id, kind: 'fact_sheet', content: JSON.stringify(FACTS) });
  await addArtifact(db, { jobId: job.id, kind: 'inventory', content: JSON.stringify(INVENTORY) });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.ok(!calls.includes('reportStory') && !calls.includes('harvestVisuals'));
  assert.ok(calls.includes('writeScript'));
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
  // The fixture's central founder has no portrait to cut out: MD-81's cutout and no-op flags; the facts check flags once.
  const all = (await getJob(db, job.id))!.flags;
  assert.ok(all.some((f) => f.check === 'render' && /^NO-OP: no cutout of Founder/.test(f.detail)));
  const flags = all.filter((f) => !/cutout|repeated_picture/i.test(f.detail));
  assert.equal(flags.length, 1);
  assert.equal(flags[0].check, 'facts');
  assert.match(flags[0].detail, /Cut line L2/);
});

test('Iteration 11 §4: the image check gets one pre_build fix, escalated once while the re-check still finds it; the first viewer\'s picture finding goes to the content pass; measured breakage ships flagged', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let checks = 0;
  let viewed = 0;
  const { deps, calls, seen } = stubDeps(db, {
    checks: {
      checkIntegrity: async () => (checks++, { problems: [{ frame: 2, asset_id: 'V2', why: 'the photo shows someone else' }] }),
      checkFirstViewer: async () => (viewed++, { hookSeconds: 3, understood: false, problems: ['lost at frame 2'] }),
    },
    render: { assembleProject: async () => ({ ok: true, problems: ['[caption_on_face] 02-f: caption overlaps a face'] }) },
  });
  const out = await runJob(deps, job);
  assert.equal(out.status, 'ok');
  const fixes = (seen.directReel as { fix?: { kind?: string; escalate?: boolean; problems: { frame: number; why: string }[] } }[]).filter((d) => d.fix);
  assert.deepEqual(fixes.map((d) => [d.fix!.kind, d.fix!.escalate ?? false]), [['pre_build', false], ['pre_build', true], ['content_pass', false]]);
  assert.deepEqual(fixes[0]!.fix!.problems.map((p) => p.frame), [2], 'only the named frame goes');
  assert.equal(checks, 3, 'the check, the re-check after the fix, the re-check after the escalation; then flags');
  // The hook finding names no frame: the opening carries it. "Lost at frame 2" and "not understood" are the words', so flags.
  assert.deepEqual(fixes[2]!.fix!.problems.map((p) => p.frame), [1]);
  assert.match(fixes[2]!.fix!.problems[0]!.why, /^The first viewer: The hook lands at 3s/);
  // The compile: every frame, then only the content pass's frame. The breakage is no dead frame: no plain recompile.
  assert.deepEqual((seen.compileReel as { only?: number[] }[]).map((c) => c.only ?? 'all'), ['all', [1]]);
  assert.equal(calls.filter((c) => c === 'renderVideo').length, 2);
  assert.equal(viewed, 2, 'the final read watches what ships');
  const flags = (await getJob(db, job.id))!.flags.filter((f) => !/repeated_picture/.test(f.detail));
  assert.deepEqual(flags.filter((f) => f.check === 'integrity').map((f) => f.detail), ['Frame 2 (V2): the photo shows someone else']);
  assert.ok(flags.some((f) => f.check === 'breakage' && /caption_on_face/.test(f.detail)));
  assert.ok(flags.some((f) => f.check === 'first_viewer' && /^Script: lost at frame 2/.test(f.detail)));
});

test('Iteration 11 §4: variety and the image check go to the director together, in one pre_build fix; a clean re-check needs no escalation', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const samePhotos: DirectorPlan = { frames: [frame(1, ['L1'], ['V1']), frame(2, ['L2'], ['V2']), frame(3, ['L3'], ['V1'])], lines_back: [] };
  let checks = 0;
  const { deps, seen } = stubDeps(db, {
    writing: { directReel: async (i) => ((seen.directReel ??= []).push(i), clone(i.fix ? PLAN : samePhotos)) },
    checks: { checkIntegrity: async () => ({ problems: checks++ === 0 ? [{ frame: 2, asset_id: 'V2', why: 'the photo shows someone else' }] : [] }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  const fixes = (seen.directReel as { fix?: { kind?: string; escalate?: boolean; problems: { frame: number; asset_id: string | null; why: string }[] } }[]).filter((d) => d.fix);
  assert.equal(fixes.length, 1, 'one call for both checks');
  assert.equal(fixes[0]!.fix!.kind, 'pre_build');
  assert.equal(fixes[0]!.fix!.escalate, undefined);
  const problems = fixes[0]!.fix!.problems;
  assert.ok(problems.some((p) => p.frame === 2 && p.why === 'the photo shows someone else'), 'the image check');
  assert.ok(problems.some((p) => p.frame !== 2 || p.why !== 'the photo shows someone else'), `and variety: ${JSON.stringify(problems)}`);
  assert.equal(checks, 2);
  assert.ok(!(await getJob(db, job.id))!.flags.some((f) => f.check === 'integrity' && /^(Frame 2|Variety)/.test(f.detail)), 'nothing left to flag');
});

test('MD-65: passing the cap warns and the reel goes on; only a runaway (2× the cap) stops it', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const over = (usd: number) => stubDeps(db, {
    writing: {
      writeScript: async (_i, ctx) => {
        await recordCost(db, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'anthropic', component: 'writer', usd });
        return clone(DRAFT);
      },
    },
  });
  const past = over(job.spend_cap_usd + 1);
  assert.equal((await runJob(past.deps, job)).status, 'ok');
  assert.ok(past.calls.includes('directReel'));
  assert.ok((await getJob(db, job.id))!.flags.some((f) => f.check === 'cost' && /kept going/.test(f.detail)));

  const db2 = await freshDb();
  const { job: job2 } = await queuedJob(db2);
  const runaway = stubDeps(db2, {
    writing: {
      writeScript: async (_i, ctx) => {
        await recordCost(db2, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'anthropic', component: 'writer', usd: job2.spend_cap_usd * CAP_BACKSTOP + 1 });
        return clone(DRAFT);
      },
    },
  });
  const out = await runJob(runaway.deps, job2);
  assert.equal(out.status === 'failed' && out.capped, true);
  assert.ok(!runaway.calls.includes('directReel'));
});

test('a runaway solver fails the job as capped; its spend is on the job', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, calls } = stubDeps(db);
  deps.solver = (ctx) =>
    solverDeps(ctx, db, async (params) => {
      await recordCost(db, { jobId: ctx.jobId, mode: ctx.mode, vendor: 'anthropic', component: 'solver_look', usd: job.spend_cap_usd * CAP_BACKSTOP + 1 });
      return lookAnswer(params, { 2: 'wrong' });
    }, quietKit());
  const out = await runJob(deps, job);
  assert.equal(out.status === 'failed' && out.capped, true);
  assert.ok(!calls.includes('writePost'), 'nothing after the look runs');
});

test('measure: a frame that will not build ships plain, recompiled alone, before anything else reads it', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let rounds = 0;
  const { deps, seen } = stubDeps(db, {
    render: {
      assembleProject: async () => {
        rounds += 1;
        return { ok: rounds > 1, problems: rounds === 1 ? ['try: 02-f: build failed: boom'] : [] };
      },
      readCompiled: () => ({ ok: true, frames: {}, stills: [] }),
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  const compiles = seen.compileReel as { only?: number[]; plain?: number[] }[];
  assert.deepEqual(compiles.map((c) => [c.only ?? 'all', c.plain]), [['all', [2]], [[2], [2]]], 'the plain list is shared, so the first entry shows it too');
  assert.equal(rounds, 2);
  assert.ok(!(await getJob(db, job.id))!.flags.some((f) => /build failed/.test(f.detail)), 'the plain frame measures clean: nothing stands');
});

test('the cut keeps the script valid, and an empty script is refused', () => {
  const cut = cutLines(DRAFT, ['L3']);
  assert.equal(cut.peak_rung_id, 'R1');
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
        if (i.fix) p.frames[1]!.purpose = 'push to the new words';
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
  assert.equal(written.plan.frames[1]!.purpose, 'push to the new words');
  assert.equal(written.plan.frames[0]!.purpose, 'purpose 1', 'other frames keep their plan');
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

test('#2 #27 a long close question stretches the close (no flag); the voice gets the tempo and silent-beat settings; a per-frame fallback is flagged; first-viewer warnings ship without a fix', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let voiced: unknown = null;
  const { deps, calls } = stubDeps(db, {
    render: {
      writeProjectFiles: (dir) => {
        fs.writeFileSync(path.join(dir, 'SCRIPT.md'), '# script');
        fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), '## Frame 1 — A\n\n- treatment: photo\n\n## Frame 2 — Close\n\n- treatment: close\n');
      },
      runVoice: async (dir, input) => {
        voiced = input;
        fs.writeFileSync(path.join(dir, 'audio_meta.json'), JSON.stringify({ voices: [{ frame: 1, duration_s: 3 }, { frame: 2, duration_s: 2.9 }] }));
        return { take: 'per_frame', takes: 0, notes: ['The one-take voice failed (no words); the frames were voiced one by one.'] };
      },
    },
    checks: { checkFirstViewer: async () => ({ hookSeconds: 1, understood: true, problems: [], warnings: ['The viewer would likely stop watching (2 of 5).'] }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(calls.filter((c) => c === 'renderVideo').length, 1, 'warnings get no re-plan');
  assert.deepEqual({ tempo: (voiced as VoiceInput).tempo, silentBeatMax: (voiced as VoiceInput).silentBeatMax }, { tempo: 1.12, silentBeatMax: 0.15 });
  const flags = (await getJob(db, job.id))!.flags;
  assert.ok(!flags.some((f) => f.check === 'voice' && /voiced in/.test(f.detail)), 'the close stretches to the question');
  assert.ok(flags.some((f) => f.check === 'voice' && /voiced one by one/.test(f.detail)));
  assert.ok(flags.some((f) => f.check === 'first_viewer' && /2 of 5/.test(f.detail)));
});

test('M11: first-viewer findings that start in the words ship as flags and never reach the picture-only fix', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const told = viewerVerdict({ hook_seconds: 1, muted_followed: true, story_in_my_words: 'a merger', want_next: 'more', keep_watching: 4, confused: [] }, 0.1, 1.5);
  const { deps, calls } = stubDeps(db, { checks: { checkFirstViewer: async () => told } });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(calls.filter((c) => c === 'renderVideo').length, 1, 'nothing for the picture to fix');
  const flags = (await getJob(db, job.id))!.flags.filter((f) => f.check === 'first_viewer').map((f) => f.detail);
  assert.ok(flags.some((d) => /^Script: The viewer told the story as: "a merger"/.test(d)), flags.join('\n'));
  assert.ok(flags.some((d) => /^Script: The first viewer did not understand the story/.test(d)));
});

test('M11: the routing sends the hook and the muted read to the picture fix, the story told back wrong to flags', () => {
  const v = viewerVerdict({ hook_seconds: null, muted_followed: false, story_in_my_words: 'about a hook factory', want_next: '', keep_watching: 4, confused: [] }, 0.1, 1.5);
  const routed = firstViewerRouting(v, 1.5);
  assert.ok(routed.picture.some((f) => /never worked out what the story was about/.test(f)));
  assert.ok(routed.picture.some((f) => /On mute/.test(f)));
  assert.ok(routed.picture.some((f) => /found no hook/.test(f)));
  assert.ok(routed.words.some((f) => /told the story as: "about a hook factory"/.test(f)), 'a quoted "hook" in the viewer\'s words stays a words finding');
  assert.ok(routed.words.some((f) => /did not understand/.test(f)));
  const late = firstViewerRouting(viewerVerdict({ hook_seconds: 4, muted_followed: true, story_in_my_words: 'x', want_next: 'y', keep_watching: 4, confused: [] }, 0.9, 1.5), 1.5);
  assert.deepEqual(late.words, []);
  assert.equal(late.picture.length, 2, 'the hook-late finding from the viewer and from the run');
});

test('variety gets one pre_build fix; the plan\'s makes are made into the inventory, a failed make falls back and is flagged', async () => {
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
        fixes.push(`${i.fix?.kind ?? 'first'}${i.fix?.escalate ? ' (escalated)' : ''}`);
        // The escalated round (the re-check still finds a repeat) answers with a plan of its own and no makes.
        return clone(i.fix?.escalate ? PLAN : i.fix?.kind === 'pre_build' ? withMakes : samePhotos);
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
  // M2 failed and fell back to V1, which frame 1 shows too: the re-check still finds a repeat, so one escalated round.
  assert.deepEqual(fixes, ['first', 'pre_build', 'pre_build (escalated)']);
  assert.equal(made.length, 1);
  // The plan checks run after the voice now: the files are written again once the fix is in.
  const written = seen.writeProjectFiles.at(-1) as { plan: DirectorPlan; inventory: VisualsInventory };
  assert.ok(written.inventory.assets.some((a) => a.id === 'M1'), 'the made asset joins the inventory');
  assert.ok(!written.plan.frames.some((f) => f.asset_ids.includes('M2')), 'a failed make falls back to existing assets');
  const flags = (await getJob(db, job.id))!.flags;
  assert.ok(flags.some((f) => /Make: M2: the image model failed/.test(f.detail)));
});

// ── Iteration 5: writer, blind story editor, one rewrite; wish search, ordering, flag dedupe ────

test('MD-102: the editor reads the script only; its notes get one rewrite (writer-revise) and ship as story flags', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const notes: StoryNotes = { tell_back: 'A founder is fired.', notes: [{ lines: ['L2'], note: 'Who is the board?' }, { lines: ['L3'], note: 'Why fire him?' }] };
  const rewritten = { ...clone(DRAFT), close_question: 'Would you have stayed?' };
  const { deps, calls, seen } = stubDeps(db, {
    writing: {
      editStory: async (i) => (calls.push('editStory'), (seen.editStory ??= []).push(i), clone(notes)),
      reviseScript: async (i) => (calls.push('reviseScript'), (seen.reviseScript ??= []).push(i), clone(rewritten)),
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  // The writer reads the pitch (its brief), the facts, the inventory and the settings: no spine.
  assert.deepEqual(Object.keys(seen.writeScript[0] as object).sort(), ['facts', 'inventory', 'pitch', 'settings']);
  // The editor's input is the script alone.
  assert.deepEqual(Object.keys(seen.editStory[0] as object).sort(), ['draft', 'settings']);
  assert.deepEqual(calls.filter((c) => /editStory|reviseScript|directReel/.test(c)).slice(0, 3), ['editStory', 'reviseScript', 'directReel']);
  const asked = (seen.reviseScript[0] as { notes: RevisionNote[] }).notes;
  assert.deepEqual(asked, [
    { source: 'Story editor', lines: ['L2'], note: 'Who is the board?' },
    { source: 'Story editor', lines: ['L3'], note: 'Why fire him?' },
  ]);
  assert.equal((seen.directReel[0] as { draft: WriterDraft }).draft.close_question, 'Would you have stayed?', 'the director plans the rewritten script');
  const story = (await getJob(db, job.id))!.flags.filter((f) => f.check === 'story').map((f) => f.detail);
  assert.deepEqual(story, ['Story editor: Who is the board? (L2)', 'Story editor: Why fire him? (L3)']);
  const kinds = (await listArtifacts(db, job.id)).map((a) => a.kind);
  assert.equal(kinds.filter((k) => k === 'story_notes').length, 1);
  assert.equal(kinds.filter((k) => k === 'writer_draft').length >= 2, true, 'the first draft and the rewrite are both kept');
});

test('MD-102: no notes, no rewrite; the editor runs once', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, calls } = stubDeps(db);
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(calls.filter((c) => c === 'editStory').length, 1);
  assert.equal(calls.filter((c) => c === 'reviseScript').length, 0);
  assert.equal((await getJob(db, job.id))!.flags.filter((f) => f.check === 'story').length, 0);
});

test('MD-65: a failed editor or a failed rewrite never stops the reel; the draft stands and a no-op flag says so', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, calls } = stubDeps(db, {
    writing: {
      editStory: async () => {
        throw new Error('overloaded');
      },
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.ok(!calls.includes('reviseScript'));
  const story = (await getJob(db, job.id))!.flags.filter((f) => f.check === 'story').map((f) => f.detail);
  assert.equal(story.length, 2);
  assert.match(story[0]!, /story editor failed \(overloaded\)/);
  assert.match(story[1]!, /^NO-OP: the story editor never read the script \(overloaded\)/);

  const db2 = await freshDb();
  const second = await queuedJob(db2);
  const directed: WriterDraft[] = [];
  const failing = stubDeps(db2, {
    writing: {
      editStory: async () => ({ tell_back: 't', notes: [{ lines: ['L1'], note: 'When is this?' }] }),
      reviseScript: async () => {
        throw new Error('still invalid');
      },
      directReel: async (i) => (directed.push(i.draft), clone(PLAN)),
    },
  });
  assert.equal((await runJob(failing.deps, second.job)).status, 'ok');
  assert.equal(directed[0]!.close_question, DRAFT.close_question, 'the first draft stands');
  const flags2 = (await getJob(db2, second.job.id))!.flags.filter((f) => f.check === 'story').map((f) => f.detail);
  assert.deepEqual(flags2.slice(0, 2), ['Story editor: When is this? (L1)', "The rewrite on the story editor's notes failed (still invalid); the first draft stands."]);
  assert.match(flags2[2]!, /^NO-OP: the writer's rewrite on the story editor's notes failed \(still invalid\)/);
});

test('MD-68: the first plan\'s wishes are searched; found media joins the inventory, the rest take their fallback', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const wished: DirectorPlan = {
    ...clone(PLAN),
    frames: clone(PLAN).frames.map((f) => (f.n === 2 ? { ...f, asset_ids: ['W1'] } : f.n === 3 ? { ...f, asset_ids: ['W2'], shows: [{ person: 'A. Founder', asset_id: 'W2', treatment: 'photo' }] } : f)),
    wishes: [
      { id: 'W1', person: 'Founder', want: 'the founder on the call', frame_ns: [2], fallback: 'V3' },
      { id: 'W2', person: 'Founder', want: 'the founder leaving', frame_ns: [3], fallback: 'V1' },
    ],
  };
  const searched: unknown[] = [];
  const { deps, calls, seen } = stubDeps(db, {
    writing: { directReel: async () => (calls.push('directReel'), clone(wished)) },
    harvest: {
      searchWishes: async (i) => {
        searched.push(i.wishes.map((w) => w.id));
        calls.push('searchWishes');
        return { found: [{ wish_id: 'W1', asset: asset('V4', { shows: 'the founder on the call' }) }], problems: ['W2: nothing verified'], usd: 0.05 };
      },
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.deepEqual(searched, [['W1', 'W2']]);
  assert.equal(calls.indexOf('searchWishes'), calls.indexOf('directReel') + 1);
  const written = seen.writeProjectFiles[0] as { plan: DirectorPlan; inventory: VisualsInventory };
  assert.deepEqual(written.plan.frames.find((f) => f.n === 2)!.asset_ids, ['V4']);
  assert.deepEqual(written.plan.frames.find((f) => f.n === 3)!.asset_ids, ['V1']);
  assert.ok(written.inventory.assets.some((a) => a.id === 'V4'));
  assert.ok(!written.plan.wishes?.length);
  assert.ok((await getJob(db, job.id))!.flags.some((f) => f.check === 'harvest' && /Wish search: W2: nothing verified/.test(f.detail)));

  // No wish search wired: every wish takes its fallback, and nothing breaks.
  const db2 = await freshDb();
  const second = await queuedJob(db2);
  const bare = stubDeps(db2, { writing: { directReel: async () => clone(wished) } });
  assert.equal((await runJob(bare.deps, second.job)).status, 'ok');
  const plan2 = (bare.seen.writeProjectFiles[0] as { plan: DirectorPlan }).plan;
  assert.deepEqual(plan2.frames.slice(1, 3).map((f) => f.asset_ids), [['V3'], ['V1']]);
});

test('MD-81: cutouts after the writer (its central list) and for wished photos in cutout frames; a quiet no-op gets a loud flag before delivery', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const portrait = asset('V2', { people: ['Founder'], flags: ['identity:verified'], anchor_for: 'Founder', character_image: true });
  const wished: DirectorPlan = {
    ...clone(PLAN),
    frames: clone(PLAN).frames.map((f) => (f.n === 2 ? { ...f, treatment: 'cutout_lift', asset_ids: ['W1'], shows: [{ person: 'Founder', asset_id: 'W1', treatment: 'cutout_lift' }] } : f)),
    wishes: [{ id: 'W1', person: 'Founder', want: 'the founder on stage', frame_ns: [2], fallback: 'V3' }],
  };
  const requests: unknown[] = [];
  const directed: VisualsInventory[] = [];
  let next = 10;
  const { deps, calls, seen } = stubDeps(db, {
    harvest: {
      harvestVisuals: async () => ({ ...clone(INVENTORY), assets: [...clone(INVENTORY).assets.filter((a) => a.id !== 'V2'), portrait] }),
      searchWishes: async () => ({ found: [{ wish_id: 'W1', asset: asset('V4', { people: ['Founder'], flags: ['wish:W1'] }) }], problems: [], usd: 0 }),
      cutPeople: async (i) => {
        requests.push(i.requests.map((r) => ({ ...r })));
        calls.push('cutPeople');
        return {
          assets: i.requests.map((r) => asset(`V${++next}`, { people: [r.name], flags: ['cutout', 'cutout_made', `cutout_of:${r.source_id}`], anchor_for: r.anchor ? r.name : null })),
          problems: [],
        };
      },
    },
    writing: { directReel: async (i) => (calls.push('directReel'), directed.push(i.inventory), i.fix ? clone(PLAN) : clone(wished)) },
    render: { designSound: async () => ({ usd: 0, problems: [], cues: { music: [], stingers: [], ambience: [] } }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  // The writer's central founder: cut from his photo anchor (a plain cutout; the photo stays his anchor), before the director.
  assert.deepEqual(requests, [[{ name: 'Founder', source_id: 'V2', anchor: false }], [{ name: 'Founder', source_id: 'V4', anchor: false, frames: [2] }]]);
  assert.ok(calls.indexOf('cutPeople') < calls.indexOf('directReel'));
  assert.ok(directed[0]!.assets.some((a) => a.id === 'V11'));
  const written = seen.writeProjectFiles[0] as { plan: DirectorPlan; inventory: VisualsInventory };
  assert.deepEqual(written.plan.frames.find((f) => f.n === 2)!.asset_ids, ['V12'], 'the wished photo\'s cutout lifts in frame 2');
  assert.ok(written.inventory.assets.some((a) => a.id === 'V12' && a.flags.includes('cutout_of:V4')));
  const flags = (await getJob(db, job.id))!.flags;
  assert.ok(flags.some((f) => f.check === 'render' && /^NO-OP: the sound designer wrote no cues/.test(f.detail)));
  assert.ok(!flags.some((f) => /no cutout of Founder/.test(f.detail)), 'the founder has a cutout now');

  // Wishes with no search wired: the no-op detector says so.
  const db2 = await freshDb();
  const second = await queuedJob(db2);
  const bare = stubDeps(db2, { writing: { directReel: async () => clone(wished) } });
  assert.equal((await runJob(bare.deps, second.job)).status, 'ok');
  assert.ok((await getJob(db2, second.job.id))!.flags.some((f) => f.check === 'render' && /^NO-OP: the director wished for 1 shot\(s\) but none was searched \(no wish search is wired\)/.test(f.detail)));
});

test('the integrity re-check runs after the fix\'s makes are made', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const order: string[] = [];
  let checks = 0;
  const fixedPlan: DirectorPlan = {
    ...clone(PLAN),
    frames: clone(PLAN).frames.map((f) => (f.n === 2 ? { ...f, asset_ids: ['M1'] } : f)),
    makes: [{ id: 'M1', kind: 'setting', brief: 'the boardroom', people: [], from_assets: [], seed: null }],
  };
  const { deps } = stubDeps(db, {
    writing: { directReel: async (i) => clone(i.fix ? fixedPlan : PLAN) },
    checks: {
      checkIntegrity: async (i) => {
        checks += 1;
        order.push(`check:${i.inventory.assets.some((a) => a.id === 'M1') ? 'with M1' : 'without M1'}`);
        return { problems: checks === 1 ? [{ frame: 2, asset_id: 'V2', why: 'wrong room' }] : [] };
      },
    },
    render: {
      makeAssets: async () => (order.push('make'), { assets: [asset('M1', { made: true, made_kind: 'setting' })], usd: 0, problems: [] }),
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.deepEqual(order, ['check:without M1', 'make', 'check:with M1']);
});

test('a flag already on the job is not added again', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  await addFlag(db, job.id, { check: 'integrity', detail: 'Frame 2 (V2): wrong room' });
  await addFlag(db, job.id, { check: 'integrity', detail: 'Frame 2 (V2): wrong room' });
  await addFlag(db, job.id, { check: 'story', detail: 'Frame 2 (V2): wrong room' });
  assert.deepEqual((await getJob(db, job.id))!.flags.map((f) => f.check), ['integrity', 'story']);
});

test('MD-122: a hook that does not pull is a warning, never a problem', () => {
  const base = { hook_seconds: 1, muted_followed: true, story_in_my_words: 'x', want_next: 'y', keep_watching: 4, confused: [] };
  const weak = viewerVerdict({ ...base, hook_pull: 2 }, 0.9, 1.5);
  assert.ok(weak.warnings.some((w) => /hook didn't pull/.test(w)));
  assert.equal(weak.problems.length, 0);
  assert.ok(!viewerVerdict({ ...base, hook_pull: 4 }, 0.9, 1.5).warnings.some((w) => /hook didn't pull/.test(w)));
});

// ── MD-129: the design reviewer beside the first viewer ─────────────────────

test('Iteration 11 §4: only nothing_missing and one_medium (either severity) reach the content pass; other design findings wait for the solver and ship as flags', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const read: { frames: number[]; plan: DirectorPlan }[] = [];
  const { deps, calls, seen } = stubDeps(db, {
    checks: {
      checkDesign: async (i) => {
        read.push({ frames: [...new Set(i.sheets.map((x) => x.frame))], plan: i.plan });
        if (read.length > 1) return { problems: [], warnings: [], errors: [], usd: 0 };
        return {
          problems: [
            { frame: 1, item: 'off_edge', severity: 'problem', what: 'The logo runs off the right edge.' },
            { frame: 2, item: 'nothing_missing', severity: 'problem', what: 'The board is never shown.' },
          ],
          warnings: [
            { frame: 3, item: 'one_medium', severity: 'warning', what: 'A drawing beside a photo.' },
            { frame: 1, item: 'focal_point', severity: 'warning', what: 'Two faces compete.' },
          ],
          errors: [],
          usd: 0.05,
        };
      },
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  const fixes = (seen.directReel as { fix?: { kind?: string; problems: { frame: number; why: string }[] } }[]).filter((d) => d.fix);
  assert.equal(fixes.length, 1, 'once');
  assert.equal(fixes[0]!.fix!.kind, 'content_pass');
  assert.deepEqual(fixes[0]!.fix!.problems.map((p) => [p.frame, p.why]), [
    [2, 'The design review: Frame 2, nothing missing: The board is never shown.'],
    [3, 'The design review: Frame 3, one medium per frame: A drawing beside a photo.'],
  ]);
  // The reviewer read every frame's labelled sheets, then only the frames the content pass changed.
  assert.deepEqual(read.map((r) => r.frames), [[1, 2, 3], [2, 3]]);
  assert.deepEqual((seen.compileReel as { only?: number[] }[]).map((c) => c.only ?? 'all'), ['all', [2, 3]]);
  assert.equal(calls.filter((c) => c === 'renderVideo').length, 2);
  const flags = (await getJob(db, job.id))!.flags.map((f) => f.detail);
  assert.ok(flags.includes('Design: Frame 1, nothing off the edge: The logo runs off the right edge.'), flags.join('\n'));
  assert.ok(flags.includes('Design (taste): Frame 1, a clear focal point: Two faces compete.'), flags.join('\n'));
  assert.ok(!flags.some((f) => /nothing missing|one medium/.test(f)), 'the frames read again came back clean');
});

test('contentPassProblems: the first viewer on its named frame (else the opening), the two content items, nothing else', () => {
  assert.deepEqual(CONTENT_ITEMS, ['nothing_missing', 'one_medium']);
  const got = contentPassProblems(['On mute, frame 3 says nothing.', 'The hook lands at 3s, after 1.5s.'], {
    problems: [{ frame: 2, item: 'readable_text', severity: 'problem', what: 'tiny' }, { frame: 2, item: 'nothing_missing', severity: 'problem', what: 'no board' }],
    warnings: [{ frame: 4, item: 'one_medium', severity: 'warning', what: 'mixed' }, { frame: 4, item: 'good_crops', severity: 'warning', what: 'tight' }],
    errors: [],
    usd: 0,
  });
  assert.deepEqual(got.map((p) => [p.frame, p.asset_id]), [[3, null], [1, null], [2, null], [4, null]]);
  assert.deepEqual(contentPassProblems([], null), []);
});

test('content pass: design warnings outside its two items get no fix; a design review that errors is flagged and the reel ships', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, calls } = stubDeps(db, {
    checks: { checkDesign: async () => ({ problems: [], warnings: [{ frame: 1, item: 'focal_point', severity: 'warning', what: 'Two faces compete.' }], errors: [], usd: 0 }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(calls.filter((c) => c === 'renderVideo').length, 1);
  assert.ok(!calls.slice(calls.indexOf('renderVideo')).includes('directReel'));
  assert.ok((await getJob(db, job.id))!.flags.some((f) => /^Design \(taste\): Frame 1, a clear focal point/.test(f.detail)));

  const db2 = await freshDb();
  const { job: job2 } = await queuedJob(db2);
  const broken = stubDeps(db2, { checks: { checkDesign: async () => { throw new Error('vision down'); } } });
  assert.equal((await runJob(broken.deps, job2)).status, 'ok');
  assert.equal(broken.calls.filter((c) => c === 'renderVideo').length, 1);
  assert.ok((await getJob(db2, job2.id))!.flags.some((f) => /Design review failed; shipped without it: vision down/.test(f.detail)));
});

test('never block a reel: a content pass that breaks the render ships the version from before it, flagged', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let renders = 0;
  let design = 0;
  const { deps } = stubDeps(db, {
    checks: {
      checkDesign: async () => {
        design += 1;
        return { problems: [{ frame: 1, item: 'nothing_missing', severity: 'problem', what: 'The deal is never shown.' }], warnings: [], errors: [], usd: 0 };
      },
    },
    render: {
      renderVideo: async (dir) => {
        renders += 1;
        const f = path.join(dir, 'renders', 'video.mp4');
        if (renders > 1) {
          fs.writeFileSync(f, 'half-written');
          throw new Error('a frame never finished building');
        }
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, 'the good mp4');
        return f;
      },
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(renders, 2);
  assert.equal(design, 1, 'nothing new to read after a failed render');
  const flags = (await getJob(db, job.id))!.flags.map((f) => f.detail);
  assert.ok(flags.includes('The reel would not render after the content pass, so it ships the version from before it.'), flags.join('\n'));
  assert.ok(flags.includes('Design: Frame 1, nothing missing: The deal is never shown.'), flags.join('\n'));
  const { rows } = await db.query<{ storage_path: string }>("SELECT storage_path FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind = 'video'", [job.id]);
  assert.equal(rows.length, 1);
  assert.equal(fs.readFileSync(deps.store.localPath!(rows[0]!.storage_path)!, 'utf8'), 'the good mp4', 'the earlier video is the one delivered');
});

test('a first viewer that never watched (no sheets, or it failed) sends nothing to the content pass', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const { deps, seen } = stubDeps(db, { checks: { checkFirstViewer: async () => { throw new Error('vision down'); } } });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.deepEqual((seen.directReel as { fix?: unknown }[]).filter((d) => d.fix), []);
  const flags = (await getJob(db, job.id))!.flags.map((f) => f.detail);
  assert.ok(flags.some((d) => /The first viewer failed \(vision down\)/.test(d)));
  assert.ok(!flags.some((d) => /found no hook/.test(d)), flags.join('\n'));
});

// ── Iteration 11 §5–§7: the problem solver, through the run (the model and the kit stubbed) ──

const SOLVER_STORYBOARD = [1, 2, 3].map((n) => `## Frame ${n} — F${n}\n\n- duration: 3s\n- treatment: photo\n`).join('\n');
const ONE_PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const solverBp = (asset: string): Blueprint => ({ ground: 'charcoal', style: 'cutouts', arrangement: 'solo', pieces: [{ id: 'p1', asset, on: '' }], labels: [], speech: [], marks: [], arrows: [], camera: { move: 'hold', stops: [] }, sounds: [] });
let msgN = 0;
function toolAnswer(name: string, input: unknown, model: string): Anthropic.Message {
  msgN += 1;
  return {
    id: `msg_${msgN}`, type: 'message', role: 'assistant', model, stop_reason: 'tool_use', stop_sequence: null,
    content: [{ type: 'tool_use', id: `tu_${msgN}`, name, input }],
    usage: { input_tokens: 2000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Message;
}
type Params = { model: string; tools: { name: string }[]; messages: { content: unknown }[] };
/** The look's verdicts: the frames named get theirs (with an aim), the rest are strong. */
const lookAnswer = (params: unknown, named: Record<number, 'weak' | 'wrong'>) => {
  const p = params as Params;
  return toolAnswer('submit_look', { verdicts: [1, 2, 3].map((n) => (named[n] ? { frame: n, verdict: named[n], because: 'it shows nothing', aim: 'show the board' } : { frame: n, verdict: 'strong', because: 'it lands' })) }, p.model);
};
/** The frame a round call is about: its second user block opens with the frame's section. */
const frameOfCall = (params: unknown) => {
  const p = params as Params;
  if (p.tools[0]!.name !== 'submit_frame') return 0;
  return Number(/Frame (\d+):/.exec(JSON.stringify((p.messages[0]!.content as unknown[])[1]))?.[1] ?? 0);
};
const solverDeps = (ctx: { jobId: string; mode: SolverDeps['mode'] }, db: Queryable, create: (params: unknown) => Promise<Anthropic.Message>, kit: SolverKit): SolverDeps => ({
  db, mode: ctx.mode, jobId: ctx.jobId, create: create as SolverDeps['create'], kitGuide: 'KIT', limitUsd: 4, kit,
  models: { look: 'claude-sonnet-5-5', first: 'claude-sonnet-5-5', second: 'claude-opus-5-5' },
  loadPrompt: () => 'SOLVER PROMPT',
  readImage: () => ({ data: ONE_PX, media_type: 'image/png' }),
});
/** A kit that builds whatever it's given; `measure` says what the measured checks find on the live frame. */
function quietKit(measure: (built: number) => string[] = () => []) {
  const built: { n: number; assets: string[] }[] = [];
  const kit: SolverKit = {
    compileFrame: async (plan, n) => (built.push({ n, assets: (plan.frames.find((f) => f.n === n)?.blueprint?.pieces ?? []).map((p) => p.asset ?? '') }), []),
    tryFrame: () => [],
    measureFrame: () => measure(built.length),
    readWords: () => [],
  };
  return Object.assign(kit, { built });
}
/** A run with the solver wired: the storyboard has three timed frames; `create` answers in order and is recorded. */
function solverRun(db: Queryable, answer: (params: unknown, i: number) => Promise<Anthropic.Message> | Anthropic.Message, kit: SolverKit, over: Overrides = {}) {
  const sent: { tool: string; model: string; frame: number; text: string }[] = [];
  const stub = stubDeps(db, {
    ...over,
    render: {
      writeProjectFiles: (dir) => {
        fs.writeFileSync(path.join(dir, 'SCRIPT.md'), '# script');
        fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), SOLVER_STORYBOARD);
      },
      ...over.render,
    },
  });
  stub.deps.solver = (ctx) => solverDeps(ctx, db, async (params) => {
    const p = params as Params;
    sent.push({ tool: p.tools[0]!.name, model: p.model, frame: frameOfCall(params), text: JSON.stringify(p.messages) });
    return answer(params, sent.length - 1);
  }, kit);
  return { ...stub, sent };
}
const shipped = async (db: Queryable, jobId: string) =>
  JSON.parse((await listArtifacts(db, jobId)).filter((a) => a.kind === 'solver' && a.content && /"shipped"/.test(a.content)).at(-1)!.content!).frames as { frame: number; label: string; kind: string; serious: number; flag: string | null }[];

test('solver: the look puts a wrong frame on the work list, round 1 reworks it alone, the built plan change ships and the plan takes its blueprint', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  const designed: DirectorPlan[] = [];
  const integrity: DirectorPlan[] = [];
  const kit = quietKit();
  const { deps, sent, calls, seen } = solverRun(db, (params, i) => (i === 0 ? lookAnswer(params, { 2: 'wrong' }) : toolAnswer('submit_frame', { frame: 2, diagnosis: 'the board is missing', approach: 'show the room', change: { kind: 'plan', blueprint: solverBp('V3') } }, (params as Params).model)), kit, {
    checks: {
      checkDesign: async (i) => (designed.push(i.plan), { problems: [], warnings: [], errors: [], usd: 0 }),
      checkIntegrity: async (i) => (integrity.push(i.plan), { problems: [] }),
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.deepEqual(sent.map((s) => [s.tool, s.model, s.frame]), [['submit_look', 'claude-sonnet-5-5', 0], ['submit_frame', 'claude-sonnet-5-5', 2]], 'one look, one round-1 call, no round 2');
  assert.deepEqual(kit.built, [{ n: 2, assets: ['V3'] }]);
  // Pre-mortem #8: the new picture is checked against its line; then the reviewer reads the changed frame on the new plan.
  assert.deepEqual(integrity.at(-1)!.frames.map((f) => [f.n, f.asset_ids]), [[2, ['V3']]]);
  assert.deepEqual(designed.at(-1)!.frames.find((f) => f.n === 2)!.blueprint, solverBp('V3'));
  assert.deepEqual((seen.reelSheets as { frames: number[] | null; viewer: boolean }[]).map((r) => [r.frames, r.viewer]), [[null, true], [[2], false], [null, true]], 'whole reel, the changed frame, the final read');
  assert.deepEqual((await shipped(db, job.id)).map((s) => [s.frame, s.label, s.kind, s.serious, s.flag]), [[2, 'r1', 'plan', 0, null]]);
  // The plan that ships carries the blueprint: the reuse record sees its picture.
  assert.ok((seen.recordUses[0] as { purpose: string; assetKey: string }[]).some((u) => u.assetKey === 'https://example.com/V3.jpg' && /^frame 2:/.test(u.purpose)));
  assert.equal(calls.filter((c) => c === 'renderVideo').length, 2);
  assert.ok((await listArtifacts(db, job.id)).some((a) => a.kind === 'solver' && a.storage_path?.endsWith('solved.json')), 'solved.json is kept');
});

test('solver: a frame still serious after round 1 goes to round 2 on the second model, then the last resort, which ships when it is cleaner', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let assembled = 0;
  // Rounds 1 and 2 still run off the edge; the last resort (the third build) measures clean.
  const kit = quietKit((built) => (built < 3 ? ['[off_frame] 02-f: "V3" is mostly off the edge (0.5-2.0s)'] : []));
  const { deps, sent } = solverRun(db, (params, i) => (i === 0 ? lookAnswer(params, { 2: 'weak' }) : toolAnswer('submit_frame', { frame: 2, diagnosis: 'it runs off', approach: 'bring it in', change: { kind: 'plan', blueprint: solverBp('V3') } }, (params as Params).model)), kit, {
    render: { assembleProject: async () => (assembled++, { ok: true, problems: assembled === 1 ? ['[off_frame] 02-f: "V2" is mostly off the edge (0.5-2.0s)'] : [] }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.deepEqual(sent.map((s) => [s.tool, s.model, s.frame]), [['submit_look', 'claude-sonnet-5-5', 0], ['submit_frame', 'claude-sonnet-5-5', 2], ['submit_frame', 'claude-opus-5-5', 2]]);
  assert.match(sent[2]!.text, /previous attempt, which wasn't enough/, 'round 2 sees round 1 and what is still wrong');
  assert.match(sent[2]!.text, /still_wrong.*off_frame/);
  assert.equal(kit.built.length, 3, 'round 1, round 2, the last resort (no model)');
  assert.deepEqual((await shipped(db, job.id)).map((s) => [s.frame, s.label, s.kind, s.serious]), [[2, 'last', 'plain', 0]]);
  const flags = (await getJob(db, job.id))!.flags.map((f) => f.detail);
  assert.ok(flags.some((d) => /^Solver, frame 2: last resort: it shows its simplest version, with 0 serious finding\(s\) against 1/.test(d)), flags.join('\n'));
});

test('solver: a solver that fails (every call throws) fails open: the reel ships, flagged', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let assembled = 0;
  const kit = quietKit();
  const { deps, sent } = solverRun(db, () => { throw new Error('overloaded'); }, kit, {
    render: { assembleProject: async () => (assembled++, { ok: true, problems: assembled === 1 ? ['[off_frame] 02-f: "V2" is mostly off the edge (0.5-2.0s)'] : [] }) },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.deepEqual(sent.map((s) => s.tool), ['submit_look', 'submit_frame', 'submit_frame'], 'the look, then rounds 1 and 2 on the serious frame');
  const flags = (await getJob(db, job.id))!.flags.map((f) => f.detail);
  assert.ok(flags.some((d) => /^Solver: the look failed \(.*overloaded.*\); the frames with serious findings are reworked/.test(d)), flags.join('\n'));
  assert.ok(flags.some((d) => /^Solver: frame 2: round 1 failed \(.*overloaded.*\); it keeps its last good version/.test(d)), flags.join('\n'));
  assert.ok((await listArtifacts(db, job.id)).some((a) => a.kind === 'video'), 'the video was delivered');
});

test('solver: a re-render that fails after a solver round ships the earlier video, swaps the frame back and stops the picture work, flagged', async () => {
  const db = await freshDb();
  const { job } = await queuedJob(db);
  let renders = 0;
  const kit = quietKit();
  const { deps, sent, calls } = solverRun(db, (params, i) => (i === 0 ? lookAnswer(params, { 2: 'wrong' }) : toolAnswer('submit_frame', { frame: 2, diagnosis: 'the board is missing', approach: 'show the room', change: { kind: 'plan', blueprint: solverBp('V3') } }, (params as Params).model)), kit, {
    render: {
      renderVideo: async (dir) => {
        renders += 1;
        const f = path.join(dir, 'renders', 'video.mp4');
        fs.mkdirSync(path.dirname(f), { recursive: true });
        if (renders > 1) {
          fs.writeFileSync(f, 'half-written');
          throw new Error('a frame never finished building');
        }
        fs.writeFileSync(f, 'the good mp4');
        return f;
      },
    },
  });
  assert.equal((await runJob(deps, job)).status, 'ok');
  assert.equal(renders, 2, 'one render after the round, no retry, nothing after it');
  assert.equal(sent.length, 2, 'no round 2 once the reel stopped rendering');
  assert.equal(calls.filter((c) => c === 'checkFirstViewer').length, 1, 'no final read of a video that did not change');
  assert.deepEqual((await shipped(db, job.id)).map((s) => [s.frame, s.label, s.kind]), [[2, 'v0', 'compiled']]);
  const flags = (await getJob(db, job.id))!.flags.map((f) => f.detail);
  assert.ok(flags.includes("The reel would not render after the solver's r1, so it ships the version from before it."), flags.join('\n'));
  assert.ok(flags.some((d) => /^Solver, frame 2: swapped back to v0/.test(d)), flags.join('\n'));
  const { rows } = await db.query<{ storage_path: string }>("SELECT storage_path FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind = 'video'", [job.id]);
  assert.equal(fs.readFileSync(deps.store.localPath!(rows[0]!.storage_path)!, 'utf8'), 'the good mp4');
});

test('withBlueprint: the frame takes the blueprint and its pictures; the other frames are untouched', () => {
  const next = withBlueprint(PLAN, 2, solverBp('V3'));
  assert.deepEqual(next.frames[1]!.blueprint, solverBp('V3'));
  assert.deepEqual(next.frames[1]!.asset_ids, ['V3', 'V2']);
  assert.equal(next.frames[0], PLAN.frames[0]);
  assert.equal(PLAN.frames[1]!.blueprint, undefined, 'pure');
});
