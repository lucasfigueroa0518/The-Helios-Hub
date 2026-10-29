import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';
import type { SessionResult } from '@/lib/explainers/render/agent';
import { SpendMeter } from '@/lib/explainers/render/meter';
import type { ArtifactStore } from '@/lib/explainers/storage';
import { recordCost, spendFor } from '@/lib/reel-ai-drama/cost';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { CLOSE } from '@/explainers/reel-ai-drama/kit/close-timing.js';
import {
  assetKey,
  captionsText,
  changedLineIds,
  clearFrameWords,
  closeVoiceSeconds,
  cutLines,
  draftProblems,
  mergeFrames,
  reconcilePlan,
  usedAssets,
} from '@/lib/reel-ai-drama/production/draft';
import {
  addArtifact,
  addFlag,
  finishJob,
  getPitch,
  KILL_REASONS,
  requestJob,
  setStage,
  type ArtifactKind,
  type Job,
  type KillReason,
} from '@/lib/reel-ai-drama/production/jobs';
import { varietyFindings } from '@/lib/reel-ai-drama/checks/variety';
import { planWithoutFailedMakes } from '@/lib/reel-ai-drama/render/make';
import { sameVoices } from '@/lib/reel-ai-drama/render/voice';
import { loadSettings, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type {
  Asset,
  DeliveryReport,
  DirectorPlan,
  FactSheet,
  JobFlag,
  JobStage,
  Mode,
  Pitch,
  PitchRow,
  PostText,
  VisualsInventory,
  WriterDraft,
} from '@/lib/reel-ai-drama/types';
import type { DirectorFix } from '@/lib/reel-ai-drama/writing/director';
import { isLogo, planWarnings } from '@/lib/reel-ai-drama/writing/validate';

/**
 * One Reel AI Drama production run (PROCESS.md P1–P9, CONTRACT.md § B5):
 *   pick → reporting ‖ harvest → (kill → next pitch) → writer → director → (lines back: one revise)
 *   → lock → facts check (one fix, then cut) → workspace + project files → voice → integrity (one fix
 *   via the director, then warn) → frame-building session → assemble (breakage: one repair, then warn)
 *   → render → contact sheet → first viewer (one fix, then warn) → post text → reuse record → deliver.
 * Every builder's module is reached through ProductionDeps, so the whole run can be stubbed; the live
 * modules are wired in production/live.ts only.
 *
 * Spend: one SpendMeter on the job's cap (MD-07). Builders record their own calls with recordCost under
 * this job id; after every step the ledger's new spend is settled into the meter, and the agent
 * sessions are metered live. Passing the cap fails the job as capped.
 */

/** What every builder call is told about the run. */
export type StepCtx = { jobId: string; pitchId: string; mode: Mode; settings: ReelAiDramaSettings };

export type Workspace = { jobDir: string; projectDir: string; homeDir: string; tmpDir: string };

export type AgentSessionInput = {
  prompt: string;
  projectDir: string;
  homeDir: string;
  tmpDir: string;
  model: string;
  frameWorkerModel: string;
  meter: SpendMeter;
  secrets: { anthropicApiKey: string; heygenApiKey: string; voiceId: string };
  log: (entry: Record<string, unknown>) => void;
};

export type PromptName = 'build-workflow' | 'frame-worker' | 'fix';

export type ProductionDeps = {
  db: Queryable;
  store: ArtifactStore;
  jobsRoot: string;
  secrets: { anthropicApiKey: string; heygenApiKey: string };
  /** HeyGen voice; default: the Explainer setting voice_id (read only). */
  voiceId?: string | null;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  prompts: (name: PromptName) => string;
  /** The Jev runner for this job (RecordingDramaJevRunner live: logged and priced under the job). */
  jev: (ctx: StepCtx) => DramaJevRunner;
  pool: { nextForProduction(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<PitchRow | null> };
  reporting: { reportStory(pitch: Pitch, ctx: StepCtx): Promise<FactSheet> };
  harvest: {
    harvestVisuals(input: { pitch: Pitch; facts: FactSheet | null; jobDir: string; jobId: string; mode: Mode; settings: ReelAiDramaSettings }): Promise<VisualsInventory>;
    recordUses(db: Queryable, jobId: string, uses: { assetKey: string; purpose: string; characterImage: boolean }[]): Promise<void>;
  };
  writing: {
    writeScript(input: { pitch: Pitch; facts: FactSheet; inventory: VisualsInventory; settings: ReelAiDramaSettings }, ctx: StepCtx): Promise<WriterDraft>;
    /** The inventory goes with every revision so the writer can rewrite to the material and `must_show` is checked. */
    reviseScript(input: { draft: WriterDraft; linesBack: DirectorPlan['lines_back']; facts: FactSheet; inventory: VisualsInventory }, ctx: StepCtx): Promise<WriterDraft>;
    /** `fix` re-asks for named frames: the integrity check's findings (C2's one fix) or lines the facts fix rewrote. */
    directReel(
      input: { draft: WriterDraft; inventory: VisualsInventory; facts: FactSheet; kitGuide: string; fix?: DirectorFix },
      ctx: StepCtx,
    ): Promise<DirectorPlan>;
    writePost(input: { draft: WriterDraft; facts: FactSheet; inventory: VisualsInventory; usedAssetIds: string[] }, ctx: StepCtx): Promise<PostText>;
  };
  checks: {
    checkFacts(jev: DramaJevRunner, input: { draft: WriterDraft; facts: FactSheet }): Promise<{ unsupported: { line_id: string; why: string }[] }>;
    checkIntegrity(input: { plan: DirectorPlan; inventory: VisualsInventory; draft: WriterDraft }, ctx: StepCtx): Promise<{ problems: IntegrityProblem[] }>;
    checkFirstViewer(input: { contactSheet: string; captions: string; draft: WriterDraft; facts: FactSheet }, ctx: StepCtx): Promise<FirstViewerResult>;
  };
  render: {
    kitGuide: string;
    prepareWorkspace(input: { jobsRoot: string; jobId: string }): Promise<Workspace>;
    writeProjectFiles(projectDir: string, input: { draft: WriterDraft; plan: DirectorPlan; inventory: VisualsInventory }): unknown;
    runVoice(projectDir: string, input: { voiceId: string; heygenApiKey: string; pronounce?: { word: string; say: string }[] }): Promise<void>;
    /** MD-59: make the plan's requested assets into `jobDir`/media (drawn, traced or code-built); fails open per make. */
    makeAssets?(input: { plan: DirectorPlan; inventory: VisualsInventory; jobDir: string; draft: WriterDraft }, ctx: StepCtx): Promise<{ assets: Asset[]; usd: number; problems: string[] }>;
    /** MD-61: the sound designer, once the voice timing is final; writes sound_cues.json, fails open. */
    designSound?(input: { projectDir: string; draft: WriterDraft; plan: DirectorPlan }, ctx: StepCtx): Promise<{ usd: number; problems: string[] }>;
    assembleProject(projectDir: string): Promise<{ ok: boolean; problems: string[] }>;
    renderVideo(projectDir: string): Promise<string>;
    contactSheet(projectDir: string, videoPath: string): Promise<string>;
    videoSeconds?(videoPath: string): Promise<number | null>;
  };
  agent: { runSession(input: AgentSessionInput): Promise<SessionResult> };
};

export type IntegrityProblem = { frame: number; asset_id: string; why: string };
/** `problems` get the one fix (hook time, muted read, the story understood); `warnings` ship as flags only. */
export type FirstViewerResult = { hookSeconds: number | null; understood: boolean; problems: string[]; warnings?: string[] };

export type RunOutcome =
  | { status: 'ok' }
  | { status: 'failed'; error: string; capped: boolean }
  | { status: 'killed'; killReason: KillReason; nextJobId: string | null };

/** Where the fix sessions read what to fix (the `fix` prompt is told this path). */
export const FIX_FINDINGS_FILE = '.hyperframes/fix-findings.json';
/** Rebuild sessions for measured breakage before the reel ships with warnings (MD-58: "rebuilt up to twice"). */
export const BREAKAGE_REBUILDS = 2;

class ProductionFailure extends Error {
  constructor(message: string, readonly capped = false) {
    super(message);
  }
}

class Killed extends Error {
  constructor(readonly reason: KillReason, readonly detail: string) {
    super(detail);
  }
}

/** First viewer verdict: the hook lands in time and the story is understood (MD-34, MD-39). */
export function firstViewerFindings(r: FirstViewerResult, hookSeconds: number): string[] {
  const out = [...r.problems];
  if (r.hookSeconds === null) out.push('The first viewer found no hook.');
  else if (r.hookSeconds > hookSeconds) out.push(`The hook lands at ${r.hookSeconds}s, after ${hookSeconds}s.`);
  if (!r.understood) out.push('The first viewer did not understand the story.');
  return out;
}

/** The harvest's kill, mapped onto the contract's reasons (MD-33). */
export function harvestKill(inventory: VisualsInventory, minVisuals: number): KillReason | null {
  if (inventory.kill) {
    const r = inventory.kill.reason as KillReason;
    if (KILL_REASONS.includes(r)) return r;
    return /key/i.test(inventory.kill.reason) ? 'no_key_moment_image' : 'too_few_visuals';
  }
  return inventory.usable_count < minVisuals ? 'too_few_visuals' : null;
}

export async function runJob(deps: ProductionDeps, job: Job): Promise<RunOutcome> {
  const { db, store } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => undefined);
  const settings = await loadSettings(db);
  const transcript: string[] = [];
  const prefix = `reel-ai-drama/jobs/${job.id}`;
  const models = { ...{ orchestrator: settings.orchestrator_model, frame_worker: settings.frame_worker_model }, ...job.models };

  const meter = new SpendMeter(job.spend_cap_usd, job.spend_usd);
  let accounted = job.spend_usd;

  const stage = async (name: JobStage) => {
    log('stage', { jobId: job.id, stage: name });
    await setStage(db, job.id, name);
  };
  const keepText = async (kind: ArtifactKind, content: unknown) => {
    if (content === null || content === undefined) return;
    await addArtifact(db, { jobId: job.id, kind, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) });
  };
  const keepFile = async (kind: ArtifactKind, file: string, name: string): Promise<string | null> => {
    if (!file || !fs.existsSync(file)) return null;
    const { storagePath, bytes } = await store.put(`${prefix}/${name}`, file);
    await addArtifact(db, { jobId: job.id, kind, storagePath, bytes });
    return storagePath;
  };
  const flag = async (check: JobFlag['check'], detail: string) => {
    log('flag', { jobId: job.id, check, detail });
    await addFlag(db, job.id, { check, detail, at: now().toISOString() });
  };
  /** Settle what the ledger gained since the last step into the meter; stop at the cap. */
  const settle = async (step: string) => {
    const spent = await spendFor(db, { jobId: job.id });
    if (spent > accounted) {
      meter.charge(spent - accounted);
      accounted = spent;
    }
    if (meter.overCap) throw new ProductionFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached after ${step} ($${meter.totalUsd.toFixed(2)}).`, true);
  };

  let ws: Workspace | null = null;
  try {
    // P1: the pick (the job names its pitch).
    await stage('pick');
    const row = await getPitch(db, job.pitch_id);
    if (!row) throw new ProductionFailure('The pitch is gone.');
    const pitch = row.pitch;
    const ctx: StepCtx = { jobId: job.id, pitchId: row.id, mode: job.mode, settings };

    // P2 ‖ P3: reporting and the harvest run side by side; either can kill (MD-31, MD-33).
    const harvestDir = path.join(deps.jobsRoot, '_harvest', job.id);
    fs.mkdirSync(harvestDir, { recursive: true });
    await stage('reporting');
    let harvestDone = false;
    const [reported, harvested] = await Promise.allSettled([
      deps.reporting.reportStory(pitch, ctx).then(async (f) => {
        if (!harvestDone) await stage('harvest');
        return f;
      }),
      deps.harvest
        .harvestVisuals({ pitch, facts: null, jobDir: harvestDir, jobId: job.id, mode: job.mode, settings })
        .finally(() => {
          harvestDone = true;
        }),
    ]);
    if (reported.status === 'rejected') throw new ProductionFailure(`Reporting failed: ${errorText(reported.reason)}`);
    if (harvested.status === 'rejected') throw new ProductionFailure(`The harvest failed: ${errorText(harvested.reason)}`);
    const facts = reported.value;
    let inventory = harvested.value;
    await keepText('fact_sheet', facts);
    await keepText('inventory', inventory);
    await settle('reporting and harvest');
    if (!facts.verdict.holds) throw new Killed('facts_dont_hold', facts.verdict.reason);
    const visualsKill = harvestKill(inventory, settings.min_visuals);
    if (visualsKill) throw new Killed(visualsKill, inventory.kill?.reason ?? `${inventory.usable_count} usable visuals, under ${settings.min_visuals}.`);
    if (!inventory.assets.some((a) => a.flags.includes('key_moment'))) {
      await addFlag(db, job.id, { check: 'harvest', detail: 'No photo of the key moment exists; the director tells it with the visuals that do.', at: now().toISOString() });
    }

    // P4, P5: the writer, then the director; lines back once (MD-38), then the script locks.
    await stage('writer');
    let draft = await deps.writing.writeScript({ pitch, facts, inventory, settings }, ctx);
    await keepText('writer_draft', draft);
    await settle('writer');
    await stage('director');
    let plan = await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide }, ctx);
    await keepText('director_plan', plan);
    await settle('director');
    if (plan.lines_back.length > 0) {
      await stage('writer_revise');
      draft = await deps.writing.reviseScript({ draft, linesBack: plan.lines_back, facts, inventory }, ctx);
      await keepText('writer_draft', draft);
      await settle('writer revise');
      await stage('director');
      plan = await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide }, ctx);
      if (plan.lines_back.length) log('lines_back_ignored', { jobId: job.id, count: plan.lines_back.length });
      plan = { ...plan, lines_back: [] };
      await keepText('director_plan', plan);
      await settle('director');
    }

    // C1: the facts check (loose Jev, MD-39): one fix through the writer, then the line is cut.
    await stage('facts_check');
    const jev = deps.jev(ctx);
    let check = await deps.checks.checkFacts(jev, { draft, facts });
    await keepText('facts_check', { round: 0, unsupported: check.unsupported });
    await settle('facts check');
    /** Lines the facts fix rewrote after the director planned them: their frames are re-planned below. */
    let rewritten: string[] = [];
    if (check.unsupported.length > 0) {
      const beforeFix = draft;
      draft = await deps.writing.reviseScript(
        { draft, linesBack: check.unsupported.map((u) => ({ line_id: u.line_id, why: u.why, suggestion: '' })), facts, inventory },
        ctx,
      );
      rewritten = changedLineIds(beforeFix, draft);
      await keepText('writer_draft', draft);
      check = await deps.checks.checkFacts(jev, { draft, facts });
      await keepText('facts_check', { round: 1, unsupported: check.unsupported });
      await settle('facts fix');
      if (check.unsupported.length > 0) {
        const text = new Map(draft.rungs.flatMap((r) => r.lines.map((l) => [l.id, l.text] as const)));
        const cut = new Set(check.unsupported.map((u) => u.line_id));
        const hookWords = draft.hook.on_screen;
        const hookCut = cut.has(draft.hook.line_id);
        draft = cutLines(draft, [...cut]);
        rewritten = rewritten.filter((id) => !cut.has(id));
        for (const u of check.unsupported) await flag('facts', `Cut line ${u.line_id} ("${text.get(u.line_id) ?? ''}"): ${u.why}`);
        if (hookCut && hookWords?.trim()) {
          // The hook's words promised the cut claim; they go with it (the reel opens on the next line, flagged).
          plan = clearFrameWords(plan, hookWords);
          await flag('facts', `The hook line was cut, so its on-screen words ("${hookWords}") were removed; the reel opens on ${draft.hook.line_id} without hook words.`);
        }
        await keepText('facts_check', { round: 'cut', cut: check.unsupported });
        await keepText('writer_draft', draft);
      }
    }
    const invalid = draftProblems(draft);
    if (invalid.length) throw new ProductionFailure(`The checked script is unusable: ${invalid.join(' ')}`);
    plan = reconcilePlan(draft, plan);
    if (rewritten.length) {
      // The facts fix changed words the picture was timed to: re-plan only those frames (directReel's fix mode).
      const lineText = new Map(draft.rungs.flatMap((r) => r.lines.map((l) => [l.id, l] as const)));
      const affected = plan.frames.filter((f) => f.line_ids.some((id) => rewritten.includes(id)));
      if (affected.length) {
        await stage('director');
        const problems = affected.map((f) => ({
          frame: f.n,
          asset_id: null,
          why: `Rewritten after your plan: ${f.line_ids
            .filter((id) => rewritten.includes(id))
            .map((id) => `${id} now reads "${lineText.get(id)?.text ?? ''}"${lineText.get(id)?.on_screen ? ` (label "${lineText.get(id)?.on_screen}")` : ''}`)
            .join('; ')}. Re-time the motion, marks, sound and on_screen to the new words; keep the frame's job.`,
        }));
        try {
          const fixed = await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide, fix: { kind: 'script_revised', plan, problems } }, ctx);
          plan = reconcilePlan(draft, mergeFrames(plan, fixed, affected.map((f) => f.n)));
          await keepText('director_plan', plan);
        } catch (error) {
          await flag('facts', `Frames ${affected.map((f) => f.n).join(', ')} keep the picture planned for the earlier wording: the re-plan failed (${errorText(error)}).`);
        }
        await settle('director re-plan');
      }
    }

    // MD-59/60: variety (no one shown the same way > 2 in a row; every main character on screen when named;
    // no staging type twice running): one director fix round, then warn.
    const variety = varietyFindings(plan, { draft, inventory });
    if (variety.length) {
      await stage('director');
      const flagged = [...new Set(variety.map((v) => v.frame))];
      try {
        const fixed = await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide, fix: { kind: 'variety', plan, problems: variety } }, ctx);
        plan = reconcilePlan(draft, mergeFrames(plan, fixed, flagged));
        await keepText('director_plan', plan);
      } catch (error) {
        await flag('integrity', `The variety re-plan failed (${errorText(error)}); frames ${flagged.join(', ')} keep their plan.`);
      }
      await settle('variety fix');
      for (const v of varietyFindings(plan, { draft, inventory })) await flag('integrity', `Variety, frame ${v.frame}: ${v.why}`);
    }

    // MD-59: the assets the director asked to be made for exact moments; a failed make falls back (fail open).
    const runMakes = async () => {
      const pending = (plan.makes ?? []).filter((m) => !inventory.assets.some((a) => a.id === m.id));
      if (!pending.length || !deps.render.makeAssets) return;
      await stage('make');
      const made = await deps.render.makeAssets({ plan: { ...plan, makes: pending }, inventory, jobDir: harvestDir, draft }, ctx);
      inventory = { ...inventory, assets: [...inventory.assets, ...made.assets] };
      const fallback = planWithoutFailedMakes(plan, inventory.assets.map((a) => a.id), inventory);
      plan = fallback.plan;
      for (const p of [...made.problems, ...fallback.notes]) await flag('harvest', `Make: ${p}`);
      await keepText('inventory', inventory);
      await settle('makes');
    };
    if (deps.render.makeAssets) await runMakes();

    // Workspace and the project files the kit reads.
    await stage('workspace');
    ws = await deps.render.prepareWorkspace({ jobsRoot: deps.jobsRoot, jobId: job.id });
    const projectDir = ws.projectDir;
    // Asset files are relative to the job dir; the Explainer workspace wipes it, so the harvest wrote beside it.
    fs.cpSync(harvestDir, ws.jobDir, { recursive: true });
    const writeProject = async () => {
      await deps.render.writeProjectFiles(projectDir, { draft, plan, inventory });
      await keepFile('script_md', path.join(projectDir, 'SCRIPT.md'), 'SCRIPT.md');
      await keepFile('storyboard_md', path.join(projectDir, 'STORYBOARD.md'), 'STORYBOARD.md');
    };
    await writeProject();

    // P6: voice (HeyGen; it reports no price).
    await stage('voice');
    const voiceId = deps.voiceId !== undefined ? deps.voiceId : (await (await import('@/lib/explainers/settings')).loadSettings(db as never)).voice_id;
    if (!voiceId) throw new ProductionFailure('No HeyGen voice id is set (Explainers Settings → HeyGen voice ID).');
    await deps.render.runVoice(projectDir, { voiceId, heygenApiKey: deps.secrets.heygenApiKey, pronounce: draft.pronounce ?? [] });
    await recordCost(db, { jobId: job.id, pitchId: row.id, mode: job.mode, vendor: 'heygen', component: 'voice', usd: null });
    // The close never stretches (MD-18, S-33): a question voiced longer than fits is flagged, not lengthened.
    const question = closeVoiceSeconds(projectDir);
    if (question !== null && question > CLOSE.maxQuestion) {
      await flag('voice', `The close question is voiced in ${question}s; about ${CLOSE.maxQuestion}s fits inside the ${CLOSE.duration}s close, which keeps its length, so the question runs past it.`);
    }

    // C2: integrity (each image shows what its line claims): one fix via the director, then warn.
    await stage('integrity_check');
    const integrity = await deps.checks.checkIntegrity({ plan, inventory, draft }, ctx);
    await keepText('integrity_check', { round: 0, problems: integrity.problems });
    await settle('integrity check');
    if (integrity.problems.length > 0) {
      const flagged = [...new Set(integrity.problems.map((p) => p.frame))];
      const fixed = await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide, fix: { kind: 'image_check', plan, problems: integrity.problems } }, ctx);
      plan = reconcilePlan(draft, mergeFrames(plan, fixed, flagged));
      await keepText('director_plan', plan);
      const again = await deps.checks.checkIntegrity({ plan, inventory, draft }, ctx);
      await keepText('integrity_check', { round: 1, problems: again.problems });
      await settle('integrity fix');
      for (const p of again.problems) await flag('integrity', `Frame ${p.frame} (${p.asset_id}): ${p.why}`);
      if (deps.render.makeAssets) {
        await runMakes();
        fs.cpSync(harvestDir, ws.jobDir, { recursive: true });
      }
      // The rewrite must not lose the voice: same lines → assemble re-paces from the voice already made;
      // different lines → voice them again (MD-58: a frame shorter than its voice cuts the line off).
      const voiced = fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8');
      await writeProject();
      if (!sameVoices(voiced, fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8'))) {
        await stage('voice');
        await deps.render.runVoice(projectDir, { voiceId, heygenApiKey: deps.secrets.heygenApiKey, pronounce: draft.pronounce ?? [] });
      }
    }

    for (const w of planWarnings(plan, { draft, inventory })) await flag('integrity', `Plan: ${w}`);

    // P7: the frame-building session (build-workflow; frame workers on the frame-worker prompt).
    const secrets = { ...deps.secrets, voiceId };
    const session = async (name: JobStage, prompt: string) => {
      await stage(name);
      const result = await deps.agent.runSession({
        prompt,
        projectDir,
        homeDir: ws!.homeDir,
        tmpDir: ws!.tmpDir,
        model: models.orchestrator,
        frameWorkerModel: models.frame_worker,
        meter,
        secrets,
        log: (entry) => transcript.push(JSON.stringify(entry)),
      });
      await recordSession(db, job, row.id, name, result);
      // runAgentSession settled its own total into the meter; anything else the ledger gained is charged.
      const spent = await spendFor(db, { jobId: job.id });
      const extra = spent - accounted - result.totalCostUsd;
      if (extra > 0) meter.charge(extra);
      accounted = spent;
      if (result.capped || meter.overCap) throw new ProductionFailure(`Spend cap $${job.spend_cap_usd.toFixed(2)} reached in ${name}.`, true);
      if (result.isError) log('session_error', { jobId: job.id, stage: name, subtype: result.subtype, errors: result.errors });
      return result;
    };
    const fixSession = async (name: JobStage, findings: unknown) => {
      const file = path.join(projectDir, FIX_FINDINGS_FILE);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(findings, null, 2)}\n`);
      return session(name, `${deps.prompts('fix')}\n\nFINDINGS_FILE: ${FIX_FINDINGS_FILE}`);
    };
    // MD-61: the sound designer plans the cues on the final voice timing (cues are word-anchored, so later
    // re-paces keep them in place). It fails open: its problems ship as warnings.
    if (deps.render.designSound) {
      await stage('sound_design');
      const sound = await deps.render.designSound({ projectDir, draft, plan }, ctx);
      await settle('sound design');
      for (const p of sound.problems.filter((x) => !x.startsWith('warning:'))) await flag('render', `Sound design: ${p}`);
    }
    await session('build', deps.prompts('build-workflow'));

    // Assemble and measure; measured breakage gets up to BREAKAGE_REBUILDS rebuild sessions, then ships
    // with a warning (MD-58).
    const measure = async (label: string | number) => {
      await stage('assemble');
      const result = await deps.render.assembleProject(projectDir);
      await keepText('breakage', { round: label, ...result });
      return result;
    };
    const rebuildUntilClean = async (first: Awaited<ReturnType<typeof measure>>, rounds: number, label: string) => {
      let result = first;
      for (let i = 1; i <= rounds && (!result.ok || result.problems.length > 0); i++) {
        await fixSession('fix', { check: 'breakage', round: i, problems: result.problems });
        result = await measure(`${label}${i}`);
      }
      return result;
    };
    const flagBreakage = async (result: Awaited<ReturnType<typeof measure>>) => {
      for (const p of result.problems) await flag('breakage', p);
      if (!result.ok && result.problems.length === 0) await flag('breakage', 'Assembly still reports a failure after its rebuilds.');
    };
    const assembled = await rebuildUntilClean(await measure(0), BREAKAGE_REBUILDS, '');
    await flagBreakage(assembled);

    // P8: render, then the contact sheet the first viewer looks at.
    const renderAndSheet = async () => {
      await stage('render');
      let video: string;
      try {
        video = await deps.render.renderVideo(projectDir);
      } catch (error) {
        await flag('render', `The render failed: ${errorText(error)}`);
        throw new ProductionFailure(`The render failed: ${errorText(error)}`);
      }
      const sheet = await deps.render.contactSheet(projectDir, video);
      return { video, sheet };
    };
    let { video, sheet } = await renderAndSheet();

    // C3: the first-time viewer: one fix session (re-assemble, re-render), then warn.
    await stage('first_viewer');
    const viewerInput = () => ({ contactSheet: sheet, captions: captionsFor(sheet, draft, plan), draft, facts });
    let viewer = await deps.checks.checkFirstViewer(viewerInput(), ctx);
    let findings = firstViewerFindings(viewer, settings.hook_seconds);
    await keepText('first_viewer', { round: 0, ...viewer, findings });
    await settle('first viewer');
    if (findings.length > 0) {
      await fixSession('fix', { check: 'first_viewer', hook_seconds_max: settings.hook_seconds, ...viewer, findings });
      // The fix must not break what was measured clean: one more rebuild if it did (MD-58).
      const reassembled = await rebuildUntilClean(await measure('after_first_viewer_fix'), 1, 'after_first_viewer_fix_');
      const before = new Set(assembled.problems);
      for (const p of reassembled.problems) if (!before.has(p)) await flag('breakage', p);
      ({ video, sheet } = await renderAndSheet());
      await stage('first_viewer');
      viewer = await deps.checks.checkFirstViewer(viewerInput(), ctx);
      findings = firstViewerFindings(viewer, settings.hook_seconds);
      await keepText('first_viewer', { round: 1, ...viewer, findings });
      await settle('first viewer fix');
      for (const f of findings) await flag('first_viewer', f);
    }
    for (const w of viewer.warnings ?? []) await flag('first_viewer', w);

    // P9: deliver — the files, the post text (MD-50), the reuse record (MD-45), the report.
    await stage('deliver');
    const videoKey = await keepFile('video', video, 'video.mp4');
    if (!videoKey) throw new ProductionFailure('The render produced no video file.');
    const sheetKey = await keepFile('contact_sheet', sheet, `contact-sheet${path.extname(sheet) || '.png'}`);
    const used = usedAssets(plan, inventory);
    const post = await deps.writing.writePost({ draft, facts, inventory, usedAssetIds: used.map((u) => u.asset.id) }, ctx);
    await keepText('post_text', post);
    await settle('post text');
    await deps.harvest.recordUses(
      db,
      job.id,
      used.map((u) => ({ assetKey: assetKey(u.asset, job.id), purpose: `frame ${u.frame.n}: ${u.frame.purpose}`, characterImage: u.asset.character_image || isLogo(u.asset) })),
    );
    const { rows: unknownParts } = await db.query<{ component: string }>(
      'SELECT DISTINCT component FROM reel_ai_drama.cost_events WHERE job_id = $1 AND usd_known = false ORDER BY component',
      [job.id],
    );
    const { rows: flagRows } = await db.query<{ flags: unknown }>('SELECT flags FROM reel_ai_drama.jobs WHERE id = $1', [job.id]);
    const report: DeliveryReport = {
      job_id: job.id,
      video: videoKey,
      contact_sheet: sheetKey,
      seconds: deps.render.videoSeconds ? await deps.render.videoSeconds(video) : null,
      usd: await spendFor(db, { jobId: job.id }),
      usd_unknown_parts: unknownParts.map((r) => r.component),
      flags: (typeof flagRows[0]?.flags === 'string' ? JSON.parse(flagRows[0].flags as string) : flagRows[0]?.flags ?? []) as JobFlag[],
      post,
    };
    await keepText('delivery_report', report);
    await finishJob(db, job.id, { status: 'ok' });
    log('job_ok', { jobId: job.id, usd: report.usd, flags: report.flags.length });
    return { status: 'ok' };
  } catch (error) {
    if (error instanceof Killed) {
      // MD-31: the story dies before production spend; the next story in the pool takes its slot.
      await finishJob(db, job.id, { status: 'killed', killReason: error.reason, error: error.detail });
      log('job_killed', { jobId: job.id, reason: error.reason, detail: error.detail });
      let nextJobId: string | null = null;
      // Only the automatic schedule refills its slot; a click was a request for that one story.
      if (job.trigger === 'auto') try {
        const next = await deps.pool.nextForProduction(db, settings, now());
        if (next) {
          const req = await requestJob(db, { pitchId: next.id, trigger: job.trigger, settings });
          if (req.ok) nextJobId = req.jobId;
          log('next_pitch', { jobId: job.id, pitchId: next.id, request: req });
        }
      } catch (e) {
        log('next_pitch_failed', { jobId: job.id, error: errorText(e) });
      }
      return { status: 'killed', killReason: error.reason, nextJobId };
    }
    const capped = error instanceof ProductionFailure && error.capped;
    const message = errorText(error);
    if (capped) await addFlag(db, job.id, { check: 'cost', detail: message, at: now().toISOString() });
    await finishJob(db, job.id, { status: 'failed', error: message, capped });
    log('job_failed', { jobId: job.id, error: message, capped });
    return { status: 'failed', error: message, capped };
  } finally {
    if (transcript.length) {
      const file = path.join(deps.jobsRoot, job.id, 'transcript.jsonl');
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, `${transcript.join('\n')}\n`);
        await keepFile('transcript_log', file, 'transcript.jsonl');
      } catch (e) {
        log('transcript_failed', { jobId: job.id, error: errorText(e) });
      }
    }
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The kit's caption transcript beside the contact sheet when it wrote one, else the script's words. */
function captionsFor(sheet: string, draft: WriterDraft, plan: DirectorPlan): string {
  for (const file of [sheet.replace(/\.[a-z0-9]+$/i, '.txt'), path.join(path.dirname(sheet), 'captions.txt')]) {
    if (file !== sheet && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return captionsText(draft, plan);
}

async function recordSession(db: Queryable, job: Job, pitchId: string, phase: string, session: SessionResult): Promise<void> {
  const models = Object.entries(session.modelUsage);
  if (models.length === 0) {
    if (session.totalCostUsd > 0) {
      await recordCost(db, { jobId: job.id, pitchId, mode: job.mode, vendor: 'anthropic', component: `${phase}:estimate`, usd: session.totalCostUsd });
    }
    return;
  }
  for (const [model, usage] of models) {
    await recordCost(db, {
      jobId: job.id,
      pitchId,
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
}
