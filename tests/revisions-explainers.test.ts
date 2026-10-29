/**
 * Targeted Revisions task 11: the Explainers description on PGlite (the real explainers, spine and
 * revisions schema files). Offline: the Agent SDK session is a canned message stream, the render, the
 * lint and bounds checks are stubs, and storage is a temp folder. One job, three scenes and a caption.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { ExplainersDb } from '@/lib/explainers/db';
import { schemaSql } from '@/lib/explainers/local-db';
import { explainerItemId } from '@/lib/explainers/publish/items';
import { unscheduleJob } from '@/lib/explainers/publish/schedule';
import type { AgentMessage, AgentQuery } from '@/lib/explainers/render/agent';
import { RESUME_PROMPT, rebuildScene, sceneResumeNote } from '@/lib/explainers/render/job';
import { ChargedSpendMeter } from '@/lib/explainers/render/meter';
import { workspacePaths } from '@/lib/explainers/render/workspace';
import { claimNextJob, failStaleRunningJobs, saveFeedback } from '@/lib/explainers/repository';
import { DEFAULT_SETTINGS } from '@/lib/explainers/settings';
import { localArtifactStore } from '@/lib/explainers/storage';
import type { LintViolation } from '@/lib/explainers/types';
import { explainerActions } from '@/lib/publishing/actions/explainers';
import { CeilingReached, createCostMeter, resetCapsForTest, setCapsForTest } from '@/lib/revisions/caps';
import { hold, putBack as realPutBack, setAside } from '@/lib/revisions/explainers-folder';
import { claimAndRunRevisions } from '@/lib/revisions/worker';
import {
  EXPLAINERS_FOLDER_GONE_NOTE,
  recoverSceneRedos,
  EXPLAINERS_SCENE_REDO_SHARE,
  EXPLAINERS_STAGE_TAGS,
  createExplainersDescription,
  retainJobFolder,
  type ExplainersDeps,
} from '@/lib/revisions/descriptions/explainers';
import { runRevision, undoRevision } from '@/lib/revisions/engine';
import { descriptionFor, registerDescription, restoreRegistryForTest } from '@/lib/revisions/registry';
import { claimNextRequested, createRequest, getRequest, markRunning } from '@/lib/revisions/store';
import type { Interpretation, PartRef } from '@/lib/revisions/types';
import type { Query } from '@/lib/social/store/pg';

import { scratchExplainersDb } from './explainers-pglite';

const TOPIC = '71000000-0000-4000-8000-000000000001';
const JOB = '71000000-0000-4000-8000-000000000002';
const OTHER_TOPIC = '71000000-0000-4000-8000-000000000003';
const OTHER_JOB = '71000000-0000-4000-8000-000000000004';
const DAY = 24 * 60 * 60 * 1000;
const CREATED = new Date('2026-10-20T12:00:00Z');
const NOW = new Date(CREATED.getTime() + 2 * DAY);

const STORYBOARD = `---
term: webhook
concept: webhook
---

## Frame 1 — Series opener

- duration: 3.5s
- src: compositions/frames/01-opener.html
- voiceover: "In the next 30 seconds, this little mailbox will teach you an AI concept."
- scene: The carrier sprints up the drive and the flag slams up mid-stride

## Frame 2 — The gap

- duration: 5s
- src: compositions/frames/02-gap.html
- voiceover: "How do you know a letter came without walking out to check?"
- scene: A critter peeks out of the window at an empty mailbox

## Frame 3 — Dictionary

- duration: 4s
- src: compositions/frames/03-dictionary.html
- voiceover: "A webhook rings your app the moment something happens."
- scene: A dictionary card with the word webhook
`;
const SCRIPT = '# SCRIPT\n\n## Line 1 — Opener (Frame 1)\n\n    In the next 30 seconds, this little mailbox will teach you an AI concept.\n';

const CAPTION = [
  'Still refreshing a page to see if anything changed? 📬',
  '',
  'A webhook is the mailbox flag of software: the other app tells yours the moment something happens, so nobody walks out to check.',
  '',
  'Save this for the next time someone asks how apps talk.',
  '',
  'A dental practice should stop polling its booking tool, because Helios wires the flag straight to the front desk.',
  '',
  '#webhooks #ai #automation',
].join('\n');
const NEW_CAPTION = CAPTION.replace('Still refreshing a page', 'Still checking the inbox every minute');

const MODULES: Record<string, string> = {
  '01-opener.js': "// Frame 1 (EX3-102): the bank's opener over the hook (01-hook.js).\nexport default {};\n",
  '01-hook.js': 'export default { draw: () => "hook" };\n',
  '02-gap.js': 'export default { draw: () => "gap" };\n',
  '02-gap.events.json': '[{"at":0.5,"sfx":"pop"}]\n',
  '03-dictionary.js': 'export default { draw: () => "<text>webhook</text>" };\n',
};
const OLD_VIDEO = `jobs/${JOB}/video.mp4`;
const OLD_SHEET = `jobs/${JOB}/contact-sheet.jpg`;

// ── Fixture ────────────────────────────────────────────────────────────────

type Fx = { db: ExplainersDb; q: Query; root: string; jobsRoot: string; projectDir: string; storageDir: string };

async function fixture(opts: { spendUsd?: number } = {}): Promise<Fx> {
  const { db, pg } = await scratchExplainersDb();
  await pg.exec(schemaSql(path.join(process.cwd(), 'db', 'revisions_schema.sql')));
  const q: Query = (text, params) => db.query(text, params) as Promise<{ rows: any[] }>;
  await db.query(`INSERT INTO explainers.topics (id, title, origin, status) VALUES ($1, 'What is a webhook?', 'manual', 'rendered')`, [TOPIC]);
  await db.query(
    `INSERT INTO explainers.jobs (id, topic_id, status, stage, trigger, mode, spend_usd, spend_cap_usd, orchestrator_model, frame_worker_model, opener, requested_at, finished_at)
     VALUES ($1, $2, 'ok', 'caption', 'click', 'development', $3, 8, 'claude-sonnet-5-5', 'claude-sonnet-5-5', 'paper-rip', $4, $4)`,
    [JOB, TOPIC, opts.spendUsd ?? 2, CREATED.toISOString()],
  );
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'storyboard', $2), ($1, 'script', $3)`, [JOB, STORYBOARD, SCRIPT]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', $2, 9, 'bucket')`, [JOB, OLD_VIDEO]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'contact_sheet', $2, 5, 'bucket')`, [JOB, OLD_SHEET]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'captions', $2, 3, 'bucket')`, [JOB, `jobs/${JOB}/caption_groups.json`]);
  await db.query(`INSERT INTO explainers.artifacts (job_id, kind, content) VALUES ($1, 'post_caption', $2)`, [JOB, CAPTION]);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-explainers-'));
  const jobsRoot = path.join(root, 'jobs');
  const storageDir = path.join(root, 'storage');
  const projectDir = workspacePaths(jobsRoot, JOB).projectDir;
  fs.mkdirSync(path.join(projectDir, 'assets', 'frames'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'renders'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'snapshots'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'STORYBOARD.md'), STORYBOARD);
  fs.writeFileSync(path.join(projectDir, 'SCRIPT.md'), SCRIPT);
  for (const [f, src] of Object.entries(MODULES)) fs.writeFileSync(path.join(projectDir, 'assets', 'frames', f), src);
  fs.writeFileSync(path.join(projectDir, 'renders', 'video.mp4'), 'old-mp4');
  fs.writeFileSync(path.join(projectDir, 'snapshots', 'contact-sheet.jpg'), 'old-jpg');
  // The stored copies the old artifacts point at.
  fs.mkdirSync(path.join(storageDir, 'jobs', JOB), { recursive: true });
  fs.writeFileSync(path.join(storageDir, OLD_VIDEO), 'old-mp4');
  fs.writeFileSync(path.join(storageDir, OLD_SHEET), 'old-jpg');
  return { db, q, root, jobsRoot, projectDir, storageDir };
}

const assistant = (id: string, inputTokens: number): AgentMessage => ({
  type: 'assistant',
  session_id: 'sess-r',
  parent_tool_use_id: null,
  message: { id, model: 'claude-sonnet-5-5', usage: { input_tokens: inputTokens, output_tokens: 100 }, content: [{ type: 'text', text: 'working' }] },
});
const result = (cost: number): AgentMessage => ({
  type: 'result',
  session_id: 'sess-r',
  subtype: 'success',
  is_error: false,
  total_cost_usd: cost,
  modelUsage: { 'claude-sonnet-5-5': { inputTokens: 1000, outputTokens: 100, costUSD: cost } },
  errors: [],
});

type SessionLog = { prompts: string[]; atStart: string[]; paidMessages: number; options?: Record<string, any> };

/** A session that rebuilds the named frame: writes a new module, a new video and a new contact sheet. */
function sceneSession(
  log: SessionLog,
  opts: { messages?: number; writeModule?: boolean; inputTokens?: number; alsoWrite?: Record<string, string>; after?: (projectDir: string) => void } = {},
): AgentQuery {
  return ({ prompt, options }) =>
    (async function* () {
      log.prompts.push(prompt);
      log.options = options;
      const dir = String(options.cwd);
      log.atStart = fs.readdirSync(path.join(dir, 'assets', 'frames')).sort();
      for (const [rel, body] of Object.entries(opts.alsoWrite ?? {})) fs.writeFileSync(path.join(dir, rel), body);
      const frame = /Stale frame: ([a-z0-9-]+)\./.exec(prompt)?.[1] ?? 'none';
      const signal = (options.abortController as AbortController).signal;
      for (let i = 0; i < (opts.messages ?? 1); i += 1) {
        log.paidMessages += 1;
        yield assistant(`m${i}`, opts.inputTokens ?? 100_000);
        if (signal.aborted) throw new Error('aborted');
      }
      if (opts.writeModule !== false) fs.writeFileSync(path.join(dir, 'assets', 'frames', `${frame}.js`), `export default { draw: () => "<text>new ${frame} webhook</text>" };\n`);
      fs.writeFileSync(path.join(dir, 'renders', 'video.mp4'), `new-mp4-${frame}`);
      fs.writeFileSync(path.join(dir, 'snapshots', 'contact-sheet.jpg'), `new-jpg-${frame}`);
      opts.after?.(dir);
      yield result(0.4);
    })();
}

function depsFor(fx: Fx, over: Partial<ExplainersDeps> & { query?: AgentQuery; bounds?: LintViolation[]; log?: SessionLog } = {}): ExplainersDeps {
  const log = over.log ?? { prompts: [], atStart: [], paidMessages: 0 };
  const store = localArtifactStore(fx.storageDir);
  let n = 0;
  return {
    explainersDb: async () => fx.db,
    jobsRoot: () => fx.jobsRoot,
    folderExists: async (jobId) => fs.existsSync(path.join(workspacePaths(fx.jobsRoot, jobId).projectDir, 'STORYBOARD.md')),
    redoScene: async (input, m) => {
      const meter = new ChargedSpendMeter(input.job.spend_cap_usd, input.job.spend_usd, (usd) => m.spend(usd));
      return rebuildScene(
        {
          db: fx.db,
          query: over.query ?? sceneSession(log),
          jobsRoot: fx.jobsRoot,
          secrets: { anthropicApiKey: 'sk' },
          voiceId: 'voice-1',
          meter,
          hyperframesLint: () => [],
          boundsCheck: () => over.bounds ?? [],
          repairAssembly: () => [],
          renderVideo: () => undefined,
        },
        input.job,
        { frameId: input.frameId, frameNumber: input.frameNumber, note: input.note },
      );
    },
    store: async (key, localPath) => {
      const out = await store.put(key, localPath);
      return { ...out, location: 'bucket' as const };
    },
    unscheduleJob: (db, jobId) => unscheduleJob(db, jobId),
    now: () => NOW,
    newId: () => `r${(n += 1)}`,
    ...over,
  };
}

const sceneFix = (key: string, fixKind: Interpretation['fixKind'] = 'wording', args?: Record<string, string>): Interpretation => ({
  vertical: 'explainers',
  part: { kind: 'scene', key },
  fixKind,
  stageTag: 'build',
  instruction: 'Make the critter wave at the mailbox instead of peeking.',
  ...(args ? { args } : {}),
});
const captionFix = (value?: string): Interpretation => ({
  vertical: 'explainers',
  part: { kind: 'caption', key: 'caption' },
  fixKind: 'wording',
  stageTag: 'caption',
  instruction: 'Change the caption hook.',
  ...(value !== undefined ? { args: { value } } : {}),
});

const meter = (ceiling = 100) => createCostMeter(ceiling);
const refs = { jobId: JOB, topicId: TOPIC };

async function latest(db: ExplainersDb, kind: string): Promise<{ storage_path: string | null; content: string | null } | undefined> {
  const { rows } = await db.query<{ storage_path: string | null; content: string | null }>(
    `SELECT storage_path, content FROM explainers.artifacts WHERE job_id = $1 AND kind = $2 ORDER BY seq DESC LIMIT 1`,
    [JOB, kind],
  );
  return rows[0];
}
const artifactCount = async (db: ExplainersDb) => Number((await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM explainers.artifacts WHERE job_id = $1`, [JOB])).rows[0]!.n);
const jobRow = async (db: ExplainersDb) => (await db.query<{ status: string; stage: string }>(`SELECT status, stage FROM explainers.jobs WHERE id = $1`, [JOB])).rows[0]!;
const moduleOnDisk = (fx: Fx, file: string) => {
  const p = path.join(fx.projectDir, 'assets', 'frames', file);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
};

// ── Retention ──────────────────────────────────────────────────────────────

test('retainJobFolder is true at day 6 unpublished and false at day 8', () => {
  assert.equal(retainJobFolder({ createdAt: CREATED }, new Date(CREATED.getTime() + 6 * DAY)), true);
  assert.equal(retainJobFolder({ createdAt: CREATED.toISOString(), publishedAt: null }, new Date(CREATED.getTime() + 8 * DAY)), false);
});

test('retainJobFolder is false once published even at day 2', () => {
  assert.equal(retainJobFolder({ createdAt: CREATED, publishedAt: new Date(CREATED.getTime() + DAY) }, new Date(CREATED.getTime() + 2 * DAY)), false);
});

// ── Shape ──────────────────────────────────────────────────────────────────

test('stage tags, fix kinds, args guide and estimates; registered in the static registry', async () => {
  const fx = await fixture();
  const d = createExplainersDescription(depsFor(fx));
  assert.equal(d.vertical, 'explainers');
  assert.equal(d.label, 'explainers');
  assert.deepEqual([...d.stageTags], ['plan', 'lint', 'build', 'render', 'caption']);
  assert.deepEqual([...EXPLAINERS_STAGE_TAGS], ['plan', 'lint', 'build', 'render', 'caption']);
  assert.deepEqual([...d.fixKinds].sort(), ['color', 'layout', 'photo', 'wording']);
  for (const k of ['wording', 'photo', 'color', 'layout'] as const) assert.ok(d.argsGuide?.[k], `args guide for ${k}`);
  assert.match(d.argsGuide!.wording!, /args\.value/);
  assert.match(d.argsGuide!.wording!, /args\.note/);
  const scene = DEFAULT_SETTINGS.per_reel_cap_usd * EXPLAINERS_SCENE_REDO_SHARE;
  for (const k of ['photo', 'color', 'layout', 'wording'] as const) assert.equal(d.estimate(k), scene);
  assert.ok(scene > 0 && scene < DEFAULT_SETTINGS.per_reel_cap_usd);
  restoreRegistryForTest();
  assert.equal(descriptionFor('explainers')?.vertical, 'explainers');
});

// ── load ───────────────────────────────────────────────────────────────────

test('load lists the worker-made scenes (the hook, not the bank opener) and the caption, and maps status', async () => {
  const fx = await fixture();
  const d = createExplainersDescription(depsFor(fx));
  const snap = await d.load(fx.q, refs);
  assert.ok(snap);
  assert.deepEqual(snap.parts.map((p) => `${p.ref.kind}:${p.ref.key}`), ['scene:01-hook', 'scene:02-gap', 'scene:03-dictionary', 'caption:caption']);
  assert.match(snap.parts[1]!.text!, /Frame 2/);
  assert.match(snap.parts[1]!.text!, /peeks out of the window/);
  assert.match(snap.parts[3]!.text!, /mailbox flag of software/);
  assert.equal(snap.status, 'review');

  await saveFeedback(fx.db, { jobId: JOB, verdict: 'approved', tags: [] });
  assert.equal((await d.load(fx.q, refs))!.status, 'approved');
  const item = (await explainerItemId(fx.db, JOB))!;
  await fx.db.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'explainers', '2026-10-23', 'afternoon', '2026-10-23T17:30:00Z', 'scheduled', 'auto')`,
    [item],
  );
  assert.equal((await d.load(fx.q, refs))!.status, 'scheduled');
  await fx.db.query(`UPDATE social_hub.schedule SET status = 'publishing' WHERE content_item_id = $1`, [item]);
  assert.equal((await d.load(fx.q, refs))!.status, 'published');
  await fx.db.query(`UPDATE social_hub.schedule SET status = 'cancelled' WHERE content_item_id = $1`, [item]);
  await saveFeedback(fx.db, { jobId: JOB, verdict: 'rejected', tags: [] });
  assert.equal((await d.load(fx.q, refs))!.status, 'rejected');
  await fx.db.query(`UPDATE explainers.jobs SET status = 'failed' WHERE id = $1`, [JOB]);
  await fx.db.query(`DELETE FROM explainers.feedback WHERE job_id = $1`, [JOB]);
  await fx.db.query(`DELETE FROM social_hub.approvals`);
  assert.equal((await d.load(fx.q, refs))!.status, 'preview');
  assert.equal(await d.load(fx.q, { jobId: '71000000-0000-4000-8000-0000000000ff' }), null);
});

// ── Caption ────────────────────────────────────────────────────────────────

test('caption-only fix needs no agent session', async () => {
  const fx = await fixture();
  let sessions = 0;
  const d = createExplainersDescription(depsFor(fx, { redoScene: async () => { sessions += 1; throw new Error('no session expected'); }, folderExists: async () => false }));
  const m = meter();
  const out = await d.revise({ q: fx.q, refs, interpretation: captionFix(NEW_CAPTION), meter: m });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(sessions, 0);
  assert.equal(m.spent, 0);
  assert.equal((await latest(fx.db, 'post_caption'))!.content, NEW_CAPTION);
  assert.equal((await latest(fx.db, 'video'))!.storage_path, OLD_VIDEO, 'the video is untouched');
  if (out.ok) {
    assert.deepEqual((out.before.copy as { caption: string }).caption, CAPTION);
    assert.deepEqual((out.after.copy as { caption: string }).caption, NEW_CAPTION);
    // restore puts the old caption back, and is idempotent
    await d.restore({ q: fx.q, refs, part: { kind: 'caption', key: 'caption' }, state: out.before });
    const n = await artifactCount(fx.db);
    await d.restore({ q: fx.q, refs, part: { kind: 'caption', key: 'caption' }, state: out.before });
    assert.equal(await artifactCount(fx.db), n);
    assert.equal((await latest(fx.db, 'post_caption'))!.content, CAPTION);
  }
});

test('a caption that breaks the caption rules is blocked; a missing or unchanged value fails; nothing written', async () => {
  const fx = await fixture();
  const d = createExplainersDescription(depsFor(fx));
  const n = await artifactCount(fx.db);
  const bad = await d.revise({ q: fx.q, refs, interpretation: captionFix('Too short. #a #b #c'), meter: meter() });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.reason, 'blocked');
    assert.match(bad.note, /caption/);
  }
  const missing = await d.revise({ q: fx.q, refs, interpretation: captionFix(), meter: meter() });
  assert.deepEqual(missing.ok ? null : missing.reason, 'failed');
  const same = await d.revise({ q: fx.q, refs, interpretation: captionFix(CAPTION), meter: meter() });
  assert.deepEqual(same.ok ? null : same.reason, 'failed');
  const photo = await d.revise({ q: fx.q, refs, interpretation: { ...captionFix(NEW_CAPTION), fixKind: 'photo' }, meter: meter() });
  assert.deepEqual(photo.ok ? null : photo.reason, 'failed');
  assert.equal(await artifactCount(fx.db), n);
});

// ── Scene redo ─────────────────────────────────────────────────────────────

test('scene redo with a missing folder is refused with the plain note', async () => {
  const fx = await fixture();
  let sessions = 0;
  const redoScene: ExplainersDeps['redoScene'] = async () => {
    sessions += 1;
    throw new Error('no session expected');
  };
  const gone = createExplainersDescription(depsFor(fx, { folderExists: async () => false, redoScene }));
  const n = await artifactCount(fx.db);
  const out = await gone.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.deepEqual(out, { ok: false, reason: 'failed', note: EXPLAINERS_FOLDER_GONE_NOTE });
  assert.equal(EXPLAINERS_FOLDER_GONE_NOTE, "This explainer's working files were cleaned up, so single scenes can't be redone.");
  // Past the retention window (day 8, unpublished) the folder no longer counts even when it is there.
  const late = createExplainersDescription(depsFor(fx, { redoScene, now: () => new Date(CREATED.getTime() + 8 * DAY) }));
  assert.deepEqual(await late.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() }), { ok: false, reason: 'failed', note: EXPLAINERS_FOLDER_GONE_NOTE });
  assert.equal(sessions, 0);
  assert.equal(await artifactCount(fx.db), n);
  assert.equal((await jobRow(fx.db)).status, 'ok');
});

test('scene redo deletes only that frame\'s module and calls resume with a resumeNote naming it (injected session runner)', async () => {
  const fx = await fixture();
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  const d = createExplainersDescription(depsFor(fx, { log }));
  const m = meter();
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap', 'photo', { note: 'Make the critter wave at the mailbox.' }), meter: m });
  assert.equal(out.ok, true, JSON.stringify(out));
  // One session, the resume prompt with the note naming 02-gap and the person's words.
  assert.equal(log.prompts.length, 1);
  assert.equal(log.prompts[0], `${RESUME_PROMPT} ${sceneResumeNote('02-gap', 'Make the critter wave at the mailbox.')}`);
  assert.match(log.prompts[0]!, /Stale frame: 02-gap\./);
  assert.match(log.prompts[0]!, /Make the critter wave at the mailbox\./);
  // When the session started only 02-gap's module and sound events were gone: renamed aside, not deleted.
  assert.deepEqual(log.atStart, ['01-hook.js', '01-opener.js', '02-gap.events.json.before-revr1', '02-gap.js.before-revr1', '03-dictionary.js']);
  // The session is voice-locked: no HeyGen key and no HeyGen hosts, so the voice cannot be made again.
  assert.equal(log.options!.env.HEYGEN_API_KEY, undefined);
  assert.ok(!log.options!.sandbox.network.allowedDomains.some((d: string) => /heygen/.test(d)));
  assert.ok(log.options!.sandbox.network.allowedDomains.includes('cdn.jsdelivr.net'));
  assert.equal(fs.existsSync(path.join(fx.jobsRoot, JOB, 'revision-hold.json')), false, 'the manifest goes once the redo is kept');
  // Other scenes untouched, byte for byte.
  for (const f of ['01-hook.js', '01-opener.js', '03-dictionary.js']) assert.equal(moduleOnDisk(fx, f), MODULES[f]);
  assert.equal(moduleOnDisk(fx, '02-gap.js'), 'export default { draw: () => "<text>new 02-gap webhook</text>" };\n');
  // The session was metered as it streamed and settled to its reported total.
  assert.ok(m.spent >= 0.4, `metered ${m.spent}`);
  // New video under a NEW key; the old stored file and its path are kept.
  const vid = (await latest(fx.db, 'video'))!.storage_path!;
  assert.equal(vid, `jobs/${JOB}/video.revr1.mp4`);
  assert.equal(fs.readFileSync(path.join(fx.storageDir, vid), 'utf8'), 'new-mp4-02-gap');
  assert.equal(fs.readFileSync(path.join(fx.storageDir, OLD_VIDEO), 'utf8'), 'old-mp4');
  assert.equal((await latest(fx.db, 'contact_sheet'))!.storage_path, `jobs/${JOB}/contact-sheet.revr1.jpg`);
  assert.equal((await latest(fx.db, 'post_caption'))!.content, CAPTION, 'the caption is not derived from the frames');
  assert.deepEqual(await jobRow(fx.db), { status: 'ok', stage: 'caption' }, 'the job is released with its stage');
  if (out.ok) {
    assert.ok(out.before.files.includes(OLD_VIDEO));
    assert.ok(out.before.files.includes(OLD_SHEET));
    assert.ok(out.after.files.includes(vid));
    assert.deepEqual(out.before.copy, { module: MODULES['02-gap.js'], events: MODULES['02-gap.events.json'] });
    // Restore: the old module back on disk and the old video and contact sheet as the current pointers. Idempotent.
    await d.restore({ q: fx.q, refs, part: { kind: 'scene', key: '02-gap' }, state: out.before });
    assert.equal((await latest(fx.db, 'video'))!.storage_path, OLD_VIDEO);
    assert.equal((await latest(fx.db, 'contact_sheet'))!.storage_path, OLD_SHEET);
    assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
    assert.equal(moduleOnDisk(fx, '02-gap.events.json'), MODULES['02-gap.events.json']);
    const n = await artifactCount(fx.db);
    await d.restore({ q: fx.q, refs, part: { kind: 'scene', key: '02-gap' }, state: out.before });
    assert.equal(await artifactCount(fx.db), n, 'a second restore writes nothing');
    assert.equal(fs.readFileSync(path.join(fx.storageDir, vid), 'utf8'), 'new-mp4-02-gap', 'the revision\'s video stays in storage');
  }
});

test('every scene fix kind takes the instruction as the note when args.note is missing; bad parts and an empty note fail', async () => {
  const fx = await fixture();
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  const d = createExplainersDescription(depsFor(fx, { log }));
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('03-dictionary', 'layout'), meter: meter() });
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.match(log.prompts[0]!, /Make the critter wave at the mailbox instead of peeking\./);
  const n = await artifactCount(fx.db);
  for (const it of [
    { ...sceneFix('02-gap', 'color'), instruction: '  ' },
    sceneFix('01-opener'),
    sceneFix('09-nothing'),
    sceneFix('../etc'),
    { ...sceneFix('02-gap'), fixKind: 'motion' as const },
  ]) {
    const r = await d.revise({ q: fx.q, refs, interpretation: it, meter: meter() });
    assert.equal(r.ok, false, JSON.stringify(it));
    if (!r.ok) assert.equal(r.reason, 'failed');
  }
  assert.equal(log.prompts.length, 1, 'no session for a refused fix');
  assert.equal(await artifactCount(fx.db), n);
});

test('a scene that fails the text-bounds check is blocked; the old module and video come back on disk; nothing written', async () => {
  const fx = await fixture();
  const d = createExplainersDescription(
    depsFor(fx, { bounds: [{ source: 'hyperframes', rule: 'text_bounds', frame: 2, severity: 'error', detail: 'bounds.mjs: 02-gap: "mailbox" is cut off' }] }),
  );
  const n = await artifactCount(fx.db);
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(out.ok, false);
  if (!out.ok) {
    assert.equal(out.reason, 'blocked');
    assert.match(out.note, /cut off/);
  }
  assert.equal(await artifactCount(fx.db), n);
  assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal(moduleOnDisk(fx, '02-gap.events.json'), MODULES['02-gap.events.json']);
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'old-mp4');
  assert.deepEqual(await jobRow(fx.db), { status: 'ok', stage: 'caption' });
});

test('a frame worker that writes no module fails with the original kept', async () => {
  const fx = await fixture();
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  const d = createExplainersDescription(depsFor(fx, { log, query: sceneSession(log, { writeModule: false }) }));
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(out.ok ? null : out.reason, 'failed');
  assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal((await latest(fx.db, 'video'))!.storage_path, OLD_VIDEO);
});

test('a scene redo never runs while a render is running (the one-at-a-time index), and holds that index while it runs', async () => {
  const fx = await fixture();
  await fx.db.query(`INSERT INTO explainers.topics (id, title, origin, status) VALUES ($1, 'Other', 'manual', 'queued')`, [OTHER_TOPIC]);
  await fx.db.query(
    `INSERT INTO explainers.jobs (id, topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model) VALUES ($1, $2, 'running', 'click', 'development', 8, 'm', 'm')`,
    [OTHER_JOB, OTHER_TOPIC],
  );
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  const d = createExplainersDescription(depsFor(fx, { log }));
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(out.ok ? null : out.reason, 'failed');
  if (!out.ok) assert.match(out.note, /render is running/);
  assert.equal(log.prompts.length, 0, 'nothing paid');
  assert.equal((await jobRow(fx.db)).status, 'ok');

  // While a redo runs, its job holds the running slot, so the render worker claims nothing.
  await fx.db.query(`UPDATE explainers.jobs SET status = 'requested' WHERE id = $1`, [OTHER_JOB]);
  let during: string | undefined;
  const watching = createExplainersDescription(
    depsFor(fx, {
      log,
      query: (args) => {
        return (async function* () {
          during = (await jobRow(fx.db)).status;
          const claimed = await fx.db.query(`UPDATE explainers.jobs SET status = 'running' WHERE status = 'requested' AND NOT EXISTS (SELECT 1 FROM explainers.jobs WHERE status = 'running') RETURNING id`);
          assert.equal(claimed.rows.length, 0, 'claimNextJob finds a running job and waits');
          yield* sceneSession(log)(args);
        })();
      },
    }),
  );
  const ok = await watching.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(during, 'running');
  assert.deepEqual(await jobRow(fx.db), { status: 'ok', stage: 'caption' });
});

test('the job\'s own per-reel spend cap still applies: too little left for the estimate is blocked before any session, a cap hit mid-session is blocked and rolled back', async () => {
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  for (const spendUsd of [8, 6.5]) {
    const spent = await fixture({ spendUsd });
    const out = await createExplainersDescription(depsFor(spent, { log })).revise({ q: spent.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
    assert.equal(out.ok ? null : out.reason, 'blocked');
    if (!out.ok) assert.match(out.note, /left of its \$8\.00 spending cap/);
  }
  assert.equal(log.prompts.length, 0, 'no session');

  const near = await fixture({ spendUsd: 5.9 });
  const mid = await createExplainersDescription(depsFor(near, { log, query: sceneSession(log, { messages: 3, inputTokens: 2_000_000 }) })).revise({
    q: near.q,
    refs,
    interpretation: sceneFix('02-gap'),
    meter: meter(),
  });
  assert.equal(mid.ok ? null : mid.reason, 'blocked');
  if (!mid.ok) assert.match(mid.note, /reached this explainer's \$8\.00 spending cap/);
  assert.equal(log.paidMessages, 1);
  assert.equal(moduleOnDisk(near, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal((await latest(near.db, 'video'))!.storage_path, OLD_VIDEO);
  assert.deepEqual(await jobRow(near.db), { status: 'ok', stage: 'caption' });
});

test('scene redo respects the meter and pauses at the ceiling: exactly one paid message, nothing kept', async () => {
  const fx = await fixture();
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  registerDescription(createExplainersDescription(depsFor(fx, { log, query: sceneSession(log, { messages: 5 }) })));
  setCapsForTest({ explainers: { wording: { capUsd: 5, ceilingUsd: 0.05 } } });
  try {
    const itemId = (await explainerItemId(fx.db, JOB))!;
    const req = await createRequest(fx.q, { vertical: 'explainers', refs, itemId, by: 'tommy', instruction: 'wave' });
    const it = sceneFix('02-gap');
    await markRunning(fx.q, req.id, it, 5, 0.05);
    const n = await artifactCount(fx.db);
    await runRevision({ q: fx.q, notify: async () => undefined, now: () => NOW }, { ...(await getRequest(fx.q, req.id))!, interpretation: it });
    const row = (await getRequest(fx.q, req.id))!;
    assert.equal(row.status, 'paused_at_ceiling', row.note ?? '');
    assert.equal(log.paidMessages, 1, 'the session stopped at the first message past the ceiling');
    assert.equal(await artifactCount(fx.db), n);
    assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
    assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'old-mp4');
    assert.deepEqual(await jobRow(fx.db), { status: 'ok', stage: 'caption' });
  } finally {
    resetCapsForTest();
    restoreRegistryForTest();
  }
});

test('ChargedSpendMeter charges each streamed message and the settled remainder; once the charge throws it reports over cap and charges nothing more', () => {
  const charged: number[] = [];
  const m = new ChargedSpendMeter(8, 0, (usd) => charged.push(usd));
  const usd = m.observe({ id: 'a', model: 'claude-sonnet-5-5', usage: { input_tokens: 100_000, output_tokens: 100 } });
  assert.ok(usd > 0);
  m.settleSession(usd + 0.1);
  assert.equal(charged.length, 2);
  assert.ok(Math.abs(charged[1]! - 0.1) < 1e-9);
  const ceiling = createCostMeter(0.01);
  const stopped = new ChargedSpendMeter(8, 0, (x) => ceiling.spend(x));
  stopped.observe({ id: 'b', model: 'claude-sonnet-5-5', usage: { input_tokens: 100_000, output_tokens: 100 } });
  assert.equal(stopped.overCap, true);
  assert.ok(stopped.stopError instanceof CeilingReached);
  const before = ceiling.spent;
  stopped.observe({ id: 'c', model: 'claude-sonnet-5-5', usage: { input_tokens: 100_000, output_tokens: 100 } });
  stopped.settleSession(5);
  assert.equal(ceiling.spent, before, 'nothing charged after the stop');
});

// ── Undo order ─────────────────────────────────────────────────────────────

test('undo out of order: a scene then the caption, undoing the scene keeps the new caption; two scenes undo newest first', async () => {
  const fx = await fixture();
  registerDescription(createExplainersDescription(depsFor(fx)));
  setCapsForTest({ explainers: { wording: { capUsd: 5, ceilingUsd: 10 }, layout: { capUsd: 5, ceilingUsd: 10 } } });
  const engine = { q: fx.q, notify: async () => undefined, now: () => NOW };
  const itemId = (await explainerItemId(fx.db, JOB))!;
  const run = async (it: Interpretation) => {
    const req = await createRequest(fx.q, { vertical: 'explainers', refs, itemId, by: 'tommy', instruction: it.instruction });
    await markRunning(fx.q, req.id, it, 5, 10);
    await runRevision(engine, { ...(await getRequest(fx.q, req.id))!, interpretation: it });
    const row = (await getRequest(fx.q, req.id))!;
    assert.equal(row.status, 'applied', row.note ?? '');
  };
  const gap: PartRef = { kind: 'scene', key: '02-gap' };
  const dict: PartRef = { kind: 'scene', key: '03-dictionary' };
  try {
    await run(sceneFix('02-gap'));
    await run(captionFix(NEW_CAPTION));
    const undoGap = await undoRevision(engine, itemId, gap, 'tommy');
    assert.equal(undoGap.ok, true, undoGap.note);
    assert.equal((await latest(fx.db, 'post_caption'))!.content, NEW_CAPTION, 'the caption fix survives the scene undo');
    assert.equal((await latest(fx.db, 'video'))!.storage_path, OLD_VIDEO);

    await run(sceneFix('02-gap'));
    await run(sceneFix('03-dictionary', 'layout'));
    const early = await undoRevision(engine, itemId, gap, 'tommy');
    assert.equal(early.ok, false, 'undoing the older scene would drop the newer scene\'s video');
    assert.match(early.note, /later fix/);
    assert.ok((await latest(fx.db, 'video'))!.storage_path!.endsWith('.mp4'));
    assert.equal(moduleOnDisk(fx, '03-dictionary.js'), 'export default { draw: () => "<text>new 03-dictionary webhook</text>" };\n');
    assert.equal((await undoRevision(engine, itemId, dict, 'tommy')).ok, true);
    assert.equal(moduleOnDisk(fx, '03-dictionary.js'), MODULES['03-dictionary.js']);
    assert.equal((await undoRevision(engine, itemId, gap, 'tommy')).ok, true);
    assert.equal((await latest(fx.db, 'video'))!.storage_path, OLD_VIDEO);
    assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  } finally {
    resetCapsForTest();
    restoreRegistryForTest();
  }
});

// ── Unschedule, interrupted claims ─────────────────────────────────────────

test('unschedule delegates to unscheduleJob: the slot is cancelled and the approval withdrawn', async () => {
  const fx = await fixture();
  await saveFeedback(fx.db, { jobId: JOB, verdict: 'approved', tags: [] });
  const item = (await explainerItemId(fx.db, JOB))!;
  await fx.db.query(
    `INSERT INTO social_hub.schedule (content_item_id, vertical, ny_date, slot, publish_at, status, source) VALUES ($1, 'explainers', '2026-10-23', 'afternoon', '2026-10-23T17:30:00Z', 'scheduled', 'auto')`,
    [item],
  );
  const calls: string[] = [];
  const d = createExplainersDescription(depsFor(fx, { unscheduleJob: async (db, jobId) => { calls.push(jobId); return unscheduleJob(db, jobId); } }));
  const out = await d.unschedule(fx.q, refs);
  assert.equal(out.ok, true);
  assert.deepEqual(calls, [JOB]);
  assert.equal((await d.load(fx.q, refs))!.status, 'review');
});

test('the stale-render sweep never touches a redo hold (recovery owns it): not failed, not released', async () => {
  const fx = await fixture();
  await fx.db.query(`UPDATE explainers.jobs SET status = 'running', stage = 'revision:x1' WHERE id = $1`, [JOB]);
  assert.equal(await failStaleRunningJobs(fx.db, 'worker restarted'), 0);
  const row = (await fx.db.query<{ status: string; stage: string; error: string | null }>(`SELECT status, stage, error FROM explainers.jobs WHERE id = $1`, [JOB])).rows[0]!;
  assert.deepEqual(row, { status: 'running', stage: 'revision:x1', error: null });
});

// ── Where the rows live (the DB split) ─────────────────────────────────────

test('a revise request made through the Explainers verbs lands where the worker claims it, and the description loads it through its own handle', async () => {
  const fx = await fixture();
  // Two distinct handles over the one shared database: the explainers handle and the worker's revisions query.
  const explainersHandle: ExplainersDb = { query: (t, p) => fx.db.query(t, p), transaction: (fn) => fx.db.transaction(fn) };
  const revisionsQ: Query = (t, p) => fx.db.query(t, p) as Promise<{ rows: any[] }>;
  let explainersReads = 0;
  const desc = createExplainersDescription({
    ...depsFor(fx),
    explainersDb: async () => {
      explainersReads += 1;
      return explainersHandle;
    },
  });
  registerDescription(desc);
  const actions = (revisionsQuery: () => Promise<Query | null>) =>
    explainerActions({
      db: async () => explainersHandle,
      itemId: explainerItemId,
      revisionsQuery,
    } as unknown as Parameters<typeof explainerActions>[0]);
  try {
    const out = await actions(async () => revisionsQ).revise!({ jobId: JOB, topicId: TOPIC }, 'tommy', { instruction: 'Make the gap scene brighter.' });
    assert.equal(out.ok, true, out.note);
    const claimed = await claimNextRequested(revisionsQ);
    assert.ok(claimed, 'the worker claims it');
    assert.equal(claimed.vertical, 'explainers');
    assert.equal(claimed.itemId, await explainerItemId(fx.db, JOB));
    // The worker hands its own query to load; the description never uses it for explainers data.
    const workerQ: Query = async () => {
      throw new Error('the description must not read explainers data through the worker query');
    };
    explainersReads = 0;
    const snap = await desc.load(workerQ, claimed.refs);
    assert.ok(snap);
    assert.ok(explainersReads > 0);
    // Explainers on a database of their own: the verbs refuse instead of writing where no worker looks.
    const split = await actions(async () => null).revise!({ jobId: JOB, topicId: TOPIC }, 'tommy', { instruction: 'Make it brighter.' });
    assert.equal(split.ok, false);
    assert.match(split.note, /shared database/);
  } finally {
    restoreRegistryForTest();
  }
});

// ── Fix round 1: placement, crash safety, collateral writes ────────────────

test('the claim filter: helios-explainers takes only explainer rows, the social worker never takes one', async () => {
  const fx = await fixture();
  const explainerItem = (await explainerItemId(fx.db, JOB))!;
  const { rows } = await fx.db.query<{ id: string }>(`INSERT INTO social_hub.content_items (vertical, format, native_ref) VALUES ('carousels', 'feed', 'post-1') RETURNING id::text AS id`);
  const carouselItem = rows[0]!.id;
  const ex = await createRequest(fx.q, { vertical: 'explainers', refs, itemId: explainerItem, by: 'tommy', instruction: 'Brighter gap scene.' });
  const ca = await createRequest(fx.q, { vertical: 'carousels', refs: { postId: 'post-1' }, itemId: carouselItem, by: 'tommy', instruction: 'Shorter cover.' });

  // The social worker's step (exclude explainers) with only the explainer row left: it claims nothing.
  await fx.db.query(`UPDATE revisions.requests SET status = 'failed' WHERE id = $1`, [ca.id]);
  const n = await claimAndRunRevisions({ q: fx.q, complete: async () => { throw new Error('no interpreter call expected'); }, notify: async () => undefined, now: () => NOW, filter: { exclude: 'explainers' } });
  assert.equal(n, 0);
  assert.equal((await getRequest(fx.q, ex.id))!.status, 'requested');

  await fx.db.query(`UPDATE revisions.requests SET status = 'requested' WHERE id = $1`, [ca.id]);
  const social = await claimNextRequested(fx.q, { exclude: 'explainers' });
  assert.equal(social?.id, ca.id, 'the older explainer row is skipped');
  assert.equal((await getRequest(fx.q, ex.id))!.status, 'requested');
  await fx.db.query(`UPDATE revisions.requests SET status = 'requested' WHERE id = $1`, [ca.id]);
  const mine = await claimNextRequested(fx.q, { only: 'explainers' });
  assert.equal(mine?.id, ex.id);
  assert.equal((await getRequest(fx.q, ca.id))!.status, 'requested', 'the carousel row is left for the social worker');
  assert.equal(await claimNextRequested(fx.q, { only: 'explainers' }), null);
  assert.equal((await claimNextRequested(fx.q))?.id, ca.id, 'no filter: every vertical, as before');
});

test('start-up recovery after a crash mid-redo: the old module, events, video and contact sheet come back, the hold is released with its stage, and the next redo works', async () => {
  const fx = await fixture();
  const jobDir = path.join(fx.jobsRoot, JOB);
  const frames = path.join(fx.projectDir, 'assets', 'frames');
  // The redo got as far as the session: hold taken, files renamed aside, a half-written new module and video.
  assert.equal(await hold(fx.db, JOB, 'c1'), 'caption');
  setAside(jobDir, { id: 'c1', key: '02-gap', stage: 'caption' });
  assert.ok(fs.existsSync(path.join(frames, '02-gap.js.before-revc1')));
  fs.writeFileSync(path.join(frames, '02-gap.js'), 'half-written');
  fs.writeFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'half-rendered');
  const n = await artifactCount(fx.db);

  assert.deepEqual(await recoverSceneRedos(fx.db, fx.jobsRoot), [JOB]);
  assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal(moduleOnDisk(fx, '02-gap.events.json'), MODULES['02-gap.events.json']);
  assert.equal(moduleOnDisk(fx, '02-gap.js.failed-revc1'), 'half-written', 'what the session left is set aside, not deleted');
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'old-mp4');
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'snapshots', 'contact-sheet.jpg'), 'utf8'), 'old-jpg');
  assert.equal(fs.existsSync(path.join(jobDir, 'revision-hold.json')), false);
  assert.deepEqual(await jobRow(fx.db), { status: 'ok', stage: 'caption' });
  assert.equal(await artifactCount(fx.db), n);
  assert.equal((await latest(fx.db, 'video'))!.storage_path, OLD_VIDEO);
  assert.equal((await latest(fx.db, 'contact_sheet'))!.storage_path, OLD_SHEET);
  // The stale sweep after it finds nothing of ours.
  assert.equal(await failStaleRunningJobs(fx.db, 'worker restarted'), 0);

  const out = await createExplainersDescription(depsFor(fx)).revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(out.ok, true, JSON.stringify(out));
  if (out.ok) assert.deepEqual(out.before.copy, { module: MODULES['02-gap.js'], events: MODULES['02-gap.events.json'] });
});

test('start-up recovery of a hold with no set-aside files (nothing moved yet) just releases it', async () => {
  const fx = await fixture();
  assert.equal(await hold(fx.db, JOB, 'h1'), 'caption');
  assert.deepEqual(await recoverSceneRedos(fx.db, fx.jobsRoot), [JOB]);
  assert.deepEqual(await jobRow(fx.db), { status: 'ok', stage: 'revision_interrupted' });
  for (const [f, src] of Object.entries(MODULES)) assert.equal(moduleOnDisk(fx, f), src);
  assert.deepEqual(await recoverSceneRedos(fx.db, fx.jobsRoot), [], 'nothing held: nothing to do');
});

test('a session that also changes another scene or the voice timing is blocked, rolled back, and those files are put back', async () => {
  const fx = await fixture();
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  const query = sceneSession(log, { alsoWrite: { 'assets/frames/03-dictionary.js': 'tampered', 'audio_meta.json': '{"frames":[]}' } });
  const n = await artifactCount(fx.db);
  const out = await createExplainersDescription(depsFor(fx, { log, query })).revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(out.ok ? null : out.reason, 'blocked');
  if (!out.ok) {
    assert.match(out.note, /assets\/frames\/03-dictionary\.js/);
    assert.match(out.note, /audio_meta\.json/);
  }
  assert.equal(moduleOnDisk(fx, '03-dictionary.js'), MODULES['03-dictionary.js'], 'the other scene is put back');
  assert.equal(fs.existsSync(path.join(fx.projectDir, 'audio_meta.json')), false, 'the file the session added is set aside');
  assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'old-mp4');
  assert.equal(await artifactCount(fx.db), n);
  assert.deepEqual(await jobRow(fx.db), { status: 'ok', stage: 'caption' });
});

test('restore never writes into the folder while a render or another redo holds the job', async () => {
  const fx = await fixture();
  const d = createExplainersDescription(depsFor(fx));
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.ok(out.ok);
  if (!out.ok) return;
  await d.restore({ q: fx.q, refs, part: { kind: 'scene', key: '02-gap' }, state: out.before }); // back to the original
  await fx.db.query(`UPDATE explainers.jobs SET status = 'running', stage = 'revision' WHERE id = $1`, [JOB]);
  fs.writeFileSync(path.join(fx.projectDir, 'assets', 'frames', '02-gap.js'), 'mid-redo');
  await assert.rejects(d.restore({ q: fx.q, refs, part: { kind: 'scene', key: '02-gap' }, state: out.before }), /being made or redone/);
  assert.equal(moduleOnDisk(fx, '02-gap.js'), 'mid-redo');
});

// ── Fix round 2: recovery and rollback hardening ───────────────────────────

const holdRow = async (db: ExplainersDb) => (await db.query<{ status: string; stage: string }>(`SELECT status, stage FROM explainers.jobs WHERE id = $1`, [JOB])).rows[0]!;

test('start-up recovery isolates a job whose files cannot be put back: it logs the job, still releases the hold, and returns', async () => {
  const fx = await fixture();
  const jobDir = path.join(fx.jobsRoot, JOB);
  const frames = path.join(fx.projectDir, 'assets', 'frames');
  assert.equal(await hold(fx.db, JOB, 'e1'), 'caption');
  setAside(jobDir, { id: 'e1', key: '02-gap', stage: 'caption' });
  fs.chmodSync(frames, 0o555); // put-back cannot rename in here
  const logged: Array<Record<string, unknown>> = [];
  try {
    const ids = await recoverSceneRedos(fx.db, fx.jobsRoot, (event, fields) => logged.push({ event, ...fields }));
    assert.deepEqual(ids, [JOB]);
  } finally {
    fs.chmodSync(frames, 0o755);
  }
  // Released, keeping the token so the next start-up tries the repair again.
  assert.deepEqual(await holdRow(fx.db), { status: 'ok', stage: 'revision_interrupted:e1' });
  assert.equal(logged.length, 1);
  assert.equal(logged[0]!.jobId, JOB);
  assert.match(String(logged[0]!.error), /EACCES|permission/i);
});

/** A put-back that fails its first `fails` calls, then does the real thing. */
function flakyPutBack(fails: number) {
  const calls = { n: 0 };
  const fn: typeof realPutBack = (jobDir, m) => {
    calls.n += 1;
    if (calls.n <= fails) throw new Error(`EIO: simulated put-back failure ${calls.n}`);
    realPutBack(jobDir, m);
  };
  return { fn, calls };
}
const blockedByBounds = [{ source: 'hyperframes' as const, rule: 'text_bounds', frame: 2, severity: 'error' as const, detail: 'cut off' }];

test('(a) a put-back that fails once is retried: the redo rolls back cleanly, the hold is released, nobody is notified', async () => {
  const fx = await fixture();
  const flaky = flakyPutBack(1);
  const notes: string[] = [];
  const d = createExplainersDescription(depsFor(fx, { bounds: blockedByBounds, putBack: flaky.fn, notify: async (m) => void notes.push(m) }));
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(out.ok ? null : out.reason, 'blocked');
  assert.equal(flaky.calls.n, 2);
  assert.deepEqual(notes, []);
  assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'old-mp4');
  assert.deepEqual(await holdRow(fx.db), { status: 'ok', stage: 'caption' });
  assert.equal(fs.existsSync(path.join(fx.jobsRoot, JOB, 'revision-hold.json')), false);
});

test('(b) a put-back that fails twice releases the hold so renders are never blocked, notifies loudly, fails the row accurately, and leaves the files for repair; (c) the next start-up repairs them', async () => {
  const fx = await fixture();
  const jobDir = path.join(fx.jobsRoot, JOB);
  const frames = path.join(fx.projectDir, 'assets', 'frames');
  const notes: string[] = [];
  registerDescription(
    createExplainersDescription(depsFor(fx, { bounds: blockedByBounds, putBack: flakyPutBack(2).fn, notify: async (m) => void notes.push(m) })),
  );
  setCapsForTest({ explainers: { wording: { capUsd: 5, ceilingUsd: 10 } } });
  try {
    const itemId = (await explainerItemId(fx.db, JOB))!;
    const req = await createRequest(fx.q, { vertical: 'explainers', refs, itemId, by: 'tommy', instruction: 'wave' });
    const it = sceneFix('02-gap');
    await markRunning(fx.q, req.id, it, 5, 10);
    await runRevision({ q: fx.q, notify: async () => undefined, now: () => NOW }, { ...(await getRequest(fx.q, req.id))!, interpretation: it });
    const row = (await getRequest(fx.q, req.id))!;
    assert.equal(row.status, 'failed');
    assert.match(row.note!, /could not put the scene back; this explainer's working files need a manual repair; the published video is unchanged\./);
    assert.doesNotMatch(row.note!, /original was kept/);
  } finally {
    resetCapsForTest();
    restoreRegistryForTest();
  }
  // Released, never left holding the one-render slot.
  assert.deepEqual(await holdRow(fx.db), { status: 'ok', stage: 'revision_interrupted:r1' });
  await fx.db.query(`INSERT INTO explainers.topics (id, title, origin, status) VALUES ($1, 'Other', 'manual', 'queued')`, [OTHER_TOPIC]);
  await fx.db.query(
    `INSERT INTO explainers.jobs (id, topic_id, status, trigger, mode, spend_cap_usd, orchestrator_model, frame_worker_model) VALUES ($1, $2, 'requested', 'click', 'development', 8, 'm', 'm')`,
    [OTHER_JOB, OTHER_TOPIC],
  );
  assert.equal((await claimNextJob(fx.db))?.id, OTHER_JOB, 'the next render is claimed');
  await fx.db.query(`UPDATE explainers.jobs SET status = 'ok' WHERE id = $1`, [OTHER_JOB]);
  // Loud notice naming the job, the folder and the repair.
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, new RegExp(JOB));
  assert.match(notes[0]!, /needs a manual repair/);
  assert.ok(notes[0]!.includes(jobDir));
  // The manifest and the set-aside files stay for the repair; the stored video is untouched.
  assert.ok(fs.existsSync(path.join(jobDir, 'revision-hold.json')));
  assert.ok(fs.existsSync(path.join(frames, '02-gap.js.before-revr1')));
  assert.equal((await latest(fx.db, 'video'))!.storage_path, OLD_VIDEO);
  // While it waits for repair, a scene redo of this explainer is refused before anything runs.
  const waiting = await createExplainersDescription(depsFor(fx)).revise({ q: fx.q, refs, interpretation: sceneFix('03-dictionary'), meter: meter() });
  assert.equal(waiting.ok ? null : waiting.reason, 'failed');
  if (!waiting.ok) assert.match(waiting.note, /manual repair/);

  // (c) The next start-up puts the files back (put-back works this time) and restores the stage.
  assert.deepEqual(await recoverSceneRedos(fx.db, fx.jobsRoot), [JOB]);
  assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal(moduleOnDisk(fx, '02-gap.events.json'), MODULES['02-gap.events.json']);
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'old-mp4');
  assert.equal(fs.existsSync(path.join(jobDir, 'revision-hold.json')), false);
  assert.deepEqual(await holdRow(fx.db), { status: 'ok', stage: 'caption' });
  const after = await createExplainersDescription(depsFor(fx)).revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(after.ok, true, JSON.stringify(after));
});

test('a ceiling stop and a failed put-back together: both are in the note, and the hold is still released', async () => {
  const fx = await fixture();
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  const notes: string[] = [];
  registerDescription(createExplainersDescription(depsFor(fx, { log, query: sceneSession(log, { messages: 5 }), putBack: flakyPutBack(2).fn, notify: async (m) => void notes.push(m) })));
  setCapsForTest({ explainers: { wording: { capUsd: 5, ceilingUsd: 0.05 } } });
  try {
    const itemId = (await explainerItemId(fx.db, JOB))!;
    const req = await createRequest(fx.q, { vertical: 'explainers', refs, itemId, by: 'tommy', instruction: 'wave' });
    const it = sceneFix('02-gap');
    await markRunning(fx.q, req.id, it, 5, 0.05);
    await runRevision({ q: fx.q, notify: async () => undefined, now: () => NOW }, { ...(await getRequest(fx.q, req.id))!, interpretation: it });
    const row = (await getRequest(fx.q, req.id))!;
    assert.equal(row.status, 'failed');
    assert.match(row.note!, /ceiling/);
    assert.match(row.note!, /need a manual repair/);
  } finally {
    resetCapsForTest();
    restoreRegistryForTest();
  }
  assert.equal(log.paidMessages, 1);
  assert.equal(notes.length, 1);
  assert.equal((await holdRow(fx.db)).status, 'ok');
});

test('a collateral step that throws during the rollback still puts the scene back before releasing the hold', async () => {
  const fx = await fixture();
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  // The session turns SCRIPT.md into a folder: the collateral check cannot read it and throws.
  const query = sceneSession(log, {
    after: (dir) => {
      fs.rmSync(path.join(dir, 'SCRIPT.md'));
      fs.mkdirSync(path.join(dir, 'SCRIPT.md'));
    },
  });
  const d = createExplainersDescription(depsFor(fx, { log, query }));
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() }).catch((e: unknown) => e);
  assert.ok(out instanceof Error || (typeof out === 'object' && out !== null && (out as { ok?: boolean }).ok === false));
  assert.equal(moduleOnDisk(fx, '02-gap.js'), MODULES['02-gap.js']);
  assert.equal(moduleOnDisk(fx, '02-gap.events.json'), MODULES['02-gap.events.json']);
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'old-mp4');
  assert.deepEqual(await holdRow(fx.db), { status: 'ok', stage: 'caption' });
  assert.equal(fs.existsSync(path.join(fx.jobsRoot, JOB, 'revision-hold.json')), false);
});

test('a manifest left by an earlier committed redo never puts old files back over committed ones', async () => {
  const fx = await fixture();
  const jobDir = path.join(fx.jobsRoot, JOB);
  const d = createExplainersDescription(depsFor(fx));
  const out = await d.revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.ok(out.ok, JSON.stringify(out));
  const committedModule = moduleOnDisk(fx, '02-gap.js');
  const committedVideo = (await latest(fx.db, 'video'))!.storage_path;
  // Simulated crash before finishAside: r1's manifest is still there (its .before-rev files are history on disk).
  fs.writeFileSync(path.join(jobDir, 'revision-hold.json'), JSON.stringify({ id: 'r1', key: '02-gap', stage: 'caption', hadEvents: true, movedVideo: true, movedSheet: true }));
  // A later redo takes the hold and crashes before it sets anything aside.
  assert.equal(await hold(fx.db, JOB, 'r2'), 'caption');
  await recoverSceneRedos(fx.db, fx.jobsRoot);
  assert.equal(moduleOnDisk(fx, '02-gap.js'), committedModule, 'the committed scene stays');
  assert.equal(fs.readFileSync(path.join(fx.projectDir, 'renders', 'video.mp4'), 'utf8'), 'new-mp4-02-gap');
  assert.equal((await latest(fx.db, 'video'))!.storage_path, committedVideo);
  assert.equal((await holdRow(fx.db)).status, 'ok');

  // And a new redo clears a leftover manifest before writing its own.
  fs.writeFileSync(path.join(jobDir, 'revision-hold.json'), JSON.stringify({ id: 'r1', key: '02-gap', stage: 'caption', hadEvents: true, movedVideo: true, movedSheet: true }));
  const again = await d.revise({ q: fx.q, refs, interpretation: sceneFix('03-dictionary'), meter: meter() });
  assert.ok(again.ok, JSON.stringify(again));
  assert.equal(moduleOnDisk(fx, '02-gap.js'), committedModule);
  assert.equal(fs.existsSync(path.join(jobDir, 'revision-hold.json')), false);
});

test('a collateral block names what could not be put back (the voice audio is hashed, not kept)', async () => {
  const fx = await fixture();
  fs.mkdirSync(path.join(fx.projectDir, 'assets', 'voice'), { recursive: true });
  fs.writeFileSync(path.join(fx.projectDir, 'assets', 'voice', 'line-1.mp3'), 'voice');
  const log: SessionLog = { prompts: [], atStart: [], paidMessages: 0 };
  const query = sceneSession(log, { alsoWrite: { 'assets/voice/line-1.mp3': 'new voice', 'assets/frames/03-dictionary.js': 'tampered' } });
  const out = await createExplainersDescription(depsFor(fx, { log, query })).revise({ q: fx.q, refs, interpretation: sceneFix('02-gap'), meter: meter() });
  assert.equal(out.ok ? null : out.reason, 'blocked');
  if (!out.ok) {
    assert.match(out.note, /could not be put back: assets\/voice\/line-1\.mp3/);
    assert.doesNotMatch(out.note, /and they were put back/);
  }
  assert.equal(moduleOnDisk(fx, '03-dictionary.js'), MODULES['03-dictionary.js']);
});
