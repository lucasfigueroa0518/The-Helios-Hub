import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { ExplainersDb } from '@/lib/explainers/db';
import { analogyBelowBar, chooseAnalogy, leastBadAnalogy, NO_ANALOGY_REASON, topicAnalogy } from '@/lib/explainers/ideas/analogy';
import { harvestNewProps, type HarvestResult } from '@/lib/explainers/render/bank';
import type { IdeaModel } from '@/lib/explainers/ideas/generator';
import { RecordingExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { defaultExec, repairBuild, runBuild, type BuildDeps, type BuildOutcome, type Exec } from '@/lib/explainers/render/build';
import { frameWorkerForLook, PICTURE_CHECK_FILE, runAgentSession, SCENE_BUILDER_AGENT, scrubbedEnv, TECH_FRAME_WORKER_AGENT, type AgentQuery, type FrameLook, type MainAgent, type SessionResult } from '@/lib/explainers/render/agent';
import { gridFrames, gridLayout, pictureFixNeeded, pictureGridParams, renderGrids, type PictureVision } from '@/lib/explainers/render/picture';
import { SpendMeter } from '@/lib/explainers/render/meter';
import {
  ANSWER_KEY_FILE,
  applyDiagnosis,
  FINDINGS_FILE,
  findingsJson,
  FIX_PROMPT,
  ANALOGY_FIX_PROMPT,
  judgeReader,
  mergeFindings,
  parseAnswerKey,
  READER_PERSONAS,
  reelTestMarkdown,
  REEL_TEST_FILE,
  REEL_TEST_NEWCOMER_FILE,
  standInWord,
  storyboardTerm,
  agentUnderstandingModel,
  isRefusal,
  jsonInText,
  understandingUsd,
  unStandIn,
  type ReaderAnswers,
  type ReaderPersona,
  type SeriousFinding,
  type UnderstandingFindings,
  type UnderstandingModel,
} from '@/lib/explainers/render/understanding';
import { asReelWarning, groupWarnings, SERIOUS_LABELS, warningsSummary, type WarningsSummary } from '@/lib/explainers/warnings';
import { resolveSource, type FetchLike } from '@/lib/explainers/render/source';
import { HYPERFRAMES_BIN, HYPERFRAMES_ENV, isExplainers41, prepareWorkspace, recordMusicChoice, workspacePaths, type Workspace } from '@/lib/explainers/render/workspace';
import {
  addArtifact,
  addLintViolations,
  finishJob,
  getJob,
  getTopic,
  listLintViolations,
  recentHandoffs,
  recentOpeners,
  recordCost,
  setJobHandoff,
  setJobOpener,
  setJobStage,
} from '@/lib/explainers/repository';
import { loadSettings, loadThemeBrief, type ExplainersSettings } from '@/lib/explainers/settings';
import type { ArtifactStore } from '@/lib/explainers/storage';
import type { ArtifactKind, JobRow, LintViolation, Mode, TopicRow } from '@/lib/explainers/types';
import { CaptionError, writeExplainerCaption, type CaptionDraft, type CaptionFacts, type CaptionOptions } from '@/lib/explainers/caption';
import { ceilingAllows, decideBuildLine, type RecentClosing } from '@/lib/social/captions/build-line';
import type { ClosingsLog } from '@/lib/social/captions/closings-store';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { eventsFromDir, lintStoryboard } from '../../../explainers/lint/lint-storyboard.mjs';
import { mountFrames } from '../../../explainers/world-kit/mount.mjs';
import { hasOpenerSfx, placeOpenerSfx } from '../../../explainers/world-kit/opener-sfx.mjs';
import { HISTORY as OPENER_HISTORY, OBJECT_HERO_OPENERS, openerByKey, pickOpener } from '../../../explainers/world-kit/openers/bank.js';
import { FALLBACK_HANDOFF, HANDOFF_FRAME, HANDOFF_HISTORY, handoffByKey, listField, pickHandoff } from '../../../explainers/world-kit/handoff-bank.js';
import { pace } from '../../../explainers/world-kit/pace.mjs';
import { OUT as EVENTS_TRACK, placeSound } from '../../../explainers/world-kit/sound.mjs';

export const PLAN_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: plan. Do only the plan phase, then stop.';
export const BUILD_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: build. STORYBOARD.md and SCRIPT.md are final; do only the build phase, through Finalize, then stop. Do not run the picture check and do not render: the worker does both.';

/** Session B for a resumed job (RenderDeps.resume): the build continues from what is on disk. */
export const RESUME_PROMPT = [
  'Use the helios-explainer-director skill to run this reel. PHASE: build. STORYBOARD.md and SCRIPT.md are final.',
  'This build was interrupted and is resuming in the same project: keep everything already on disk and do only what is missing.',
  'Do not generate the voice again (audio_meta.json and assets/voice/ exist); run audio.mjs sync-durations only if a frame has no voice_end.',
  'Run node assets/kit/pace.mjs, node assets/kit/music.mjs only if assets/bgm/track.mp3 is missing, and node assets/kit/opener-sfx.mjs; then write the frame packets.',
  'Keep assets/world/world.js if node assets/kit/try.mjs world passes. Dispatch frame workers only for frames whose module is missing or listed below as stale, then mount, try, bounds, sound, captions, assemble and finalize. Do not run the picture check and do not render: the worker does both.',
].join(' ');

/** One follow-up when session B stops successful but leaves beats unwritten. */
export function repairPrompt(missing: readonly number[]): string {
  return [
    'Use the helios-explainer-director skill to run this reel. PHASE: build.',
    `Frames ${missing.join(', ')} are missing from compositions/frames/.`,
    'Write each missing frame, then finish the build: assemble and check. Do not run the picture check and do not render: the worker does both.',
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
  /** Swappable for tests: the kit's breakage checks (try.mjs, Explainers 4.2) once more after session B. */
  tryCheck?: (projectDir: string) => LintViolation[];
  /**
   * The A/B harness (.explainers-local/runs/ab-scene-builder.ts): settings that win over the stored
   * ones for this run only (e.g. scene_builder_model), and a stop right before session B, so one plan
   * can be built twice from identical copies (with `resume`, which starts at session B).
   */
  settingsOverride?: Partial<ExplainersSettings>;
  stopAt?: 'session_b';
  /** Swappable for tests: snap.mjs sequences for the picture check the worker runs (null: no stills). */
  snapSequences?: (projectDir: string) => SequenceManifest | null;
  /**
   * The cheap picture check (cost fix 2026-10-28): one vision call over contact grids on
   * picture_check_model. Without it, or when it fails, the legacy picture-checker session runs.
   */
  pictureVision?: PictureVision;
  /**
   * The understanding test's readers and diagnosis (Explainers 4.2): direct Messages API calls on
   * reader_model. Without it the test does not run and the reel says so (`understanding:not_run`).
   */
  understanding?: UnderstandingModel | 'agent';
  /**
   * Swappable for tests. When session B stops without `renders/video.mp4` but
   * `index.html` is assembled, the worker renders it. No extra model call.
   */
  renderVideo?: (projectDir: string) => void;
  /** Adds the reel's verified new drawings to the asset bank (EX3-114); tests stub it. */
  harvest?: (input: { projectDir: string; jobId: string; topic: string }) => HarvestResult;
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
  /** Tests: the code build runner's command runner (build.ts defaultExec otherwise). */
  buildExec?: Exec;
  /** Extra resume instructions (e.g. frames to rebuild), appended to RESUME_PROMPT. */
  resumeNote?: string;
  /** Swappable for tests: the random draw of the opener (Math.random's shape). */
  random?: () => number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

/** Where a job's workspace names its opener (openers/sound.mjs CHOICE). */
export const OPENER_CHOICE = path.join('assets', 'opener.json');

/**
 * The hero's kind from STORYBOARD.md's `## Anchor scene` (`hero: <entity id> — critter | object`):
 * the director stages the analogy and picks the hero (EX3-128). A storyboard without one: critter.
 */
export function storyboardHero(storyboard: string): 'critter' | 'object' {
  const m = /^\s*-?\s*hero:.*?\b(critter|object)\b[^\n]*$/im.exec(storyboard);
  return m?.[1]?.toLowerCase() === 'object' ? 'object' : 'critter';
}

/**
 * Frame 1's opener for this job (EX3-102): the one it already drew, or a random one of the bank
 * that none of the last HISTORY reels used, recorded on the job and written to assets/opener.json
 * for pace, the frame and the sound. A job resumed from before the bank (its worker's own frame 1
 * built, no choice file) keeps that frame and draws none: null. An object-led reel (the storyboard's
 * hero is an object, EX3-111, EX3-128) draws only from the openers that never touch the hero, and the
 * choice file says `"hero": "object"`. Drawn after the plan, which names the hero; pace.mjs reads the
 * choice in the build.
 */
export async function assignOpener(
  db: ExplainersDb,
  jobId: string,
  projectDir: string,
  { resuming = false, random = Math.random, hero = 'critter' }: { resuming?: boolean; random?: () => number; hero?: 'critter' | 'object' } = {},
): Promise<string | null> {
  const pool = hero === 'object' ? OBJECT_HERO_OPENERS : undefined;
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
      key = pickOpener(await recentOpeners(db, jobId, OPENER_HISTORY), { rand: random, ...(pool ? { pool } : {}) }) as string;
      await setJobOpener(db, jobId, key);
    } catch (error) {
      // A database without the `opener` column yet (db/explainers_schema.sql, EX3-102): the reel
      // still gets an opener, drawn without the history, and the render goes on.
      if ((error as { code?: string })?.code !== '42703') throw error;
      key = pickOpener([], { rand: random, ...(pool ? { pool } : {}) }) as string;
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ key, name: openerByKey(key)?.name ?? key, hero }, null, 1)}\n`);
  return key;
}

/** Where a job's workspace names its hand-off (world-kit/frames.mjs HANDOFF_CHOICE). */
export const HANDOFF_CHOICE = path.join('assets', 'handoff.json');

/**
 * What frame 3's hand-off can draw from the plan (4.3): the anchor scene's hero `{ id, kind }`, the
 * mapped parts frame 3 names (`handoff_parts:`, entity ids) and its world sounds (`world_sounds:`,
 * foley words). Missing fields are empty: the pick then takes a template that needs none of them.
 */
export function handoffPlan(storyboard: string): { hero: { id: string; kind: 'critter' | 'object' } | null; parts: string[]; sounds: string[] } {
  const heroLine = /^\s*-?\s*hero:\s*([^\s—–-][^—–\n]*?)\s*[—–-]+\s*(critter|object)\b/im.exec(storyboard);
  const hero = heroLine ? { id: heroLine[1].trim().replace(/[`"]/g, ''), kind: heroLine[2].toLowerCase() as 'critter' | 'object' } : null;
  const heads = [...storyboard.matchAll(/^##\s+Frame\s+(\d+)\b.*$/gm)];
  const i = heads.findIndex((m) => Number(m[1]) === HANDOFF_FRAME);
  const block = i < 0 ? '' : storyboard.slice(heads[i].index! + heads[i][0].length, i + 1 < heads.length ? heads[i + 1].index : undefined);
  const field = (name: string) => new RegExp(`^\\s*-\\s*${name}:\\s*(.*)$`, 'im').exec(block)?.[1] ?? '';
  return { hero, parts: listField(field('handoff_parts'), 3), sounds: listField(field('world_sounds'), 2) };
}

/**
 * Frame 3's hand-off for this job (4.3): the one it already drew, or a random template that fits
 * the plan and that none of the last HANDOFF_HISTORY reels used, recorded on the job and written to
 * assets/handoff.json for pace, mount and the frame. Fail open: a database without the `handoff`
 * column draws without the history, and anything else wrong still writes FALLBACK_HANDOFF.
 */
export async function assignHandoff(
  db: ExplainersDb,
  jobId: string,
  projectDir: string,
  storyboard: string,
  { resuming = false, random = Math.random }: { resuming?: boolean; random?: () => number } = {},
): Promise<string> {
  const plan = handoffPlan(storyboard);
  const reel = { critterHero: plan.hero?.kind === 'critter', parts: plan.parts, sounds: plan.sounds };
  const file = path.join(projectDir, HANDOFF_CHOICE);
  let key: string | null = null;
  if (resuming) {
    try {
      const k = JSON.parse(fs.readFileSync(file, 'utf8'))?.key;
      key = handoffByKey(k) ? k : null;
    } catch {
      key = null;
    }
  }
  if (!key) {
    try {
      key = pickHandoff(await recentHandoffs(db, jobId, HANDOFF_HISTORY), reel, { rand: random });
      await setJobHandoff(db, jobId, key);
    } catch (error) {
      if ((error as { code?: string })?.code !== '42703') log42(error);
      key = key ?? pickHandoff([], reel, { rand: random });
    }
  }
  const pick = key ?? FALLBACK_HANDOFF;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ key: pick, name: handoffByKey(pick)?.name ?? pick, hero: plan.hero, parts: plan.parts, sounds: plan.sounds }, null, 1)}\n`);
  return pick;
}

/** A hand-off history error that is not the missing column: logged, never thrown (fail open). */
function log42(error: unknown): void {
  console.warn(JSON.stringify({ event: 'handoff_history_failed', error: error instanceof Error ? error.message : String(error) }));
}

/**
 * How a render ended. A finished reel always carries its warnings' count and the first two in plain
 * words (Explainers 4.2: the reel's notice); only a real crash or the spend cap fails a run.
 */
export type RenderOutcome = { status: 'ok'; warnings: WarningsSummary } | { status: 'failed'; error: string; capped: boolean };

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

/** True when every voiced frame (1–7) has its scene module in assets/frames, so the worker can mount and render them. */
export function frameModulesWritten(projectDir: string): boolean {
  const dir = path.join(projectDir, 'assets', 'frames');
  if (!fs.existsSync(dir)) return false;
  // A frame's own module: NN-<name>.js. Not code's opener (01-opener.js) and not a frame's new props (*.props.js).
  const own = fs.readdirSync(dir).filter((f) => /^\d+-[^.]+\.js$/.test(f) && f !== '01-opener.js');
  const have = new Set(own.map((f) => Number(/^(\d+)/.exec(f)?.[1])));
  return [1, 2, 3, 4, 5, 6, 7].every((n) => have.has(n));
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
/** hx-4's soft-3D and lens frames render several times slower than 3.x's flat frames (pre-mortem). */
export const RENDER_TIMEOUT_MS = 30 * 60 * 1000;

export function renderProjectVideo(projectDir: string): void {
  const out = path.join(projectDir, 'renders', 'video.mp4');
  if (fileReady(out)) return;
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const res = spawnSync(
    HYPERFRAMES_BIN,
    ['render', '--quality', 'high', '--workers', 'auto', '--output', 'renders/video.mp4'],
    { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, encoding: 'utf8', timeout: RENDER_TIMEOUT_MS },
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
 * What the picture check (EX3-84; required since Explainers 4.1) leaves on the reel, as warnings
 * (Explainers 4.2: it fails open, and it is the viewer's read only). A job prepared as 4.1 or later with
 * no readable .hyperframes/picture-check.json gets `picture:missing` (nobody looked at the shot
 * sequences before render; the reel still renders). Each frame where the stranger could not follow gets
 * one row per kind of problem, `picture:<kind>`: `line` (the picture does not show what the line says),
 * `jump_cut` (a cut the stranger felt as a jump), `floating` (held by nothing, resting on nothing: code
 * cannot see it in general), `who` (it cannot tell what the line is about) and `mechanism` (it could
 * not follow how the real thing works). The reel's answer adds `one_film` (it did
 * not feel like one film) and `changed_look` (a thing looked like a different thing later; minimum 6).
 * `frame` is the storyboard number when the id starts with it. A file from before 4.2 (named_character,
 * tech_moves) is read the same way; its faceless and cut-off lists are code's now and ignored.
 */
export function pictureCheckViolations(check: unknown, { required }: { required: boolean }): LintViolation[] {
  const entries = Array.isArray(check) ? check : Array.isArray((check as { frames?: unknown })?.frames) ? (check as { frames: unknown[] }).frames : null;
  if (!entries) {
    return required
      ? [{ source: 'storyboard', rule: 'picture:missing', frame: null, severity: 'warning', detail: `No readable ${PICTURE_CHECK_FILE}: the picture check did not run, so nobody looked at the shot sequences before render.` }]
      : [];
  }
  const out: LintViolation[] = [];
  const frameOf = (id: string) => {
    const n = Number(/^0*(\d+)/.exec(id)?.[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') continue;
    const e = raw as Record<string, unknown>;
    const id = String(e.frame ?? e.tile ?? '?');
    const add = (kind: string, said: string) => out.push({ source: 'storyboard', rule: `picture:${kind}`, frame: frameOf(id), severity: 'warning', detail: `${id}: ${said}` });
    if (e.matches_line === 'no') add('line', `the picture does not show what the line says${e.why ? ` (${String(e.why)})` : ''}`);
    const jumps = Array.isArray(e.jump_cuts) ? e.jump_cuts : [];
    for (const j of jumps) {
      const jj = j as { between?: unknown; why?: unknown };
      add('jump_cut', `a cut felt like a jump${Array.isArray(jj.between) ? ` between ${jj.between.join(' and ')}` : ''}${jj.why ? ` (${String(jj.why)})` : ''}`);
    }
    const floating = Array.isArray(e.floating) ? e.floating.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : [];
    if (floating.length) add('floating', `floating (held by nothing, resting on nothing): ${floating.join('; ')}`);
    const listOf = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : []);
    if (listOf(e.disconnected).length) add('disconnected', `not connected or not joined: ${listOf(e.disconnected).join('; ')}`);
    if (listOf(e.vanished).length) add('vanished', `appears or vanishes between shots of the same place: ${listOf(e.vanished).join('; ')}`);
    if (listOf(e.overlaps).length) add('overlap', `overlaps or cut off: ${listOf(e.overlaps).join('; ')}`);
    const subject = typeof e.subject === 'string' ? e.subject : typeof e.named_character === 'string' ? e.named_character : '';
    if (/^cannot tell/i.test(subject.trim())) add('who', 'a stranger cannot tell what the line is about');
    if (e.mechanism === 'unclear' || e.tech_moves === 'only_labels') {
      add('mechanism', `a stranger could not follow how it works${typeof e.mechanism_seen === 'string' && e.mechanism_seen.trim() ? ` (they saw: ${e.mechanism_seen.trim()})` : ''}`);
    }
  }
  const reel = (check as { reel?: unknown } | null)?.reel;
  if (reel && typeof reel === 'object') {
    const r = reel as { one_film?: unknown; why?: unknown; changed_look?: unknown };
    if (r.one_film === 'no' || r.one_film === 'partly') {
      out.push({ source: 'storyboard', rule: 'picture:one_film', frame: null, severity: 'warning', detail: `The reel ${r.one_film === 'no' ? 'does not feel' : 'only partly feels'} like one film${r.why ? ` (${String(r.why)})` : ''}.` });
    }
    for (const c of Array.isArray(r.changed_look) ? r.changed_look : []) {
      const x = (c ?? {}) as { thing?: unknown; frames?: unknown };
      const frames = Array.isArray(x.frames) ? x.frames.map(String) : [];
      out.push({ source: 'storyboard', rule: 'picture:changed_look', frame: frames.length ? frameOf(frames.at(-1)!) : null, severity: 'warning', detail: `${String(x.thing ?? 'something')} looks like a different thing${frames.length ? ` in ${frames.join(' and ')}` : ''}.` });
    }
  }
  return out;
}

/** snap.mjs sequences' manifest (one entry per voiced frame), or null when the stills could not be made. */
export type SequenceManifest = { frames: { id: string; number: number; look?: string; voiceover?: string; stills: { t: number; file: string }[] }[] };

export function runSnapSequences(projectDir: string): SequenceManifest | null {
  const script = path.join(projectDir, 'assets', 'kit', 'snap.mjs');
  if (!fs.existsSync(script)) return null;
  spawnSync(process.execPath, [script, 'sequences'], { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, encoding: 'utf8', timeout: 10 * 60 * 1000 });
  const m = readJson(path.join(projectDir, '.hyperframes', 'sequences', 'manifest.json')) as SequenceManifest | null;
  return m && Array.isArray(m.frames) && m.frames.length ? m : null;
}

/** The checker's dispatch: per frame, only its stills in order and the line heard over them. */
export function pictureCheckPrompt(manifest: SequenceManifest): string {
  return [
    'Look at these stills as a first-time viewer and answer as your instructions say. Per frame, in play order:',
    ...manifest.frames.map((f) => `- ${f.id}: stills ${f.stills.map((s) => `${s.file} (${s.t.toFixed(2)}s)`).join(', ')}; the line heard: "${f.voiceover ?? ''}"`),
  ].join('\n');
}

/** A frame entry the one fix round should take: what a viewer could not follow in it. */
export function pictureFailures(entry: Record<string, unknown>, look?: string): string[] {
  const out: string[] = [];
  if (entry.matches_line === 'no') out.push(`the picture does not show what the line says${entry.why ? ` (${String(entry.why)})` : ''}`);
  // Jump cuts are code's (try.mjs jump_cut, which knows the planned cuts, carries and look changes):
  // the viewer's felt jumps stay warnings and never send a frame to the fix (job b5488742: every
  // frame was flagged on its intended cuts).
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).filter(Boolean) : []);
  if (list(entry.floating).length) out.push(`floating: ${list(entry.floating).join('; ')}`);
  if (list(entry.disconnected).length) out.push(`not connected or not joined: ${list(entry.disconnected).join('; ')}`);
  if (list(entry.vanished).length) out.push(`appears or vanishes between shots of the same place: ${list(entry.vanished).join('; ')}`);
  if (list(entry.overlaps).length) out.push(`overlaps or cut off: ${list(entry.overlaps).join('; ')}`);
  if (typeof entry.subject === 'string' && /^cannot tell/i.test(entry.subject)) out.push('a viewer cannot tell what the line is about');
  if (entry.mechanism === 'unclear' && look !== 'world') out.push(`a viewer could not follow the mechanism${entry.mechanism_seen ? ` (saw: ${String(entry.mechanism_seen)})` : ''}`);
  return out;
}

/**
 * The one fix for one frame the picture check failed (cost fix 2026-10-28): its builder, directly, as
 * the session's main agent, with only that frame's problems; no director, no orchestrator.
 */
export function pictureFixPrompt(f: { id: string; problems: string[] }): string {
  return [
    `Read .hyperframes/frame-packets/_role.md and your packet .hyperframes/frame-packets/${f.id}.md. Your frame ${f.id} is already built (assets/frames/${f.id}.js). The picture check (run by the worker) found what a first-time viewer could not follow in it:`,
    ...f.problems.map((p) => `- ${f.id}: ${p}`),
    'Fix only that, in your own files, then look and self-check as your instructions say. Do not run the picture check and do not render: the worker does both.',
  ].join('\n');
}

/** The builder agent for a picture fix: by the frame's look (scene for world/blend or none). */
/** The model a code-dispatched builder runs on: the scene builder and the mechanism builders by their settings; every other builder on the job's frame_worker_model. */
export function builderModel(settings: Partial<Pick<ExplainersSettings, 'scene_builder_model' | 'tech_frame_worker_model'>>, frameWorkerModel: string, agent: string): string {
  if (agent === SCENE_BUILDER_AGENT) return settings.scene_builder_model ?? frameWorkerModel;
  if (agent === TECH_FRAME_WORKER_AGENT) return settings.tech_frame_worker_model ?? frameWorkerModel;
  return frameWorkerModel;
}

export function pictureFixAgent(look?: string): MainAgent {
  return frameWorkerForLook((look === 'mechanism' ? 'mechanism' : 'world') as FrameLook);
}

/** NEW_PROPS names a reel drew (world and frames), for the asset bank rows. */
function newPropNames(projectDir: string): { name: string; file: string }[] {
  const files = [path.join('assets', 'world', 'new-props.js'), ...(fs.existsSync(path.join(projectDir, 'assets', 'frames')) ? fs.readdirSync(path.join(projectDir, 'assets', 'frames')).filter((f) => f.endsWith('.props.js')).map((f) => path.join('assets', 'frames', f)) : [])];
  return files.flatMap((file) => {
    const text = read(path.join(projectDir, file)) ?? '';
    return [...text.matchAll(/\bname:\s*['"`]([^'"`]+)['"`]/g)].map((m) => ({ name: m[1], file }));
  });
}

/** An asset row passes when an object the checker named carries most of the drawing's words. */
export function assetRows(props: { name: string; file: string }[], objects: string[]): { name: string; file: string; meant: string; seen: string; pass: boolean }[] {
  const words = (v: string) => v.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  return props.map((p) => {
    const want = words(p.name);
    let best = '';
    let score = 0;
    for (const o of objects) {
      const have = new Set(words(o));
      const hit = want.filter((w) => have.has(w)).length / Math.max(1, want.length);
      if (hit > score) [best, score] = [o, hit];
    }
    return { name: p.name, file: p.file, meant: p.name, seen: best, pass: score >= 0.6 };
  });
}

/**
 * The picture check, run by code after session B and before the render: snap.mjs sequences, the
 * `picture-checker` agent (picture_check_model) on every frame, one fix round for the frames a viewer
 * could not follow (their builders, once), the checker again on those frames, and
 * .hyperframes/picture-check.json written. Every failure here fails open: collect turns what is left,
 * or a missing file, into warnings.
 */
async function runPictureCheck(ctx: {
  deps: RenderDeps;
  job: JobRow;
  projectDir: string;
  settings: ExplainersSettings;
  session: (prompt: string, model?: string, agent?: MainAgent) => Promise<SessionResult>;
  meter: SpendMeter;
  log: (event: string, fields?: Record<string, unknown>) => void;
  recordCheck: (r: SessionResult) => Promise<void>;
  recordFix: (r: SessionResult) => Promise<void>;
  recordVision: (r: { model: string; usage: unknown; usd: number }) => Promise<void>;
}): Promise<void> {
  const { deps, job, projectDir, settings, session, log } = ctx;
  const snap = deps.snapSequences ?? runSnapSequences;
  const parse = (text: string) => {
    const reply = jsonInText(text, 'picture checker') as { frames?: Record<string, unknown>[]; reel?: unknown };
    if (!Array.isArray(reply?.frames)) throw new Error('the picture checker replied with no frames');
    return reply as { frames: Record<string, unknown>[]; reel?: unknown };
  };
  const viaAgent = async (manifest: SequenceManifest) => {
    const r = await session(pictureCheckPrompt(manifest), settings.picture_check_model, 'picture-checker');
    await ctx.recordCheck(r);
    if (r.capped) throw new Error('the spend cap was reached in the picture check');
    return parse(r.lastText);
  };
  let breakage: LintViolation[] | null = null;
  const breakageNow = () => (breakage ??= (deps.tryCheck ?? runTryCheck)(projectDir));
  const check = async (manifest: SequenceManifest) => {
    if (deps.pictureVision) {
      try {
        // Risk from what code already knows: the breakage try.mjs still reports, per frame.
        const breakage = breakageNow();
        const jpegs = await renderGrids(projectDir, gridLayout(gridFrames(manifest.frames, breakage)));
        const reply = await deps.pictureVision(pictureGridParams(settings.picture_check_model, manifest.frames, jpegs));
        ctx.meter.charge(reply.usd);
        await ctx.recordVision(reply);
        return parse(reply.text);
      } catch (error) {
        log('picture_grid_failed', { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
      }
    }
    return viaAgent(manifest);
  };
  const manifest = snap(projectDir);
  if (!manifest) {
    log('picture_check_no_stills', { jobId: job.id });
    return;
  }
  const first = await check(manifest);
  const looks = new Map(manifest.frames.map((f) => [f.id, f.look]));
  const flagged = first.frames.map((e) => ({ id: String(e.frame ?? ''), problems: pictureFailures(e, looks.get(String(e.frame ?? ''))) })).filter((f) => f.id && looks.has(f.id) && f.problems.length);
  // A frame that passes every code check and is low risk skips the fix round (its notes still ship).
  const byId = new Map(manifest.frames.map((f) => [f.id, f]));
  const failing = flagged.filter((f) => pictureFixNeeded(byId.get(f.id)!, breakageNow()));
  if (failing.length < flagged.length) log('picture_fix_skipped', { jobId: job.id, frames: flagged.filter((f) => !failing.includes(f)).map((f) => f.id) });
  let result = first;
  const write = () => {
    const objects = result.frames.flatMap((e) => (Array.isArray(e.objects) ? e.objects.map(String) : []));
    fs.mkdirSync(path.join(projectDir, '.hyperframes'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, PICTURE_CHECK_FILE), `${JSON.stringify({ ...result, assets: assetRows(newPropNames(projectDir), objects) }, null, 1)}\n`);
  };
  write();
  if (!failing.length) return;
  // Only the flagged frames, each by its own builder, in parallel; then code re-mounts them.
  log('picture_fix', { jobId: job.id, frames: failing.map((f) => f.id) });
  const fixes = await Promise.all(failing.map((f) => { const agent = pictureFixAgent(looks.get(f.id)); return session(pictureFixPrompt(f), builderModel(settings, job.frame_worker_model, agent), agent).catch(() => null); }));
  for (const r of fixes) if (r) await ctx.recordFix(r);
  for (const f of failing) {
    try {
      mountFrames(projectDir, f.id as never);
    } catch (error) {
      log('picture_fix_mount_failed', { jobId: job.id, frame: f.id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  if (fixes.some((r) => r?.capped)) return;
  const again = snap(projectDir);
  if (!again) return;
  const ids = new Set(failing.map((f) => f.id));
  const second = await check({ frames: again.frames.filter((f) => ids.has(f.id)) });
  const fixed = new Map(second.frames.map((e) => [String(e.frame ?? ''), e]));
  result = { ...first, frames: first.frames.map((e) => fixed.get(String(e.frame ?? '')) ?? e) };
  write();
}

/**
 * The kit's breakage checks (try.mjs, Explainers 4.2: fail open) run once more after session B, on the
 * built frames: whatever the builders' one fix round left becomes a `breakage:<check>` warning, and the
 * reel still renders. try.mjs prints `problems: [{ frame, check, rule, message }]` beside its `errors`;
 * an error it printed without one is `breakage:try`. A try that cannot run records nothing.
 */
export function runTryCheck(projectDir: string): LintViolation[] {
  const script = path.join(projectDir, 'assets', 'kit', 'try.mjs');
  if (!fs.existsSync(script)) return [];
  const res = spawnSync(process.execPath, [script, 'all'], { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, encoding: 'utf8', timeout: 5 * 60 * 1000 });
  try {
    return tryViolations(JSON.parse(res.stdout));
  } catch {
    return [];
  }
}

/** try.mjs's JSON as warnings (see runTryCheck). */
export function tryViolations(parsed: unknown): LintViolation[] {
  const p = (parsed ?? {}) as { errors?: unknown; problems?: unknown };
  const frameOf = (v: unknown) => Number(/^0*(\d+)/.exec(String(v ?? ''))?.[1]) || null;
  if (Array.isArray(p.problems) && p.problems.length) {
    return p.problems.map((raw) => {
      const x = (raw ?? {}) as { frame?: unknown; check?: unknown; rule?: unknown; message?: unknown };
      const check = String(x.check ?? '').replace(/[^\w-]+/g, '_') || 'try';
      const rule = typeof x.rule === 'string' && /^breakage:\S/.test(x.rule) ? x.rule : `breakage:${check}`;
      return { source: 'hyperframes' as const, rule, frame: frameOf(x.frame), severity: 'warning' as const, detail: `${x.frame ? `${String(x.frame)}: ` : ''}${String(x.message ?? '')}` };
    });
  }
  return (Array.isArray(p.errors) ? p.errors : []).map((e) => ({ source: 'hyperframes' as const, rule: 'breakage:try', frame: frameOf(e), severity: 'warning' as const, detail: String(e) }));
}

/** The most minor understanding notes kept as their own warnings; the rest are counted in one more. */
export const MINOR_WARNINGS_MAX = 12;

/** The understanding test's leftovers as reel warnings (Explainers 4.2). */
export function understandingWarnings(findings: UnderstandingFindings, extra: LintViolation[] = []): LintViolation[] {
  const rows: LintViolation[] = findings.serious.map((f) => ({
    source: 'storyboard',
    rule: `understanding:${f.type}`,
    frame: f.beat,
    severity: 'warning',
    detail: `${SERIOUS_LABELS[f.type] ?? f.type}. The ${f.reader} viewer: "${f.reader_quote}". The reel: "${f.script_quote}".${f.why ? ` ${f.why}` : ''} (cause: ${f.cause.replace('_', ' ')})`,
  }));
  for (const m of findings.minor.slice(0, MINOR_WARNINGS_MAX)) rows.push({ source: 'storyboard', rule: 'understanding:minor', frame: m.beat, severity: 'warning', detail: m.text });
  if (findings.minor.length > MINOR_WARNINGS_MAX) {
    rows.push({ source: 'storyboard', rule: 'understanding:minor', frame: null, severity: 'warning', detail: `${findings.minor.length - MINOR_WARNINGS_MAX} more minor notes are in the understanding report.` });
  }
  return [...extra, ...rows];
}

type UnderstandingRound = {
  ran: boolean;
  findings: UnderstandingFindings;
  readers: Partial<Record<ReaderPersona, ReaderAnswers>>;
  /** The curious reader's file (the real term), for the diagnosis. */
  reelTest: string;
  standIn: string;
  leakedScenes: number[];
  hasKey: boolean;
  problems: string[];
};

/**
 * The understanding test (Explainers 4.2, UNDERSTANDING.md, fail open), right after the plan. Code builds
 * what a viewer meets, two readers read it in parallel, Jev judges each against the director's answer
 * key, and code sorts serious from minor. Something serious: one diagnosis, the director's one fix
 * session, one re-test of the whole reel, and the version with fewer serious findings goes ahead (a tie
 * keeps the fix). Whatever remains is attached to the reel as warnings. Nothing here stops the reel but
 * the spend cap. Returns the plan that goes ahead.
 */
/**
 * The analogy check failed (`analogy:no_pass`): the director gets one fix pass on the analogy's
 * mapping (PHASE: fix, a findings file whose findings have cause `mapping`, one per check missed),
 * before the understanding test. Fail open: a pass that throws, errors or leaves no plan keeps the
 * plan as it was. Returns the plan that goes ahead.
 */
export async function analogyFixPass(ctx: {
  projectDir: string;
  analogy: string;
  misses: readonly string[];
  storyboard: string;
  script: string;
  model: string;
  session: (prompt: string, model: string) => Promise<SessionResult>;
  onSession?: (s: SessionResult) => Promise<void>;
  log?: (event: string, data: Record<string, unknown>) => void;
}): Promise<{ storyboard: string; script: string; ran: boolean }> {
  const file = (rel: string) => path.join(ctx.projectDir, rel);
  const keep = { storyboard: ctx.storyboard, script: ctx.script, ran: false };
  const misses = ctx.misses.length ? ctx.misses : ['the analogy did not pass the analogy checks'];
  const findings = {
    serious: misses.map((m) => ({ type: 'analogy_check', reader: 'analogy_check', reader_quote: m, script_quote: '', beat: null, cause: 'mapping', why: `The analogy "${ctx.analogy}" missed this check: ${m}` })),
    minor: [] as string[],
  };
  const restore = () => {
    fs.writeFileSync(file('STORYBOARD.md'), ctx.storyboard);
    fs.writeFileSync(file('SCRIPT.md'), ctx.script);
  };
  try {
    fs.mkdirSync(path.dirname(file(FINDINGS_FILE)), { recursive: true });
    fs.writeFileSync(file(FINDINGS_FILE), `${JSON.stringify(findings, null, 2)}\n`);
    const fix = await ctx.session(ANALOGY_FIX_PROMPT, ctx.model);
    await ctx.onSession?.(fix);
    if (fix.capped) throw new RenderFailure('Spend cap reached in the analogy fix session.', true);
    const board = fs.existsSync(file('STORYBOARD.md')) ? fs.readFileSync(file('STORYBOARD.md'), 'utf8') : '';
    const words = fs.existsSync(file('SCRIPT.md')) ? fs.readFileSync(file('SCRIPT.md'), 'utf8') : '';
    if (fix.isError || !board.trim() || !words.trim()) {
      ctx.log?.('analogy_fix_kept_plan', { error: fix.isError, subtype: fix.subtype });
      restore();
      return keep;
    }
    ctx.log?.('analogy_fix_done', { changed: board !== ctx.storyboard || words !== ctx.script });
    return { storyboard: board, script: words, ran: true };
  } catch (error) {
    if (error instanceof RenderFailure) throw error;
    ctx.log?.('analogy_fix_failed', { error: error instanceof Error ? error.message : String(error) });
    restore();
    return keep;
  } finally {
    // the understanding test writes its own findings; none of these linger for it
    fs.rmSync(file(FINDINGS_FILE), { force: true });
  }
}

async function understandingTest(ctx: {
  deps: RenderDeps;
  job: JobRow;
  topic: TopicRow;
  settings: ExplainersSettings;
  projectDir: string;
  storyboard: string;
  script: string;
  meter: SpendMeter;
  session: (prompt: string, model: string, agent?: 'reader' | 'diagnoser') => Promise<SessionResult>;
  keepText: (kind: ArtifactKind, content: string | null) => Promise<void>;
  stage: (name: string) => Promise<void>;
  log: (event: string, fields?: Record<string, unknown>) => void;
}): Promise<{ storyboard: string; script: string }> {
  const { deps, job, topic, settings, projectDir, meter, keepText, stage, log } = ctx;
  const model =
    deps.understanding === 'agent'
      ? agentUnderstandingModel(
          ({ prompt, agent, model: m }) => ctx.session(prompt, m, agent),
          (rel, text) => {
            fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
            fs.writeFileSync(path.join(projectDir, rel), text);
          },
        )
      : deps.understanding;
  const notRun = (detail: string): LintViolation => ({ source: 'storyboard', rule: 'understanding:not_run', frame: null, severity: 'warning', detail });
  if (!model) {
    log('understanding_skipped', { jobId: job.id, reason: 'no reader model' });
    await addLintViolations(deps.db, job.id, [notRun('The understanding test did not run: this worker has no reader model.')]);
    return { storyboard: ctx.storyboard, script: ctx.script };
  }
  const jev = deps.analogy ? new RecordingExplainersJevRunner(deps.analogy.jevTransport, deps.db, { mode: job.mode, jobId: job.id }) : null;
  const term = topic.term?.trim() || storyboardTerm(ctx.storyboard) || topic.title;
  const file = (rel: string) => path.join(projectDir, rel);
  const spend = async (component: string, reply: { usage: unknown; model: string; usd?: number }) => {
    // the agent path's sessions are already on the meter
    const usd = reply.usd ?? understandingUsd(reply as never);
    if (reply.usd === undefined) meter.charge(usd);
    const u = (reply.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
    await recordCost(deps.db, {
      jobId: job.id,
      mode: job.mode,
      vendor: 'anthropic',
      component: `${component}:${reply.model}`,
      inputTokens: u.input_tokens ?? 0,
      outputTokens: u.output_tokens ?? 0,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      usd,
    });
  };

  const round = async (storyboard: string, script: string): Promise<UnderstandingRound> => {
    const key = parseAnswerKey(readJson(file(ANSWER_KEY_FILE)));
    const curious = reelTestMarkdown({ storyboard, script, term });
    const standIn = standInWord(`${curious.text}\n${term}`);
    const newcomer = reelTestMarkdown({ storyboard, script, term, standIn });
    fs.mkdirSync(path.dirname(file(REEL_TEST_FILE)), { recursive: true });
    fs.writeFileSync(file(REEL_TEST_FILE), curious.text);
    fs.writeFileSync(file(REEL_TEST_NEWCOMER_FILE), newcomer.text);
    const tests: Record<ReaderPersona, { text: string; word: string }> = { newcomer: { text: newcomer.text, word: standIn }, curious: { text: curious.text, word: term } };
    const problems: string[] = [];
    const settled = await Promise.allSettled(
      READER_PERSONAS.map(async (persona) => {
        const request = { model: settings.reader_model, persona, term: tests[persona].word, reelTest: tests[persona].text, file: persona === 'newcomer' ? REEL_TEST_NEWCOMER_FILE : REEL_TEST_FILE };
        try {
          return await model.read(request);
        } catch (error) {
          // A refusal gets one retry in the plainest wording on the director's model (live runs: the
          // reader model's safeguards flagged every wording of some topics), then fails open.
          if (!isRefusal(error)) throw error;
          log('understanding_reader_refused', { jobId: job.id, persona, retry_model: settings.director_model });
          return await model.read({ ...request, plain: true, model: settings.director_model });
        }
      }),
    );
    const readers: Partial<Record<ReaderPersona, ReaderAnswers>> = {};
    const parts: UnderstandingFindings[] = [];
    for (const [i, result] of settled.entries()) {
      const persona = READER_PERSONAS[i];
      if (result.status === 'rejected') {
        problems.push(`the ${persona} reader failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
        continue;
      }
      await spend(`understanding_reader_${persona}`, result.value);
      readers[persona] = result.value.value;
      let judged: UnderstandingFindings;
      try {
        judged = await judgeReader({ jev, topicId: topic.id, key, reader: persona, answers: result.value.value, reelTest: tests[persona].text });
      } catch (error) {
        // Jev failed: judge what code can read on its own, and say so.
        problems.push(`Jev could not judge the ${persona} reader: ${error instanceof Error ? error.message : String(error)}`);
        judged = await judgeReader({ jev: null, topicId: topic.id, key, reader: persona, answers: result.value.value, reelTest: tests[persona].text });
      }
      parts.push(persona === 'newcomer' ? unStandIn(judged, standIn, term) : judged);
    }
    if (!jev && key) problems.push('no Jev on this worker: only what code reads from the answers was judged');
    return { ran: parts.length > 0, findings: mergeFindings(parts), readers, reelTest: curious.text, standIn, leakedScenes: curious.leakedScenes, hasKey: Boolean(key), problems };
  };
  const report = (attempt: 'first' | 'after_fix', r: UnderstandingRound) =>
    keepText('lint_report', JSON.stringify({ phase: 'understanding', attempt, findings: findingsJson(r.findings), problems: r.problems, stand_in: r.standIn, readers: r.readers }, null, 2));
  const extras = (r: UnderstandingRound): LintViolation[] => [
    ...(r.leakedScenes.length
      ? [{ source: 'storyboard' as const, rule: 'understanding:scene_line', frame: r.leakedScenes.length === 1 ? r.leakedScenes[0] : null, severity: 'warning' as const, detail: `The scene line of frame ${r.leakedScenes.join(', ')} said what it means (parentheses or "="), not only what a viewer sees; the readers met it without that part.` }]
      : []),
    ...(r.hasKey ? [] : [{ source: 'storyboard' as const, rule: 'understanding:no_answer_key', frame: null, severity: 'warning' as const, detail: `The director wrote no readable ${ANSWER_KEY_FILE}, so the readers' answers were judged only on what code can read from them.` }]),
    ...r.problems.map(notRun),
  ];
  const capCheck = () => {
    if (meter.overCap) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached in the understanding test.`, true);
  };

  await stage('understanding');
  const first = await round(ctx.storyboard, ctx.script);
  await report('first', first);
  capCheck();
  if (!first.ran || first.findings.serious.length === 0) {
    if (!first.ran) log('understanding_not_run', { jobId: job.id, problems: first.problems });
    await addLintViolations(deps.db, job.id, understandingWarnings(first.findings, extras(first)));
    return { storyboard: ctx.storyboard, script: ctx.script };
  }

  // Serious: one diagnosis (fail open: without it, each finding keeps its default cause).
  log('understanding_serious', { jobId: job.id, types: first.findings.serious.map((f) => f.type) });
  let serious: SeriousFinding[] = first.findings.serious;
  try {
    const d = await model.diagnose({ model: settings.reader_model, reelTest: first.reelTest, key: parseAnswerKey(readJson(file(ANSWER_KEY_FILE))), readers: first.readers, serious, standIn: first.standIn, term });
    await spend('understanding_diagnosis', d);
    serious = applyDiagnosis(serious, d.value);
  } catch (error) {
    log('understanding_diagnosis_failed', { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
  }
  const firstFindings: UnderstandingFindings = { serious, minor: first.findings.minor };
  fs.writeFileSync(file(FINDINGS_FILE), `${JSON.stringify(findingsJson(firstFindings), null, 2)}\n`);
  capCheck();

  // The director's one fix session, with the plan as it was kept to fall back on.
  const before = { storyboard: ctx.storyboard, script: ctx.script, key: read(file(ANSWER_KEY_FILE)) };
  await stage('session_fix');
  const fix = await ctx.session(FIX_PROMPT, settings.director_model);
  await recordSessionCost(deps.db, job, job.mode, 'session_fix', fix);
  if (fix.capped) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached in the fix session.`, true);
  const restore = () => {
    fs.writeFileSync(file('STORYBOARD.md'), before.storyboard);
    fs.writeFileSync(file('SCRIPT.md'), before.script);
    if (before.key !== null) fs.writeFileSync(file(ANSWER_KEY_FILE), before.key);
  };
  let board = read(file('STORYBOARD.md'));
  let words = read(file('SCRIPT.md'));
  if (!board?.trim() || !words?.trim()) {
    // A fix that left no plan behind is no fix: the plan as it was goes ahead.
    log('understanding_fix_lost_plan', { jobId: job.id });
    restore();
    board = before.storyboard;
    words = before.script;
  }
  if (board !== before.storyboard) await keepText('storyboard', board);
  if (words !== before.script) await keepText('script', words);
  if (fix.isError) log('understanding_fix_error', { jobId: job.id, subtype: fix.subtype, errors: fix.errors });

  // One re-test of the whole reel, both readers fresh; the better version goes ahead.
  await stage('understanding_retest');
  const second = await round(board, words);
  await report('after_fix', second);
  capCheck();
  let remaining: UnderstandingFindings;
  let extra: LintViolation[];
  if (!second.ran) {
    // No re-test to compare: the fix stays (a tie keeps the fix), carrying what the first test found.
    remaining = { serious: firstFindings.serious, minor: [...firstFindings.minor, { text: 'The re-test after the fix did not run, so these findings are from before the fix.', beat: null }] };
    extra = extras(second);
  } else if (second.findings.serious.length > firstFindings.serious.length) {
    log('understanding_reverted', { jobId: job.id, before: firstFindings.serious.length, after: second.findings.serious.length });
    restore();
    if (board !== before.storyboard) await keepText('storyboard', before.storyboard);
    if (words !== before.script) await keepText('script', before.script);
    board = before.storyboard;
    words = before.script;
    remaining = { serious: firstFindings.serious, minor: [...firstFindings.minor, { text: `The fix made it worse (${second.findings.serious.length} serious findings after it, ${firstFindings.serious.length} before), so the plan from before the fix went ahead.`, beat: null }] };
    extra = extras(first);
  } else {
    remaining = second.findings;
    extra = extras(second);
  }
  log('understanding_done', { jobId: job.id, serious: remaining.serious.length, minor: remaining.minor.length });
  await addLintViolations(deps.db, job.id, understandingWarnings(remaining, extra));
  return { storyboard: board, script: words };
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
  const settings = { ...(await loadSettings(db)), ...(deps.settingsOverride ?? {}) };
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

    // The idea phase picks every pool topic's analogy (EX3-30). A topic from before 3.9, or one
    // whose pass failed or picked nothing, gets the same pass here, for this one topic, on this click
    // (EX3-31). Explainers 4.2, fail open: when nothing passes in three writer calls, the render goes
    // on with the least-bad candidate and an `analogy:no_pass` warning (supersedes EX3-125's failed
    // render); the topic keeps its below-bar note, so a later render writes again. Only a writer that
    // returned nothing usable at all fails the run.
    let analogy = topicAnalogy(topic);
    let noPass: { analogy: string; misses: string[] } | null = null;
    if (!analogy) {
      await stage('analogy');
      if (!deps.analogy) throw new RenderFailure('This topic has no picked analogy, and this worker has no analogy writer.');
      const jev = new RecordingExplainersJevRunner(deps.analogy.jevTransport, db, { mode: job.mode, jobId: job.id });
      const note = await chooseAnalogy(
        { db, jev, ideaModel: deps.analogy.ideaModel, model: settings.analogy_model, mode: job.mode, jobId: job.id },
        topic,
      ).catch((error: unknown) => {
        throw new RenderFailure(`Analogy: ${error instanceof Error ? error.message : String(error)}`);
      });
      topic = (await getTopic(db, job.topic_id)) as TopicRow;
      analogy = topicAnalogy(topic);
      if (!analogy && analogyBelowBar(note)) {
        const least = leastBadAnalogy(note);
        if (!least) throw new RenderFailure(NO_ANALOGY_REASON);
        analogy = least.analogy;
        noPass = { analogy: analogy.name, misses: least.misses };
        log('analogy_no_pass', { jobId: job.id, analogy: analogy.name, misses: least.misses });
        await addLintViolations(db, job.id, [
          { source: 'storyboard', rule: 'analogy:no_pass', frame: null, severity: 'warning', detail: `No analogy passed the checks in three writer calls, so the reel uses the least-bad one, "${analogy.name}"${least.misses.length ? `: ${least.misses.join('; ')}` : ''}.` },
        ]);
      }
      if (!analogy) throw new RenderFailure(NO_ANALOGY_REASON);
    }

    // Explainers 4.3: the reel has no curiosity-gap beat. The gap writer's code stays (the idea
    // phase no longer runs it either), but nothing writes, picks or waits for a gap line here, and
    // BRIEF.md carries none.

    await stage('workspace');
    const existing = workspacePaths(deps.jobsRoot, job.id);
    const resuming = Boolean(deps.resume) && fs.existsSync(path.join(existing.projectDir, 'STORYBOARD.md')) && fs.existsSync(path.join(existing.projectDir, 'SCRIPT.md'));
    if (resuming) {
      ws = existing;
      log('resume', { jobId: job.id });
    } else {
      ws = (deps.prepare ?? prepareWorkspace)({ jobsRoot: deps.jobsRoot, jobId: job.id, topic, sourceText, analogy });
      await keepText('brief', read(path.join(ws.projectDir, 'BRIEF.md')));
    }

    // The analogy pass, when it ran, is already on the job's spend.
    const meter = new SpendMeter(job.spend_cap_usd, (await getJob(db, job.id))?.spend_usd ?? job.spend_usd);
    // Explainers 4.2 models (settings): the director (session A and its fix) on director_model, session B
    // on the job's orchestrator model; the scene builder on scene_builder_model; every frame builder on
    // the job's frame_worker_model, except mechanism builders on tech_frame_worker_model; the picture check
    // on picture_check_model.
    const session = (prompt: string, model: string = job.orchestrator_model, agent?: MainAgent) =>
      runAgentSession({
        mainAgent: agent,
        readerModel: settings.reader_model,
        query: deps.query,
        prompt,
        projectDir: ws!.projectDir,
        homeDir: ws!.homeDir,
        tmpDir: ws!.tmpDir,
        model,
        frameWorkerModel: job.frame_worker_model,
        sceneBuilderModel: settings.scene_builder_model,
        techFrameWorkerModel: settings.tech_frame_worker_model,
        pictureCheckModel: settings.picture_check_model,
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
      const a = await session(PLAN_PROMPT, settings.director_model);
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
      // The analogy failed its checks: one director fix pass on its mapping (fail open).
      if (noPass) {
        await stage('session_analogy_fix');
        const fixed = await analogyFixPass({
          projectDir: ws.projectDir, analogy: noPass.analogy, misses: noPass.misses, storyboard, script, model: settings.director_model, session,
          onSession: (s) => recordSessionCost(db, job, job.mode, 'session_analogy_fix', s),
          log: (event, data) => log(event, { jobId: job.id, ...data }),
        });
        if (fixed.storyboard !== storyboard) await keepText('storyboard', fixed.storyboard);
        if (fixed.script !== script) await keepText('script', fixed.script);
        storyboard = fixed.storyboard;
        script = fixed.script;
      }
    }

    // The understanding test (Explainers 4.2, fail open): two readers, Jev's checklist against the
    // director's answer key, one fix and one re-test when something is serious, warnings for what is
    // left. A resumed job's plan was tested before it stopped.
    if (!resuming) {
      const fixed = await understandingTest({ deps, job, topic, settings, projectDir: ws.projectDir, storyboard, script, meter, session, keepText, stage, log });
      storyboard = fixed.storyboard;
      script = fixed.script;
    }

    // Frame 1's opener, drawn from the bank once the plan names the hero (EX3-102, EX3-128).
    const opener = await assignOpener(db, job.id, ws.projectDir, { resuming, random: deps.random, hero: storyboardHero(storyboard) });
    log('opener', { jobId: job.id, opener });

    // Frame 3's hand-off (4.3): a template from the bank that fits the plan (its hero, the mapped
    // parts and world sounds frame 3 names), never one of the last few reels'. Code builds frame 3.
    const handoff = await assignHandoff(db, job.id, ws.projectDir, storyboard, { resuming, random: deps.random });
    log('handoff', { jobId: job.id, handoff });

    // Checkpoint: deterministic lint, recorded, never blocking (E-07). The director already ran it in
    // session A and fixed what it could (its one fix round); an error still left is a reel warning
    // (`lint:<rule>`, Explainers 4.2: fail open).
    await stage('checkpoint');
    const checkpoint = lintStoryboard({ storyboard, script, brief: read(path.join(ws.projectDir, 'BRIEF.md')) });
    await addLintViolations(db, job.id, (checkpoint.violations as LintViolation[]).map((v) => (v.severity === 'error' ? asReelWarning(v, 'lint') : v)));
    await keepText('lint_report', JSON.stringify({ phase: 'checkpoint', ...checkpoint }, null, 2));

    if (deps.stopAt === 'session_b') {
      const error = 'Stopped before session B (stopAt: the plan is ready to build from a copy).';
      await finishJob(db, job.id, { status: 'failed', error, capped: false });
      log('job_stopped', { jobId: job.id, at: 'session_b' });
      return { status: 'failed', error, capped: false };
    }

    // Session B: build. By default code runs the workflow's build steps (cost fix 1, build.ts) and
    // dispatches each builder as its own session, each recorded as session_b:<model>; build_runner
    // 'agent' brings back the orchestrator session.
    await stage('session_b');
    const codeRunner = (settings.build_runner ?? 'code') === 'code';
    const buildDeps = (): BuildDeps => {
      const env = scrubbedEnv({ projectDir: ws!.projectDir, homeDir: ws!.homeDir, tmpDir: ws!.tmpDir, secrets: { ...deps.secrets, voiceId: settings.voice_id ?? '' } });
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_CUSTOM_HEADERS;
      return {
        projectDir: ws!.projectDir,
        voiceId: settings.voice_id ?? '',
        dispatch: async (agent, prompt) => {
          const r = await session(prompt, builderModel(settings, job.frame_worker_model, agent), agent);
          await recordSessionCost(db, job, job.mode, 'session_b', r);
          return r;
        },
        overCap: () => meter.overCap,
        log: (event, data) => log(event, { jobId: job.id, ...(data ?? {}) }),
        exec: deps.buildExec ?? defaultExec(ws!.projectDir, env),
        ...(resuming ? { resume: { note: deps.resumeNote } } : {}),
      };
    };
    const asSession = (o: BuildOutcome): SessionResult => ({ sessionId: null, subtype: 'success', isError: false, totalCostUsd: 0, modelUsage: {}, capped: o.capped, denials: [], errors: [], lastText: o.notes.join('\n') });
    let b: SessionResult;
    if (codeRunner) {
      const built = await runBuild(buildDeps());
      log('build_notes', { jobId: job.id, notes: built.notes });
      b = asSession(built);
    } else {
      b = await session(resuming ? `${RESUME_PROMPT}${deps.resumeNote ? ` ${deps.resumeNote}` : ''}` : BUILD_PROMPT);
    }
    await stage('session_b_done', { sessionBId: b.sessionId ?? undefined });
    if (!codeRunner) await recordSessionCost(db, job, job.mode, 'session_b', b);
    // A cap in session B (or its repair) keeps the reel when it is already rendered, or when the frames
    // are written and the voice exists: the worker assembles and renders them with no model (hx-4
    // pre-mortem: a capped job used to throw away every finished frame). The cap and the salvage are
    // recorded on the reel; nothing else is spent. Only a cap with nothing to deliver fails the run.
    const videoPath = path.join(ws.projectDir, 'renders', 'video.mp4');
    const salvageable = () => fileReady(videoPath) || (frameModulesWritten(ws!.projectDir) && fileReady(path.join(ws!.projectDir, 'audio_meta.json')));
    let salvage = false;
    const capped = async (where: string) => {
      if (!salvageable()) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached ${where}.`, true);
      salvage = true;
      log('capped_salvage', { jobId: job.id, where });
      await addLintViolations(db, job.id, [
        { source: 'storyboard', rule: 'spend_cap', frame: null, severity: 'warning', detail: `The $${job.spend_cap_usd.toFixed(2)} cap was reached ${where}, so nothing more was spent on this reel.` },
        { source: 'storyboard', rule: 'salvaged', frame: null, severity: 'warning', detail: 'The worker delivered what was already built, with no model: it assembled and rendered the frames already written, and whatever session B had not finished after them (checks, fixes, the picture check) did not run.' },
      ]);
    };
    if (b.capped) await capped('in session B');

    // A successful session can still stop with beats unwritten and no MP4 (the
    // server reel: the auto classifier refused frames 2 and 6, and the model
    // waited). One repair, then the worker render below. No third session.
    const missing = missingFrameNumbers(ws.projectDir);
    if (!salvage && !fileReady(videoPath) && missing.length > 0 && b.subtype === 'success' && !b.isError) {
      await stage('repair');
      log('repair_frames', { jobId: job.id, missing });
      if (codeRunner) {
        b = asSession(await repairBuild(buildDeps(), missing));
      } else {
        b = await session(repairPrompt(missing));
        await recordSessionCost(db, job, job.mode, 'repair', b);
      }
      if (b.capped) await capped('while repairing missing frames');
    }

    // The picture check, run by code (Lucas, 2026-10-28: the orchestrator skipped it on 2 of 3 reels
    // to save spend near the cap): stills, the checker, one fix round, the file. Fails open.
    if (!salvage && isExplainers41(ws.projectDir) && !fileReady(videoPath)) {
      try {
        await stage('picture_check');
        await runPictureCheck({
          deps,
          job,
          projectDir: ws.projectDir,
          session,
          settings,
          meter,
          log,
          recordFix: (r) => recordSessionCost(db, job, job.mode, 'picture_fix', r),
          recordCheck: (r) => recordSessionCost(db, job, job.mode, 'picture_check', r),
          recordVision: async (r) => {
            const u = (r.usage ?? {}) as { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null };
            await recordCost(db, { jobId: job.id, mode: job.mode, vendor: 'anthropic', component: `picture_check:${r.model}`, inputTokens: u.input_tokens ?? 0, outputTokens: u.output_tokens ?? 0, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0, usd: r.usd });
          },
        });
      } catch (error) {
        log('picture_check_failed', { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
      }
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
      brief: read(path.join(ws.projectDir, 'BRIEF.md')),
      frameSource: frameModulesByNumber(ws.projectDir),
      audioMeta: readJson(path.join(ws.projectDir, 'audio_meta.json')),
      frameEvents: eventsFromDir(path.join(ws.projectDir, 'assets', 'frames')),
      eventsTrack: fs.existsSync(path.join(ws.projectDir, EVENTS_TRACK)),
    });
    // The final pass records only what the checkpoint could not see: the built frames and sound.
    const builtOnly = new Set(['narration_on_screen', 'opener_sfx', 'sound_events', 'sound_track', 'headword_term']);
    const onScreen = (final.violations as LintViolation[]).filter((v) => builtOnly.has(v.rule) || /on-screen text/.test(v.detail));
    // Explainers 4.2, fail open: session B's builders and orchestrator had their one fix round, so
    // every check's leftover error is a reel warning and the reel still renders.
    const hyperframes = (deps.hyperframesLint ?? runHyperframesLint)(ws.projectDir).map((v) =>
      v.severity === 'error' ? { ...v, rule: 'breakage:hyperframes_lint', severity: 'warning' as const, detail: `${v.rule}: ${v.detail}` } : v,
    );
    const bounds = (deps.boundsCheck ?? runBoundsCheck)(ws.projectDir).map((v) => ({ ...v, rule: 'breakage:bounds', severity: 'warning' as const }));
    const breakage = (deps.tryCheck ?? runTryCheck)(ws.projectDir).map((v) => asReelWarning(v, 'breakage'));
    await addLintViolations(db, job.id, groupWarnings([...onScreen.map((v) => (v.severity === 'error' ? asReelWarning(v, 'lint') : v)), ...hyperframes, ...bounds, ...breakage]));
    await keepText('lint_report', JSON.stringify({ phase: 'final', storyboard: final, hyperframes, bounds, breakage }, null, 2));
    // The blind picture check (EX3-84; required since Explainers 4.1, over each frame's shot stills).
    const pictureCheck = readJson(path.join(ws.projectDir, PICTURE_CHECK_FILE));
    await keepText('lint_report', JSON.stringify({ phase: 'picture_check', verdicts: pictureCheck ?? null }, null, 2));
    const pictureFindings = pictureCheckViolations(pictureCheck, { required: isExplainers41(ws.projectDir) });
    if (pictureFindings.length) {
      if (pictureFindings.some((v) => v.rule === 'picture:missing')) log('picture_check_missing', { jobId: job.id });
      await addLintViolations(db, job.id, groupWarnings(pictureFindings));
    }

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

    // The asset bank grows (EX3-114): the reel's new drawings the picture check named exactly. Never blocks.
    try {
      const harvest = (deps.harvest ?? harvestNewProps)({ projectDir: ws.projectDir, jobId: job.id, topic: topic.title });
      if (harvest.added.length || harvest.skipped.length) log('bank_harvest', { jobId: job.id, ...harvest });
    } catch (error) {
      log('bank_harvest_failed', { jobId: job.id, error: error instanceof Error ? error.message : String(error) });
    }

    await stage('caption');
    const facts: CaptionFacts = {
      title: topic.title,
      scope: topic.scope,
      analogy: analogy.name,
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
    if (draft) {
      await recordCaptionCost(db, job.id, job.mode, draft);
      await keepText('post_caption', draft.text);
      await deps.closings?.record(job.id, draft.builderRead, captionOpts.includeBuildLine);
    } else {
      // Fail open (Explainers 4.2): the reel is made; it waits for a caption before it can post.
      const detail = captionError instanceof Error ? captionError.message : String(captionError);
      log('caption_missing', { jobId: job.id, error: detail });
      await addLintViolations(db, job.id, [
        { source: 'storyboard', rule: 'caption:missing', frame: null, severity: 'warning', detail: `The post caption could not be written (${detail}), so this reel cannot post until it has one.` },
      ]);
    }

    await finishJob(db, job.id, { status: 'ok' });
    const warnings = warningsSummary(await listLintViolations(db, job.id));
    log('job_ok', { jobId: job.id, warnings: warnings.count, first: warnings.first });
    return { status: 'ok', warnings };
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
