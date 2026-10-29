/**
 * Targeted Revisions task 10: the text on screen (reels) description on PGlite (the real reels and
 * spine schema files). Offline: storage, ffmpeg, the text engine, the scene and motion writers, the
 * image model and Kling are all stubs. One reel: one 9:16 frame plus one clip.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { PGlite } from '@electric-sql/pglite';

import { checkCopy, type CopyReport } from '@/lib/reels/copy/report';
import { KLING_USD_PER_CLIP } from '@/lib/reels/insights';
import { motionRecord, parseMotionPrompt, type MotionPrompt } from '@/lib/reels/visual/motion-prompt';
import { CeilingReached, createCostMeter, resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import { meteredCreate } from '@/lib/revisions/descriptions/carousels-live';
import {
  createTextOnScreenDescription,
  textOnScreenDescription,
  TEXT_ON_SCREEN_KLING_USD,
  TEXT_ON_SCREEN_STAGE_TAGS,
  rawKeyFor,
  type TextOnScreenDeps,
} from '@/lib/revisions/descriptions/text-on-screen';
import { runRevision } from '@/lib/revisions/engine';
import { descriptionFor, registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
import { claimNextRequested, createRequest, listForItem, markRunning } from '@/lib/revisions/store';
import { relayPlate, type PlateDeps } from '@/lib/revisions/text-on-screen-plate';
import { unscheduleItem } from '@/lib/social/overnight/schedule';
import type { Interpretation, PartRef } from '@/lib/revisions/types';
import type { Query } from '@/lib/social/store/pg';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { openHubTestDb } from './fixtures/social-hub/pglite';

const IDEA = '60000000-0000-4000-8000-000000000001';
const SLATE = '60000000-0000-4000-8000-000000000002';
const VISUAL = '60000000-0000-4000-8000-000000000003';
const VIDEO = '60000000-0000-4000-8000-000000000004';
const RUN = '60000000-0000-4000-8000-000000000005';
const SOURCE = '60000000-0000-4000-8000-000000000006';

/** A past slate (Oct 1): revisions are not limited to today's slate. */
const PAST_DATE = '2026-10-01';
const COPY = 'OpenAI shipped a model that writes its own tests and the team found out from a customer';
const NEW_COPY = 'OpenAI shipped a model that writes its own tests and nobody on the team noticed for a week';
const SCENE = 'A lone server rack glows in the lower third of a quiet room.';
const BG = `${VISUAL}/background.png`;
const FRAME = `${VISUAL}/frame.png`;
const CLIP = `${VIDEO}/reel.mp4`;
const PROMPT: MotionPrompt = parseMotionPrompt('Camera: slow dolly in, easing to rest by 6.0s\n0.0-0.5s: the rack hums\n0.5-10.0s: lights pulse', 'orange');
const MOTION = motionRecord('glitch', PROMPT, 'strobe', { routedHook: 'glitch', sfx: 'glitch-strobe.wav' });

const REPORT: CopyReport = {
  onScreenCopy: COPY,
  viewerStake: 'Your tests may be next.',
  caption: 'OpenAI shipped it quietly.\n\nA customer noticed first.',
  builderRead: 'At Helios we test everything.',
  callToAction: 'Follow for more.',
  hashtags: ['#ai', '#openai', '#testing'],
  sources: [{ name: 'The Verge', url: 'https://verge.test/openai' }],
  working: { hookDrafts: [], copyDraft: '', captionDraft: '', remainingPatterns: [], builderRead: 'At Helios we test everything.' } as CopyReport['working'],
};
const KNOWN = ['https://verge.test/openai'];
const checksFor = (copy: string) => checkCopy({ ...REPORT, onScreenCopy: copy }, 'the_callout', KNOWN);

type Seeded = { pg: PGlite; q: Query };

async function seed(o: { lock?: boolean; inFlight?: 'visual' | 'video' | 'copy' | 'finish'; noClip?: boolean } = {}): Promise<Seeded> {
  const { pg } = await openHubTestDb();
  STORE.clear();
  for (const k of [BG, FRAME, CLIP]) STORE.add(k);
  await pg.exec(readFileSync(path.join(process.cwd(), 'db', 'revisions_schema.sql'), 'utf8').split(/\r?\n/).filter((l) => !l.startsWith('\\')).join('\n'));
  (globalThis as { __outreachHubPool?: unknown }).__outreachHubPool = { query: (text: string, params?: unknown[]) => pg.query(text, params as unknown[]), options: { max: 1 } };
  await pg.query(`INSERT INTO reels.runs (id, trigger, status) VALUES ($1, 'scheduled', 'ok')`, [RUN]);
  await pg.query(`INSERT INTO reels.post_ideas (id) VALUES ($1)`, [IDEA]);
  await pg.query(`INSERT INTO reels.score_slates (id, run_id, ny_date, pass1_version, pass2_version) VALUES ($1, $2, $3, 'p1', 'p2')`, [SLATE, RUN, PAST_DATE]);
  await pg.query(
    `INSERT INTO reels.sources (id, run_id, canonical_url, headline, body, source_name, source_type, adapter_id, bucket)
     VALUES ($1, $2, 'https://verge.test/openai', 'OpenAI ships a test-writing model', 'The model writes tests.', 'The Verge', 'news', 'rss', 'A')`,
    [SOURCE, RUN],
  );
  await pg.query(`INSERT INTO reels.post_idea_members (source_id, post_idea_id, role) VALUES ($1, $2, 'primary')`, [SOURCE, IDEA]);
  const copyCols = `slate_id, post_idea_id, prompt_version, model, bucket, framework, status, on_screen_copy, viewer_stake, caption, call_to_action, hashtags, sources, checks, working, full_story_cue`;
  const copyVals = [SLATE, IDEA, 'v30', 'claude-sonnet-5', 'the_callout', 'f1', 'ok', COPY, REPORT.viewerStake, REPORT.caption, REPORT.callToAction, REPORT.hashtags, JSON.stringify(REPORT.sources), JSON.stringify(checksFor(COPY)), JSON.stringify(REPORT.working), 'Full story in the caption'];
  const ph = copyVals.map((_, i) => `$${i + 1}`).join(', ');
  await pg.query(`INSERT INTO reels.idea_copy (${copyCols}) VALUES (${ph})`, copyVals);
  await pg.query(`INSERT INTO reels.idea_copy_history (${copyCols}) VALUES (${ph})`, copyVals);
  await pg.query(
    `INSERT INTO reels.visual_jobs (id, post_idea_id, slate_id, status, finished_at, category, story, on_screen_copy, scene, image_prompt,
                                    background_storage_path, frame_storage_path, background_qa, render, warnings)
     VALUES ($1, $2, $3, 'ok', now(), 'storytelling', 'The story.', $4, $5, 'the prompt', $6, $7, '{"pass": true}'::jsonb, $8::jsonb, '[]'::jsonb)`,
    [VISUAL, IDEA, SLATE, COPY, SCENE, BG, FRAME, JSON.stringify({ lines: ['OpenAI shipped'], details: null, model: 'gpt-image-2', colorProfile: 'orange' })],
  );
  await pg.query(
    `INSERT INTO reels.video_jobs (id, post_idea_id, slate_id, visual_job_id, status, finished_at, motion_prompt, video_storage_path, higgsfield_job_id, usd)
     VALUES ($1, $2, $3, $4, 'ok', now(), $5, $6, 'fal-req-1', 0.5)`,
    [VIDEO, IDEA, SLATE, VISUAL, MOTION, CLIP],
  );
  if (o.lock) await pg.query(`INSERT INTO reels.reel_locks (ny_date, slot, post_idea_id, slate_id, note) VALUES ($1, 1, $2, $3, 'Lucas: keep it')`, [PAST_DATE, IDEA, SLATE]);
  if (o.inFlight === 'visual') await pg.query(`INSERT INTO reels.visual_jobs (post_idea_id, slate_id, status) VALUES ($1, $2, 'requested')`, [IDEA, SLATE]);
  if (o.inFlight === 'video') await pg.query(`INSERT INTO reels.video_jobs (post_idea_id, slate_id, status) VALUES ($1, $2, 'running')`, [IDEA, SLATE]);
  if (o.inFlight === 'copy') await pg.query(`INSERT INTO reels.copy_jobs (post_idea_id, slate_id, status) VALUES ($1, $2, 'requested')`, [IDEA, SLATE]);
  if (o.inFlight === 'finish') await pg.query(`INSERT INTO reels.finish_requests (post_idea_id, slate_id, status) VALUES ($1, $2, 'active')`, [IDEA, SLATE]);
  const q: Query = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });
  return { pg, q };
}

/** Everything a revision can change, for "nothing written" and restore round-trips. */
async function snapshot(q: Query) {
  const copy = (await q(`SELECT on_screen_copy, checks, caption, full_story_cue FROM reels.idea_copy WHERE post_idea_id = $1`, [IDEA])).rows;
  const history = (await q(`SELECT count(*)::int AS n FROM reels.idea_copy_history WHERE post_idea_id = $1`, [IDEA])).rows[0]!.n as number;
  const video = (await q(`SELECT visual_job_id::text AS visual_job_id, motion_prompt, video_storage_path, higgsfield_job_id, status FROM reels.video_jobs WHERE id = $1`, [VIDEO])).rows;
  const visual = (await q(`SELECT scene, background_storage_path, frame_storage_path, render, on_screen_copy FROM reels.visual_jobs WHERE id = $1`, [VISUAL])).rows;
  return { copy, history, video, visual };
}
const current = async (q: Query) =>
  (await q(
    `SELECT j.video_storage_path, j.motion_prompt, j.higgsfield_job_id, j.visual_job_id::text AS visual_job_id, v.scene, v.background_storage_path, v.frame_storage_path,
            v.render, v.on_screen_copy AS visual_copy, v.status AS visual_status, c.on_screen_copy, c.checks
       FROM reels.video_jobs j JOIN reels.visual_jobs v ON v.id = j.visual_job_id
       JOIN reels.idea_copy c ON c.slate_id = j.slate_id AND c.post_idea_id = j.post_idea_id WHERE j.id = $1`,
    [VIDEO],
  )).rows[0]! as Record<string, unknown> & { render: { colorProfile?: string; lines?: string[] } };

type Opts = {
  fits?: boolean;
  clean?: boolean;
  scene?: string | null;
  plateFails?: boolean;
  deps?: Partial<TextOnScreenDeps>;
};

/** Unique across setups, as random ids are live. */
let ids = 0;
/** The fake reels-frames bucket for one seeded database (keys stored by any setup). */
const STORE = new Set<string>();

function setup(o: Opts = {}) {
  const calls = {
    image: [] as string[],
    kling: [] as Array<{ prompt: string; backgroundKey: string; profile: string }>,
    scene: [] as Array<{ hint: string | null; profile: string }>,
    motion: [] as Array<{ png: string; hint: string | null; profile: string }>,
    plates: [] as Array<{ copy: string; profile: string }>,
    overlays: [] as Array<{ video: string; hook: string | null }>,
    rendered: [] as Array<{ png: string; copy: string; profile: string }>,
    qa: [] as string[],
    stored: [] as string[],
    read: [] as string[],
    readClips: [] as string[],
    fal: [] as string[],
    withdrawn: [] as string[],
    unschedule: [] as string[],
  };
  const plate: PlateDeps = {
    async probeVideo() {
      return { width: 1080, height: 1920, fps: 24 };
    },
    async renderTextPlate(copy, _w, _h, profile) {
      calls.plates.push({ copy, profile: profile ?? 'noir' });
      if (o.plateFails) throw new Error('the text engine crashed');
      return { png: Buffer.from('plate'), lines: [copy.slice(0, 12)], warnings: [] };
    },
    async overlayPlate(video, _plate, _out, hook) {
      calls.overlays.push({ video, hook: hook.hook });
    },
    async overlayStillPlate(video) {
      calls.overlays.push({ video, hook: null });
    },
    async muxHookSfx() {},
    async writeFile() {},
    sfxDir: '/sfx',
  };
  const deps: TextOnScreenDeps = {
    async readObject(key) {
      calls.read.push(key);
      return Buffer.from(`png:${key}`);
    },
    async storeFile(key) {
      calls.stored.push(key);
      STORE.add(key);
    },
    async storeBuffer(key) {
      calls.stored.push(key);
      STORE.add(key);
    },
    async workDir() {
      return { dir: '/tmp/work', done: async () => {} };
    },
    async writeLocal() {},
    async renderText(png, copy, profile) {
      calls.rendered.push({ png: png.toString(), copy, profile });
      if (o.fits === false) return { ok: false, error: 'Copy does not fit the frame.' };
      return { ok: true, png: Buffer.from('frame'), lines: ['line 1', 'line 2'], warnings: [] };
    },
    async checkBackground(png) {
      calls.qa.push(png.toString());
      return { pass: true, reasons: [], mean_luma: 0.2, bright_fraction: 0, width: 1152, height: 2048 };
    },
    plate,
    async readClip(key) {
      calls.readClips.push(key);
      return STORE.has(key);
    },
    async falClip(requestId) {
      calls.fal.push(requestId);
      return o.clean !== false;
    },
    async withdrawItem(q, itemId) {
      calls.withdrawn.push(itemId);
      return unscheduleItem(q, itemId);
    },
    async writeScene({ hint, profile }, m) {
      calls.scene.push({ hint: hint ?? null, profile });
      m.spend(0.02);
      return o.scene === undefined ? 'A new scene: a single desk lamp in the lower third.' : o.scene;
    },
    async generateBackground(prompt, m) {
      calls.image.push(prompt);
      m.spend(0.2);
      return { png: Buffer.from('new-background') };
    },
    async writeMotion({ png, hint, profile }, m) {
      calls.motion.push({ png: png.toString(), hint: hint ?? null, profile });
      m.spend(0.02);
      return parseMotionPrompt('Camera: slow dolly out, easing to rest by 6.0s\n0.0-0.5s: a flicker\n0.5-10.0s: dust drifts', profile);
    },
    async kling(input) {
      calls.kling.push(input);
      return { bytes: Buffer.from('raw clip'), jobId: `fal-new-${calls.kling.length}` };
    },
    async unschedule(_q, postIdeaId) {
      calls.unschedule.push(postIdeaId);
      return { ok: true, note: 'Unscheduled.' };
    },
    newId: () => `r${++ids}`,
    ...(o.deps ?? {}),
  };
  return { desc: createTextOnScreenDescription(deps), calls, deps };
}

const stage = (key: 'copy' | 'frame' | 'video'): PartRef => ({ kind: 'stage', key });
const interp = (part: PartRef, fixKind: Interpretation['fixKind'], args?: Record<string, string>): Interpretation => ({
  vertical: 'reels', part, fixKind, stageTag: 'copy', instruction: 'fix it', ...(args ? { args } : {}),
});
const meter = () => createCostMeter(5);
const refs = { postIdeaId: IDEA, videoJobId: VIDEO };

test('UI label and stage tags say "text on screen"; fix kinds, args guide and estimates', () => {
  const d = descriptionFor('reels')!;
  assert.ok(d);
  assert.equal(d.vertical, 'reels');
  assert.equal(d.label, 'text on screen');
  assert.doesNotMatch(JSON.stringify(d.argsGuide), /trial reel/i);
  assert.deepEqual([...d.stageTags], [...TEXT_ON_SCREEN_STAGE_TAGS]);
  assert.deepEqual([...d.stageTags], ['copy', 'scene', 'background', 'color', 'motion', 'overlay']);
  assert.deepEqual([...d.fixKinds].sort(), ['color', 'motion', 'photo', 'wording']);
  for (const k of d.fixKinds) assert.ok(d.argsGuide?.[k], k);
  assert.match(d.argsGuide!.wording!, /args\.value/);
  assert.match(d.argsGuide!.color!, /noir.*paper.*orange.*green/);
  assert.match(d.argsGuide!.photo!, /sceneHint/);
  assert.match(d.argsGuide!.motion!, /motionHint/);
  // Wording is ffmpeg and the local text engine only; the rest pay for Kling at the ledger's own price.
  assert.equal(d.estimate('wording'), 0);
  assert.equal(TEXT_ON_SCREEN_KLING_USD, KLING_USD_PER_CLIP);
  assert.ok(d.estimate('motion') >= KLING_USD_PER_CLIP);
  assert.ok(d.estimate('photo') > d.estimate('motion'));
  assert.ok(d.estimate('color') > d.estimate('motion'));
});

test('relayPlate lays the new words over the stored clean clip with ffmpeg only, hook and sound kept', async () => {
  const seen: string[] = [];
  const deps: PlateDeps = {
    probeVideo: async (p) => (seen.push(`probe ${p}`), { width: 720, height: 1280, fps: 24 }),
    renderTextPlate: async (copy, w, h, profile, cue) => (seen.push(`plate ${copy} ${w}x${h} ${profile} ${cue}`), { png: Buffer.from('p'), lines: ['a'], warnings: [] }),
    overlayPlate: async (v, _p, out, h) => void seen.push(`overlay ${v} -> ${out} ${h.hook} ${h.timing}`),
    overlayStillPlate: async () => void seen.push('still'),
    muxHookSfx: async (_v, sfx, out) => void seen.push(`sfx ${sfx} -> ${out}`),
    writeFile: async () => {},
    sfxDir: '/sfx',
  };
  const out = await relayPlate(deps, { storedClipPath: '/w/clean.mp4', newCopy: NEW_COPY, workDir: '/w', profile: 'orange', fullStoryCue: 'Full story below', hook: 'glitch', timing: 'strobe' });
  assert.equal(out.videoPath, '/w/relay-sfx.mp4');
  assert.equal(out.sfx, 'glitch-strobe.wav');
  assert.deepEqual(seen, [
    'probe /w/clean.mp4',
    `plate ${NEW_COPY} 720x1280 orange Full story below`,
    'overlay /w/clean.mp4 -> /w/relay.mp4 glitch strobe',
    'sfx /sfx/glitch-strobe.wav -> /w/relay-sfx.mp4',
  ]);
});

test('wording fix calls relayPlate and zero image or video model calls', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value: NEW_COPY }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) return;
  assert.equal(calls.image.length, 0);
  assert.equal(calls.kling.length, 0);
  assert.equal(calls.scene.length, 0);
  assert.equal(calls.motion.length, 0);
  // A pipeline reel keeps no raw clip, so the clean clip comes from Fal's stored result; grade and hook are reused.
  assert.deepEqual(calls.fal, ['fal-req-1']);
  assert.ok(calls.stored.some((k) => /raw\.revr\d+\.mp4$/.test(k)), 'the clean clip is kept beside the new reel');
  assert.deepEqual(calls.plates, [{ copy: NEW_COPY, profile: 'orange' }]);
  assert.equal(calls.overlays.length, 1);
  assert.equal(calls.overlays[0]!.hook, 'glitch');
  // The copy fit is checked on the stored background with the person's words.
  assert.deepEqual(calls.rendered, [{ png: `png:${BG}`, copy: NEW_COPY, profile: 'orange' }]);
  const now = await current(s.q);
  assert.equal(now.on_screen_copy, NEW_COPY);
  assert.deepEqual(now.checks, JSON.parse(JSON.stringify(checksFor(NEW_COPY))), 'checks recomputed with checkCopy');
  assert.equal(now.visual_copy, NEW_COPY);
  assert.deepEqual(now.render.lines, ['line 1', 'line 2']);
  assert.equal(now.render.colorProfile, 'orange');
  assert.equal(now.background_storage_path, BG, 'the same background');
  assert.equal(now.scene, SCENE);
  // New keys only; the old files stay referenced by `before`.
  assert.notEqual(now.video_storage_path, CLIP);
  assert.notEqual(now.frame_storage_path, FRAME);
  assert.match(String(now.video_storage_path), /^60000000-0000-4000-8000-000000000004\/reel\.revr\d+\.mp4$/);
  for (const k of calls.stored) assert.ok(![CLIP, FRAME, BG].includes(k), `never overwrites ${k}`);
  assert.ok(res.before.files.includes(CLIP));
  assert.ok(res.before.files.includes(FRAME));
  assert.ok(res.after.files.includes(String(now.video_storage_path)));
  assert.equal(now.motion_prompt, MOTION, 'the hook record is unchanged');
  assert.equal(now.higgsfield_job_id, 'fal-req-1');
  // The old frame row is untouched.
  const old = (await s.q(`SELECT on_screen_copy, frame_storage_path FROM reels.visual_jobs WHERE id = $1`, [VISUAL])).rows[0]!;
  assert.deepEqual(old, { on_screen_copy: COPY, frame_storage_path: FRAME });
});

test('wording fix appends to idea_copy_history', async () => {
  const s = await seed();
  const { desc } = setup();
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value: NEW_COPY }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  const rows = (await s.q(`SELECT on_screen_copy, caption, checks FROM reels.idea_copy_history WHERE post_idea_id = $1 ORDER BY id`, [IDEA])).rows;
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.on_screen_copy, COPY);
  assert.equal(rows[1]!.on_screen_copy, NEW_COPY);
  assert.equal(rows[1]!.caption, REPORT.caption, 'the rest of the row is carried over');
  const row = (await s.q(`SELECT caption, call_to_action, hashtags, full_story_cue, prompt_version FROM reels.idea_copy WHERE post_idea_id = $1`, [IDEA])).rows[0]!;
  assert.deepEqual(row, { caption: REPORT.caption, call_to_action: REPORT.callToAction, hashtags: REPORT.hashtags, full_story_cue: 'Full story in the caption', prompt_version: 'v30' });
});

test('new copy that fails checkCopy or copy-fit returns blocked; nothing written, nothing paid', async () => {
  const cases: Array<[string, Opts, string]> = [
    ['Too short.', {}, 'words'],
    [`${NEW_COPY} \\n with an escape`, {}, 'escape'],
    [NEW_COPY, { fits: false }, 'fit'],
  ];
  for (const [value, o, why] of cases) {
    const s = await seed();
    const before = await snapshot(s.q);
    const { desc, calls } = setup(o);
    const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value }), meter: meter() });
    assert.equal(res.ok, false, why);
    if (res.ok) continue;
    assert.equal(res.reason, 'blocked', `${why}: ${res.note}`);
    assert.match(res.note, /text on screen/);
    assert.deepEqual(await snapshot(s.q), before, why);
    assert.equal(calls.overlays.length, 0, why);
    assert.equal(calls.stored.length, 0, why);
  }
});

test('wording on a reel with no clean clip stored is refused with a plain note', async () => {
  const s = await seed();
  const before = await snapshot(s.q);
  const { desc, calls } = setup({ clean: false });
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value: NEW_COPY }), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) {
    assert.equal(res.reason, 'failed');
    assert.match(res.note, /clip/);
  }
  assert.deepEqual(await snapshot(s.q), before);
  assert.equal(calls.overlays.length, 0);
});

test('background image fix runs frame then video stages once', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const m = meter();
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('frame'), 'photo'), meter: m });
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) return;
  // No hint: the stored scene is kept, no scene writer call.
  assert.equal(calls.scene.length, 0);
  assert.equal(calls.image.length, 1);
  assert.match(calls.image[0]!, /lone server rack/);
  assert.deepEqual(calls.qa, ['new-background']);
  assert.equal(calls.rendered.length, 1);
  assert.equal(calls.motion.length, 1);
  assert.equal(calls.motion[0]!.png, 'new-background', 'the motion writer sees the new background');
  assert.equal(calls.kling.length, 1);
  assert.equal(calls.kling[0]!.profile, 'orange', 'the grade is kept');
  assert.equal(calls.overlays.length, 1);
  assert.equal(calls.plates[0]!.copy, COPY);
  assert.ok(Math.abs(m.spent - (0.2 + 0.02 + TEXT_ON_SCREEN_KLING_USD)) < 1e-9, `metered ${m.spent}`);
  const now = await current(s.q);
  assert.notEqual(now.visual_job_id, VISUAL, 'a new frame row; the old one is left as it was');
  assert.notEqual(now.background_storage_path, BG);
  assert.notEqual(now.frame_storage_path, FRAME);
  assert.notEqual(now.video_storage_path, CLIP);
  assert.equal(now.higgsfield_job_id, 'fal-new-1');
  assert.equal(now.visual_status, 'ok');
  assert.equal(now.scene, SCENE);
  assert.equal(now.on_screen_copy, COPY, 'the words are untouched');
  assert.match(String(now.motion_prompt), /^Hook: glitch\nHook timing: strobe/);
  assert.match(String(now.motion_prompt), /slow dolly out/);
  // The raw clip is kept too (a later wording fix re-lays on it).
  assert.ok(calls.stored.some((k) => /raw\.revr\d+\.mp4$/.test(k)), calls.stored.join(', '));
  for (const k of [BG, FRAME, CLIP]) assert.ok(res.before.files.includes(k), k);
  for (const k of calls.stored) assert.ok(![CLIP, FRAME, BG].includes(k));
  const old = (await s.q(`SELECT background_storage_path, frame_storage_path, status FROM reels.visual_jobs WHERE id = $1`, [VISUAL])).rows[0]!;
  assert.deepEqual(old, { background_storage_path: BG, frame_storage_path: FRAME, status: 'ok' });
});

test('background image fix with a scene hint writes one new scene with the hint', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('frame'), 'photo', { sceneHint: 'a desk lamp instead of the rack' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepEqual(calls.scene, [{ hint: 'a desk lamp instead of the rack', profile: 'orange' }]);
  assert.match(calls.image[0]!, /desk lamp/);
  assert.match(String((await current(s.q)).scene), /desk lamp/);
});

test('motion fix reruns only video from the stored frame', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion', { motionHint: 'slower, calmer' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) return;
  assert.equal(calls.image.length, 0);
  assert.equal(calls.scene.length, 0);
  assert.equal(calls.rendered.length, 0, 'the still is not redrawn');
  assert.deepEqual(calls.motion, [{ png: `png:${BG}`, hint: 'slower, calmer', profile: 'orange' }]);
  assert.equal(calls.kling.length, 1);
  assert.equal(calls.kling[0]!.backgroundKey, BG);
  const now = await current(s.q);
  assert.equal(now.visual_job_id, VISUAL, 'the same frame row');
  assert.equal(now.frame_storage_path, FRAME);
  assert.notEqual(now.video_storage_path, CLIP);
  assert.equal(now.on_screen_copy, COPY);
  assert.ok(res.before.files.includes(CLIP));
});

test('color fix changes the grade and re-renders', async () => {
  const s = await seed();
  const { desc, calls } = setup();
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('frame'), 'color', { grade: 'paper' }), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  if (!res.ok) return;
  // The grade is in the background's palette, the band check, the still, Kling's band line and the plate.
  assert.equal(calls.image.length, 1);
  assert.equal(calls.scene.length, 0);
  assert.deepEqual(calls.rendered.map((r) => r.profile), ['paper']);
  assert.deepEqual(calls.motion.map((r) => r.profile), ['paper']);
  assert.equal(calls.kling[0]!.profile, 'paper');
  assert.deepEqual(calls.plates.map((p) => p.profile), ['paper']);
  const now = await current(s.q);
  assert.equal(now.render.colorProfile, 'paper');
  assert.deepEqual(res.before.colors, { grade: 'orange' });
  assert.deepEqual(res.after.colors, { grade: 'paper' });
  // Same grade again: nothing to do.
  const again = await desc.revise({ q: s.q, refs, interpretation: interp(stage('frame'), 'color', { grade: 'paper' }), meter: meter() });
  assert.equal(again.ok, false);
});

test('missing or invalid args fail with a plain note and change nothing', async () => {
  const s = await seed();
  const before = await snapshot(s.q);
  const { desc, calls } = setup();
  const cases: Array<[PartRef, Interpretation['fixKind'], Record<string, string> | undefined]> = [
    [stage('copy'), 'wording', undefined],
    [stage('copy'), 'wording', { value: '   ' }],
    [stage('copy'), 'wording', { value: COPY }],
    [stage('frame'), 'color', undefined],
    [stage('frame'), 'color', { grade: 'purple' }],
    [{ kind: 'stage', key: 'audio' }, 'motion', undefined],
    [{ kind: 'slide', key: '1' }, 'motion', undefined],
  ];
  for (const [part, kind, args] of cases) {
    const res = await desc.revise({ q: s.q, refs, interpretation: interp(part, kind, args), meter: meter() });
    assert.equal(res.ok, false, `${kind} ${JSON.stringify(args)}`);
    if (!res.ok) assert.equal(res.reason, 'failed', res.note);
  }
  const layout = await desc.revise({ q: s.q, refs, interpretation: interp(stage('frame'), 'layout'), meter: meter() });
  assert.equal(layout.ok, false);
  assert.deepEqual(await snapshot(s.q), before);
  assert.equal(calls.image.length + calls.kling.length + calls.motion.length + calls.overlays.length, 0);
});

test('a locked reel is refused', async () => {
  const s = await seed({ lock: true });
  const before = await snapshot(s.q);
  const { desc, calls } = setup();
  for (const [kind, args] of [['wording', { value: NEW_COPY }], ['motion', undefined]] as const) {
    const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), kind, args), meter: meter() });
    assert.equal(res.ok, false);
    if (!res.ok) {
      assert.equal(res.reason, 'blocked');
      assert.match(res.note, /this text on screen reel is locked/i);
      assert.doesNotMatch(res.note, /trial/i);
    }
  }
  assert.deepEqual(await snapshot(s.q), before);
  assert.equal(calls.kling.length + calls.overlays.length, 0);
});

test('a reel with a stage still being made (one-in-flight) is refused before any spend', async () => {
  for (const flight of ['visual', 'video', 'copy', 'finish'] as const) {
    const s = await seed({ inFlight: flight });
    const before = await snapshot(s.q);
    const { desc, calls } = setup();
    const m = meter();
    const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: m });
    assert.equal(res.ok, false, flight);
    if (!res.ok) assert.match(res.note, /being made/, flight);
    assert.equal(m.spent, 0);
    assert.equal(calls.motion.length, 0);
    assert.deepEqual(await snapshot(s.q), before);
  }
});

test('a reel from a past slate is revisable', async () => {
  const s = await seed();
  const date = (await s.q(`SELECT ny_date::text AS d FROM reels.score_slates WHERE id = $1`, [SLATE])).rows[0]!.d;
  assert.equal(date, PAST_DATE);
  const { desc } = setup();
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: meter() });
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal((await s.q(`SELECT count(*)::int AS n FROM reels.finish_requests`)).rows[0]!.n, 0, 'requestFinish is not used');
});

test('a failing plate or a Kling error is failed with the original kept', async () => {
  const s = await seed();
  const before = await snapshot(s.q);
  const plate = await setup({ plateFails: true }).desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value: NEW_COPY }), meter: meter() });
  assert.equal(plate.ok, false);
  if (!plate.ok) {
    assert.equal(plate.reason, 'failed');
    assert.match(plate.note, /text engine crashed/);
  }
  const kling = await setup({ deps: { kling: async () => { throw new Error('Fal rejected the clip (500)'); } } }).desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: meter() });
  assert.equal(kling.ok, false);
  if (!kling.ok) assert.match(kling.note, /Fal rejected/);
  assert.deepEqual(await snapshot(s.q), before);
});

test('after the ceiling exactly one paid call happens, even when the pipeline code swallows the error; Kling is never reached', async () => {
  const s = await seed();
  const before = await snapshot(s.q);
  let paid = 0;
  const swallow = async (f: () => Promise<unknown>) => { try { await f(); } catch { /* the writer fails open */ } };
  const { desc, calls } = setup({
    deps: {
      async writeMotion({ profile }, m) {
        const create = meteredCreate(async (_params: never) => { paid++; return {}; }, m, () => 0.5);
        for (let i = 0; i < 3; i++) await swallow(() => create(undefined as never));
        return parseMotionPrompt('', profile);
      },
    },
  });
  await assert.rejects(desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: createCostMeter(0.1) }), CeilingReached);
  assert.equal(paid, 1);
  assert.equal(calls.kling.length, 0);
  assert.deepEqual(await snapshot(s.q), before);

  // The image model swallowing its ceiling error: no motion writer, no Kling.
  let images = 0;
  const p = setup({
    deps: {
      async generateBackground(_prompt, m) {
        await swallow(async () => { if (m.stopped()) m.halt(); images++; m.spend(0.5); });
        await swallow(async () => { if (m.stopped()) m.halt(); images++; m.spend(0.5); });
        return { png: Buffer.from('bg') };
      },
    },
  });
  await assert.rejects(p.desc.revise({ q: s.q, refs, interpretation: interp(stage('frame'), 'photo'), meter: createCostMeter(0.1) }), CeilingReached);
  assert.equal(images, 1);
  assert.equal(p.calls.motion.length + p.calls.kling.length, 0);

  // A ceiling below Kling's price stops before Kling is called.
  const k = setup();
  await assert.rejects(k.desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: createCostMeter(0.3) }), CeilingReached);
  assert.equal(k.calls.kling.length, 0);
  assert.deepEqual(await snapshot(s.q), before);
});

test('restore puts back the reel and its old files for every fix kind, recomputes checks, and is idempotent', async () => {
  const fixes: Array<[PartRef, Interpretation['fixKind'], Record<string, string> | undefined]> = [
    [stage('copy'), 'wording', { value: NEW_COPY }],
    [stage('frame'), 'photo', undefined],
    [stage('video'), 'motion', undefined],
    [stage('frame'), 'color', { grade: 'noir' }],
  ];
  for (const [part, kind, args] of fixes) {
    const s = await seed();
    const before = await snapshot(s.q);
    const { desc, calls } = setup();
    const res = await desc.revise({ q: s.q, refs, interpretation: interp(part, kind, args), meter: meter() });
    assert.equal(res.ok, true, `${kind}: ${JSON.stringify(res)}`);
    if (!res.ok) continue;
    const work = calls.overlays.length + calls.kling.length + calls.image.length;
    await desc.restore({ q: s.q, refs, part, state: res.before });
    const back = await snapshot(s.q);
    const strip = (x: typeof back) => ({ ...x, history: 0, video: x.video.map((v) => ({ ...v, visual_job_id: null })) });
    assert.deepEqual(strip(back), strip(before), kind);
    // The video points at the original still (the same row, or a fresh copy of it).
    const still = await current(s.q);
    assert.deepEqual([still.background_storage_path, still.frame_storage_path, still.scene, still.render.colorProfile], [BG, FRAME, SCENE, 'orange'], kind);
    await desc.restore({ q: s.q, refs, part, state: res.before });
    assert.deepEqual(await snapshot(s.q), back, `${kind} twice`);
    assert.equal(calls.overlays.length + calls.kling.length + calls.image.length, work, 'restore never renders or pays');
    // Redo: `after` comes back too.
    await desc.restore({ q: s.q, refs, part, state: res.after });
    assert.equal((await current(s.q)).video_storage_path, res.after.files[0]);
  }
});

test('undo out of order: change the words, then the movement; undoing the words first is refused and keeps both; in order works', async () => {
  const s = await seed();
  const { desc } = setup();
  const a = await desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value: NEW_COPY }), meter: meter() });
  assert.equal(a.ok, true);
  const b = await setup().desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: meter() });
  assert.equal(b.ok, true, JSON.stringify(b));
  if (!a.ok || !b.ok) return;
  // The movement's clip carries the new words (one reel = one piece).
  const mid = await current(s.q);
  assert.equal(mid.on_screen_copy, NEW_COPY);
  await assert.rejects(desc.restore({ q: s.q, refs, part: stage('copy'), state: a.before }), /later fix/);
  const still = await current(s.q);
  assert.deepEqual(still, mid, 'nothing changed');
  await desc.restore({ q: s.q, refs, part: stage('video'), state: b.before });
  assert.equal((await current(s.q)).on_screen_copy, NEW_COPY, 'the words stay after undoing the movement');
  await desc.restore({ q: s.q, refs, part: stage('copy'), state: a.before });
  const end = await current(s.q);
  assert.equal(end.on_screen_copy, COPY);
  assert.equal(end.video_storage_path, CLIP);
  assert.deepEqual(end.checks, JSON.parse(JSON.stringify(checksFor(COPY))));
});

test('load maps status (review, approved, scheduled, published, rejected) and labels the text, background and movement', async () => {
  const s = await seed();
  const { desc } = setup();
  const snap = (await desc.load(s.q, refs))!;
  assert.equal(snap.vertical, 'reels');
  assert.equal(snap.status, 'review');
  assert.deepEqual(snap.parts.map((p) => p.ref), [stage('copy'), stage('frame'), stage('video')]);
  assert.match(snap.parts[0]!.text!, /text on screen/i);
  assert.match(snap.parts[0]!.text!, new RegExp(COPY));
  assert.match(snap.parts[1]!.text!, /background/i);
  assert.match(snap.parts[1]!.text!, /lone server rack/);
  assert.equal(snap.parts[1]!.color, 'orange');
  assert.match(snap.parts[2]!.text!, /movement/i);
  assert.match(snap.parts[2]!.text!, /slow dolly in/);
  assert.match(snap.parts[2]!.text!, /glitch/);
  assert.equal(await desc.load(s.q, { postIdeaId: IDEA, videoJobId: '00000000-0000-0000-0000-000000000000' }), null);

  const item = (await s.q(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', $1, $2) RETURNING id::text AS id`, [VIDEO, IDEA])).rows[0]!.id as string;
  await s.q(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'approved', 'user')`, [item]);
  assert.equal((await desc.load(s.q, refs))!.status, 'approved');
  await s.q(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, idea_ref) VALUES ($1, 'reels', '2026-10-30', 'morning', now() + interval '1 day', 'scheduled', 'user', $2)`,
    [item, IDEA],
  );
  assert.equal((await desc.load(s.q, refs))!.status, 'scheduled');
  await s.q(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'reels', 'auto', 'publishing', 'c')`, [item]);
  assert.equal((await desc.load(s.q, refs))!.status, 'published');
  await s.q(`UPDATE social_hub.publish_attempts SET status = 'failed'`);
  await s.q(`UPDATE social_hub.schedule SET status = 'cancelled'`);
  await s.q(`UPDATE social_hub.approvals SET decision = 'rejected'`);
  assert.equal((await desc.load(s.q, refs))!.status, 'rejected');
  const revise = await desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: meter() });
  assert.equal(revise.ok, false);
});

test('unschedule delegates to unscheduleIdea: the slot is cancelled and the approval withdrawn', async () => {
  const s = await seed();
  const item = (await s.q(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', $1, $2) RETURNING id::text AS id`, [VIDEO, IDEA])).rows[0]!.id as string;
  await s.q(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'approved', 'user')`, [item]);
  await s.q(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, idea_ref, approved_at) VALUES ($1, 'reels', '2026-10-30', 'morning', now() + interval '1 day', 'scheduled', 'user', $2, now())`,
    [item, IDEA],
  );
  const out = await textOnScreenDescription.unschedule(s.q, refs);
  assert.equal(out.ok, true, out.note);
  assert.equal((await textOnScreenDescription.load(s.q, refs))!.status, 'review');
});

test('a scheduled reel goes back to review when its movement is revised (engine run)', async () => {
  const s = await seed();
  const item = (await s.q(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', $1, $2) RETURNING id::text AS id`, [VIDEO, IDEA])).rows[0]!.id as string;
  await s.q(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'approved', 'user')`, [item]);
  await s.q(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source, idea_ref, approved_at) VALUES ($1, 'reels', '2026-10-30', 'morning', now() + interval '1 day', 'scheduled', 'user', $2, now())`,
    [item, IDEA],
  );
  const { deps } = setup();
  registerDescription(createTextOnScreenDescription({ ...deps, unschedule: (q, postIdeaId) => textOnScreenDescription.unschedule(q, { postIdeaId, videoJobId: VIDEO }) }));
  setCapsForTest({ reels: { motion: { capUsd: 1, ceilingUsd: 1.5 } } });
  try {
    await createRequest(s.q, { vertical: 'reels', refs, itemId: item, by: 'tommy', instruction: 'make the movement calmer' });
    const row = (await claimNextRequested(s.q))!;
    const it = interp(stage('video'), 'motion', { motionHint: 'calmer' });
    await markRunning(s.q, row.id, it, 0, 0);
    await runRevision({ q: s.q, notify: async () => {}, now: () => new Date() }, { ...row, interpretation: it });
    const [done] = await listForItem(s.q, item);
    assert.equal(done!.status, 'applied', done!.note ?? '');
    assert.equal((await textOnScreenDescription.load(s.q, refs))!.status, 'review');
    assert.notEqual((await current(s.q)).video_storage_path, CLIP);
  } finally {
    restoreRegistryForTest();
    resetCapsForTest();
  }
});

/* ── Fix round 1 ── */

test('an approved reel with no slot (force-posted then failed) goes back to review and is revised (engine run)', async () => {
  const s = await seed();
  const item = (await s.q(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', $1, $2) RETURNING id::text AS id`, [VIDEO, IDEA])).rows[0]!.id as string;
  await s.q(`INSERT INTO social_hub.approvals (content_item_id, decision, via) VALUES ($1, 'approved', 'force')`, [item]);
  await s.q(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'reels', 'force', 'failed', 'c')`, [item]);
  assert.equal((await textOnScreenDescription.load(s.q, refs))!.status, 'approved');
  const { deps, calls } = setup();
  registerDescription(createTextOnScreenDescription(deps));
  setCapsForTest({ reels: { motion: { capUsd: 1, ceilingUsd: 1.5 } } });
  try {
    await createRequest(s.q, { vertical: 'reels', refs, itemId: item, by: 'tommy', instruction: 'calmer movement' });
    const row = (await claimNextRequested(s.q))!;
    const it = interp(stage('video'), 'motion');
    await markRunning(s.q, row.id, it, 0, 0);
    await runRevision({ q: s.q, notify: async () => {}, now: () => new Date() }, { ...row, interpretation: it });
    const [done] = await listForItem(s.q, item);
    assert.equal(done!.status, 'applied', done!.note ?? '');
    assert.deepEqual(calls.withdrawn, [item], 'the spine withdrew the approval (unscheduleIdea had no slot)');
    assert.deepEqual(calls.unschedule, [], 'unscheduleIdea is only used when there is a slot');
    assert.equal((await textOnScreenDescription.load(s.q, refs))!.status, 'review');
    assert.notEqual((await current(s.q)).video_storage_path, CLIP);
  } finally {
    restoreRegistryForTest();
    resetCapsForTest();
  }
});

test('undo makes the restored still the idea\'s newest frame row again (the readers\' ordering); redo still works; files stay', async () => {
  for (const [kind, args] of [['photo', undefined], ['color', { grade: 'green' }]] as const) {
    const s = await seed();
    const { desc } = setup();
    const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('frame'), kind, args), meter: meter() });
    assert.equal(res.ok, true, JSON.stringify(res));
    if (!res.ok) continue;
    // loadFramesForIdeas (run.ts): newest by requested_at; latestBackground (video-run.ts): newest ok with a background by finished_at.
    const byRequested = async () => (await s.q(`SELECT DISTINCT ON (post_idea_id) id::text AS id, scene, background_storage_path, render->>'colorProfile' AS grade FROM reels.visual_jobs WHERE post_idea_id = $1 ORDER BY post_idea_id, requested_at DESC`, [IDEA])).rows[0]!;
    const byFinished = async () => (await s.q(`SELECT id::text AS id, scene, background_storage_path, render->>'colorProfile' AS grade FROM reels.visual_jobs WHERE post_idea_id = $1 AND status = 'ok' AND background_storage_path IS NOT NULL ORDER BY finished_at DESC NULLS LAST LIMIT 1`, [IDEA])).rows[0]!;
    const revised = await byRequested();
    assert.notEqual(revised.background_storage_path, BG, kind);
    await desc.restore({ q: s.q, refs, part: stage('frame'), state: res.before });
    for (const latest of [await byRequested(), await byFinished()]) {
      assert.deepEqual([latest.background_storage_path, latest.scene, latest.grade], [BG, SCENE, 'orange'], kind);
      assert.equal(latest.id, (await current(s.q)).visual_job_id, 'the video points at the newest row');
    }
    const rows = (await s.q(`SELECT count(*)::int AS n FROM reels.visual_jobs WHERE post_idea_id = $1`, [IDEA])).rows[0]!.n;
    await desc.restore({ q: s.q, refs, part: stage('frame'), state: res.before });
    assert.equal((await s.q(`SELECT count(*)::int AS n FROM reels.visual_jobs WHERE post_idea_id = $1`, [IDEA])).rows[0]!.n, rows, 'idempotent: nothing written');
    // The revision's row is never deleted; its files stay recoverable.
    assert.equal((await s.q(`SELECT count(*)::int AS n FROM reels.visual_jobs WHERE id = $1::uuid`, [revised.id])).rows[0]!.n, 1);
    for (const f of res.after.files) assert.ok(STORE.has(f), f);
    // Redo brings the revision's still back, as the newest row.
    await desc.restore({ q: s.q, refs, part: stage('frame'), state: res.after });
    const redone = await byRequested();
    assert.equal(redone.background_storage_path, revised.background_storage_path, kind);
    assert.equal((await current(s.q)).video_storage_path, res.after.files[0]);
  }
});

test('the clean clip is kept: motion fix, then two wording fixes re-lay on stored raw clips and never ask Fal', async () => {
  assert.equal(rawKeyFor(`${VIDEO}/reel.revabc.mp4`), `${VIDEO}/raw.revabc.mp4`);
  assert.equal(rawKeyFor(CLIP), null);
  const s = await seed();
  const { desc, calls } = setup();
  const m = await desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: meter() });
  assert.equal(m.ok, true, JSON.stringify(m));
  const w1 = await desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value: NEW_COPY }), meter: meter() });
  assert.equal(w1.ok, true, JSON.stringify(w1));
  const third = 'OpenAI shipped a model that writes its own tests and the team only noticed a week later';
  const w2 = await desc.revise({ q: s.q, refs, interpretation: interp(stage('copy'), 'wording', { value: third }), meter: meter() });
  assert.equal(w2.ok, true, JSON.stringify(w2));
  assert.deepEqual(calls.fal, []);
  assert.equal(calls.readClips.length, 2);
  for (const k of calls.readClips) assert.match(k, /raw\.revr\d+\.mp4$/);
  assert.notEqual(calls.readClips[0], calls.readClips[1], 'the second wording fix uses the raw clip the first one kept');
  assert.equal((await current(s.q)).on_screen_copy, third);
});

test('a post started while Kling ran stops the write: failed, nothing written', async () => {
  const s = await seed();
  const before = await snapshot(s.q);
  const { desc } = setup({
    deps: {
      async kling() {
        const item = (await s.q(`INSERT INTO social_hub.content_items (vertical, format, native_ref, idea_ref) VALUES ('reels', 'reel', $1, $2) RETURNING id::text AS id`, [VIDEO, IDEA])).rows[0]!.id;
        await s.q(`INSERT INTO social_hub.publish_attempts (content_item_id, vertical, trigger, status, caption) VALUES ($1, 'reels', 'force', 'requested', 'c')`, [item]);
        return { bytes: Buffer.from('raw'), jobId: 'fal-late' };
      },
    },
  });
  const res = await desc.revise({ q: s.q, refs, interpretation: interp(stage('video'), 'motion'), meter: meter() });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, 'failed');
  assert.deepEqual(await snapshot(s.q), before);
});
