import fs from 'node:fs';
import path from 'node:path';

import { runAgentSession, type AgentQuery, type SessionResult } from '@/lib/explainers/render/agent';
import { missingFrameNumbers, renderProjectVideo, repairProjectAssembly, runBoundsCheck, runHyperframesLint } from '@/lib/explainers/render/job';
import { SpendMeter } from '@/lib/explainers/render/meter';
import { checkUnderstanding, FINDINGS_FILE, type ComprehensionCheck } from '@/lib/explainers/render/understanding';
import { recordMusicChoice, type Workspace } from '@/lib/explainers/render/workspace';
import type { ExplainersJevRunner } from '@/lib/explainers/jev/runner';
import { loadSettings as loadExplainerSettings } from '@/lib/explainers/settings';
import type { ArtifactStore } from '@/lib/explainers/storage';
import type { LintViolation } from '@/lib/explainers/types';
import { RecordingRealCaseJevRunner } from '@/lib/real-case/jev/runner';
import {
  addRealCaseArtifact,
  addRealCaseJobFlag,
  finishRealCaseJob,
  recentRealCaseOpeners,
  setRealCaseJobOpener,
  setRealCaseJobStage,
  type RealCaseArtifactKind,
  type RealCaseJob,
} from '@/lib/real-case/jobs';
import { verifiedFacts } from '@/lib/real-case/render/brief';
import {
  cutSentences,
  FACT_FINDINGS_FILE,
  lintFindings,
  MAX_FACT_ROUNDS,
  modelFindings,
  parseFacts,
  planFrames,
  type FactChecker,
  type FactFinding,
} from '@/lib/real-case/render/fact-check';
import { prepareRealCaseWorkspace, type PrepareRealCase } from '@/lib/real-case/render/workspace';
import { getStory, recordRealCaseCost } from '@/lib/real-case/repository';
import { loadRealCaseSettings } from '@/lib/real-case/settings';
import type { StoryRow } from '@/lib/real-case/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { lintRealCase } from '../../../explainers/real-case/lint/lint-real-case.mjs';
import { HISTORY as OPENER_HISTORY, OBJECT_HERO_OPENERS, openerByKey, pickOpener } from '../../../explainers/world-kit/openers/bank.js';

/**
 * One Real Case render (M5): workspace (the Explainer one + the Real Case overlay) → session A (plan)
 * → the understanding test (one fix session for serious misunderstandings) → the fact-check gate
 * (rewrite rounds, then the cut) → the opener → the checkpoint lint → session B (build and render) →
 * collect. Every artifact a stage produced is kept, even when a later stage fails. Retry is Lucas's
 * click. Everything is written to this route's own tables (RC-01).
 */

const SKILL = 'Use the helios-real-case-director skill to run this reel.';
export const RC_PLAN_PROMPT = `${SKILL} PHASE: plan. Do only the plan phase, then stop.`;
export const RC_FIX_PROMPT = `${SKILL} PHASE: fix. .hyperframes/understanding-findings.json lists what a first-time viewer misunderstood. Fix it, then stop.`;
export const RC_BUILD_PROMPT = `${SKILL} PHASE: build. STORYBOARD.md and SCRIPT.md are final; do only the build phase, then stop.`;
export function rcFactsPrompt(lastRound: boolean): string {
  return `${SKILL} PHASE: facts. ${FACT_FINDINGS_FILE} lists the sentences the fact check failed. Rewrite them, then stop.${lastRound ? ' This is the last round: say only what a fact says, or cut the detail.' : ''}`;
}
export function rcRepairPrompt(missing: readonly number[]): string {
  return `${SKILL} PHASE: build. Frames ${missing.join(', ')} are missing from compositions/frames/. Write each missing frame, then finish the build: assemble, check, and render renders/video.mp4. A tool result that says to stop and wait is a denied call, not a person. Retry it. Do not ask.`;
}

export type RealCaseRenderDeps = {
  db: import('@/lib/explainers/db').Queryable;
  query: AgentQuery;
  store: ArtifactStore;
  jobsRoot: string;
  secrets: { anthropicApiKey: string; heygenApiKey: string };
  factChecker: FactChecker;
  /** The understanding test's judge. Without it, the test is recorded and the build goes on. */
  jevTransport?: JevTransport;
  /** HeyGen's voice; default: the Explainer Reels setting (read only). */
  voiceId?: string | null;
  prepare?: PrepareRealCase;
  hyperframesLint?: (projectDir: string) => LintViolation[];
  boundsCheck?: (projectDir: string) => LintViolation[];
  renderVideo?: (projectDir: string) => void;
  repairAssembly?: (projectDir: string) => string[];
  random?: () => number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

export type RealCaseRenderOutcome = { status: 'ok' } | { status: 'failed'; error: string; capped: boolean };

class RenderFailure extends Error {
  constructor(message: string, readonly capped = false) {
    super(message);
  }
}

const read = (file: string): string | null => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null);
const fileReady = (file: string) => fs.existsSync(file) && fs.statSync(file).size > 0;
function readJson(file: string): unknown {
  try {
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
  } catch {
    return null;
  }
}

/** Frame 1's opener: an object-led reel draws from the openers that never touch a critter hero. */
export async function assignRealCaseOpener(db: RealCaseRenderDeps['db'], jobId: string, projectDir: string, random: () => number = Math.random): Promise<string> {
  const key = pickOpener(await recentRealCaseOpeners(db, jobId, OPENER_HISTORY), { rand: random, pool: OBJECT_HERO_OPENERS }) as string;
  await setRealCaseJobOpener(db, jobId, key);
  const file = path.join(projectDir, 'assets', 'opener.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ key, name: openerByKey(key)?.name ?? key, hero: 'object' }, null, 1)}\n`);
  return key;
}

export async function runRealCaseJob(deps: RealCaseRenderDeps, job: RealCaseJob): Promise<RealCaseRenderOutcome> {
  const { db, store } = deps;
  const log = deps.log ?? (() => undefined);
  const settings = await loadRealCaseSettings(db);
  const prefix = `real-case/jobs/${job.id}`;
  let ws: Workspace | null = null;
  const transcriptLines: string[] = [];

  const keep = async (kind: RealCaseArtifactKind, file: string, name: string) => {
    if (!fs.existsSync(file)) return false;
    const { storagePath, bytes, location } = await store.put(`${prefix}/${name}`, file);
    await addRealCaseArtifact(db, { jobId: job.id, kind, storagePath, bytes, storageLocation: location ?? 'local' });
    return true;
  };
  const keepText = async (kind: RealCaseArtifactKind, content: string | null) => {
    if (content) await addRealCaseArtifact(db, { jobId: job.id, kind, content });
  };
  const stage = async (name: string, sessions?: { sessionAId?: string; sessionBId?: string }) => {
    log('stage', { jobId: job.id, stage: name });
    await setRealCaseJobStage(db, job.id, name, sessions);
  };
  const recordSession = async (phase: string, session: SessionResult) => {
    const models = Object.entries(session.modelUsage);
    if (models.length === 0) {
      if (session.totalCostUsd > 0) await recordRealCaseCost(db, { jobId: job.id, storyId: job.story_id, mode: job.mode, vendor: 'anthropic', component: `${phase}:estimate`, usd: session.totalCostUsd });
      return;
    }
    for (const [model, usage] of models) {
      await recordRealCaseCost(db, {
        jobId: job.id,
        storyId: job.story_id,
        mode: job.mode,
        vendor: 'anthropic',
        component: `${phase}:${model}`,
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        cacheReadTokens: usage.cacheReadInputTokens ?? 0,
        cacheWriteTokens: usage.cacheCreationInputTokens ?? 0,
        usd: Number(usage.costUSD ?? 0),
      });
    }
  };

  try {
    const voiceId = deps.voiceId !== undefined ? deps.voiceId : (await loadExplainerSettings(db as never)).voice_id;
    if (!voiceId) throw new RenderFailure('No HeyGen voice id is set (Explainers Settings → HeyGen voice ID).');
    const story = (await getStory(db, job.story_id)) as StoryRow | null;
    if (!story) throw new RenderFailure('The story is gone.');
    const facts = new Map(verifiedFacts(story).map((f) => [f.id, f.text]));
    if (facts.size === 0) throw new RenderFailure('The story has no checked facts to tell.');

    await stage('workspace');
    ws = (deps.prepare ?? prepareRealCaseWorkspace)({ jobsRoot: deps.jobsRoot, jobId: job.id, story });
    const projectDir = ws.projectDir;
    const brief = read(path.join(projectDir, 'BRIEF.md')) ?? '';
    await keepText('brief', brief);

    const meter = new SpendMeter(job.spend_cap_usd, job.spend_usd);
    const session = (prompt: string) =>
      runAgentSession({
        query: deps.query,
        prompt,
        projectDir,
        homeDir: ws!.homeDir,
        tmpDir: ws!.tmpDir,
        model: job.orchestrator_model,
        frameWorkerModel: job.frame_worker_model,
        meter,
        secrets: { ...deps.secrets, voiceId },
        log: (entry) => transcriptLines.push(JSON.stringify(entry)),
      });
    const runPhase = async (name: string, prompt: string) => {
      await stage(name);
      const result = await session(prompt);
      await recordSession(name, result);
      if (result.capped) throw new RenderFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached in ${name}.`, true);
      return result;
    };
    const plan = () => ({ storyboard: read(path.join(projectDir, 'STORYBOARD.md')) ?? '', script: read(path.join(projectDir, 'SCRIPT.md')) ?? '' });

    // Session A: the plan.
    const a = await runPhase('session_a', RC_PLAN_PROMPT);
    await setRealCaseJobStage(db, job.id, 'session_a_done', { sessionAId: a.sessionId ?? undefined });
    let { storyboard, script } = plan();
    await keepText('storyboard', storyboard);
    await keepText('script', script);
    if (a.isError || !storyboard || !script) throw new RenderFailure(`Session A ended without a plan (${a.subtype}${a.errors.length ? `: ${a.errors.join('; ')}` : ''}).`);

    // The understanding test: a stranger's answers, judged by Jev; serious misunderstandings get one fix.
    ({ storyboard, script } = await understandingTest());

    // The fact-check gate (RC-06): rewrite rounds, then the cut. Truth before audio.
    ({ storyboard, script } = await factGate());

    // Frame 1's opener (an object-led reel).
    const opener = await assignRealCaseOpener(db, job.id, projectDir, deps.random);
    log('opener', { jobId: job.id, opener });

    // Checkpoint: the Real Case lint on the final plan, recorded.
    await stage('checkpoint');
    await keepText('lint_report', JSON.stringify({ phase: 'checkpoint', ...lintRealCase({ storyboard, script, brief }) }, null, 2));

    // Session B: build and render.
    let b = await runPhase('session_b', RC_BUILD_PROMPT);
    await setRealCaseJobStage(db, job.id, 'session_b_done', { sessionBId: b.sessionId ?? undefined });
    const videoPath = path.join(projectDir, 'renders', 'video.mp4');
    const missing = missingFrameNumbers(projectDir);
    if (!fileReady(videoPath) && missing.length > 0 && b.subtype === 'success' && !b.isError) {
      log('repair_frames', { jobId: job.id, missing });
      b = await runPhase('repair', rcRepairPrompt(missing));
    }

    // Collect.
    await stage('collect');
    const audioMeta = read(path.join(projectDir, 'audio_meta.json'));
    await keepText('audio_meta', audioMeta);
    if (audioMeta) await recordRealCaseCost(db, { jobId: job.id, storyId: job.story_id, mode: job.mode, vendor: 'heygen', component: 'tts+bgm+sfx', usd: null });
    await keep('captions', path.join(projectDir, 'caption_groups.json'), 'caption_groups.json');
    await keep('contact_sheet', path.join(projectDir, 'snapshots', 'contact-sheet.jpg'), 'contact-sheet.jpg');
    if (!fileReady(videoPath)) {
      const repaired = (deps.repairAssembly ?? repairProjectAssembly)(projectDir);
      if (repaired.length) log('assembly_repaired', { jobId: job.id, steps: repaired });
    }
    const hyperframes = (deps.hyperframesLint ?? runHyperframesLint)(projectDir);
    const bounds = (deps.boundsCheck ?? runBoundsCheck)(projectDir);
    await keepText('lint_report', JSON.stringify({ phase: 'final', hyperframes, bounds, picture_check: readJson(path.join(projectDir, '.hyperframes', 'picture-check.json')) }, null, 2));

    const assembled = fileReady(path.join(projectDir, 'index.html')) && missingFrameNumbers(projectDir).length === 0;
    if (assembled && !fileReady(videoPath)) {
      await stage('render');
      try {
        (deps.renderVideo ?? renderProjectVideo)(projectDir);
      } catch (error) {
        throw new RenderFailure(`Session B ended without a video (${b.subtype}). ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (!(await keep('video', videoPath, 'video.mp4'))) {
      const stillMissing = missingFrameNumbers(projectDir);
      throw new RenderFailure(`Session B ended without a video (${b.subtype}${b.errors.length ? `: ${b.errors.join('; ')}` : ''}).${stillMissing.length ? ` Missing frames ${stillMissing.join(', ')}.` : ''}`);
    }
    const track = recordMusicChoice(deps.jobsRoot, projectDir);
    if (track) log('music', { jobId: job.id, track });

    await finishRealCaseJob(db, job.id, { status: 'ok' });
    log('job_ok', { jobId: job.id });
    return { status: 'ok' };

    // ── The two gates, sharing this render's state ──────────────────────────

    async function understandingTest(): Promise<{ storyboard: string; script: string }> {
      const file = path.join(projectDir, '.hyperframes', 'comprehension-check.json');
      const first = readJson(file) as ComprehensionCheck | null;
      if (!first) {
        log('comprehension_check_missing', { jobId: job.id });
        return { storyboard, script };
      }
      if (!deps.jevTransport) {
        await keepText('lint_report', JSON.stringify({ phase: 'understanding', attempt: 'first', verdict: null, comprehension: first }, null, 2));
        return { storyboard, script };
      }
      const runner = new RecordingRealCaseJevRunner(deps.jevTransport, db, { mode: job.mode, jobId: job.id });
      // The Explainer test's questions, on this route's ledger: the topic id it logs is the story's.
      const jev = {
        ask: (r: { component: string; state: unknown; set: unknown; questions: unknown }) =>
          runner.ask({ component: r.component, state: r.state as never, set: r.set as never, questions: r.questions as never, storyId: story!.id }),
        get callCount() {
          return runner.callCount;
        },
        usd: 0,
      } as unknown as ExplainersJevRunner;
      const judge = (c: ComprehensionCheck | null, board: string, words: string) =>
        checkUnderstanding({ jev, topicId: story!.id, term: story!.term, comprehension: c, storyboard: board, script: words });
      const verdict = await judge(first, storyboard, script);
      await keepText('lint_report', JSON.stringify({ phase: 'understanding', attempt: 'first', verdict, comprehension: first }, null, 2));
      if (!verdict || verdict.blocking.length === 0) return { storyboard, script };

      fs.writeFileSync(path.join(projectDir, FINDINGS_FILE), `${JSON.stringify({ blocking: verdict.blocking, minor: verdict.minor }, null, 2)}\n`);
      fs.rmSync(file, { force: true });
      await runPhase('session_fix', RC_FIX_PROMPT);
      const fixed = plan();
      if (fixed.storyboard !== storyboard) await keepText('storyboard', fixed.storyboard);
      if (fixed.script !== script) await keepText('script', fixed.script);
      const again = readJson(file) as ComprehensionCheck | null;
      const second = again ? await judge(again, fixed.storyboard, fixed.script) : null;
      await keepText('lint_report', JSON.stringify({ phase: 'understanding', attempt: 'after_fix', verdict: second, comprehension: again }, null, 2));
      for (const f of second ? second.blocking : verdict.blocking) await addRealCaseJobFlag(db, job.id, 'understanding', `${f.kind}: ${f.detail}`);
      return { storyboard: fixed.storyboard || storyboard, script: fixed.script || script };
    }

    async function factGate(): Promise<{ storyboard: string; script: string }> {
      const facts = parseFacts(brief) as Map<string, string>;
      let board = storyboard;
      let words = script;
      const check = async (round: number): Promise<FactFinding[]> => {
        await stage(`fact_check_${round}`);
        const response = await deps.factChecker.check({ model: settings.fact_check_model, term: story!.term, facts, frames: planFrames(board, words) });
        await recordRealCaseCost(db, {
          jobId: job.id,
          storyId: job.story_id,
          mode: job.mode,
          vendor: 'anthropic',
          component: `fact_check:${response.model}`,
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
          cacheWriteTokens: response.usage.cache_creation_input_tokens ?? 0,
          usd: response.usd,
        });
        const findings = [...lintFindings(board, words, brief), ...modelFindings(response.sentences)];
        await keepText('fact_check', JSON.stringify({ round, findings, sentences: response.sentences }, null, 2));
        return findings;
      };

      let findings = await check(0);
      for (let round = 1; findings.length > 0 && round <= MAX_FACT_ROUNDS; round += 1) {
        log('fact_check_failed', { jobId: job.id, round, findings: findings.length });
        fs.writeFileSync(path.join(projectDir, FACT_FINDINGS_FILE), `${JSON.stringify({ last_round: round === MAX_FACT_ROUNDS, findings }, null, 2)}\n`);
        await runPhase(`session_facts_${round}`, rcFactsPrompt(round === MAX_FACT_ROUNDS));
        ({ storyboard: board, script: words } = plan());
        await keepText('storyboard', board);
        await keepText('script', words);
        findings = await check(round);
      }
      if (findings.length === 0) return { storyboard: board, script: words };

      // The last resort: cut what is still untrue, so the reel is made and says nothing false.
      const cuts = findings.filter((f): f is FactFinding & { sentence: string } => Boolean(f.sentence));
      let cut;
      try {
        cut = cutSentences(board, words, cuts, facts);
      } catch (error) {
        throw new RenderFailure(error instanceof Error ? error.message : String(error));
      }
      fs.writeFileSync(path.join(projectDir, 'STORYBOARD.md'), cut.storyboard);
      fs.writeFileSync(path.join(projectDir, 'SCRIPT.md'), cut.script);
      await keepText('storyboard', cut.storyboard);
      await keepText('script', cut.script);
      for (const c of cut.cut) await addRealCaseJobFlag(db, job.id, 'fact_cut', `frame ${c.frame}: "${c.sentence}"`);
      const left = lintFindings(cut.storyboard, cut.script, brief);
      await keepText('fact_check', JSON.stringify({ round: 'cut', cut: cut.cut, lint_after_cut: left }, null, 2));
      for (const f of left) await addRealCaseJobFlag(db, job.id, 'fact_unresolved', `frame ${f.frame}: ${f.why}`);
      log('fact_cut', { jobId: job.id, cut: cut.cut.length });
      return { storyboard: cut.storyboard, script: cut.script };
    }
  } catch (error) {
    const capped = error instanceof RenderFailure && error.capped;
    const message = error instanceof Error ? error.message : String(error);
    await finishRealCaseJob(db, job.id, { status: 'failed', error: message, capped });
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
