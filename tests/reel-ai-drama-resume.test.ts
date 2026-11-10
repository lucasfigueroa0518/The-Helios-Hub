/**
 * A requeued Reel AI Drama job resumes from its project on disk: voice, sound design, compile and render are reused only
 * while provably current. Offline: PGlite and stubbed steps, no model, no HeyGen, no render.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { Queryable } from '@/lib/explainers/db';
import { localArtifactStore } from '@/lib/explainers/storage';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { claimNextJob, requeueJob, requestJob } from '@/lib/reel-ai-drama/production/jobs';
import { COMPILE_FINGERPRINT, runJob, type ProductionDeps } from '@/lib/reel-ai-drama/production/run';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import type { DirectorPlan, FactSheet, Pitch, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { scratchExplainersDb } from './explainers-pglite';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rd-resume-'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const PITCH = { title: 'Fixture', brief: 'b', story_type: 'deal', era: 'race', event_date: '2023-11-17', date_precision: 'day', cast: [{ name: 'Founder', role: 'CEO', kind: 'person', player_id: null }], why_now: null, expected_visuals: [], sources: [] } as unknown as Pitch;
const FACTS = { summary: 's', timeline: [], facts: [{ id: 'F1', text: 't', source_ids: ['S1'], key: true, confidence: 'confirmed' }], sources: [], quotes: [], artifacts: [], cast: [], places: [], verdict: { holds: true, reason: 'r' } } as unknown as FactSheet;
const asset = (id: string, flags: string[] = []) => ({ id, kind: 'person_photo', file: `media/${id}.jpg`, url: `https://example.com/${id}.jpg`, source_page: null, credit: 'Ex', license: null, shows: id, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1080, height: 1920, phash: null, character_image: false, made: false, upscaled: false, flags });
const INVENTORY = { assets: [asset('V1', ['key_moment']), asset('V2'), asset('V3')], usable_count: 20, counts: {}, kill: null, usd: 0 } as unknown as VisualsInventory;
const line = (id: string, text: string) => ({ id, text, on_screen: null, fact_ids: ['F1'], must_show: null });
const DRAFT = { title: 'T', hook: { line_id: 'L1' }, rungs: [{ id: 'R1', purpose: 'setup', lines: [line('L1', 'He wanted the deal.'), line('L2', 'The board met.')] }, { id: 'R2', purpose: 'turn', lines: [line('L3', 'They fired him.')] }], peak_rung_id: 'R2', landing_rung_id: 'R2', close_question: 'Would you?', word_count: 11, central: [] } as unknown as WriterDraft;
const frame = (n: number, ids: string[], a: string, treatment: string) => ({ n, name: `F${n}`, line_ids: ids, treatment, asset_ids: [a], purpose: `p${n}`, music: 'hold', on_screen: null });
const PLAN = { frames: [frame(1, ['L1'], 'V1', 'photo'), frame(2, ['L2'], 'V2', 'map'), frame(3, ['L3'], 'V3', 'photo')], lines_back: [] } as unknown as DirectorPlan;

async function scratch() {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  return db;
}
async function freshJob(db: Queryable) {
  const { rows } = await db.query<{ id: string }>(`INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, status) VALUES ('Fixture', $1::jsonb, 'key:f', 'pooled') RETURNING id`, [JSON.stringify(PITCH)]);
  assert.ok((await requestJob(db, { pitchId: rows[0]!.id, trigger: 'click', settings: DEFAULT_SETTINGS })).ok);
  return (await claimNextJob(db))!;
}

type Opts = { root?: string; voices?: string[]; renderFails?: boolean };
/** Stubs that leave a real-looking project on disk: voiced storyboard, audio, cues, compiled frames, a render. */
function deps(db: Queryable, o: Opts = {}) {
  const root = o.root ?? tmp();
  const calls: string[] = [];
  const logs: { event: string; from?: string }[] = [];
  const voices = o.voices ?? ['He wanted the deal.', 'The board met.', 'They fired him.'];
  const note = (n: string) => void calls.push(n);
  const paths = (jobsRoot: string, jobId: string) => {
    const jobDir = path.join(jobsRoot, jobId);
    return { jobDir, projectDir: path.join(jobDir, 'project'), homeDir: path.join(jobDir, 'home'), tmpDir: path.join(jobDir, 'tmp') };
  };
  const d: ProductionDeps = {
    db,
    store: localArtifactStore(path.join(root, 'storage')),
    jobsRoot: path.join(root, 'jobs'),
    secrets: { anthropicApiKey: 't', heygenApiKey: 't' },
    voiceId: 'v',
    log: (event, data) => void logs.push({ event, from: (data as { from?: string } | undefined)?.from }),
    jev: () => ({ callCount: 0, ask: async () => { throw new Error('no Jev'); } }) as unknown as DramaJevRunner,
    pool: { nextForProduction: async () => null },
    reporting: { reportStory: async () => (note('reporting'), clone(FACTS)) },
    harvest: { harvestVisuals: async () => (note('harvest'), clone(INVENTORY)), recordUses: async () => undefined },
    writing: {
      writeScript: async () => (note('writer'), clone(DRAFT)),
      editStory: async () => (note('editor'), { tell_back: 't', notes: [] }),
      reviseScript: async (i) => clone(i.draft),
      directReel: async () => (note('director'), clone(PLAN)),
      writePost: async () => ({ caption: 'c', credits: [], question: 'q' }),
      creativePass: async () => (note('creative'), { touches: { touches: [], custom: [] }, problems: [], usd: 0 }) as never,
    },
    checks: {
      checkFacts: async () => ({ unsupported: [] }),
      checkIntegrity: async () => (note('integrity'), { problems: [] }),
      checkFirstViewer: async () => (note('first_viewer'), { hookSeconds: 1, understood: true, problems: [] }),
    },
    render: {
      kitGuide: 'KIT',
      prepareWorkspace: async ({ jobsRoot, jobId }) => {
        note('prepare');
        const ws = paths(jobsRoot, jobId);
        fs.rmSync(ws.jobDir, { recursive: true, force: true });
        for (const dir of [ws.projectDir, ws.homeDir, ws.tmpDir]) fs.mkdirSync(dir, { recursive: true });
        return ws;
      },
      reuseWorkspace: ({ jobsRoot, jobId }) => {
        const ws = paths(jobsRoot, jobId);
        return fs.existsSync(path.join(ws.projectDir, 'STORYBOARD.md')) ? ws : null;
      },
      writeProjectFiles: (dir) => {
        fs.writeFileSync(path.join(dir, 'SCRIPT.md'), '# s\n');
        fs.writeFileSync(path.join(dir, 'STORYBOARD.md'), voices.map((v, i) => `## Frame ${i + 1}\n- voiceover: ${v}\n`).join('\n'));
      },
      runVoice: async (dir) => {
        note('voice');
        fs.mkdirSync(path.join(dir, 'assets', 'voice'), { recursive: true });
        const meta = voices.map((_, i) => {
          fs.writeFileSync(path.join(dir, 'assets', 'voice', `f${i + 1}.wav`), 'wav');
          return { frame: i + 1, path: `assets/voice/f${i + 1}.wav`, duration_s: 1.2, words: [] };
        });
        fs.writeFileSync(path.join(dir, 'audio_meta.json'), JSON.stringify({ voices: meta }));
        fs.appendFileSync(path.join(dir, 'STORYBOARD.md'), '\n<!-- durations synced -->\n');
      },
      designSound: async ({ projectDir }) => {
        note('sound');
        fs.writeFileSync(path.join(projectDir, 'sound_cues.json'), JSON.stringify({ music: [{ action: 'start' }], stingers: [], ambience: [] }));
        return { usd: 0, problems: [] };
      },
      compileReel: async (i) => {
        note('compile');
        fs.mkdirSync(path.join(i.projectDir, 'assets', 'frames'), { recursive: true });
        for (const f of i.plan.frames) fs.writeFileSync(path.join(i.projectDir, 'assets', 'frames', `0${f.n}-f.js`), 'x');
        return { frames: i.plan.frames.map((f) => ({ n: f.n, id: `0${f.n}-f`, treatment: f.treatment, plain: false })), problems: [] };
      },
      assembleProject: async (dir) => {
        note('assemble');
        fs.writeFileSync(path.join(dir, 'index.html'), '<html></html>');
        return { ok: true, problems: [] };
      },
      renderVideo: async (dir) => {
        note('render');
        if (o.renderFails) throw new Error('hyperframes render timed out');
        return writeVideo(dir);
      },
      contactSheet: async (dir) => {
        note('sheet');
        const f = path.join(dir, 'renders', 'sheet.png');
        fs.writeFileSync(f, 'png');
        return f;
      },
    },
  };
  return { deps: d, calls, logs, root };
}
function writeVideo(projectDir: string, ahead = 0): string {
  const f = path.join(projectDir, 'renders', 'video.mp4');
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, 'mp4');
  const t = new Date(Date.now() + ahead);
  fs.utimesSync(f, t, t);
  return f;
}
const projectOf = (root: string, jobId: string) => path.join(root, 'jobs', jobId, 'project');
const PAID_AFTER_PLAN = ['voice', 'integrity', 'sound', 'compile', 'assemble', 'creative', 'render'];

/** A job that failed at its render, then had its video made by hand (the aadbe506 case), requeued and claimed again. */
async function failedAtRender() {
  const db = await scratch();
  const job = await freshJob(db);
  const first = deps(db, { renderFails: true });
  assert.equal((await runJob(first.deps, job)).status, 'failed');
  assert.ok(first.calls.includes('voice') && first.calls.includes('compile'));
  writeVideo(projectOf(first.root, job.id), 5_000);
  assert.equal(await requeueJob(db, job.id), true);
  return { db, job: (await claimNextJob(db))!, root: first.root };
}

test('resume: every artifact current: no voice, sound, compile or render; straight to the first viewer and delivery', async () => {
  const { db, job, root } = await failedAtRender();
  const again = deps(db, { root });
  assert.equal((await runJob(again.deps, job)).status, 'ok');
  for (const step of [...PAID_AFTER_PLAN, 'prepare', 'reporting', 'writer', 'director']) assert.ok(!again.calls.includes(step), `${step} ran: ${again.calls.join(', ')}`);
  assert.ok(again.calls.includes('first_viewer'));
  const from = again.logs.filter((l) => l.event === 'resumed').map((l) => l.from);
  for (const step of ['workspace', 'voice', 'integrity check', 'sound design', 'compile', 'render']) assert.ok(from.includes(step), step);
  const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM reel_ai_drama.cost_events WHERE job_id = $1 AND vendor = 'heygen'`, [job.id]);
  assert.equal(rows[0]!.n, 1, 'only the first run recorded the voice');
});

test('resume: compiled before fingerprints, frames newer than the plan still count as current', async () => {
  const { db, job, root } = await failedAtRender();
  const project = projectOf(root, job.id);
  fs.rmSync(path.join(project, COMPILE_FINGERPRINT));
  writeVideo(project, 5_000);
  const again = deps(db, { root });
  assert.equal((await runJob(again.deps, job)).status, 'ok');
  assert.ok(!again.calls.includes('compile') && !again.calls.includes('render'), again.calls.join(', '));
});

test('resume: changed voice lines re-voice, and everything after the voice runs again', async () => {
  const { db, job, root } = await failedAtRender();
  const again = deps(db, { root, voices: ['He wanted the deal.', 'The board met at night.', 'They fired him.'] });
  assert.equal((await runJob(again.deps, job)).status, 'ok');
  for (const step of PAID_AFTER_PLAN) assert.ok(again.calls.includes(step), `${step} skipped: ${again.calls.join(', ')}`);
  assert.ok(!again.calls.includes('prepare'), 'the workspace is kept either way');
});

test('resume: a compiled input newer than the video renders again, without recompiling', async () => {
  const { db, job, root } = await failedAtRender();
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(path.join(projectOf(root, job.id), 'index.html'), later, later);
  const again = deps(db, { root });
  assert.equal((await runJob(again.deps, job)).status, 'ok');
  assert.ok(again.calls.includes('render'));
  for (const step of ['voice', 'sound', 'compile', 'creative']) assert.ok(!again.calls.includes(step), step);
});

test('fresh job: nothing is resumed, every step runs', async () => {
  const db = await scratch();
  const job = await freshJob(db);
  const run = deps(db);
  assert.equal((await runJob(run.deps, job)).status, 'ok');
  for (const step of ['prepare', ...PAID_AFTER_PLAN]) assert.ok(run.calls.includes(step), step);
  assert.deepEqual(run.logs.filter((l) => l.event === 'resumed'), []);
});
