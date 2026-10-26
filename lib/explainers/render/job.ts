import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { ExplainersDb } from '@/lib/explainers/db';
import { chooseAnalogy, topicAnalogy } from '@/lib/explainers/ideas/analogy';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { RecordingExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { runAgentSession, type AgentQuery, type SessionResult } from '@/lib/explainers/render/agent';
import { SpendMeter } from '@/lib/explainers/render/meter';
import { resolveSource, type FetchLike } from '@/lib/explainers/render/source';
import { HYPERFRAMES_BIN, HYPERFRAMES_ENV, prepareWorkspace, recordMusicChoice, workspacePaths, type Workspace } from '@/lib/explainers/render/workspace';
import {
  addArtifact,
  addLintViolations,
  finishJob,
  getJob,
  getTopic,
  recentOpeners,
  recordCost,
  setJobOpener,
  setJobStage,
} from '@/lib/explainers/repository';
import { loadSettings, loadThemeBrief } from '@/lib/explainers/settings';
import type { ArtifactStore } from '@/lib/explainers/storage';
import type { ArtifactKind, JobRow, LintViolation, Mode, TopicRow } from '@/lib/explainers/types';
import { CaptionError, writeExplainerCaption, type CaptionDraft, type CaptionFacts, type CaptionOptions } from '@/lib/explainers/caption';
import { ceilingAllows, decideBuildLine, type RecentClosing } from '@/lib/social/captions/build-line';
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { eventsFromDir, lintStoryboard } from '../../../explainers/lint/lint-storyboard.mjs';
import { mountFrames } from '../../../explainers/world-kit/mount.mjs';
import { hasOpenerSfx, placeOpenerSfx } from '../../../explainers/world-kit/opener-sfx.mjs';
import { HISTORY as OPENER_HISTORY, openerByKey, pickOpener } from '../../../explainers/world-kit/openers/bank.js';
import { pace } from '../../../explainers/world-kit/pace.mjs';
import { OUT as EVENTS_TRACK, placeSound } from '../../../explainers/world-kit/sound.mjs';

export const PLAN_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: plan. Do only the plan phase, then stop.';
export const BUILD_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: build. STORYBOARD.md and SCRIPT.md are final; do only the build phase, then stop.';

/** Session B for a resumed job (RenderDeps.resume): the build continues from what is on disk. */
export const RESUME_PROMPT = [
  'Use the helios-explainer-director skill to run this reel. PHASE: build. STORYBOARD.md and SCRIPT.md are final.',
  'This build was interrupted and is resuming in the same project: keep everything already on disk and do only what is missing.',
  'Do not generate the voice again (audio_meta.json and assets/voice/ exist); run audio.mjs sync-durations only if a frame has no voice_end.',
  'Run node assets/kit/pace.mjs, node assets/kit/music.mjs only if assets/bgm/track.mp3 is missing, and node assets/kit/opener-sfx.mjs; then write the frame packets.',
  'Keep assets/world/world.js if node assets/kit/try.mjs world passes. Dispatch frame workers only for frames whose module is missing or listed below as stale, then mount, try, bounds, sound, captions, assemble, finalize, the picture check, and render renders/video.mp4.',
].join(' ');

/** One follow-up when session B stops successful but leaves beats unwritten. */
export function repairPrompt(missing: readonly number[]): string {
  return [
    'Use the helios-explainer-director skill to run this reel. PHASE: build.',
    `Frames ${missing.join(', ')} are missing from compositions/frames/.`,
    'Write each missing frame, then finish the build: assemble, check, and render renders/video.mp4.',
    'A tool result that says to stop and wait is a denied call, not a person. Retry it. Do not ask.',
  ].join(' ');
}

export type RenderDeps = {
  db: ExplainersDb;
  query: AgentQuery;
  store: ArtifactStore;
  jobsRoot: string;
  secrets: { anthropicApiKey: string; heygenApiKey: string };
  fetchSource?: FetchLike;
  /** Swappable for tests; the real one runs `hyperframes init` and build-frame. */
  prepare?: typeof prepareWorkspace;
  /** Swappable for tests; the real one runs the pinned `hyperframes lint --json`. */
  hyperframesLint?: (projectDir: string) => LintViolation[];
  /** Swappable for tests: the kit's text-bounds check (EX3-92), run on the built frames. */
  boundsCheck?: (projectDir: string) => LintViolation[];
  /**
   * Swappable for tests. When session B stops without `renders/video.mp4` but
   * `index.html` is assembled, the worker renders it. No extra model call.
   */
  renderVideo?: (projectDir: string) => void;
  /** Swappable for tests. The real one calls Sonnet. A finished video always gets one. */
  writeCaption?: (facts: CaptionFacts, opts: CaptionOptions) => Promise<CaptionDraft>;
  /**
   * v4 captions: Jev's fit score for the build line (`liveExplainerBuildFit`), null on failure.
   * Absent: no build line. Asked only when the closings ceiling leaves room.
   */
  buildFit?: (facts: CaptionFacts, subjectId: string) => Promise<number | null>;
  /** v4 captions: the explainer closings log. Absent: no recent closings, nothing recorded. */
  closings?: ClosingsLog;
  /**
   * The analogy pass for a topic that has no picked analogy (EX3-31): the analogy writer and
   * Jev. Without it, such a topic fails with that reason.
   */
  analogy?: { ideaModel: IdeaModel; jevTransport: JevTransport };
  /** Swappable for tests: the deterministic assembly repair before the worker render (EX3-52, EX3-53). */
  repairAssembly?: (projectDir: string) => string[];
  /**
   * Resume an interrupted job in its existing workspace: no workspace preparation and, when the
   * plan (STORYBOARD.md, SCRIPT.md) is already there, no session A. Session B continues from the
   * build steps already done (RESUME_PROMPT). Spend carries on from the job's recorded spend.
   */
  resume?: boolean;
  /** Extra resume instructions (e.g. frames to rebuild), appended to RESUME_PROMPT. */
  resumeNote?: string;
  /** Swappable for tests: the random draw of the opener (Math.random's shape). */
  random?: () => number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

/** Where a job's workspace names its opener (openers/sound.mjs CHOICE). */
export const OPENER_CHOICE = path.join('assets', 'opener.json');

/**
 * Frame 1's opener for this job (EX3-102): the one it already drew, or a random one of the bank
 * that none of the last HISTORY reels used, recorded on the job and written to assets/opener.json
 * for pace, the frame and the sound. A job resumed from before the bank (its worker's own frame 1
 * built, no choice file) keeps that frame and draws none: null.
 */
export async function assignOpener(
  db: ExplainersDb,
  jobId: string,
  projectDir: string,
  { resuming = false, random = Math.random }: { resuming?: boolean; random?: () => number } = {},
): Promise<string | null> {
  const file = path.join(projectDir, OPENER_CHOICE);
  const onFile = (): string | null => {
    try {
      const k = JSON.parse(fs.readFileSync(file, 'utf8'))?.key;
      return openerByKey(k) ? k : null;
    } catch {
      return null;
    }
  };
  let key = (await getJob(db, jobId))?.opener ?? (resuming ? onFile() : null);
  if (!key || !openerByKey(key)) {
    const legacy = resuming && !fs.existsSync(file) && fs.existsSync(path.join(projectDir, 'assets', 'frames', '01-opener.js'));
    if (legacy) return null;
    try {
      key = pickOpener(await recentOpeners(db, jobId, OPENER_HISTORY), { rand: random }) as string;
      await setJobOpener(db, jobId, key);
    } catch (error) {
      // A database without the `opener` column yet (db/explainers_schema.sql, EX3-102): the reel
      // still gets an opener, drawn without the history, and the render goes on.
      if ((error as { code?: string })?.code !== '42703') throw error;
      key = pickOpener([], { rand: random }) as string;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ key, name: openerByKey(key)?.name ?? key }, null, 1)}\n`);
  return key;
}

export type RenderOutcome = { status: 'ok' } | { status: 'failed'; error: string; capped: boolean };

class RenderFailure extends Error {
  constructor(message: string, readonly capped = false) {
    super(message);
  }
}

function recordCaptionCost(db: ExplainersDb, jobId: string, mode: Mode, draft: CaptionDraft): Promise<void> {
  return recordCost(db, {
    jobId,
    mode,
    vendor: 'anthropic',
    component: `post_caption:${draft.model}`,
    inputTokens: draft.inputTokens,
    outputTokens: draft.outputTokens,
    cacheReadTokens: draft.cacheReadTokens,
    cacheWriteTokens: draft.cacheWriteTokens,
    usd: draft.usd,
  });
}

/**
 * v4 captions. The recent explainer closings and whether this caption gets the build line.
 * An unreadable log fails closed: no Jev call, no build line, an empty recent-closings list.
 * Jev is asked only when the ceiling leaves room, and a failed fit call means no build line;
 * the caption still ships with its light Helios mention.
 */
async function captionBuildLine(
  deps: RenderDeps,
  facts: CaptionFacts,
  jobId: string,
  log: (event: string, fields?: Record<string, unknown>) => void,
): Promise<CaptionOptions> {
  let recent: RecentClosing[] = [];
  if (deps.closings) {
    try {
      recent = await deps.closings.recent();
    } catch (error) {
      log('caption_closings_unread', { jobId, error: error instanceof Error ? error.message : String(error) });
      log('caption_build_line', { jobId, fit: null, includeBuildLine: false, recent: 0 });
      return { recent: [], includeBuildLine: false };
    }
  }
  let fit: number | null = null;
  if (ceilingAllows(recent) && deps.buildFit) {
    try {
      fit = await deps.buildFit(facts, jobId);
    } catch {
      fit = null;
    }
  }
  const includeBuildLine = decideBuildLine(fit, recent);
  log('caption_build_line', { jobId, fit, includeBuildLine, recent: recent.length });
  return { recent, includeBuildLine };
}

function read(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function fileReady(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).size > 0;
}

const BEAT_NUMBERS = [1, 2, 3, 4, 5, 6, 7, 8];

/** Frame numbers 1–8 that have no composition file yet. */
export function missingFrameNumbers(projectDir: string): number[] {
  const dir = path.join(projectDir, 'compositions', 'frames');
  const present = new Set<number>();
  if (fs.existsSync(dir)) {
    for (const file of fs.readdirSync(dir)) {
      const n = /^(\d+).+\.html$/.exec(file)?.[1];
      if (n) present.add(Number(n));
    }
  }
  return BEAT_NUMBERS.filter((n) => !present.has(n));
}

/** Init writes a placeholder index.html. A reel is assembled only once all eight frames exist. */
function projectAssembled(projectDir: string): boolean {
  return fileReady(path.join(projectDir, 'index.html')) && missingFrameNumbers(projectDir).length === 0;
}

/**
 * Render an assembled project. Session B is supposed to do this; the first
 * three live runs stopped after a sandboxed `hyperframes check` could not
 * bind 127.0.0.1 and left no MP4. This runs the pinned CLI in the worker,
 * outside the agent sandbox. Throws when no video is written.
 */
export function renderProjectVideo(projectDir: string): void {
  const out = path.join(projectDir, 'renders', 'video.mp4');
  if (fileReady(out)) return;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = spawnSync(
    HYPERFRAMES_BIN,
    ['render', '--quality', 'high', '--workers', '1', '--output', 'renders/video.mp4'],
    { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, encoding: 'utf8', timeout: 10 * 60 * 1000 },
  );
  if (res.error) throw new Error(`hyperframes render failed to start: ${res.error.message}`);
  if (res.status !== 0 || !fileReady(out)) {
    const tail = (res.stderr || res.stdout || '').trim().slice(-800);
    throw new Error(`hyperframes render exited ${res.status ?? 'with no status'}${tail ? `: ${tail}` : ''}`);
  }
}

function runNode(projectDir: string, script: string, args: string[]): string | null {
  const res = spawnSync(process.execPath, [script, ...args], {
    cwd: projectDir,
    env: { ...process.env, ...HYPERFRAMES_ENV },
    encoding: 'utf8',
    timeout: 5 * 60 * 1000,
  });
  if (res.status === 0) return null;
  return `${path.basename(script)} exited ${res.status ?? 'with no status'}: ${(res.stderr || res.stdout || '').trim().slice(-300)}`;
}

/**
 * Session B is supposed to mount the frames, place the opener's sounds, build the captions, and
 * assemble. When it stops short with the scene modules written, finish those deterministic steps
 * here (no model) so the worker render below can run. Returns what it did, for the log.
 */
export function repairProjectAssembly(
  projectDir: string,
  { placeMusic = (dir: string) => runNode(dir, path.join(dir, 'assets', 'kit', 'music.mjs'), []) }: { placeMusic?: (dir: string) => string | null } = {},
): string[] {
  const done: string[] = [];
  const scripts = path.join(projectDir, '.claude', 'skills', 'faceless-explainer', 'scripts');
  const frameModules = path.join(projectDir, 'assets', 'frames');
  const modules = fs.existsSync(frameModules) ? fs.readdirSync(frameModules).filter((f) => f.endsWith('.js')) : [];
  if (modules.length === 0) return done;

  let changed = false;
  const metaFile = path.join(projectDir, 'audio_meta.json');
  // Unpaced frames (no timing files) are voice-length with no hold: pace them (EX3-60), then
  // re-mount every frame and re-place the opener sounds on frame 1's new length.
  let paced = false;
  if (fs.existsSync(metaFile) && !fs.existsSync(path.join(projectDir, 'assets', 'timing'))) {
    const result = pace(projectDir);
    done.push(result.ok ? `paced the frames (${result.total}s)` : `pacing failed: ${result.errors.join('; ')}`);
    if (result.ok) {
      const mounted = mountFrames(projectDir);
      done.push(`re-mounted ${mounted.mounted.join(', ')}`);
      const opener = placeOpenerSfx(projectDir);
      done.push(opener.ok ? 'placed the opener sounds' : `opener sounds failed: ${opener.errors.join('; ')}`);
      paced = true;
      changed = true;
    }
  }
  const unmounted = modules.filter((f) => !fs.existsSync(path.join(projectDir, 'compositions', 'frames', f.replace(/\.js$/, '.html'))));
  if (unmounted.length > 0) {
    const mounted = mountFrames(projectDir);
    if (mounted.mounted.length) {
      done.push(`mounted ${mounted.mounted.join(', ')}`);
      changed = true;
    }
  }
  if (fs.existsSync(metaFile) && !hasOpenerSfx(JSON.parse(fs.readFileSync(metaFile, 'utf8')))) {
    const placed = placeOpenerSfx(projectDir);
    done.push(placed.ok ? 'placed the opener sounds' : `opener sounds failed: ${placed.errors.join('; ')}`);
    changed ||= placed.ok;
  }
  // The music bed, when the session never placed it (EX3-82).
  if (fs.existsSync(metaFile) && !(JSON.parse(fs.readFileSync(metaFile, 'utf8')) as { bgm?: unknown }).bgm) {
    const error = placeMusic(projectDir);
    done.push(error ?? 'placed the music');
    changed ||= !error;
  }
  // The frames' sound events, when the session never mixed them (EX3-63).
  const hasEvents = fs.readdirSync(frameModules).some((f) => f.endsWith('.events.json'));
  if (fs.existsSync(metaFile) && hasEvents && (paced || !fs.existsSync(path.join(projectDir, EVENTS_TRACK)))) {
    const sound = placeSound(projectDir);
    done.push(sound.placed > 0 ? `placed ${sound.placed} sound effects` : `sound design failed: ${sound.errors.join('; ') || 'nothing placed'}`);
    changed ||= sound.placed > 0;
  }
  if (!changed) return done;

  if (fs.existsSync(metaFile) && (paced || !fs.existsSync(path.join(projectDir, 'compositions', 'captions.html')))) {
    const error = runNode(projectDir, path.join(scripts, 'captions.mjs'), ['build', '--storyboard', './STORYBOARD.md', '--audio-meta', './audio_meta.json', '--hyperframes', '.', '--out', './caption_groups.json']);
    const built = fs.existsSync(path.join(projectDir, 'compositions', 'captions.html'));
    done.push(error ?? (built ? 'built the captions' : 'no captions (no narration)'));
  }
  const assembled = runNode(projectDir, path.join(scripts, 'assemble-index.mjs'), ['--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  done.push(assembled ?? 'assembled index.html');
  if (!assembled) {
    const injected = runNode(projectDir, path.join(scripts, 'transitions.mjs'), ['inject', '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
    done.push(injected ?? 'injected the transitions');
  }
  return done;
}

/** HyperFrames' own lint findings, as lint_violations rows. */
export function runHyperframesLint(projectDir: string): LintViolation[] {
  const res = spawnSync(HYPERFRAMES_BIN, ['lint', '--json'], {
    cwd: projectDir,
    env: { ...process.env, ...HYPERFRAMES_ENV },
    encoding: 'utf8',
  });
  try {
    const parsed = JSON.parse(res.stdout) as { findings?: Record<string, unknown>[] };
    return (parsed.findings ?? []).map((f) => {
      const file = String(f.file ?? f.path ?? '');
      const frame = /(?:^|\/)(\d+)-[^/]*\.html$/.exec(file)?.[1];
      return {
        source: 'hyperframes',
        rule: String(f.code ?? f.rule ?? 'unknown'),
        frame: frame ? Number(frame) : null,
        severity: f.severity === 'error' ? 'error' : 'warning',
        detail: String(f.message ?? ''),
      };
    });
  } catch {
    return [{ source: 'hyperframes', rule: 'lint_unavailable', frame: null, severity: 'warning', detail: (res.stderr || res.stdout).slice(-400) }];
  }
}

/**
 * The kit's text-bounds check (EX3-92) on the built frames, as lint violations: text cut off by
 * the frame edge, outside its textBox, or in a keep-out. Recorded under the browser checks'
 * source (`hyperframes`, the table's other source) with rule `text_bounds`. A check that cannot
 * run (no script, no browser) records nothing.
 */
export function runBoundsCheck(projectDir: string): LintViolation[] {
  const script = path.join(projectDir, 'assets', 'kit', 'bounds.mjs');
  if (!fs.existsSync(script)) return [];
  const res = spawnSync(process.execPath, [script, 'all'], { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, encoding: 'utf8', timeout: 180_000 });
  try {
    const parsed = JSON.parse(res.stdout) as { errors?: string[] };
    return (parsed.errors ?? []).map((e) => ({
      source: 'hyperframes',
      rule: 'text_bounds',
      frame: Number(/^(\d+)-/.exec(e)?.[1]) || null,
      severity: 'error',
      detail: `bounds.mjs: ${e}`,
    }));
  } catch {
    return [];
  }
}

/** The scene modules (assets/frames/NN-*.js) by frame number: where 3.0 frames keep their on-screen text. */
function frameModulesByNumber(projectDir: string): Map<number, string> {
  const dir = path.join(projectDir, 'assets', 'frames');
  const map = new Map<number, string>();
  if (!fs.existsSync(dir)) return map;
  for (const file of fs.readdirSync(dir).sort()) {
    const n = /^(\d+)/.exec(file)?.[1];
    // frame 1 has two: the worker's hook (01-hook.js) and the bank's opener over it (EX3-102)
    if (n && file.endsWith('.js')) map.set(Number(n), `${map.get(Number(n)) ?? ''}${fs.readFileSync(path.join(dir, file), 'utf8')}`);
  }
  return map;
}

function readJson(file: string): unknown {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

async function recordSessionCost(db: ExplainersDb, job: JobRow, mode: Mode, phase: string, session: SessionResult): Promise<void> {
  const models = Object.entries(session.modelUsage);
  if (models.length === 0) {
    // Aborted before a result: the streamed estimate is what we know.
    if (session.totalCostUsd > 0) {
      await recordCost(db, { jobId: job.id, mode, vendor: 'anthropic', component: `${phase}:estimate`, usd: session.totalCostUsd });
    }
    return;
  }
  for (const [model, usage] of models) {
    await recordCost(db, {
      jobId: job.id,
      mode,
      vendor: 'anthropic',
      component: `${phase}:${model}`,
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      cacheReadTokens: usage.cacheReadInputTokens ?? 0,
      cacheWriteTokens: usage.cacheCreationInputTokens ?? 0,
      usd: Number(usage.costUSD ?? 0),
    });
  }
}

/**
 * One render: source → analogy (only when the topic has none, EX3-31) →
 * workspace → session A (plan) → checkpoint (lint, no LLM) → session B (build
 * + render) → collect outputs. Every artifact a stage produced is kept, even
 * when a later stage fails. Retry is Lucas's click.
 */
export async function runRenderJob(deps: RenderDeps, job: JobRow): Promise<RenderOutcome> {
  const { db, store } = deps;
  const log = deps.log ?? (() => undefined);
  const settings = await loadSettings(db);
  let topic = (await getTopic(db, job.topic_id)) as TopicRow;
  const prefix = `jobs/${job.id}`;
  let ws: Workspace | null = null;
  const transcriptLines: string[] = [];
  const transcript = (entry: Record<string, unknown>) => transcriptLines.push(JSON.stringify(entry));

  const keep = async (kind: ArtifactKind, file: string, name: string) => {
    if (!fs.existsSync(file)) return false;
    const { storagePath, bytes, location } = await store.put(`${prefix}/${name}`, file);
    await addArtifact(db, { jobId: job.id, kind, storagePath, bytes, storageLocation: location ?? 'local' });
    return true;
  };
  const keepText = async (kind: ArtifactKind, content: string | null) => {
    if (content) await addArtifact(db, { jobId: job.id, kind, content });
  };
  const stage = async (name: string, sessions?: { sessionAId?: string; sessionBId?: string }) => {
    log('stage', { jobId: job.id, stage: name });
    await setJobStage(db, job.id, name, sessions);
  };

  try {
    if (!settings.voice_id) throw new RenderFailure('No HeyGen voice id is set (Settings → HeyGen voice ID).');

    await stage('source');
    const sourceText = await resolveSource(topic, deps.fetchSource).catch((error: unknown) => {
      throw new RenderFailure(`Source: ${error instanceof Error ? error.message : String(error)}`);
    });
    await keepText('source', sourceText);

    // The idea phase picks every pool topic's analogy (EX3-30). A topic from before 3.0, or one
    // whose pass failed, gets the same pass here, for this one topic, on this click (EX3-31).
    if (!topicAnalogy(topic)) {
      await stage('analogy');
      if (!deps.analogy) throw new RenderFailure('This topic has no picked analogy, and this worker has no analogy writer.');
      const jev = new RecordingExplainersJevRunner(deps.analogy.jevTransport, db, { mode: job.mode, jobId: job.id });
      await chooseAnalogy(
        {
          db,
          jev,
          ideaModel: deps.analogy.ideaModel,
          model: settings.idea_model,
          mode: job.mode,
          themeBrief: await loadThemeBrief(db, settings.theme_brief_version),
          jobId: job.id,
        },
        topic,
      ).catch((error: unknown) => {
        throw new RenderFailure(`Analogy: ${error instanceof Error ? error.message : String(error)}`);
      });
      topic = (await getTopic(db, job.topic_id)) as TopicRow;
    }

    await stage('workspace');
    const existing = workspacePaths(deps.jobsRoot, job.id);
    const resuming = Boolean(deps.resume) && fs.existsSync(path.join(existing.projectDir, 'STORYBOARD.md')) && fs.existsSync(path.join(existing.projectDir, 'SCRIPT.md'));
    if (resuming) {
      ws = existing;
      log('resume', { jobId: job.id });
    } else {
      ws = (deps.prepare ?? prepareWorkspace)({ jobsRoot: deps.jobsRoot, jobId: job.id, topic, sourceText, analogy: topicAnalogy(topic) });
      await keepText('brief', read(path.join(ws.projectDir, 'BRIEF.md')));
    }

    // Frame 1's opener, drawn from the bank before anything is built (EX3-102).
    const opener = await assignOpener(db, job.id, ws.projectDir, { resuming, random: deps.random });
    log('opener', { jobId: job.id, opener });

    // The analogy pass, when it ran, is already on the job's spend.
    const meter = new SpendMeter(job.spend_cap_usd, (await getJob(db, job.id))?.spend_usd ?? job.spend_usd);
    const session = (prompt: string) =>
      runAgentSession({
        query: deps.query,
        prompt,
        projectDir: ws!.projectDir,
        homeDir: ws!.homeDir,
        tmpDir: ws!.tmpDir,
        model: job.orchestrator_model,
        frameWorkerModel: job.frame_worker_model,
        meter,
        secrets: { ...deps.secrets, voiceId: settings.voice_id! },
        log: transcript,
      });

    // Session A: plan (a resumed job already has its plan).
    let storyboard: string;
    let script: string;
    if (resuming) {
      storyboard = read(path.join(ws.projectDir, 'STORYBOARD.md')) ?? '';
      script = read(path.join(ws.projectDir, 'SCRIPT.md')) ?? '';
    } else {
      await stage('session_a');
      const a = await session(PLAN_PROMPT);
      await stage('session_a_done', { sessionAId: a.sessionId ?? undefined });
      await recordSessionCost(db, job, job.mode, 'session_a', a);
      if (a.capped) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached in session A.`, true);
      const planned = read(path.join(ws.projectDir, 'STORYBOARD.md'));
      const written = read(path.join(ws.projectDir, 'SCRIPT.md'));
      await keepText('storyboard', planned);
      await keepText('script', written);
      if (a.isError || !planned || !written) {
        throw new RenderFailure(`Session A ended without a plan (${a.subtype}${a.errors.length ? `: ${a.errors.join('; ')}` : ''}).`);
      }
      storyboard = planned;
      script = written;
    }

    // The first-time-viewer test of the curiosity gap (EX3-101): what a stranger understood.
    const gapCheck = readJson(path.join(ws.projectDir, '.hyperframes', 'gap-check.json'));
    if (gapCheck) await keepText('lint_report', JSON.stringify({ phase: 'gap_check', verdict: gapCheck }, null, 2));
    if (!resuming && !gapCheck) log('gap_check_missing', { jobId: job.id });

    // Checkpoint: deterministic lint, recorded, never blocking in version one (E-07).
    // The reviewer layers from E-11 plug in here after run one.
    await stage('checkpoint');
    const checkpoint = lintStoryboard({ storyboard, script });
    await addLintViolations(db, job.id, checkpoint.violations as LintViolation[]);
    await keepText('lint_report', JSON.stringify({ phase: 'checkpoint', ...checkpoint }, null, 2));

    // Session B: build and render.
    await stage('session_b');
    let b = await session(resuming ? `${RESUME_PROMPT}${deps.resumeNote ? ` ${deps.resumeNote}` : ''}` : BUILD_PROMPT);
    await stage('session_b_done', { sessionBId: b.sessionId ?? undefined });
    await recordSessionCost(db, job, job.mode, 'session_b', b);
    if (b.capped) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached in session B.`, true);

    // A successful session can still stop with beats unwritten and no MP4 (the
    // server reel: the auto classifier refused frames 2 and 6, and the model
    // waited). One repair, then the worker render below. No third session.
    const videoPath = path.join(ws.projectDir, 'renders', 'video.mp4');
    const missing = missingFrameNumbers(ws.projectDir);
    if (!fileReady(videoPath) && missing.length > 0 && b.subtype === 'success' && !b.isError) {
      await stage('repair');
      log('repair_frames', { jobId: job.id, missing });
      b = await session(repairPrompt(missing));
      await recordSessionCost(db, job, job.mode, 'repair', b);
      if (b.capped) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached while repairing missing frames.`, true);
    }

    // Collect: outputs, audio telemetry, post-build lint.
    await stage('collect');
    const audioMeta = read(path.join(ws.projectDir, 'audio_meta.json'));
    await keepText('audio_meta', audioMeta);
    if (audioMeta) {
      // HeyGen returns no price on these calls (E-17): recorded as unknown, never guessed.
      await recordCost(db, { jobId: job.id, mode: job.mode, vendor: 'heygen', component: 'tts+bgm+sfx', usd: null });
    }
    await keep('captions', path.join(ws.projectDir, 'caption_groups.json'), 'caption_groups.json');
    await keep('contact_sheet', path.join(ws.projectDir, 'snapshots', 'contact-sheet.jpg'), 'contact-sheet.jpg');
    const video = videoPath;
    if (!fileReady(video)) {
      const repaired = (deps.repairAssembly ?? repairProjectAssembly)(ws.projectDir);
      if (repaired.length) log('assembly_repaired', { jobId: job.id, steps: repaired });
    }
    const final = lintStoryboard({
      storyboard: read(path.join(ws.projectDir, 'STORYBOARD.md')) ?? storyboard,
      script: read(path.join(ws.projectDir, 'SCRIPT.md')) ?? script,
      frameSource: frameModulesByNumber(ws.projectDir),
      audioMeta: readJson(path.join(ws.projectDir, 'audio_meta.json')),
      frameEvents: eventsFromDir(path.join(ws.projectDir, 'assets', 'frames')),
      eventsTrack: fs.existsSync(path.join(ws.projectDir, EVENTS_TRACK)),
    });
    // The final pass records only what the checkpoint could not see: the built frames and sound.
    const builtOnly = new Set(['narration_on_screen', 'opener_sfx', 'sound_events', 'sound_track', 'headword_term']);
    const onScreen = (final.violations as LintViolation[]).filter((v) => builtOnly.has(v.rule) || /on-screen text/.test(v.detail));
    const hyperframes = (deps.hyperframesLint ?? runHyperframesLint)(ws.projectDir);
    const bounds = (deps.boundsCheck ?? runBoundsCheck)(ws.projectDir);
    await addLintViolations(db, job.id, [...onScreen, ...hyperframes, ...bounds]);
    await keepText('lint_report', JSON.stringify({ phase: 'final', storyboard: final, hyperframes, bounds }, null, 2));
    // The blind picture check (EX3-84): per tile, what was meant, what a stranger saw, the verdict.
    const pictureCheck = readJson(path.join(ws.projectDir, '.hyperframes', 'picture-check.json'));
    await keepText('lint_report', JSON.stringify({ phase: 'picture_check', verdicts: pictureCheck ?? null }, null, 2));

    if (projectAssembled(ws.projectDir) && !fileReady(video)) {
      await stage('render');
      log('worker_render', { jobId: job.id });
      try {
        (deps.renderVideo ?? renderProjectVideo)(ws.projectDir);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new RenderFailure(`Session B ended without a video (${b.subtype}). ${detail}`);
      }
    }
    if (!(await keep('video', video, 'video.mp4'))) {
      const stillMissing = missingFrameNumbers(ws.projectDir);
      const gap = stillMissing.length ? ` Missing frames ${stillMissing.join(', ')}.` : '';
      throw new RenderFailure(
        `Session B ended without a video (${b.subtype}${b.errors.length ? `: ${b.errors.join('; ')}` : ''}).${gap}`,
      );
    }
    const track = recordMusicChoice(deps.jobsRoot, ws.projectDir);
    if (track) log('music', { jobId: job.id, track });

    await stage('caption');
    const facts: CaptionFacts = {
      title: topic.title,
      scope: topic.scope,
      storyboard: read(path.join(ws.projectDir, 'STORYBOARD.md')) ?? storyboard,
      script: read(path.join(ws.projectDir, 'SCRIPT.md')) ?? script,
      source: topic.source_text,
    };
    const captionOpts = await captionBuildLine(deps, facts, job.id, log);
    const writer = deps.writeCaption ?? ((input, opts) => writeExplainerCaption(input, job.orchestrator_model, opts));
    let draft: CaptionDraft | null = null;
    let captionError: unknown = null;
    // The retry is told why the first caption was rejected (after the cache breakpoint).
    let retryReason: string | undefined;
    for (let attempt = 0; attempt < 2 && !draft; attempt += 1) {
      try {
        draft = await writer(facts, retryReason ? { ...captionOpts, retryReason } : captionOpts);
      } catch (error) {
        captionError = error;
        // Only a caption the model wrote and code rejected tells the retry why; an API or transport failure does not.
        retryReason = error instanceof CaptionError ? error.message : undefined;
        const spent = error instanceof CaptionError ? error.spent : undefined;
        if (spent) await recordCaptionCost(db, job.id, job.mode, spent);
        log('caption_failed', { jobId: job.id, attempt, error: error instanceof Error ? error.message : String(error) });
      }
    }
    if (!draft) {
      const detail = captionError instanceof Error ? captionError.message : String(captionError);
      throw new RenderFailure(`Post caption failed: ${detail}`);
    }
    await recordCaptionCost(db, job.id, job.mode, draft);
    await keepText('post_caption', draft.text);
    await deps.closings?.record(job.id, draft.builderRead, captionOpts.includeBuildLine);

    await finishJob(db, job.id, { status: 'ok' });
    log('job_ok', { jobId: job.id });
    return { status: 'ok' };
  } catch (error) {
    const capped = error instanceof RenderFailure && error.capped;
    const message = error instanceof Error ? error.message : String(error);
    await finishJob(db, job.id, { status: 'failed', error: message, capped });
    log('job_failed', { jobId: job.id, error: message, capped });
    return { status: 'failed', error: message, capped };
  } finally {
    if (transcriptLines.length) {
      const file = path.join(deps.jobsRoot, job.id, 'transcript.jsonl');
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${transcriptLines.join('\n')}\n`);
      await keep('transcript_log', file, 'transcript.jsonl').catch(() => false);
    }
  }
}
