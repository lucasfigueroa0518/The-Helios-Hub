import { garbledAssetIds, reanchor } from '@/lib/reel-ai-drama/harvest/anchors';
import fs from 'node:fs';
import path from 'node:path';

import type { Queryable } from '@/lib/explainers/db';
import { SpendMeter } from '@/lib/explainers/render/meter';
import type { ArtifactStore } from '@/lib/explainers/storage';
import { recordCost, spendFor } from '@/lib/reel-ai-drama/cost';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { CLOSE } from '@/explainers/reel-ai-drama/kit/close-timing.js';
import { CUES_FILE } from '@/explainers/reel-ai-drama/kit/sound.mjs';
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
  withBlueprintAssets,
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
import { designFindingText, type DesignReview } from '@/lib/reel-ai-drama/checks/design';
import {
  describePictures,
  lastResort,
  lastResortFrames,
  measuredFinding,
  readVersions,
  recordFindings,
  reviewFinding,
  seriousFindings,
  settleFrame,
  solverLook,
  solverRound,
  type FrameAttempt,
  type FrameFinding,
  type FrameVersion,
  type FrameWork,
  type ReelBrief,
  type SolverDeps,
  type SolverImage,
} from '@/lib/reel-ai-drama/production/solver';
import type { CompiledRead, CompileInput, CompileResult } from '@/lib/reel-ai-drama/render/compile';
import { checkPlanCarried, planMissText, type PlanMiss } from '@/lib/reel-ai-drama/render/plan-carried';
import type { Sheet } from '@/lib/reel-ai-drama/render/sheets';
import { frameSpans } from '@/lib/reel-ai-drama/render/video';
import { planWithoutFailedMakes } from '@/lib/reel-ai-drama/render/make';
import { applyWishes } from '@/lib/reel-ai-drama/render/wishes';
import { centralCutoutRequests, cutoutSwaps, stageCutoutRequests, useCutouts, wishCutoutRequests, type CutoutRequest } from '@/lib/reel-ai-drama/harvest/cutouts';
import { emptyTrace, noOpFlags } from '@/lib/reel-ai-drama/production/noop';
import type { SoundCues } from '@/lib/reel-ai-drama/render/sound-design';
import { sameVoices, type VoiceInput, type VoiceResult } from '@/lib/reel-ai-drama/render/voice';
import { loadSettings, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import { blueprintAssets } from '@/lib/reel-ai-drama/types';
import type {
  Asset,
  Blueprint,
  DeliveryReport,
  DirectorPlan,
  FactSheet,
  JobFlag,
  JobStage,
  Mode,
  Pitch,
  PitchRow,
  PostText,
  ShotWish,
  StoryNotes,
  VisualsInventory,
  WriterDraft,
} from '@/lib/reel-ai-drama/types';
import type { DirectorFix, FixProblem } from '@/lib/reel-ai-drama/writing/director';
import type { StoryEditInput } from '@/lib/reel-ai-drama/writing/story-editor';
import { directorNotes, storyEditorNotes, type RevisionNote } from '@/lib/reel-ai-drama/writing/writer';
import { isLogo, planWarnings, standInsFrom, type StandIn } from '@/lib/reel-ai-drama/writing/validate';

/**
 * One Reel AI Drama production run (PROCESS.md P1–P9, CONTRACT.md § B5):
 *   pick → reporting ‖ harvest → writer → blind story editor → (notes: one writer rewrite) → cutouts →
 *   director → wish search → (lines back: one revise) → lock → facts check (one fix, then cut) → workspace + project files → voice →
 *   image check ‖ plan checks (one combined `pre_build` fix of the named frames, escalated once if still found, then flags) →
 *   sound design → compile → measure (a frame that won't build ships plain) → render → sheets of moments → first viewer ‖ design
 *   review → director content pass (once) → solver look → two solver rounds (each: build, measure, render, re-read the changed
 *   frames, ship the version with the fewest serious findings) → last resort → final read → flags → post text → reuse record →
 *   deliver (Iteration 11). The solver may write a frame's code; measured checks still run on it.
 * Every builder's module is reached through ProductionDeps, so the whole run can be stubbed; the live
 * modules are wired in production/live.ts only.
 *
 * Spend: one SpendMeter on the job's cap (MD-07). Builders record their own calls with recordCost under
 * this job id; after every step the ledger's new spend is settled into the meter. Passing the cap fails the job as capped.
 */

/** What every builder call is told about the run. */
export type StepCtx = { jobId: string; pitchId: string; mode: Mode; settings: ReelAiDramaSettings };

export type Workspace = { jobDir: string; projectDir: string; homeDir: string; tmpDir: string };

export type ProductionDeps = {
  db: Queryable;
  store: ArtifactStore;
  jobsRoot: string;
  secrets: { anthropicApiKey: string; heygenApiKey: string };
  /** HeyGen voice; default: the Explainer setting voice_id (read only). */
  voiceId?: string | null;
  now?: () => Date;
  log?: (event: string, fields?: Record<string, unknown>) => void;
  /** The Jev runner for this job (RecordingDramaJevRunner live: logged and priced under the job). */
  jev: (ctx: StepCtx) => DramaJevRunner;
  pool: { nextForProduction(db: Queryable, settings: ReelAiDramaSettings, now: Date): Promise<PitchRow | null> };
  reporting: { reportStory(pitch: Pitch, ctx: StepCtx): Promise<FactSheet> };
  harvest: {
    /** `facts` may be the reporting promise: the harvest awaits it before its cast searches (everyone the facts name gets portraits). */
    harvestVisuals(input: { pitch: Pitch; facts: FactSheet | null | PromiseLike<FactSheet | null>; jobDir: string; jobId: string; mode: Mode; settings: ReelAiDramaSettings }): Promise<VisualsInventory>;
    recordUses(db: Queryable, jobId: string, uses: { assetKey: string; purpose: string; characterImage: boolean }[]): Promise<void>;
    /**
     * MD-68: the targeted search for the director's wishes (builder B). New assets are numbered after the
     * inventory's last V id and copied into the job media; it records its own cost; fails open per wish.
     * Missing: every wish takes its fallback.
     */
    searchWishes?(input: {
      wishes: ShotWish[];
      pitch: Pitch;
      facts: FactSheet;
      jobDir: string;
      jobId: string;
      mode: Mode;
      settings: ReelAiDramaSettings;
    }): Promise<{ found: { wish_id: string; asset: Asset }[]; problems: string[]; usd: number }>;
    /**
     * MD-81: transparent cutouts (rembg, local, free) made after the writer and after the wish search; new
     * assets are numbered after the inventory's last V id. Fails open per person. Missing: no cutouts.
     */
    cutPeople?(input: { inventory: VisualsInventory; requests: CutoutRequest[]; jobDir: string; jobId: string; mode: Mode }): Promise<{ assets: Asset[]; problems: string[] }>;
  };
  writing: {
    /** MD-100: the writer owns the whole story (the brief, the fact timeline, the inventory, the length). */
    writeScript(input: { pitch: Pitch; facts: FactSheet; inventory: VisualsInventory; settings: ReelAiDramaSettings }, ctx: StepCtx): Promise<WriterDraft>;
    /** MD-102: the blind story editor reads the script only and sends notes; it never edits. */
    editStory(input: StoryEditInput, ctx: StepCtx): Promise<StoryNotes>;
    /**
     * One rewrite on labelled notes (story editor, director, facts check). The inventory goes with every
     * revision so the writer can rewrite to the material and `must_show` is checked.
     */
    reviseScript(input: { draft: WriterDraft; notes: RevisionNote[]; facts: FactSheet; inventory: VisualsInventory }, ctx: StepCtx): Promise<WriterDraft>;
    /** `fix` re-asks for named frames: the integrity check's findings (C2's one fix) or lines the facts fix rewrote. */
    directReel(
      input: { draft: WriterDraft; inventory: VisualsInventory; facts: FactSheet; kitGuide: string; fix?: DirectorFix },
      ctx: StepCtx,
    ): Promise<DirectorPlan>;
    writePost(input: { draft: WriterDraft; facts: FactSheet; inventory: VisualsInventory; usedAssetIds: string[] }, ctx: StepCtx): Promise<PostText>;
  };
  checks: {
    checkFacts(jev: DramaJevRunner, input: { draft: WriterDraft; facts: FactSheet }): Promise<{ unsupported: { line_id: string; why: string }[] }>;
    checkIntegrity(input: { plan: DirectorPlan; inventory: VisualsInventory; draft: WriterDraft; facts: FactSheet }, ctx: StepCtx): Promise<{ problems: IntegrityProblem[] }>;
    /** Reads unlabelled sheets of the whole reel (`viewerSheets`). */
    checkFirstViewer(input: { sheets: Sheet[]; captions: string; draft: WriterDraft; facts: FactSheet }, ctx: StepCtx): Promise<FirstViewerResult>;
    /** MD-129: the design reviewer on each frame's sheets of moments, beside the first viewer; fails open. Missing: no design review. */
    checkDesign?(input: { sheets: Sheet[]; plan: DirectorPlan; draft: WriterDraft }, ctx: StepCtx): Promise<DesignReview>;
  };
  render: {
    kitGuide: string;
    prepareWorkspace(input: { jobsRoot: string; jobId: string }): Promise<Workspace>;
    writeProjectFiles(projectDir: string, input: { draft: WriterDraft; plan: DirectorPlan; inventory: VisualsInventory }): unknown;
    /** Iter 9: what each picture holds, from its real pixels (keys logos too). Optional so stubbed runs needn't. */
    measurePictures?(inventory: VisualsInventory, root: string): Promise<unknown>;
    /** MD-93: one take, sped up by `tempo`, split per frame; a result whose take is `per_frame` fell back (flagged). */
    runVoice(projectDir: string, input: VoiceInput): Promise<VoiceResult | void>;
    /** MD-59: make the plan's requested assets into `jobDir`/media (drawn, traced or code-built); fails open per make. */
    makeAssets?(input: { plan: DirectorPlan; inventory: VisualsInventory; jobDir: string; draft: WriterDraft }, ctx: StepCtx): Promise<{ assets: Asset[]; usd: number; problems: string[] }>;
    /** MD-61: the sound designer, once the voice timing is final; writes sound_cues.json, fails open. */
    designSound?(input: { projectDir: string; draft: WriterDraft; plan: DirectorPlan }, ctx: StepCtx): Promise<{ usd: number; problems: string[]; cues?: SoundCues | null }>;
    /** Every story frame compiled from its blueprint (render/compile.ts); never throws for one frame. */
    compileReel(input: CompileInput): Promise<CompileResult>;
    /** What the compiled frames really did, from the browser: the plan check reads it. Missing: no plan check. */
    readCompiled?(projectDir: string): Promise<CompiledRead> | CompiledRead;
    assembleProject(projectDir: string): Promise<{ ok: boolean; problems: string[] }>;
    renderVideo(projectDir: string): Promise<string>;
    contactSheet(projectDir: string, videoPath: string): Promise<string>;
    /**
     * Iteration 11 §2–§3: the moments of the rendered reel (`frames`: only these; null: every frame) cut into labelled sheets
     * for the reviewers and the solver, and with `viewer`, unlabelled sheets of the whole reel for the first viewer. Missing:
     * no sheets, so no design review, first viewer or solver look.
     */
    reelSheets?(projectDir: string, videoPath: string, input: { findings: string[]; dir: string; frames: number[] | null; viewer: boolean }): Promise<{ review: Sheet[]; viewer: Sheet[] }>;
    /** One full-size still from the video at `reel_t` seconds, for the solver. */
    fullStill?(videoPath: string, reel_t: number, file: string): Promise<string>;
    videoSeconds?(videoPath: string): Promise<number | null>;
  };
  /**
   * Iteration 11 §5: the problem solver's deps for this job (its models, limit, kit guide and the kit's CLIs on the project).
   * Missing: no solver; the reel ships as compiled and reviewed, with its findings flagged.
   */
  solver?(ctx: StepCtx, input: { projectDir: string; inventory: VisualsInventory }): SolverDeps;
};

export type IntegrityProblem = { frame: number; asset_id: string; why: string };
/** `problems` get the one fix (hook time, muted read, the story understood); `warnings` ship as flags only. */
export type FirstViewerResult = { hookSeconds: number | null; understood: boolean; problems: string[]; warnings?: string[] };

export type RunOutcome =
  | { status: 'ok' }
  | { status: 'failed'; error: string; capped: boolean }
  | { status: 'killed'; killReason: KillReason; nextJobId: string | null };

/** MD-65: the per-reel cap warns; only spend past this multiple of it stops a job (a runaway guard). */
export const CAP_BACKSTOP = 2;

/**
 * A resumed job's fact sheet (the latest kept), with its inventory when that was kept too and the harvest's
 * media is still on disk; a kept fact sheet alone means the harvest runs again on it.
 */
async function priorReporting(db: Queryable, jobId: string, harvestDir: string): Promise<{ facts: FactSheet; inventory: VisualsInventory | null } | null> {
  const { rows } = await db.query<{ kind: string; content: string }>(
    `SELECT DISTINCT ON (kind) kind, content FROM reel_ai_drama.artifacts
      WHERE job_id = $1 AND kind IN ('fact_sheet', 'inventory') AND content IS NOT NULL ORDER BY kind, created_at DESC`,
    [jobId],
  );
  const by = new Map(rows.map((r) => [r.kind, r.content]));
  if (!by.has('fact_sheet')) return null;
  const media = path.join(harvestDir, 'media');
  const harvested = by.has('inventory') && fs.existsSync(media) && fs.readdirSync(media).length > 0;
  return { facts: JSON.parse(by.get('fact_sheet')!) as FactSheet, inventory: harvested ? (JSON.parse(by.get('inventory')!) as VisualsInventory) : null };
}

/**
 * A resumed job's story (MD-102): the latest script and the editor's notes, when the editor finished.
 * `rewritten` says a script was kept after the notes (the rewrite ran); when there are notes and it didn't,
 * the job runs only the rewrite. A job with no notes artifact (or one from before iteration 5) writes afresh.
 */
async function priorStory(db: Queryable, jobId: string): Promise<{ draft: WriterDraft; notes: StoryNotes; rewritten: boolean } | null> {
  const { rows } = await db.query<{ kind: string; content: string; created_at: string | Date }>(
    `SELECT DISTINCT ON (kind) kind, content, created_at FROM reel_ai_drama.artifacts
      WHERE job_id = $1 AND kind IN ('writer_draft', 'story_notes') AND content IS NOT NULL ORDER BY kind, created_at DESC`,
    [jobId],
  );
  const by = new Map(rows.map((r) => [r.kind, r]));
  const draft = by.get('writer_draft');
  const notes = by.get('story_notes');
  if (!draft || !notes) return null;
  const rewritten = new Date(draft.created_at).getTime() > new Date(notes.created_at).getTime();
  return { draft: JSON.parse(draft.content) as WriterDraft, notes: JSON.parse(notes.content) as StoryNotes, rewritten };
}
/** A problem's frame, by the frame ids the compile wrote; null when it names none. Pure. */
export const problemFrame = (problem: string, frames: readonly { n: number; id: string }[]): number | null => frames.find((f) => problem.includes(f.id))?.n ?? null;
/** A frame that won't build or draw at all: a new layout didn't help, so it ships plain. */
export const DEAD_FRAME = /build failed|failed to build|render threw|is not deterministic|is not a function|does not provide an export/i;

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

/** The design items the director's content pass takes (Iteration 11 §4); every other finding goes to the solver. */
export const CONTENT_ITEMS: readonly string[] = ['nothing_missing', 'one_medium'];

/**
 * What the director's content pass is asked to fix: the first viewer's picture findings (on the frame they name, else the
 * opening that carries the hook) and the design review's `nothing_missing` and `one_medium` findings, either severity. Pure.
 */
export function contentPassProblems(picture: readonly string[], design: DesignReview | null): FixProblem[] {
  const content = [...(design?.problems ?? []), ...(design?.warnings ?? [])].filter((p) => CONTENT_ITEMS.includes(p.item));
  return [
    ...picture.map((why) => ({ frame: Number(/\bframe (\d+)/i.exec(why)?.[1] ?? 1), asset_id: null, why: `The first viewer: ${why}` })),
    ...content.map((p) => ({ frame: p.frame, asset_id: null, why: `The design review: ${designFindingText(p)}` })),
  ];
}

/** What every solver call shares about the reel: the script by frame, every picture described, and the words it states. Pure. */
export function solverBrief(draft: WriterDraft, plan: DirectorPlan, facts: FactSheet, inventory: VisualsInventory): ReelBrief {
  const lines = new Map(draft.rungs.flatMap((r) => r.lines.map((l) => [l.id, l] as const)));
  const script = plan.frames
    .map((f) => `Frame ${f.n}: ${f.line_ids.map((id) => lines.get(id)?.text ?? '').filter(Boolean).join(' ')}${f.on_screen ? ` [on screen: ${f.on_screen}]` : ''}`)
    .join('\n');
  const allowed = [
    ...[...lines.values()].flatMap((l) => [l.text, l.on_screen ?? '']),
    draft.hook.on_screen,
    ...plan.frames.map((f) => f.on_screen ?? ''),
    JSON.stringify(facts),
  ].filter(Boolean).join('\n');
  return { script, pictures: describePictures(inventory), allowed };
}

/** `plan` with frame `n` on `blueprint`, its pictures added to the frame's assets. Pure. */
export function withBlueprint(plan: DirectorPlan, n: number, blueprint: Blueprint): DirectorPlan {
  return { ...plan, frames: plan.frames.map((f) => (f.n === n ? { ...f, blueprint, asset_ids: [...new Set([...blueprintAssets(blueprint), ...(f.asset_ids ?? [])])] } : f)) };
}

/** The measured state of the project: each frame's lines, and the lines no frame could be found for. */
type Measured = { ok: boolean; byFrame: Map<number, string[]>; loose: string[] };

/** A finding that starts in the words: the story told back wrong or not understood (checks/first-viewer.ts wording). */
const WORDS_FINDING = /^The viewer told the story as|did not understand the story/i;
/** A finding the picture can act on: the hook's time (the opening frame carries it) and the muted read. */
const PICTURE_FINDING = /hook|on mute|what the story was asking|never worked out what the story was about/i;

/**
 * M11: the first viewer's findings split by who can act on them. `picture` goes to the picture-only fix;
 * `words` (the story not understood) ships as flags, since the script is locked and voiced by then (the
 * story editor's blind read is the words' check, MD-97). Anything unrecognised counts as words.
 */
export function firstViewerRouting(r: FirstViewerResult, hookSeconds: number): { picture: string[]; words: string[] } {
  const picture: string[] = [];
  const words: string[] = [];
  for (const f of new Set(firstViewerFindings(r, hookSeconds))) (!WORDS_FINDING.test(f) && PICTURE_FINDING.test(f) ? picture : words).push(f);
  return { picture, words };
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
  const prefix = `reel-ai-drama/jobs/${job.id}`;

  // MD-65: the per-reel cap is a warning, not a stop; only a runaway (CAP_BACKSTOP × the cap) stops a job.
  const meter = new SpendMeter(job.spend_cap_usd * CAP_BACKSTOP, job.spend_usd);
  let accounted = job.spend_usd;
  let capWarned = false;

  const stage = async (name: JobStage) => {
    log('stage', { jobId: job.id, stage: name });
    await setStage(db, job.id, name);
  };
  const keepText = async (kind: ArtifactKind, content: unknown) => {
    if (content === null || content === undefined) return;
    await addArtifact(db, { jobId: job.id, kind, content: typeof content === 'string' ? content : JSON.stringify(content, null, 2) });
  };
  /** Compile and measure rounds repeat what they find; a flag says it once. */
  const flagged = new Set<string>();
  const keepFile = async (kind: ArtifactKind, file: string, name: string): Promise<string | null> => {
    if (!file || !fs.existsSync(file)) return null;
    // A second try before a paid-for file is lost to a passing storage error.
    const { storagePath, bytes } = await store.put(`${prefix}/${name}`, file).catch(() => store.put(`${prefix}/${name}`, file));
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
    if (!capWarned && meter.totalUsd >= job.spend_cap_usd) {
      capWarned = true;
      await flag('cost', `The reel passed its $${job.spend_cap_usd.toFixed(2)} cap after ${step} ($${meter.totalUsd.toFixed(2)}) and kept going (MD-65).`);
    }
    if (meter.overCap) throw new ProductionFailure(`Runaway spend: $${meter.totalUsd.toFixed(2)} after ${step}, ${CAP_BACKSTOP}× the $${job.spend_cap_usd.toFixed(2)} cap.`, true);
  };

  let ws: Workspace | null = null;
  try {
    // P1: the pick (the job names its pitch).
    await stage('pick');
    const row = await getPitch(db, job.pitch_id);
    if (!row) throw new ProductionFailure('The pitch is gone.');
    const pitch = row.pitch;
    const ctx: StepCtx = { jobId: job.id, pitchId: row.id, mode: job.mode, settings };
    let inventory: VisualsInventory;
    let facts: FactSheet;
    const harvestDir = path.join(deps.jobsRoot, '_harvest', job.id);
    /** What each fail-open step actually did, for the no-op detector before delivery (MD-81). */
    const trace = emptyTrace();
    /** What each picture holds (contract §7b): after the harvest, then after the cut and wish steps. Free, and only what's new. */
    const measureNew = async (step: string) => {
      if (!deps.render.measurePictures) return;
      try {
        await deps.render.measurePictures(inventory, harvestDir);
        await keepText('inventory', inventory);
      } catch (error) {
        await flag('harvest', `Measuring the pictures after the ${step} failed (${errorText(error)}); they fall back on their boxes.`);
      }
    };

    /** MD-81: cut people out (rembg) and add the cutouts to the inventory; fails open. */
    const cutPeople = async (requests: CutoutRequest[], step: string): Promise<Asset[]> => {
      if (!requests.length) return [];
      if (!deps.harvest.cutPeople) {
        log('cutouts_skipped', { jobId: job.id, step, people: requests.map((r) => r.name) });
        return [];
      }
      try {
        const made = await deps.harvest.cutPeople({ inventory, requests, jobDir: harvestDir, jobId: job.id, mode: job.mode });
        const known = new Set(inventory.assets.map((a) => a.id));
        const added = made.assets.filter((a) => !known.has(a.id));
        if (added.length) {
          inventory = { ...inventory, assets: [...inventory.assets, ...added] };
          await keepText('inventory', inventory);
        }
        for (const p of made.problems) await flag('harvest', `Cutout (${step}): ${p}`);
        log('cutouts', { jobId: job.id, step, made: added.map((a) => `${a.people[0] ?? a.shows ?? a.kind} → ${a.id}`) });
        return added;
      } catch (error) {
        await flag('harvest', `The cutouts after the ${step} failed (${errorText(error)}); ${requests.map((r) => r.name).join(', ')} keep their photos.`);
        return [];
      }
    };

    /** Wishes the search didn't find: they leave the plan when resolved, so they're kept for the plan checks (decision 4). */
    const standIns: StandIn[] = [];
    /** A plan with no search wired, or one sent back before the search, takes its wishes' fallbacks (logged). */
    const withFallbacks = (p: DirectorPlan, step: string): DirectorPlan => {
      if (!p.wishes?.length) return p;
      log('wishes_fallback', { jobId: job.id, step, wishes: p.wishes.map((w) => w.id) });
      standIns.push(...standInsFrom(p, new Map()));
      return applyWishes(p, new Map());
    };
    /** What each wish found: a fix round asking for the same shot gets the same answer, with no second search. */
    const searched = new Map<string, string[]>();
    const wishKey = (w: ShotWish) => `${w.person ?? ''}|${w.want}`.toLowerCase().replace(/\s+/g, ' ').trim();
    /** MD-68: search for the director's wishes, add what is found to the inventory, then resolve every wish. */
    const searchWishes = async (p: DirectorPlan): Promise<DirectorPlan> => {
      const wishes = p.wishes ?? [];
      if (!wishes.length) return p;
      trace.wishes = { planned: wishes.length, notSearched: null };
      if (!deps.harvest.searchWishes) {
        trace.wishes.notSearched = 'no wish search is wired';
        return withFallbacks(p, 'no wish search wired');
      }
      await stage('wish_search');
      const found = new Map<string, string[]>();
      for (const w of wishes) if (searched.get(wishKey(w))?.length) found.set(w.id, searched.get(wishKey(w))!);
      const fresh = wishes.filter((w) => !searched.has(wishKey(w)));
      try {
        const result = fresh.length ? await deps.harvest.searchWishes({ wishes: fresh, pitch, facts, jobDir: harvestDir, jobId: job.id, mode: job.mode, settings }) : { found: [], problems: [], usd: 0 };
        const stopped = result.problems.find((x) => /^wish search stopped/i.test(x));
        if (stopped && !result.found.length) trace.wishes.notSearched = stopped;
        const known = new Set(inventory.assets.map((a) => a.id));
        const added = result.found.filter((f) => !known.has(f.asset.id));
        inventory = { ...inventory, assets: [...inventory.assets, ...added.map((f) => f.asset)] };
        for (const f of result.found) if (inventory.assets.some((a) => a.id === f.asset.id)) found.set(f.wish_id, [...(found.get(f.wish_id) ?? []), f.asset.id]);
        for (const problem of result.problems) await flag('harvest', `Wish search: ${problem}`);
        log('wish_search', { jobId: job.id, wishes: wishes.length, found: found.size, usd: result.usd });
        if (added.length) await keepText('inventory', inventory);
      } catch (error) {
        trace.wishes.notSearched = `the search failed: ${errorText(error)}`;
        await flag('harvest', `The wish search failed (${errorText(error)}); every wished shot uses its fallback.`);
      }
      for (const w of fresh) searched.set(wishKey(w), found.get(w.id) ?? []);
      const missed = wishes.filter((w) => !found.has(w.id));
      if (missed.length) log('wishes_missed', { jobId: job.id, wishes: missed.map((w) => `${w.id} → ${w.fallback}`) });
      standIns.push(...standInsFrom(p, found));
      let resolved = applyWishes(p, found);
      // MD-81: a found photo of a person in a frame that lifts people out gets a cutout, and those frames use it.
      const lifted = wishCutoutRequests(
        resolved,
        wishes.filter((w) => found.has(w.id)).flatMap((w) => found.get(w.id)!.map((asset_id) => ({ wish: w, asset_id }))),
        inventory,
      );
      if (lifted.length) resolved = useCutouts(resolved, cutoutSwaps(lifted, await cutPeople(lifted, 'wish search')));
      await keepText('director_plan', resolved);
      await settle('wish search');
      return resolved;
    };

    /**
     * A plan arriving from the director, first or fix: the same for all. What it wished for is searched (never the same shot twice),
     * everyone on a stage is a real cutout (local rembg, no spend), new pictures are measured, and what code repaired is flagged.
     */
    const arrive = async (given: DirectorPlan, step: string): Promise<DirectorPlan> => {
      const { repairs, ...p } = given;
      for (const r of repairs ?? []) await flag('integrity', `Director plan, ${r}`);
      let next = withBlueprintAssets(await searchWishes(p));
      const staged = stageCutoutRequests(next, inventory);
      const cut = staged.requests.length ? cutoutSwaps(staged.requests, await cutPeople(staged.requests, 'stage')) : [];
      if (staged.swaps.length || cut.length) next = useCutouts(next, [...staged.swaps, ...cut]);
      await measureNew(step);
      return next;
    };

    // P2 ‖ P3: reporting and the harvest run side by side. Neither stops the reel (MD-65): what they find
    // wrong ships as a warning. A resumed job reuses the fact sheet and harvest it already paid for.
    fs.mkdirSync(harvestDir, { recursive: true });
    const prior = await priorReporting(db, job.id, harvestDir);
    if (prior) log('resumed', { jobId: job.id, from: prior.inventory ? 'fact_sheet + inventory' : 'fact_sheet' });
    await stage('reporting');
    let harvestDone = false;
    const reporting = prior ? Promise.resolve(prior.facts) : deps.reporting.reportStory(pitch, ctx);
    const [reported, harvested] = prior?.inventory ? [{ status: 'fulfilled' as const, value: prior.facts }, { status: 'fulfilled' as const, value: prior.inventory }] : await Promise.allSettled([
      reporting.then(async (f) => {
        if (!harvestDone) await stage('harvest');
        return f;
      }),
      deps.harvest
        .harvestVisuals({ pitch, facts: prior ? prior.facts : reporting.catch(() => null), jobDir: harvestDir, jobId: job.id, mode: job.mode, settings })
        .finally(() => {
          harvestDone = true;
        }),
    ]);
    if (reported.status === 'rejected') throw new ProductionFailure(`Reporting failed: ${errorText(reported.reason)}`);
    if (harvested.status === 'rejected') throw new ProductionFailure(`The harvest failed: ${errorText(harvested.reason)}`);
    facts = reported.value;
    inventory = harvested.value;
    if (!prior) await keepText('fact_sheet', facts);
    if (!prior?.inventory) await keepText('inventory', inventory);
    await measureNew('harvest');
    await settle('reporting and harvest');
    // MD-65: nothing a check finds stops the reel. The writer tells a shaky claim at the strength the sheet
    // gives it (attributed, or both sides); thin visuals go to the director and the makes.
    if (!facts.verdict.holds) await flag('reporting', `The reporter doubts the story as pitched: ${facts.verdict.reason} The reel went ahead; the writer attributes what isn't confirmed.`);
    const visualsKill = harvestKill(inventory, settings.min_visuals);
    if (visualsKill) await flag('harvest', `${visualsKill}: ${inventory.kill?.reason ?? `${inventory.usable_count} usable visuals, under ${settings.min_visuals}.`} The reel went ahead with what exists and what can be made.`);
    if (!inventory.assets.some((a) => a.flags.includes('key_moment'))) {
      await addFlag(db, job.id, { check: 'harvest', detail: 'No photo of the key moment exists; the director tells it with the visuals that do.', at: now().toISOString() });
    }

    let draft: WriterDraft;
    // MD-102: every note the blind editor sends ships as a story flag, answered by the rewrite or not.
    const noteFlags = async (notes: StoryNotes) => {
      for (const n of notes.notes) await flag('story', `Story editor: ${n.note}${n.lines.length ? ` (${n.lines.join(', ')})` : ''}`);
    };
    /** One writer rewrite on the editor's notes (MD-102); it fails open: the first draft stands. */
    const rewriteOnNotes = async (notes: StoryNotes) => {
      const asked = storyEditorNotes(notes.notes);
      if (!asked.length) return;
      await stage('story_rewrite');
      try {
        draft = await deps.writing.reviseScript({ draft, notes: asked, facts, inventory }, ctx);
        await keepText('writer_draft', draft);
      } catch (error) {
        trace.rewriteFailed = errorText(error);
        await flag('story', `The rewrite on the story editor's notes failed (${errorText(error)}); the first draft stands.`);
      }
      await settle('story rewrite');
    };
    // A resumed job reuses the story it already wrote and read; the notes still ship as flags.
    const keptStory = await priorStory(db, job.id);
    if (keptStory) {
      log('resumed', { jobId: job.id, from: keptStory.rewritten ? 'script + notes + rewrite' : 'script + notes' });
      draft = keptStory.draft;
      await noteFlags(keptStory.notes);
      if (!keptStory.rewritten) await rewriteOnNotes(keptStory.notes);
    } else {
      // P4 (MD-100): the writer owns the whole story.
      await stage('writer');
      draft = await deps.writing.writeScript({ pitch, facts, inventory, settings }, ctx);
      await keepText('writer_draft', draft);
      await settle('writer');

      // MD-102: the blind story editor reads the script only and sends notes; the writer rewrites once when
      // there are any. Both fail open (MD-65).
      await stage('story_notes');
      let notes: StoryNotes | null = null;
      try {
        notes = await deps.writing.editStory({ draft, settings }, ctx);
        await keepText('story_notes', notes);
      } catch (error) {
        trace.editorFailed = errorText(error);
        await flag('story', `The story editor failed (${errorText(error)}); the writer's draft stands unread.`);
      }
      await settle('story notes');
      if (notes) {
        await noteFlags(notes);
        await rewriteOnNotes(notes);
      }
    }

    // MD-81, MD-100: cutouts after the writer. Everyone the writer names central with a verified portrait and
    // no cutout gets one (rembg, local); it is their character image when they have no anchor yet.
    const cast = [...facts.cast, ...pitch.cast];
    const central = draft.central ?? [];
    if (central.length) {
      const wanted = centralCutoutRequests(central, cast, inventory);
      for (const p of wanted.problems) await flag('harvest', `Cutout (central): ${p}`);
      await cutPeople(wanted.requests, 'writer');
      await measureNew('cutouts');
    }

    // P5: the director shoots first (MD-68), then the targeted search for its wishes; lines back once
    // (MD-38), then the script locks.
    await stage('director');
    const firstPlan = await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide }, ctx);
    await keepText('director_plan', firstPlan);
    await settle('director');
    let plan = await arrive(firstPlan, 'wish search');
    if (plan.lines_back.length > 0) {
      await stage('writer_revise');
      let revised = false;
      try {
        draft = await deps.writing.reviseScript({ draft, notes: directorNotes(plan.lines_back), facts, inventory }, ctx);
        await keepText('writer_draft', draft);
        revised = true;
      } catch (error) {
        await flag('story', `The rewrite of the lines the director sent back failed (${errorText(error)}); the script stands.`);
      }
      await settle('writer revise');
      if (revised) {
        await stage('director');
        try {
          plan = await arrive(await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide }, ctx), 're-plan after lines back');
          if (plan.lines_back.length) log('lines_back_ignored', { jobId: job.id, count: plan.lines_back.length });
        } catch (error) {
          await flag('integrity', `The re-plan after the rewrite failed (${errorText(error)}); the first plan follows the new script.`);
        }
        await settle('director');
      }
      plan = { ...plan, lines_back: [] };
      await keepText('director_plan', plan);
    }

    // C1: the facts check (loose Jev, MD-39): one fix through the writer, then the line is cut.
    await stage('facts_check');
    const jev = deps.jev(ctx);
    const factsCheck = async (): Promise<{ unsupported: { line_id: string; why: string }[] }> => {
      try {
        return await deps.checks.checkFacts(jev, { draft, facts });
      } catch (error) {
        await flag('facts', `The facts check failed (${errorText(error)}); this script ships unchecked.`);
        return { unsupported: [] };
      }
    };
    let check = await factsCheck();
    await keepText('facts_check', { round: 0, unsupported: check.unsupported });
    await settle('facts check');
    /** Lines the facts fix rewrote after the director planned them: their frames are re-planned below. */
    let rewritten: string[] = [];
    if (check.unsupported.length > 0) {
      const beforeFix = draft;
      let revised = true;
      try {
        draft = await deps.writing.reviseScript(
          { draft, notes: check.unsupported.map((u) => ({ source: 'Facts check' as const, lines: [u.line_id], note: u.why })), facts, inventory },
          ctx,
        );
      } catch (error) {
        // Nothing was rewritten, so what the check found still stands and its lines are cut below.
        revised = false;
        await flag('facts', `The rewrite on the facts check failed (${errorText(error)}).`);
      }
      rewritten = changedLineIds(beforeFix, draft);
      await keepText('writer_draft', draft);
      if (revised) check = await factsCheck();
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
            .join('; ')}. Re-time the blueprint and on_screen to the new words; keep the frame's job.`,
        }));
        try {
          const fixed = await arrive(await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide, fix: { kind: 'script_revised', plan, problems } }, ctx), 'script-revision fix');
          plan = reconcilePlan(draft, mergeFrames(plan, fixed, affected.map((f) => f.n)));
          await keepText('director_plan', plan);
        } catch (error) {
          await flag('facts', `Frames ${affected.map((f) => f.n).join(', ')} keep the picture planned for the earlier wording: the re-plan failed (${errorText(error)}).`);
        }
        await settle('director re-plan');
      }
    }

    // MD-59: the assets the director asked to be made for exact moments; a failed make falls back (fail open).
    const runMakes = async () => {
      const pending = (plan.makes ?? []).filter((m) => !inventory.assets.some((a) => a.id === m.id));
      if (!pending.length || !deps.render.makeAssets) return;
      await stage('make');
      const made = await deps.render.makeAssets({ plan: { ...plan, makes: pending }, inventory, jobDir: harvestDir, draft }, ctx).catch((error) => ({ assets: [] as Asset[], usd: 0, problems: [`the makes failed (${errorText(error)}); their frames use their fallbacks`] }));
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
    const jobDir = ws.jobDir;
    // Asset files are relative to the job dir; the Explainer workspace wipes it, so the harvest wrote beside it.
    fs.cpSync(harvestDir, ws.jobDir, { recursive: true });
    const writeProject = async () => {
      // Measured from the real pixels: what the kit composes from. Fails open: unmeasured pictures fall back on their boxes.
      if (deps.render.measurePictures) await deps.render.measurePictures(inventory, jobDir).catch(async (error) => flag('render', `Measuring the pictures: ${errorText(error)}`));
      await deps.render.writeProjectFiles(projectDir, { draft, plan, inventory });
      await keepFile('script_md', path.join(projectDir, 'SCRIPT.md'), 'SCRIPT.md');
      await keepFile('storyboard_md', path.join(projectDir, 'STORYBOARD.md'), 'STORYBOARD.md');
    };
    await writeProject();

    // P6: voice (HeyGen; it reports no price).
    await stage('voice');
    const voiceId = deps.voiceId !== undefined ? deps.voiceId : (await (await import('@/lib/explainers/settings')).loadSettings(db as never)).voice_id;
    if (!voiceId) throw new ProductionFailure('No HeyGen voice id is set (Explainers Settings → HeyGen voice ID).');
    const voiceInput: VoiceInput = {
      voiceId,
      heygenApiKey: deps.secrets.heygenApiKey,
      pronounce: draft.pronounce ?? [],
      tempo: settings.voice_tempo,
      silentBeatMax: settings.silent_beat_max,
    };
    const voice = async () => {
      const made = await deps.render.runVoice(projectDir, voiceInput);
      for (const note of made?.notes ?? []) await flag('voice', note);
    };
    await voice();
    await recordCost(db, { jobId: job.id, pitchId: row.id, mode: job.mode, vendor: 'heygen', component: 'voice', usd: null });
    // The close stretches to its question's voice (pace.mjs closeLength), so a long question is logged, not flagged.
    const question = closeVoiceSeconds(projectDir);
    if (question !== null && question > CLOSE.maxQuestion) log('close_stretched', { jobId: job.id, questionSeconds: question, closeSeconds: CLOSE.duration });

    // Iteration 11 §4: the plan checks (MD-59/60 variety) and the image check (C2) go to the director together, once, before
    // anything is built (`pre_build`): only the named frames go and come back. A problem the re-check still finds gets one more
    // round on the escalation model; what remains ships as flags.
    await stage('integrity_check');
    const integrityCheck = async (): Promise<IntegrityProblem[]> => {
      try {
        return (await deps.checks.checkIntegrity({ plan, inventory, draft, facts }, ctx)).problems;
      } catch (error) {
        await flag('integrity', `The image check failed (${errorText(error)}); the pictures ship unchecked.`);
        return [];
      }
    };
    const preBuildFindings = async () => ({ integrity: await integrityCheck(), variety: varietyFindings(plan, { draft, inventory, facts, standIns }) });
    let found = await preBuildFindings();
    await keepText('integrity_check', { round: 0, problems: found.integrity, variety: found.variety });
    await settle('integrity check');
    let preBuildFixed = false;
    for (const escalate of [false, true]) {
      if (!found.integrity.length && !found.variety.length) break;
      // A garbled image never stays an anchor: its person's next best portrait takes over before the fix.
      const reanchored = reanchor(inventory, garbledAssetIds(found.integrity));
      if (reanchored.moved.length) {
        inventory = reanchored.inventory;
        await keepText('inventory', inventory);
        for (const m of reanchored.moved) log('reanchored', { jobId: job.id, ...m });
      }
      const problems: FixProblem[] = [...found.variety.map((v) => ({ frame: v.frame, asset_id: v.asset_id, why: v.why })), ...found.integrity];
      const named = [...new Set(problems.map((p) => p.frame))];
      await stage('director');
      try {
        const fixed = await arrive(
          await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide, fix: { kind: 'pre_build', plan, problems, ...(escalate ? { escalate } : {}) } }, ctx),
          escalate ? 'pre-build fix (escalated)' : 'pre-build fix',
        );
        plan = reconcilePlan(draft, mergeFrames(plan, fixed, named));
        await keepText('director_plan', plan);
        preBuildFixed = true;
        // Makes the fix asked for exist before the re-check looks at them (they were "not in the inventory").
        if (deps.render.makeAssets) await runMakes();
        fs.cpSync(harvestDir, ws.jobDir, { recursive: true });
      } catch (error) {
        await settle('pre-build fix');
        await flag('integrity', `The pre-build re-plan failed (${errorText(error)}); frames ${named.join(', ')} keep their plan.`);
        break;
      }
      await settle(escalate ? 'pre-build fix (escalated)' : 'pre-build fix');
      await stage('integrity_check');
      found = await preBuildFindings();
      await keepText('integrity_check', { round: escalate ? 2 : 1, problems: found.integrity, variety: found.variety });
      await settle('integrity re-check');
    }
    for (const p of found.integrity) await flag('integrity', `Frame ${p.frame} (${p.asset_id}): ${p.why}`);
    for (const v of found.variety) await flag('integrity', `Variety, frame ${v.frame}: ${v.why}`);
    if (preBuildFixed) {
      // The rewrite must not lose the voice: same lines → assemble re-paces from the voice already made;
      // different lines → voice them again (MD-58: a frame shorter than its voice cuts the line off).
      const voiced = fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8');
      await writeProject();
      if (!sameVoices(voiced, fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8'))) {
        await stage('voice');
        await voice();
      }
    }

    for (const w of planWarnings(plan, { draft, inventory })) await flag('integrity', `Plan: ${w}`);

    // MD-61: the sound designer plans the cues on the final voice timing (cues are word-anchored, so later
    // re-paces keep them in place). It fails open: its problems ship as warnings.
    if (deps.render.designSound) {
      await stage('sound_design');
      const sound = await deps.render.designSound({ projectDir, draft, plan }, ctx).catch((error) => ({ usd: 0, problems: [`the sound designer failed (${errorText(error)}); the kit keeps its default sound`], cues: null }));
      trace.soundCues = sound.cues !== undefined ? cueCount(sound.cues) : cueCount(readCues(projectDir));
      await settle('sound design');
      for (const p of sound.problems.filter((x) => !x.startsWith('warning:'))) await flag('render', `Sound design: ${p}`);
    }

    // P7: code compiles every frame from its blueprint.
    const plainFrames: number[] = [];
    let compiledFrames: CompileResult['frames'] = [];
    const flagOnce = async (check: JobFlag['check'], detail: string) => {
      if (flagged.has(detail)) return;
      flagged.add(detail);
      await flag(check, detail);
    };
    const compile = async (only?: number[]) => {
      await stage('compile');
      const done = await deps.render.compileReel({ plan, inventory, projectDir, plain: plainFrames, ...(only ? { only } : {}) });
      compiledFrames = done.frames;
      for (const p of done.problems) await flagOnce('render', `Compile: ${p}`);
    };
    const idOf = (n: number) => compiledFrames.find((f) => f.n === n)?.id ?? '';
    /**
     * Assembly's breakage, the plan check and each frame's own reports, by frame. Nothing is flagged here: the solver answers
     * what it can, and what the last measurement still finds ships as flags.
     */
    const measure = async (label: string): Promise<Measured> => {
      await stage('assemble');
      const result = await deps.render.assembleProject(projectDir);
      await keepText('breakage', { round: label, ...result });
      const byFrame = new Map<number, string[]>();
      const loose: string[] = [];
      const add = (n: number | null, line: string) => {
        if (n === null) loose.push(line);
        else byFrame.set(n, [...(byFrame.get(n) ?? []), line]);
      };
      for (const p of result.problems) add(problemFrame(p, compiledFrames), p);
      if (deps.render.readCompiled) {
        let read: CompiledRead;
        try {
          read = await deps.render.readCompiled(projectDir);
        } catch (error) {
          read = { ok: false, frames: {}, stills: [], skipped: errorText(error) };
        }
        if (!read.ok) await flagOnce('breakage', `The plan check could not run: ${read.skipped ?? 'no reading came back'}.`);
        else {
          for (const [key, f] of Object.entries(read.frames)) {
            const n = problemFrame(f.id ?? key, compiledFrames) ?? (Number.isFinite(Number(key)) ? Number(key) : null);
            for (const r of f.reports ?? []) add(n, `Frame ${n ?? key}: ${r}`);
          }
          for (const m of checkPlanCarried(plan, read.frames)) add(m.frame, planMissText(m));
        }
      }
      return { ok: result.ok, byFrame, loose };
    };
    /** A frame that won't build or draw at all ships as its first picture, plain and flagged; the solver may still rework it. */
    const measurePlain = async (label: string): Promise<Measured> => {
      let m = await measure(label);
      const dead = [...m.byFrame].filter(([n, lines]) => !plainFrames.includes(n) && lines.some((l) => DEAD_FRAME.test(l))).map(([n]) => n);
      if (dead.length) {
        plainFrames.push(...dead);
        await compile(dead);
        m = await measure(`${label}_plain`);
      }
      return m;
    };
    await compile();
    let measured = await measurePlain('compiled');

    // P8: render, then the contact sheet. Every round renders (free) and cuts its sheets from the video, so the reviewers and
    // the solver see what the viewer sees, captions included (Iteration 11 §3, pre-mortem #1).
    const renderAndSheet = async (retry: boolean) => {
      await stage('render');
      let video: string;
      try {
        video = await deps.render.renderVideo(projectDir);
      } catch (first) {
        await flag('render', `The render failed: ${errorText(first)}`);
        if (!retry) throw new ProductionFailure(`The render failed: ${errorText(first)}`);
        // A render costs nothing and everything before it was paid for: one more try before the reel is lost.
        try {
          video = await deps.render.renderVideo(projectDir);
        } catch (error) {
          await flag('render', `The second render failed too: ${errorText(error)}`);
          throw new ProductionFailure(`The render failed: ${errorText(error)}`);
        }
      }
      // The video exists now: nothing after this point may lose it.
      let sheet = '';
      try {
        sheet = await deps.render.contactSheet(projectDir, video);
      } catch (error) {
        await flag('render', `The contact sheet failed (${errorText(error)}); the reel ships without it.`);
      }
      return { video, sheet };
    };
    let { video, sheet } = await renderAndSheet(true);
    /** Set when a re-render failed: the reel ships the last video that rendered, and the picture work stops. */
    let frozen = false;
    /** A re-render after a change; a failure keeps the video before it (never block a reel). */
    const rerender = async (why: string): Promise<boolean> => {
      const saved = { video: `${video}.before${path.extname(video)}`, sheet: sheet ? `${sheet}.before${path.extname(sheet)}` : '' };
      fs.copyFileSync(video, saved.video);
      if (sheet) fs.copyFileSync(sheet, saved.sheet);
      try {
        ({ video, sheet } = await renderAndSheet(false));
        return true;
      } catch {
        ({ video, sheet } = saved);
        frozen = true;
        await flag('render', `The reel would not render after ${why}, so it ships the version from before it.`);
        return false;
      }
    };

    // Sheets of moments (Iteration 11 §2–§3): the reviewers and the solver read them; the first viewer reads unlabelled ones.
    const sheetsDir = path.join(jobDir, 'sheets');
    let cutRound = 0;
    const reviewSheets = new Map<number, Sheet[]>();
    const cut = async (frames: number[] | null, viewer: boolean): Promise<Sheet[]> => {
      if (!deps.render.reelSheets) return [];
      cutRound += 1;
      try {
        const made = await deps.render.reelSheets(projectDir, video, {
          findings: [...[...measured.byFrame.values()].flat(), ...measured.loose],
          dir: path.join(sheetsDir, `round-${cutRound}`),
          frames,
          viewer,
        });
        for (const n of new Set(made.review.map((s) => s.frame))) reviewSheets.set(n, made.review.filter((s) => s.frame === n));
        return made.viewer;
      } catch (error) {
        await flag('render', `Cutting the sheets failed (${errorText(error)}); the reviewers read what they had.`);
        return [];
      }
    };

    // C3: the first-time viewer on the whole reel, and the design reviewer on each frame's sheets (MD-129). The design review
    // fails open; unchanged frames keep their findings, and only changed frames are read again (pre-mortem #10).
    const designBy = new Map<number, DesignReview>();
    const designErrors: string[] = [];
    const designOf = (n: number) => designBy.get(n) ?? { problems: [], warnings: [], errors: [], usd: 0 };
    const designRead = async (frames: number[] | null) => {
      if (!deps.checks.checkDesign) return;
      const sheets = [...reviewSheets].filter(([n]) => !frames || frames.includes(n)).flatMap(([, s]) => s);
      if (!sheets.length) return;
      let review: DesignReview;
      try {
        review = await deps.checks.checkDesign({ sheets, plan, draft }, ctx);
      } catch (error) {
        review = { problems: [], warnings: [], errors: [errorText(error)], usd: 0 };
      }
      designErrors.push(...review.errors);
      for (const n of new Set(sheets.map((s) => s.frame))) {
        designBy.set(n, { problems: review.problems.filter((p) => p.frame === n), warnings: review.warnings.filter((p) => p.frame === n), errors: [], usd: 0 });
      }
    };
    const designAll = (): DesignReview => ({
      problems: [...designBy.values()].flatMap((d) => d.problems),
      warnings: [...designBy.values()].flatMap((d) => d.warnings),
      errors: [],
      usd: 0,
    });
    /** null: the first viewer didn't watch (no sheets, or it failed), which is no finding at all, never "no hook". */
    const viewerRead = async (sheets: Sheet[]): Promise<FirstViewerResult | null> => {
      if (!sheets.length) return null;
      try {
        return await deps.checks.checkFirstViewer({ sheets, captions: captionsFor(sheet, draft, plan), draft, facts }, ctx);
      } catch (error) {
        await flag('first_viewer', `The first viewer failed (${errorText(error)}); shipped without its read.`);
        return null;
      }
    };
    const storyFrames = () => plan.frames.filter((f) => f.treatment !== 'close').map((f) => f.n);

    const viewerSheets = await cut(null, true);
    await stage('first_viewer');
    let [viewer] = await Promise.all([viewerRead(viewerSheets), designRead(null)]);
    const route = (v: FirstViewerResult | null) => (v ? firstViewerRouting(v, settings.hook_seconds) : { picture: [] as string[], words: [] as string[] });
    let routed = route(viewer);
    await keepText('first_viewer', { round: 0, ...viewer, findings: routed.picture, script_findings: routed.words, design: designAll() });
    await settle('first viewer and design review');
    /** Frames whose picture changed since the first viewer last watched: the final read runs when there are any. */
    let changedSinceViewer = false;

    // Iteration 11 §4: the content pass. What's missing or mixed on the rendered frames (and the first viewer's picture findings)
    // goes to the director once, on `director_fix_model`; layout faults go straight to the solver.
    const content = contentPassProblems(routed.picture, designAll());
    if (content.length) {
      const named = [...new Set(content.map((p) => p.frame))].filter((n) => storyFrames().includes(n));
      let replanned = false;
      await stage('director');
      try {
        const fixed = await arrive(await deps.writing.directReel({ draft, inventory, facts, kitGuide: deps.render.kitGuide, fix: { kind: 'content_pass', plan, problems: content } }, ctx), 'content pass');
        plan = reconcilePlan(draft, mergeFrames(plan, fixed, named));
        await keepText('director_plan', plan);
        replanned = true;
      } catch (error) {
        await flag('first_viewer', `The content pass on frames ${named.join(', ')} failed (${errorText(error)}); the solver takes them as they are.`);
      }
      await settle('content pass');
      if (replanned) try {
        if (deps.render.makeAssets) await runMakes();
        fs.cpSync(harvestDir, ws.jobDir, { recursive: true });
        const voiced = fs.existsSync(path.join(projectDir, 'STORYBOARD.md')) ? fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8') : '';
        await writeProject();
        if (voiced && !sameVoices(voiced, fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8'))) {
          await stage('voice');
          await voice();
        }
        await compile(named);
        measured = await measurePlain('content_pass');
        if (await rerender('the content pass')) {
          changedSinceViewer = true;
          await cut(named, false);
          await stage('first_viewer');
          await designRead(named);
          await settle('design review after the content pass');
        }
      } catch (error) {
        // Only a runaway stops a job; anything else here leaves the render already made.
        if (error instanceof ProductionFailure) throw error;
        frozen = true;
        await flag('render', `The rebuild after the content pass failed (${errorText(error)}); the reel ships as first rendered.`);
      }
    }

    // Iteration 11 §5–§7: the problem solver. One reel-wide look, then up to two rounds on what's wrong or weak, each change
    // built, measured, rendered and re-read; every attempt is kept and the version with the fewest serious findings ships.
    const solved: { frame: number; label: string; kind: string; serious: number; flag: string | null }[] = [];
    if (deps.solver && !frozen) {
      await stage('solver');
      const solver = deps.solver(ctx, { projectDir, inventory });
      const storyboard = () => (fs.existsSync(path.join(projectDir, 'STORYBOARD.md')) ? fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8') : '');
      const spans = frameSpans(storyboard());
      const lineText = new Map(draft.rungs.flatMap((r) => r.lines.map((l) => [l.id, l] as const)));
      const frameOf = (n: number) => plan.frames.find((f) => f.n === n);
      const voiceOf = (n: number) => (frameOf(n)?.line_ids ?? []).map((id) => lineText.get(id)?.text ?? '').filter(Boolean).join(' ');
      const brief = solverBrief(draft, plan, facts, inventory);
      const findingsOf = (n: number): FrameFinding[] => [
        ...(measured.byFrame.get(n) ?? []).map((line) => measuredFinding(n, line)),
        ...[...designOf(n).problems, ...designOf(n).warnings].map(reviewFinding),
      ];
      const images = (n: number): SolverImage[] => (reviewSheets.get(n) ?? []).map((s, i, all) => ({ file: s.file, label: `Frame ${n}, sheet ${i + 1} of ${all.length}` }));
      const story = storyFrames();
      const aims = new Map<number, string>();
      const workFor = async (n: number): Promise<FrameWork> => {
        const span = spans.find((s) => s.number === n);
        let still: SolverImage | null = null;
        if (span && deps.render.fullStill) {
          const file = await deps.render.fullStill(video, (span.start + span.end) / 2, path.join(sheetsDir, `still-${n}-${cutRound}.jpg`)).catch(() => null);
          if (file) still = { file, label: `Frame ${n}, full size, at its middle` };
        }
        return {
          n,
          id: idOf(n),
          name: span?.name ?? '',
          voice: voiceOf(n),
          job: frameOf(n)?.purpose ?? '',
          duration: span ? Math.round((span.end - span.start) * 1000) / 1000 : 0,
          blueprint: frameOf(n)?.blueprint ?? null,
          findings: findingsOf(n),
          sheets: images(n),
          still,
          neighbours: [n - 1, n + 1].filter((m) => story.includes(m)).map((m) => ({ n: m, sheets: images(m) })),
          ...(aims.get(n) ? { aim: aims.get(n)! } : {}),
        };
      };
      /** The version each changed frame ships, installed; the plan follows a plan version, so a rewritten storyboard keeps it. */
      const settleFrames = async (frames: number[]) => {
        const swapped: number[] = [];
        for (const n of frames) {
          const s = settleFrame(projectDir, idOf(n), n);
          for (const p of s.problems) await flagOnce('render', `Solver: ${p}`);
          if (!s.chosen) continue;
          if (s.chosen.blueprint && s.chosen.kind !== 'code') plan = withBlueprint(plan, n, s.chosen.blueprint);
          if (s.swappedBack) swapped.push(n);
          const entry = { frame: n, label: s.chosen.label, kind: s.chosen.kind, serious: s.serious, flag: s.flag };
          const at = solved.findIndex((x) => x.frame === n);
          if (at >= 0) solved[at] = entry;
          else solved.push(entry);
        }
        return swapped;
      };
      /** After a round: re-check new pictures, measure, render, re-read the changed frames, record and settle (contract §5 Check). */
      const afterChange = async (attempts: FrameAttempt[], label: string) => {
        const built = attempts.filter((a) => a.built);
        if (!built.length) return;
        const changed = built.map((a) => a.frame);
        // The plan check reads each changed frame against the blueprint it now has.
        for (const a of built) {
          const v = readVersions(projectDir, a.id).find((x) => x.label === a.label);
          if (v?.blueprint && v.kind !== 'code') plan = withBlueprint(plan, a.frame, v.blueprint);
        }
        // Pre-mortem #8: a swapped picture is checked against its line again.
        const pictured = built.filter((a) => a.newPictures.length);
        const imageFindings = new Map<number, FrameFinding[]>();
        if (pictured.length) {
          await stage('integrity_check');
          const probe = { ...plan, frames: plan.frames.filter((f) => pictured.some((a) => a.frame === f.n)).map((f) => ({ ...f, asset_ids: pictured.find((a) => a.frame === f.n)!.newPictures })) };
          try {
            for (const p of (await deps.checks.checkIntegrity({ plan: probe, inventory, draft, facts }, ctx)).problems) {
              imageFindings.set(p.frame, [...(imageFindings.get(p.frame) ?? []), { frame: p.frame, from: 'review', item: 'nothing_missing', severity: 'problem', what: `the image check: ${p.asset_id}: ${p.why}` }]);
            }
          } catch (error) {
            await flagOnce('integrity', `The image check on the solver's new pictures failed (${errorText(error)}).`);
          }
          await settle(`image check after ${label}`);
        }
        measured = await measure(label);
        if (!(await rerender(`the solver's ${label}`))) {
          // The reel stopped rendering with this round in it: every frame it changed goes back to its version before.
          for (const a of built) recordFindings(projectDir, a.id, a.label, [{ frame: a.frame, from: 'build', what: 'the reel would not render with it' }]);
          await settleFrames(changed);
          return;
        }
        changedSinceViewer = true;
        await cut(changed, false);
        await stage('first_viewer');
        await designRead(changed);
        await settle(`design review after ${label}`);
        await stage('solver');
        for (const a of built) {
          recordFindings(projectDir, a.id, a.label, [...[...designOf(a.frame).problems, ...designOf(a.frame).warnings].map(reviewFinding), ...(imageFindings.get(a.frame) ?? [])]);
        }
        const swapped = await settleFrames(changed);
        if (swapped.length) {
          // A frame swapped back: the video must show the version that ships.
          measured = await measure(`${label}_settled`);
          if (await rerender(`swapping back frames ${swapped.join(', ')}`)) await cut(swapped, false);
        }
      };

      const look = await solverLook(
        { projectDir, brief, frames: story.map((n) => ({ n, id: idOf(n), name: spans.find((s) => s.number === n)?.name ?? '', voice: voiceOf(n), job: frameOf(n)?.purpose ?? '', sheets: images(n) })), findings: story.flatMap(findingsOf) },
        solver,
      );
      for (const v of look.verdicts) if (v.aim) aims.set(v.frame, v.aim);
      await keepText('solver', { step: 'look', ...look });
      for (const p of look.problems) await flagOnce('render', `Solver: ${p}`);
      await settle('solver look');
      const worked = new Set(look.work);
      const stillSerious = () => [...worked].filter((n) => (solved.find((s) => s.frame === n)?.serious ?? seriousFindings(findingsOf(n)).length) > 0);
      for (const round of [1, 2] as const) {
        if (frozen) break;
        const list = round === 1 ? look.work : stillSerious();
        if (!list.length) break;
        const frames: FrameWork[] = [];
        for (const n of list) frames.push(await workFor(n));
        const res = await solverRound({ projectDir, plan, brief, round, frames, inventoryIds: inventory.assets.map((a) => a.id) }, solver);
        await keepText('solver', { step: `round_${round}`, attempts: res.attempts, usd: res.usd });
        for (const p of res.problems) await flagOnce('render', `Solver: ${p}`);
        await settle(`solver round ${round}`);
        await afterChange(res.attempts, `r${round}`);
      }
      // The last resort (§7): a frame still serious after round 2 or at the limit tries its simplest clean version. Weak only never.
      const last = frozen
        ? []
        : lastResortFrames([...worked].map((n) => {
            const s = solved.find((x) => x.frame === n);
            return { frame: n, serious: s?.serious ?? seriousFindings(findingsOf(n)).length, kind: (s?.kind ?? 'compiled') as FrameVersion['kind'] };
          }));
      if (last.length) {
        const attempts: FrameAttempt[] = [];
        for (const n of last) attempts.push(await lastResort({ projectDir, plan, work: await workFor(n), allowed: brief.allowed }, solver.kit));
        for (const a of attempts) for (const p of a.problems) await flagOnce('render', `Solver: ${p}`);
        await afterChange(attempts, 'last');
      }
      for (const s of solved) {
        if (s.flag) await flagOnce('render', `Solver, frame ${s.frame}: ${s.flag}`);
        if (s.serious > 0) await flagOnce('render', `Solver, frame ${s.frame}: ships with ${s.serious} serious finding(s).`);
      }
      await keepText('solver', { step: 'shipped', frames: solved });
      await keepFile('solver', path.join(projectDir, 'assets', 'solved.json'), 'solved.json');
    }

    // The final read: the first viewer watches what ships, when anything changed since it last did.
    if (changedSinceViewer && !frozen) {
      await stage('first_viewer');
      const last = await viewerRead(await cut(null, true));
      // A final read that didn't happen leaves the last one standing.
      if (last) {
        viewer = last;
        routed = route(viewer);
      }
      await keepText('first_viewer', { round: 'final', ...viewer, findings: routed.picture, script_findings: routed.words, design: designAll() });
      await settle('final read');
    }
    // What still stands ships as flags: the last measurement, the reviewers' last read, the first viewer's last read.
    for (const lines of measured.byFrame.values()) for (const l of lines) await flagOnce('breakage', l);
    for (const l of measured.loose) await flagOnce('breakage', l);
    if (!measured.ok && !measured.loose.length && !measured.byFrame.size) await flagOnce('breakage', 'Assembly still reports a failure.');
    for (const e of designErrors) await flagOnce('first_viewer', `Design review failed; shipped without it: ${e}`);
    for (const f of routed.picture) await flag('first_viewer', f);
    for (const p of designAll().problems) await flag('first_viewer', `Design: ${designFindingText(p)}`);
    for (const f of routed.words) await flag('first_viewer', `Script: ${f}`);
    for (const w of viewer?.warnings ?? []) await flag('first_viewer', w);
    for (const w of designAll().warnings) await flag('first_viewer', `Design (taste): ${designFindingText(w)}`);

    // MD-81: a step that quietly did nothing gets one loud flag before delivery.
    for (const f of noOpFlags(trace, { central, cast, inventory })) await flag(f.check, f.detail);

    // P9: deliver — the files, the post text (MD-50), the reuse record (MD-45), the report.
    await stage('deliver');
    const videoKey = await keepFile('video', video, 'video.mp4');
    if (!videoKey) throw new ProductionFailure('The render produced no video file.');
    const sheetKey = await keepFile('contact_sheet', sheet, `contact-sheet${path.extname(sheet) || '.png'}`);
    const used = usedAssets(plan, inventory);
    let post: PostText | null = null;
    try {
      post = await deps.writing.writePost({ draft, facts, inventory, usedAssetIds: used.map((u) => u.asset.id) }, ctx);
      await keepText('post_text', post);
    } catch (error) {
      await flag('story', `The post text failed (${errorText(error)}); the reel is delivered without it.`);
    }
    await settle('post text');
    try {
      await deps.harvest.recordUses(
        db,
        job.id,
        used.map((u) => ({ assetKey: assetKey(u.asset, job.id), purpose: `frame ${u.frame.n}: ${u.frame.purpose}`, characterImage: u.asset.character_image || isLogo(u.asset) })),
      );
    } catch (error) {
      await flag('harvest', `Recording which pictures this reel used failed (${errorText(error)}); the 20-day rule won't see them.`);
    }
    const { rows: unknownParts } = await db.query<{ component: string }>(
      'SELECT DISTINCT component FROM reel_ai_drama.cost_events WHERE job_id = $1 AND usd_known = false ORDER BY component',
      [job.id],
    );
    const { rows: flagRows } = await db.query<{ flags: unknown }>('SELECT flags FROM reel_ai_drama.jobs WHERE id = $1', [job.id]);
    const report: DeliveryReport = {
      job_id: job.id,
      video: videoKey,
      contact_sheet: sheetKey,
      seconds: deps.render.videoSeconds ? await deps.render.videoSeconds(video).catch(() => null) : null,
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
  }
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The sound designer's cues written to the project (CUES_FILE), or null when there is none. */
function readCues(projectDir: string): SoundCues | null {
  try {
    return JSON.parse(fs.readFileSync(path.join(projectDir, CUES_FILE), 'utf8')) as SoundCues;
  } catch {
    return null;
  }
}
const cueCount = (c: SoundCues | null | undefined) => (c ? (c.music?.length ?? 0) + (c.stingers?.length ?? 0) + (c.ambience?.length ?? 0) : 0);

/** The kit's caption transcript beside the contact sheet when it wrote one, else the script's words. */
function captionsFor(sheet: string, draft: WriterDraft, plan: DirectorPlan): string {
  for (const file of [sheet.replace(/\.[a-z0-9]+$/i, '.txt'), path.join(path.dirname(sheet), 'captions.txt')]) {
    if (file !== sheet && fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return captionsText(draft, plan);
}
