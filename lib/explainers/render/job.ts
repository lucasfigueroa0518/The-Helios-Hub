import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type { ExplainersDb } from '@/lib/explainers/db';
import { runAgentSession, type AgentQuery, type SessionResult } from '@/lib/explainers/render/agent';
import { SpendMeter } from '@/lib/explainers/render/meter';
import { resolveSource, type FetchLike } from '@/lib/explainers/render/source';
import { HYPERFRAMES_BIN, HYPERFRAMES_ENV, prepareWorkspace, type Workspace } from '@/lib/explainers/render/workspace';
import {
  addArtifact,
  addLintViolations,
  finishJob,
  getTopic,
  recordCost,
  setJobStage,
} from '@/lib/explainers/repository';
import { loadSettings } from '@/lib/explainers/settings';
import type { ArtifactStore } from '@/lib/explainers/storage';
import type { ArtifactKind, JobRow, LintViolation, Mode, TopicRow } from '@/lib/explainers/types';
import { CaptionError, writeExplainerCaption, type CaptionDraft, type CaptionFacts } from '@/lib/explainers/caption';
import { lintStoryboard } from '../../../explainers/lint/lint-storyboard.mjs';

export const PLAN_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: plan. Do only the plan phase, then stop.';
export const BUILD_PROMPT =
  'Use the helios-explainer-director skill to run this reel. PHASE: build. STORYBOARD.md and SCRIPT.md are final; do only the build phase, then stop.';

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
  /**
   * Swappable for tests. When session B stops without `renders/video.mp4` but
   * `index.html` is assembled, the worker renders it. No extra model call.
   */
  renderVideo?: (projectDir: string) => void;
  /** Swappable for tests. The real one calls Sonnet. A finished video always gets one. */
  writeCaption?: (facts: CaptionFacts) => Promise<CaptionDraft>;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

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

function read(file: string): string | null {
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
}

function fileReady(file: string): boolean {
  return fs.existsSync(file) && fs.statSync(file).size > 0;
}

const BEAT_NUMBERS = [1, 2, 3, 4, 5, 6, 7];

/** Frame numbers 1–7 that have no composition file yet. */
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

/** Init writes a placeholder index.html. A reel is assembled only once all seven frames exist. */
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

function framesByNumber(projectDir: string): Map<number, string> {
  const dir = path.join(projectDir, 'compositions', 'frames');
  const map = new Map<number, string>();
  if (!fs.existsSync(dir)) return map;
  for (const file of fs.readdirSync(dir).sort()) {
    const n = /^(\d+)/.exec(file)?.[1];
    if (n && file.endsWith('.html')) map.set(Number(n), fs.readFileSync(path.join(dir, file), 'utf8'));
  }
  return map;
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
 * One render: source → workspace → session A (plan) → checkpoint (lint, no
 * LLM) → session B (build + render) → collect outputs. Every artifact a stage
 * produced is kept, even when a later stage fails. Retry is Lucas's click.
 */
export async function runRenderJob(deps: RenderDeps, job: JobRow): Promise<RenderOutcome> {
  const { db, store } = deps;
  const log = deps.log ?? (() => undefined);
  const settings = await loadSettings(db);
  const topic = (await getTopic(db, job.topic_id)) as TopicRow;
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

    await stage('workspace');
    ws = (deps.prepare ?? prepareWorkspace)({ jobsRoot: deps.jobsRoot, jobId: job.id, topic, sourceText });
    await keepText('brief', read(path.join(ws.projectDir, 'BRIEF.md')));

    const meter = new SpendMeter(job.spend_cap_usd, job.spend_usd);
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

    // Session A: plan.
    await stage('session_a');
    const a = await session(PLAN_PROMPT);
    await stage('session_a_done', { sessionAId: a.sessionId ?? undefined });
    await recordSessionCost(db, job, job.mode, 'session_a', a);
    if (a.capped) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached in session A.`, true);
    const storyboard = read(path.join(ws.projectDir, 'STORYBOARD.md'));
    const script = read(path.join(ws.projectDir, 'SCRIPT.md'));
    await keepText('storyboard', storyboard);
    await keepText('script', script);
    if (a.isError || !storyboard || !script) {
      throw new RenderFailure(`Session A ended without a plan (${a.subtype}${a.errors.length ? `: ${a.errors.join('; ')}` : ''}).`);
    }

    // Checkpoint: deterministic lint, recorded, never blocking in version one (E-07).
    // The reviewer layers from E-11 plug in here after run one.
    await stage('checkpoint');
    const checkpoint = lintStoryboard({ storyboard, script });
    await addLintViolations(db, job.id, checkpoint.violations as LintViolation[]);
    await keepText('lint_report', JSON.stringify({ phase: 'checkpoint', ...checkpoint }, null, 2));

    // Session B: build and render.
    await stage('session_b');
    let b = await session(BUILD_PROMPT);
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
    const final = lintStoryboard({
      storyboard: read(path.join(ws.projectDir, 'STORYBOARD.md')) ?? storyboard,
      script: read(path.join(ws.projectDir, 'SCRIPT.md')) ?? script,
      frameHtml: framesByNumber(ws.projectDir),
    });
    const onScreen = (final.violations as LintViolation[]).filter(
      (v) => v.rule === 'narration_on_screen' || /on-screen text/.test(v.detail),
    );
    const hyperframes = (deps.hyperframesLint ?? runHyperframesLint)(ws.projectDir);
    await addLintViolations(db, job.id, [...onScreen, ...hyperframes]);
    await keepText('lint_report', JSON.stringify({ phase: 'final', storyboard: final, hyperframes }, null, 2));

    const video = videoPath;
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

    await stage('caption');
    const facts: CaptionFacts = {
      title: topic.title,
      scope: topic.scope,
      storyboard: read(path.join(ws.projectDir, 'STORYBOARD.md')) ?? storyboard,
      script: read(path.join(ws.projectDir, 'SCRIPT.md')) ?? script,
      source: topic.source_text,
    };
    const writer = deps.writeCaption ?? ((input) => writeExplainerCaption(input, job.orchestrator_model));
    let draft: CaptionDraft | null = null;
    let captionError: unknown = null;
    for (let attempt = 0; attempt < 2 && !draft; attempt += 1) {
      try {
        draft = await writer(facts);
      } catch (error) {
        captionError = error;
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
