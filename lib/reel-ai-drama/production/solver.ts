import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { blueprintTreatment } from '@/explainers/reel-ai-drama/kit/project-files.mjs';
import { eventsFileProblems, solvedSourceProblems } from '@/explainers/reel-ai-drama/kit/try.mjs';
import { parseFrames } from '@/explainers/reel-ai-drama/kit/frames.mjs';
import { cachedSystemText, ephemeralCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages, ratesForModel, usageBucketsFromMessage, type MessageUsageLike } from '@/lib/anthropic-pricing';
import { recordCost } from '@/lib/reel-ai-drama/cost';
import { HYPERFRAMES_ENV } from '@/lib/explainers/render/workspace';
import { compileReel, normalBlueprint, plainBlueprint, readSolved, SOLVED_DIR, SOLVED_FILE, type SolvedEntry, type SolvedIndex } from '@/lib/reel-ai-drama/render/compile';
import { jsonOut, tail, type RunResult, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { blueprintAssets, type Blueprint, type DirectorPlan, type MakeRequest, type VisualsInventory } from '@/lib/reel-ai-drama/types';
import { section, type Effort, type Ledger, type SendMessage, type SubmitParams, type SubmitTool } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_FRAME_TOOL, SUBMIT_LOOK_TOOL } from '@/lib/reel-ai-drama/writing/schemas';

/**
 * The problem solver (Iteration 11 contract §5–§7; replaces production/creative.ts). It looks at every frame of the rendered
 * reel once, then reworks each weak, wrong or seriously faulted frame in up to two rounds, and keeps every attempt so the
 * version with the fewest serious findings ships. A frame it can't fix takes the last resort, `plainBlueprint`.
 *
 * What runs where. The model calls are here. Building, trying and measuring a frame go through `SolverKit` (the kit's
 * compile, try.mjs, bounds/screen and compiled-read, free). Rendering the reel, cutting sheets and the reviewers belong to the
 * run: between rounds it renders, reviews the frames that changed, and hands their findings back with `recordFindings`;
 * `settleFrame` then installs the best version.
 *
 * Caching (docs/prompt-caching.md): tools → system → messages. The system is the role prompt, the kit guide and the solver's
 * kit notes, one block marked 1h: identical for every frame call (and its own prefix for the look). In a frame call the
 * script and the pictures described are the first user block, also marked 1h, byte-identical across frames and rounds; the
 * frame's own data follows. A retry marks its last block 5m. The first frame call of a round runs alone so the rest read a
 * warm cache.
 *
 * Fails open: a failure of any kind leaves the frame's last good version, and a problem line the run flags.
 */

// ── Types (contract §5) ─────────────────────────────────────────────────────────────────────────────

export type LookVerdict = { frame: number; verdict: 'strong' | 'weak' | 'wrong'; because: string; aim?: string };
export type FrameChange =
  | { kind: 'plan'; blueprint: Blueprint; makes?: MakeRequest[] }
  | { kind: 'code'; module: string; events: unknown[] };
export type SolverSubmit = { frame: number; diagnosis: string; approach: string; change: FrameChange };

/** One finding on one frame, from a reviewer, a measured check, the build or the words check. */
export type FrameFinding = { frame: number; from: 'review' | 'measured' | 'build' | 'words'; item?: string; severity?: 'problem' | 'warning'; what: string };

/** One version of a frame, kept on disk (`assets/solver/versions/<id>/<label>.json`). `v0` is the frame as compiled. */
export type FrameVersion = {
  label: string;
  /** Order of making; the latest wins a tie. */
  seq: number;
  /** 0 compiled, 1 and 2 the solver's rounds, 3 the last resort. */
  round: 0 | 1 | 2 | 3;
  kind: 'compiled' | 'plan' | 'code' | 'plain';
  built: boolean;
  usd: number;
  /** The storyboard treatment this version needs (a plan change can move a frame on or off the whiteboard). */
  treatment: string;
  /** What code found when it was built (measured checks, the words check, or why it didn't build). */
  findings: FrameFinding[];
  /** What the reviewers found on it after the render; null until the run records them. */
  review: FrameFinding[] | null;
  pictures: string[];
  submit?: SolverSubmit;
  blueprint?: Blueprint;
  /** On `v0`: the texts the frame showed as compiled, which the words check takes as already stated. */
  words?: string[];
};

export type SolverKit = {
  /** Compile frame `n` of `plan` into `assets/frames`, even when `assets/solved.json` lists it. Returns compile problems. */
  compileFrame(plan: DirectorPlan, n: number): Promise<string[]>;
  /** try.mjs on one frame id: its errors. Timed out, it reports that (pre-mortem #4). */
  tryFrame(id: string): Promise<string[]> | string[];
  /** The measured checks (bounds, screen) on one frame id: their error lines. */
  measureFrame(id: string): Promise<string[]> | string[];
  /** Every text the frame shows while it plays (compiled-read.mjs `words`). */
  readWords(id: string): Promise<string[]> | string[];
  /** Make the drawings a plan change orders, adding them to the project's inventory. Returns problems; absent, none can be ordered. */
  makeAssets?(makes: MakeRequest[], frame: number): Promise<string[]>;
};

export type SolverModels = { look: string; first: string; second: string };

export type SolverDeps = Ledger & {
  create: SendMessage;
  /** The kit guide, kit/FRAME.md (render/index.ts `KIT_GUIDE`). */
  kitGuide: string;
  models: SolverModels;
  /** `solver_limit_usd`: covers the look and both rounds. */
  limitUsd: number;
  kit: SolverKit;
  /** Default: the files in explainers/reel-ai-drama/prompts. */
  loadPrompt?: (name: 'solver-look' | 'solver-frame') => string;
  /** A picture for the model. Default: read the file, its media type from the extension. */
  readImage?: (file: string) => Promise<{ data: string; media_type: ImageType }> | { data: string; media_type: ImageType };
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

type ImageType = 'image/jpeg' | 'image/png' | 'image/webp';

/** A labelled picture the model sees: a sheet of moments, or a full-size still. */
export type SolverImage = { file: string; label: string };

/** What every call shares about the reel. Stable across frames and rounds, so it caches. */
export type ReelBrief = {
  /** The script, as the viewer hears it, frame by frame. */
  script: string;
  /** Every picture available, described (`describePictures`). */
  pictures: string;
  /** The words the reel already states (script, on-screen lines, facts, credits): the words check's allowed list. */
  allowed: string;
};

export type LookFrame = { n: number; id: string; name: string; voice: string; job: string; sheets: SolverImage[] };
export type LookResult = { verdicts: LookVerdict[]; work: number[]; usd: number; problems: string[] };

/** One frame to rework. */
export type FrameWork = {
  n: number;
  id: string;
  name: string;
  voice: string;
  job: string;
  duration: number;
  blueprint: Blueprint | null;
  findings: FrameFinding[];
  sheets: SolverImage[];
  still: SolverImage | null;
  neighbours: { n: number; sheets: SolverImage[] }[];
  /** The look's aim for it, when it gave one. */
  aim?: string;
};

export type FrameAttempt = {
  frame: number;
  id: string;
  label: string;
  built: boolean;
  kind: 'plan' | 'code' | null;
  usd: number;
  findings: FrameFinding[];
  /** Pictures the attempt shows that the frame's last good version didn't: the image check re-runs on them (pre-mortem #8). */
  newPictures: string[];
  problems: string[];
  /** Not tried: the limit, or this round already ran for it before a restart. */
  skipped?: 'limit' | 'done';
};

// ── Settings ────────────────────────────────────────────────────────────────────────────────────────

/** The per-call output ceiling (pre-mortem #12): a call never gets more room than this. */
export const SOLVER_MAX_TOKENS = { look: 16_000, frame: 32_000 } as const;
/** The worst case an image can cost, in input tokens (a large, high-resolution picture). */
export const IMAGE_TOKENS_MAX = 4_800;
/** Frames whose models run at once; applying and measuring run one at a time (pre-mortem #14). */
export const SOLVER_PARALLEL = 3;
const LOOK_EFFORT: Effort = 'medium';
const FRAME_EFFORT: Effort = 'high';

export const SOLVER_STATE_DIR = path.join('assets', 'solver');

// ── Serious findings and the version that ships (contract §7) ──────────────────────────────────────

/** A reviewer `problem` on these is serious. */
export const SERIOUS_REVIEW_ITEMS = ['off_edge', 'readable_text', 'nothing_missing', 'clean_cutouts'] as const;
/** A measured line tagged with these is serious. `new_words` is the solver's words check (pre-mortem #7). */
export const SERIOUS_MEASURED = ['off_frame', 'mark_on_nothing', 'opening_unformed', 'keep_covered', 'new_words'] as const;

export function isSerious(f: FrameFinding): boolean {
  if (f.from === 'build') return true;
  if (f.from === 'review') return f.severity === 'problem' && (SERIOUS_REVIEW_ITEMS as readonly string[]).includes(f.item ?? '');
  const tag = f.item ?? /\[(\w+)\]/.exec(f.what)?.[1] ?? '';
  return (SERIOUS_MEASURED as readonly string[]).includes(tag);
}

/** The serious ones, in the order given. Pure. */
export function seriousFindings(findings: readonly FrameFinding[]): FrameFinding[] {
  return findings.filter(isSerious);
}

/** A measured check's line as a finding: its `[tag]` is the item. Pure. */
export function measuredFinding(frame: number, line: string): FrameFinding {
  const item = /\[(\w+)\]/.exec(line)?.[1];
  return { frame, from: 'measured', ...(item ? { item } : {}), what: line };
}

/** A design-review finding (checks/design.ts `DesignFinding`) as a finding. Pure. */
export function reviewFinding(f: { frame: number; item: string; severity: 'problem' | 'warning'; what: string }): FrameFinding {
  return { frame: f.frame, from: 'review', item: f.item, severity: f.severity, what: f.what };
}

const seriousCount = (v: FrameVersion) => seriousFindings([...v.findings, ...(v.review ?? [])]).length;

/**
 * Which version ships: the fewest serious findings, ties to the latest. A version that didn't build never ships. The last
 * resort (`plain`) ships only with strictly fewer than the best other version. Shipping anything but the latest attempt is a
 * swap back, always flagged. Pure.
 */
export function chooseVersion(versions: readonly FrameVersion[]): { chosen: FrameVersion | null; serious: number; swappedBack: boolean; flag: string | null } {
  const built = versions.filter((v) => v.built);
  if (!built.length) return { chosen: null, serious: 0, swappedBack: false, flag: null };
  const best = (vs: readonly FrameVersion[]) => vs.reduce<FrameVersion | null>((b, v) => (!b || seriousCount(v) < seriousCount(b) || (seriousCount(v) === seriousCount(b) && v.seq > b.seq) ? v : b), null);
  const others = best(built.filter((v) => v.kind !== 'plain'));
  const plain = best(built.filter((v) => v.kind === 'plain'));
  const chosen = !others || (plain && seriousCount(plain) < seriousCount(others)) ? plain! : others;
  const latest = versions.reduce((a, v) => (v.seq > a.seq ? v : a));
  const swappedBack = chosen.seq !== latest.seq;
  const n = seriousCount(chosen);
  const flag =
    chosen.kind === 'plain'
      ? `last resort: it shows its simplest version, with ${n} serious finding(s) against ${others ? seriousCount(others) : 'no'} for its best other version`
      : swappedBack
        ? `swapped back to ${chosen.label} (${n} serious finding(s)); ${latest.label} ${latest.built ? `had ${seriousCount(latest)}` : "didn't build"}`
        : null;
  return { chosen, serious: n, swappedBack, flag };
}

/** The frames that take the last resort: serious findings on the version that ships. A frame that's only weak never does. Pure. */
export function lastResortFrames(shipped: readonly { frame: number; serious: number; kind: FrameVersion['kind'] }[]): number[] {
  return shipped.filter((s) => s.serious > 0 && s.kind !== 'plain').map((s) => s.frame);
}

// ── Spend (contract §5, pre-mortem #12) ─────────────────────────────────────────────────────────────

const usdOf = (messages: readonly Anthropic.Message[], model: string) => (messages.length ? Number(priceAnthropicMessages(messages as unknown as MessageUsageLike[], { modelId: model }).costUsd) : 0);

/**
 * The most a call can cost: every input token as a 1h cache write (the dearest input), each image at its largest, and the
 * whole output ceiling. Text is counted at 3 characters a token, which overcounts. Pure.
 */
export function worstCaseUsd(params: SubmitParams): number {
  let chars = 0;
  let images = 0;
  const walk = (v: unknown): void => {
    if (typeof v === 'string') chars += v.length;
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      if (o.type === 'image') { images += 1; return; }
      for (const [k, x] of Object.entries(o)) if (k !== 'cache_control') walk(x);
    }
  };
  walk(params.system);
  walk(params.tools);
  walk(params.messages);
  const rates = ratesForModel(params.model);
  const input = Math.ceil(chars / 3) + images * IMAGE_TOKENS_MAX;
  return (input * rates.inputPerMtokUsd * 2 + params.max_tokens * rates.outputPerMtokUsd) / 1_000_000;
}

/** The limit's ledger, on disk so a restart doesn't reset it (pre-mortem #16). */
export class SpendGuard {
  constructor(
    readonly limitUsd: number,
    private spentUsd = 0,
    private readonly file: string | null = null,
  ) {}

  static load(projectDir: string, limitUsd: number): SpendGuard {
    const file = path.join(projectDir, SOLVER_STATE_DIR, 'spend.json');
    let spent = 0;
    try {
      spent = Number((JSON.parse(fs.readFileSync(file, 'utf8')) as { spent?: number }).spent) || 0;
    } catch {
      spent = 0;
    }
    return new SpendGuard(limitUsd, spent, file);
  }

  get spent(): number {
    return this.spentUsd;
  }

  /** Worst cases of calls in flight: parallel calls can't each take the same headroom. */
  private heldUsd = 0;

  /** Spend so far, the calls in flight and this call's worst case fit the limit. */
  fits(worstUsd: number): boolean {
    return this.spentUsd + this.heldUsd + worstUsd <= this.limitUsd + 1e-9;
  }

  /** Hold a call's worst case while it runs; false (and nothing held) when it doesn't fit. */
  hold(worstUsd: number): boolean {
    if (!this.fits(worstUsd)) return false;
    this.heldUsd += worstUsd;
    return true;
  }

  release(worstUsd: number): void {
    this.heldUsd = Math.max(0, this.heldUsd - worstUsd);
  }

  add(usd: number): void {
    this.spentUsd += Number.isFinite(usd) && usd > 0 ? usd : 0;
    if (!this.file) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      fs.writeFileSync(this.file, `${JSON.stringify({ spent: Math.round(this.spentUsd * 1e6) / 1e6 })}\n`);
    } catch {
      // The ledger in the database still has it.
    }
  }
}

export class SpendLimitError extends Error {
  constructor(readonly worstUsd: number, readonly spentUsd: number, readonly limitUsd: number) {
    super(`the solver's limit: $${spentUsd.toFixed(2)} spent, and this call could cost $${worstUsd.toFixed(2)} of $${limitUsd.toFixed(2)}`);
    this.name = 'SpendLimitError';
  }
}

// ── Prompts and the kit notes ───────────────────────────────────────────────────────────────────────

const PROMPTS = path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'prompts');
const promptCache = new Map<string, string>();
/** A solver prompt, read once per process so the cached prefix keeps its bytes. */
export function loadSolverPrompt(name: 'solver-look' | 'solver-frame'): string {
  const hit = promptCache.get(name);
  if (hit !== undefined) return hit;
  const text = fs.readFileSync(path.join(PROMPTS, `${name}.md`), 'utf8').trim();
  promptCache.set(name, text);
  return text;
}

/**
 * What the kit guide (kit/FRAME.md) doesn't yet say and the solver needs: `place`, and the contract a frame's own code
 * follows. It travels with the kit guide in the cached system prefix. Integration may move it into FRAME.md.
 */
export const SOLVER_KIT_NOTES = `## For the problem solver: exact geometry and frame code

### \`place\`
A piece may carry \`place: { x, y, w, rotate, z }\`, in px on the 1080x1920 frame. It is the box of what shows of the picture (a cutout's empty margin isn't part of it): its top-left corner at \`x\`, \`y\`, its width \`w\`; its height follows the picture's shape. \`rotate\` is degrees and \`z\` its depth, higher in front. This is the one exception to the rule that a blueprint never gives a position or a size. A placed piece stays exactly there, and code lays every other piece out around it. Code guarantees nothing about a placed piece; the measured checks report on it like any other, so keep it to § Layout's zones.

### Frame code
A frame replaced with code is one ES module with its sound list:
- It imports only from \`../kit/\`. Its default export is \`{ treatment, build(root, ctx), render(t) }\`, and \`treatment\` is the frame's storyboard treatment, given with the frame.
- \`build\` makes the frame's DOM once, inside \`root\`, with \`root.ownerDocument\` and the kit: \`ctx.nk\` holds the components and helpers this guide names. \`ctx\` is \`{ id, duration, treatment, timing: { words, lines }, media, objects, nk, assets }\`; \`ctx.media[id]\` is a picture's record, its \`file\` under the project.
- \`render(t)\` sets every visible state from the frame's time \`t\` alone, so the same \`t\` always draws the same picture whatever was drawn before. It never reads a clock or randomness, schedules work, uses CSS or Web animation, loads from the network, applies an SVG filter, or sets \`visibility\` to \`visible\` (set \`''\` to show).
- Every found picture on screen shows its credit (\`nk.credit\`).
- \`events\` is the frame's sounds: \`{ t, kind, what, dur, shown }\` each, \`t\` in seconds from the frame's start, with the kinds and rules of § Sound. Every frame has at least its place's ambience.
Code loads the module in a browser, plays it through, and measures it like every other frame.`;

const systemFor = (prompt: string, kitGuide: string) => `${prompt}\n\n---\n\n${kitGuide.trim()}\n\n${SOLVER_KIT_NOTES}`;

// ── The conversation ────────────────────────────────────────────────────────────────────────────────

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const one = (v: unknown) => String(v ?? '').replace(/\s+/g, ' ').trim();

type Turn<T> = { value: T | null; usd: number; problems: string[] };

async function recordCall(ledger: Ledger, component: string, model: string, message: Anthropic.Message): Promise<number> {
  const usd = usdOf([message], model);
  const b = usageBucketsFromMessage(message as unknown as MessageUsageLike);
  await recordCost(ledger.db, {
    jobId: ledger.jobId ?? null,
    sessionId: ledger.sessionId ?? null,
    pitchId: ledger.pitchId ?? null,
    mode: ledger.mode,
    vendor: 'anthropic',
    component,
    inputTokens: b.uncachedInputTokens,
    outputTokens: b.outputTokens,
    cacheReadTokens: b.cacheReadInputTokens,
    cacheWriteTokens: b.cacheCreation5mInputTokens + b.cacheCreation1hInputTokens,
    usd,
  }).catch(() => undefined);
  return usd;
}

/** The messages with a 5m breakpoint on the last block, keeping any marked earlier (the shared 1h block). */
function markLast(messages: Anthropic.MessageParam[]): Anthropic.MessageParam[] {
  if (messages.length < 2) return messages;
  const last = messages[messages.length - 1]!;
  const blocks = typeof last.content === 'string' ? [{ type: 'text' as const, text: last.content }] : last.content;
  if (!blocks.length) return messages;
  const marked = blocks.map((b, i) => (i === blocks.length - 1 ? { ...b, cache_control: ephemeralCache('5m') } : b));
  return [...messages.slice(0, -1), { ...last, content: marked as Anthropic.ContentBlockParam[] }];
}

/**
 * Ask until the tool is called with input `check` accepts. `check` returns the problems the model must answer (parsing, and for
 * a frame, building it); one more turn answers them in the same conversation, and a turn that ends without the call takes
 * that turn too. Before each call its worst case must fit the limit, or it doesn't run.
 */
async function converse<T>(
  deps: SolverDeps,
  guard: SpendGuard,
  req: { component: string; model: string; system: string; tool: SubmitTool; user: Anthropic.ContentBlockParam[]; maxTokens: number; effort: Effort },
  check: (input: unknown) => Promise<{ value: T | null; problems: string[] }>,
  retries = 1,
): Promise<Turn<T>> {
  const messages: Anthropic.MessageParam[] = [{ role: 'user', content: req.user }];
  let usd = 0;
  let left = retries;
  let problems: string[] = [];
  for (;;) {
    const params: SubmitParams = {
      model: req.model,
      max_tokens: req.maxTokens,
      tools: [req.tool] as unknown as Anthropic.Tool[],
      tool_choice: { type: 'auto' },
      system: cachedSystemText(req.system),
      messages: markLast(messages),
      output_config: { effort: req.effort },
    };
    const worst = worstCaseUsd(params);
    if (!guard.hold(worst)) throw Object.assign(new SpendLimitError(worst, guard.spent, guard.limitUsd), { usd });
    let message: Anthropic.Message;
    try {
      message = await deps.create(params);
    } catch (e) {
      guard.release(worst);
      throw Object.assign(new Error(`${req.component}: ${errorText(e)}`), { usd });
    }
    const spent = await recordCall(deps, req.component, message.model || req.model, message);
    usd += spent;
    guard.add(spent);
    guard.release(worst);
    if (message.stop_reason === 'max_tokens') return { value: null, usd, problems: [`${req.component}: the turn hit the ${req.maxTokens}-token ceiling before submitting`] };
    if (message.stop_reason === 'refusal') return { value: null, usd, problems: [`${req.component}: the model declined`] };
    messages.push({ role: 'assistant', content: message.content as unknown as Anthropic.ContentBlockParam[] });
    const call = message.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use' && b.name === req.tool.name);
    if (!call) {
      problems = [`${req.component}: the turn ended without calling ${req.tool.name}`];
      if (left-- <= 0) return { value: null, usd, problems };
      messages.push({ role: 'user', content: `Submit your work by calling ${req.tool.name} now.` });
      continue;
    }
    let checked: { value: T | null; problems: string[] };
    try {
      checked = await check(call.input);
    } catch (e) {
      checked = { value: null, problems: [`it could not be checked (${errorText(e)})`] };
    }
    if (checked.value !== null && !checked.problems.length) return { value: checked.value, usd, problems: [] };
    problems = checked.problems.length ? checked.problems : ['the submission could not be read'];
    if (left-- <= 0) return { value: null, usd, problems };
    messages.push({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Not accepted. Answer every problem below and call ${req.tool.name} again with the whole change:\n- ${problems.join('\n- ')}` }],
    });
  }
}

// ── What the model sees ─────────────────────────────────────────────────────────────────────────────

/** Every picture available, described: what it shows, its kind and shape, and who made it. Pure. */
export function describePictures(inventory: Pick<VisualsInventory, 'assets'> | null | undefined): string {
  const lines = (inventory?.assets ?? []).map((a) => {
    const shape = a.width > 0 && a.height > 0 ? `${a.width}x${a.height}` : '';
    const traits = [a.kind, shape, a.made ? `made${a.made_kind ? ` (${a.made_kind})` : ''}` : '', a.people?.length ? `people: ${a.people.join(', ')}` : '', a.regions?.cut ? `cutout, ${a.regions.cut.grade}` : ''].filter(Boolean).join('; ');
    return `- ${a.id} (${traits}): ${one(a.shows)}${a.credit ? ` Credit: ${one(a.credit)}.` : ''}`;
  });
  return lines.join('\n') || '(none)';
}

async function imageBlocks(deps: SolverDeps, images: readonly SolverImage[], problems: string[]): Promise<Anthropic.ContentBlockParam[]> {
  const read =
    deps.readImage ??
    ((file: string) => ({ data: fs.readFileSync(file).toString('base64'), media_type: (/\.png$/i.test(file) ? 'image/png' : /\.webp$/i.test(file) ? 'image/webp' : 'image/jpeg') as ImageType }));
  const out: Anthropic.ContentBlockParam[] = [];
  for (const img of images) {
    try {
      const { data, media_type } = await read(img.file);
      out.push({ type: 'text', text: img.label }, { type: 'image', source: { type: 'base64', media_type, data } });
    } catch (e) {
      problems.push(`${img.label}: the picture could not be read (${errorText(e)})`);
    }
  }
  return out;
}

const findingLines = (fs_: readonly FrameFinding[]) => (fs_.length ? fs_.map((f) => `- ${isSerious(f) ? '[serious] ' : ''}${f.from}${f.item ? ` ${f.item}` : ''}: ${one(f.what)}`).join('\n') : '(none)');

// ── The look ────────────────────────────────────────────────────────────────────────────────────────

const VERDICT_RANK: Record<LookVerdict['verdict'], number> = { wrong: 2, weak: 1, strong: 0 };

/** The look's verdicts, checked: one for every frame, `because` on all, `aim` on weak and wrong. Pure. */
export function parseLook(raw: unknown, frames: readonly number[]): { value: LookVerdict[] | null; problems: string[] } {
  const list = (raw as { verdicts?: unknown } | null)?.verdicts;
  if (!Array.isArray(list)) return { value: null, problems: ['submit { verdicts: [...] } with a verdict for every frame'] };
  const problems: string[] = [];
  const out = new Map<number, LookVerdict>();
  for (const v of list as Record<string, unknown>[]) {
    const frame = Number(v?.frame);
    const verdict = v?.verdict as LookVerdict['verdict'];
    if (!frames.includes(frame)) { problems.push(`there is no frame ${String(v?.frame)} to judge`); continue; }
    if (!(verdict in VERDICT_RANK)) { problems.push(`frame ${frame}: the verdict is strong, weak or wrong`); continue; }
    if (out.has(frame)) { problems.push(`frame ${frame} has two verdicts`); continue; }
    const because = one(v.because);
    const aim = one(v.aim);
    if (!because) problems.push(`frame ${frame}: \`because\` is required`);
    if (verdict !== 'strong' && !aim) problems.push(`frame ${frame}: \`aim\` is required on ${verdict}`);
    out.set(frame, { frame, verdict, because, ...(verdict !== 'strong' && aim ? { aim } : {}) });
  }
  const missing = frames.filter((n) => !out.has(n));
  if (missing.length) problems.push(`no verdict for frame ${missing.join(', ')}: every frame gets one`);
  return { value: [...out.values()].sort((a, b) => a.frame - b.frame), problems };
}

/** Every weak or wrong frame and every frame with a serious finding, worst first. Pure. */
export function workList(verdicts: readonly LookVerdict[], findings: readonly FrameFinding[], frames: readonly number[]): number[] {
  const serious = (n: number) => seriousFindings(findings.filter((f) => f.frame === n)).length;
  const rank = (n: number) => VERDICT_RANK[verdicts.find((v) => v.frame === n)?.verdict ?? 'strong'];
  return frames
    .filter((n) => rank(n) > 0 || serious(n) > 0)
    .sort((a, b) => Math.max(rank(b), serious(b) ? 2 : 0) - Math.max(rank(a), serious(a) ? 2 : 0) || serious(b) - serious(a) || rank(b) - rank(a) || a - b);
}

/**
 * One reel-wide look on `models.look`. Fails open: without verdicts the work list is the frames with serious findings. The
 * result is kept in `assets/solver/look.json`, so a restarted job doesn't look again (pre-mortem #16).
 */
export async function solverLook(
  input: { projectDir: string; brief: ReelBrief; frames: LookFrame[]; findings: FrameFinding[] },
  deps: SolverDeps,
): Promise<LookResult> {
  const numbers = input.frames.map((f) => f.n);
  const file = path.join(input.projectDir, SOLVER_STATE_DIR, 'look.json');
  try {
    const kept = JSON.parse(fs.readFileSync(file, 'utf8')) as LookResult;
    if (Array.isArray(kept.verdicts) && Array.isArray(kept.work)) return { ...kept, usd: 0, problems: [] };
  } catch {
    // None yet.
  }
  const fallback = (problem: string, usd = 0): LookResult => ({ verdicts: [], work: workList([], input.findings, numbers), usd, problems: [problem] });
  const guard = SpendGuard.load(input.projectDir, deps.limitUsd);
  const problems: string[] = [];
  try {
    const user: Anthropic.ContentBlockParam[] = [{ type: 'text', text: [section('The script', input.brief.script), section('Pictures available', input.brief.pictures)].join('\n\n') }];
    for (const f of input.frames) {
      const mine = input.findings.filter((x) => x.frame === f.n);
      user.push({ type: 'text', text: section(`Frame ${f.n}: ${f.name}`, [`Voice: "${one(f.voice)}"`, `Job: ${one(f.job)}`, `What the checks found:\n${findingLines(mine)}`].join('\n')) });
      user.push(...(await imageBlocks(deps, f.sheets, problems)));
    }
    const turn = await converse<LookVerdict[]>(
      deps,
      guard,
      { component: 'solver_look', model: deps.models.look, system: systemFor((deps.loadPrompt ?? loadSolverPrompt)('solver-look'), deps.kitGuide), tool: SUBMIT_LOOK_TOOL, user, maxTokens: SOLVER_MAX_TOKENS.look, effort: LOOK_EFFORT },
      async (raw) => parseLook(raw, numbers),
    );
    if (!turn.value) return fallback(`the look failed (${turn.problems.join('; ')}); the frames with serious findings are reworked`, turn.usd);
    const result: LookResult = { verdicts: turn.value, work: workList(turn.value, input.findings, numbers), usd: turn.usd, problems };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(result, null, 1)}\n`);
    return result;
  } catch (e) {
    return fallback(`the look failed (${errorText(e)}); the frames with serious findings are reworked`, (e as { usd?: number }).usd ?? 0);
  }
}

// ── A submission ────────────────────────────────────────────────────────────────────────────────────

const PLAIN_GROUNDS = new Set(['charcoal', 'kraft', 'whiteboard']);

/** Name, number and date tokens in text: capitalised words and figures, normalised. */
function tokens(text: string): { raw: string; key: string }[] {
  return [...String(text).matchAll(/[\p{Lu}][\p{L}'’-]*|\d[\d,.]*\d|\d/gu)].map((m) => ({ raw: m[0], key: wordKey(m[0]) })).filter((t) => t.key);
}
function wordKey(w: string): string {
  const s = w.toLowerCase().replace(/['’]s$/, '').replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  return /^\d[\d,.]*$/.test(s) ? s.replace(/,/g, '').replace(/\.$/, '') : s;
}
function knownWords(text: string): Set<string> {
  return new Set([...String(text).matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’,.-]*/gu)].map((m) => wordKey(m[0])).flatMap((k) => [k, ...k.split(/[-.]/)]).filter(Boolean));
}

/** The words the kit itself puts in a credit line around a picture's credit. */
const CREDIT_WORDS = 'Photo Illustration Logo Drawing Map Helios Wikimedia Commons Wikipedia public domain via';

/** The credits in `describePictures` text: a picture's own credit is never a new word. Pure. */
export function creditsIn(pictures: string): string {
  return [...String(pictures).matchAll(/ Credit: (.*)\.$/gm)].map((m) => m[1]).join('\n');
}

/** Names, numbers and dates on screen that the reel doesn't already state (HARD CONSTRAINT 2). Pure. */
export function newWords(shown: readonly string[], allowed: string): string[] {
  const known = knownWords(allowed);
  const out = new Set<string>();
  for (const text of shown) for (const t of tokens(text)) if (!known.has(t.key)) out.add(t.raw);
  return [...out];
}

/** The words a blueprint puts on screen. Pure. */
function blueprintWords(b: Blueprint): string[] {
  const texts: string[] = [b.hook?.text ?? '', ...b.labels.flatMap((l) => [l.text, l.sub ?? '']), ...b.speech.map((s) => s.text), ...b.pieces.flatMap((p) => [p.label ?? '', p.note ?? ''])];
  const walk = (v: unknown): void => {
    if (typeof v === 'string') texts.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) if (!['asset', 'assets', 'kind', 'tone', 'id'].includes(k)) walk(x);
  };
  for (const p of b.pieces) walk(p.opts);
  return texts.filter((t) => one(t));
}

/** Asset ids a frame module names in its strings. Pure. */
function moduleAssets(module: string, ids: ReadonlySet<string>): string[] {
  return [...new Set([...module.matchAll(/['"`]([A-Z]{1,3}\d+(?:\.\w+)?)['"`]/g)].map((m) => m[1]!).filter((id) => ids.has(id)))];
}

export type SubmitContext = { n: number; duration: number; treatment: string; assets: ReadonlySet<string>; allowed: string; canMake: boolean };

/**
 * A submission, checked before it's built: the right frame, a reason and an approach, and a change code can build. A plan's
 * pictures exist or are ordered; a code change has its `events` (pre-mortem #17) and the kit's source rules. Pure.
 */
export function parseSubmit(raw: unknown, ctx: SubmitContext): { value: SolverSubmit | null; problems: string[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  if (Number(r.frame) !== ctx.n) problems.push(`\`frame\` is ${ctx.n}, the frame you were given`);
  const diagnosis = one(r.diagnosis);
  const approach = one(r.approach);
  if (!diagnosis) problems.push('`diagnosis` is required');
  if (!approach) problems.push('`approach` is required');
  const c = (r.change ?? {}) as Record<string, unknown>;
  let change: FrameChange | null = null;
  if (c.kind === 'plan') {
    const blueprint = normalBlueprint(c.blueprint as Partial<Blueprint>);
    const makes = Array.isArray(c.makes) ? (c.makes as MakeRequest[]) : [];
    if (!blueprint) problems.push('a plan change needs a blueprint with at least one piece');
    else {
      const made = new Set(makes.map((m) => m?.id));
      for (const m of makes) {
        if (!m?.id || ctx.assets.has(m.id)) problems.push(`a drawing you order needs an id no picture has (${String(m?.id)})`);
        if (!one(m?.brief)) problems.push(`drawing ${String(m?.id)} needs a brief`);
      }
      if (makes.length && !ctx.canMake) problems.push('no drawing can be ordered in this run: use the pictures on the list');
      const has = (id: string) => ctx.assets.has(id) || made.has(id);
      for (const id of blueprintAssets(blueprint)) if (!has(id)) problems.push(`no picture "${id}": use an id from the list or order it in \`makes\``);
      if (!PLAIN_GROUNDS.has(blueprint.ground) && !has(blueprint.ground)) problems.push(`ground "${blueprint.ground}" is charcoal, kraft, whiteboard or a picture's id`);
      const ids = new Set(blueprint.pieces.map((p) => p.id));
      if (ids.size !== blueprint.pieces.length) problems.push('every piece needs an id of its own');
      for (const p of blueprint.pieces) {
        const pl = p.place as Record<string, unknown> | undefined;
        if (pl && !(Number.isFinite(pl.x) && Number.isFinite(pl.y) && Number.isFinite(pl.w) && Number(pl.w) > 0)) problems.push(`piece ${p.id}: \`place\` needs numbers x, y and a width w above 0`);
      }
      const fresh = newWords(blueprintWords(blueprint), `${ctx.allowed}\n${CREDIT_WORDS}`);
      if (fresh.length) problems.push(`on-screen words add what the reel doesn't state: ${fresh.slice(0, 6).join(', ')}`);
      change = { kind: 'plan', blueprint, ...(makes.length ? { makes } : {}) };
    }
  } else if (c.kind === 'code') {
    const module = typeof c.module === 'string' ? c.module : '';
    if (!module.trim()) problems.push('a code change needs `module`, the frame\'s whole source');
    else {
      problems.push(...(solvedSourceProblems(module) as string[]).map((p) => `the module ${p}`));
      if (/\bfrom\s+['"]\.\.\/custom\//.test(module)) problems.push('the module imports from ../custom/: only ../kit/ may be imported');
      const said = /\btreatment\s*:\s*['"`](\w+)['"`]/.exec(module)?.[1];
      if (said && said !== ctx.treatment) problems.push(`the module's treatment is "${said}"; it must be "${ctx.treatment}"`);
    }
    if (!Array.isArray(c.events)) problems.push('a code change needs `events`, the frame\'s sounds');
    else if (!c.events.length) problems.push('`events` is empty: the frame needs at least its ambience');
    else problems.push(...(eventsFileProblems(c.events, ctx.duration, ctx.assets as never) as string[]).map((p) => `events: ${p}`));
    change = { kind: 'code', module, events: Array.isArray(c.events) ? c.events : [] };
  } else problems.push('`change.kind` is plan or code');
  return { value: change ? { frame: ctx.n, diagnosis, approach, change } : null, problems };
}

// ── Versions on disk (contract §6, §7) ──────────────────────────────────────────────────────────────

const versionsDir = (projectDir: string, id: string) => path.join(projectDir, SOLVER_STATE_DIR, 'versions', id);

export function readVersions(projectDir: string, id: string): FrameVersion[] {
  const dir = versionsDir(projectDir, id);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.endsWith('.events.json'))
    .flatMap((f) => {
      try {
        return [JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as FrameVersion];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.seq - b.seq);
}

function writeVersionMeta(projectDir: string, id: string, v: FrameVersion): void {
  const dir = versionsDir(projectDir, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${v.label}.json`), `${JSON.stringify(v, null, 1)}\n`);
}

/** Keep the frame's live files as a version (an attempt that built, or the frame as compiled). */
function keepLive(projectDir: string, id: string, v: FrameVersion): void {
  const dir = versionsDir(projectDir, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const ext of ['.js', '.events.json']) {
    const live = path.join(projectDir, 'assets', 'frames', `${id}${ext}`);
    if (fs.existsSync(live)) fs.copyFileSync(live, path.join(dir, `${v.label}${ext}`));
  }
  writeVersionMeta(projectDir, id, v);
}

function nextSeq(projectDir: string, id: string): number {
  return readVersions(projectDir, id).reduce((m, v) => Math.max(m, v.seq), -1) + 1;
}

/** The storyboard's `- treatment:` of frame `n`, or null. */
function storyboardTreatment(projectDir: string, n: number): string | null {
  try {
    const f = (parseFrames(fs.readFileSync(path.join(projectDir, 'STORYBOARD.md'), 'utf8')) as { number: number; fields: Record<string, string> }[]).find((x) => x.number === n);
    return f ? (one(f.fields.treatment).toLowerCase() || 'photo') : null;
  } catch {
    return null;
  }
}

/** Set frame `n`'s `- treatment:` line, so try.mjs and the captions read the treatment the frame now has. */
function setStoryboardTreatment(projectDir: string, n: number, treatment: string): void {
  const file = path.join(projectDir, 'STORYBOARD.md');
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, 'utf8');
  const head = new RegExp(`^##\\s+Frame\\s+${n}\\b.*$`, 'm').exec(text);
  if (!head) return;
  const start = head.index + head[0].length;
  const next = text.slice(start).search(/^##\s+Frame\s+\d+/m);
  const end = next < 0 ? text.length : start + next;
  const block = text.slice(start, end);
  const changed = /^- treatment:.*$/m.test(block) ? block.replace(/^- treatment:.*$/m, `- treatment: ${treatment}`) : block;
  if (changed !== block) fs.writeFileSync(file, text.slice(0, start) + changed + text.slice(end));
}

function writeSolved(projectDir: string, index: SolvedIndex): void {
  fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, SOLVED_FILE), `${JSON.stringify(index, null, 1)}\n`);
}

/**
 * Make a version the frame's live one: its files into `assets/frames`, its storyboard treatment, and `assets/solved.json`
 * (with its copy in `assets/solved/`) unless it is the frame as compiled, which a recompile makes again.
 */
export function installVersion(projectDir: string, id: string, n: number, v: FrameVersion): void {
  const dir = versionsDir(projectDir, id);
  const frames = path.join(projectDir, 'assets', 'frames');
  const solvedDir = path.join(projectDir, SOLVED_DIR);
  fs.mkdirSync(frames, { recursive: true });
  for (const ext of ['.js', '.events.json']) {
    const src = path.join(dir, `${v.label}${ext}`);
    if (fs.existsSync(src)) fs.copyFileSync(src, path.join(frames, `${id}${ext}`));
  }
  if (v.treatment) setStoryboardTreatment(projectDir, n, v.treatment);
  const index = readSolved(projectDir);
  if (v.kind === 'compiled') {
    delete index[id];
    for (const ext of ['.js', '.events.json']) fs.rmSync(path.join(solvedDir, `${id}${ext}`), { force: true });
  } else {
    fs.mkdirSync(solvedDir, { recursive: true });
    for (const ext of ['.js', '.events.json']) {
      const src = path.join(dir, `${v.label}${ext}`);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(solvedDir, `${id}${ext}`));
    }
    index[id] = { kind: v.kind, round: v.round, usd: Math.round(v.usd * 1e4) / 1e4 } satisfies SolvedEntry;
  }
  writeSolved(projectDir, index);
}

/** Record what the reviewers found on a version after the render (only changed frames are re-read). */
export function recordFindings(projectDir: string, id: string, label: string, review: FrameFinding[]): void {
  const v = readVersions(projectDir, id).find((x) => x.label === label);
  if (v) writeVersionMeta(projectDir, id, { ...v, review });
}

/** The version that ships, installed. `flag` is set on a swap back or the last resort. Never throws. */
export function settleFrame(projectDir: string, id: string, n: number): { chosen: FrameVersion | null; serious: number; swappedBack: boolean; flag: string | null; problems: string[] } {
  try {
    const pick = chooseVersion(readVersions(projectDir, id));
    if (pick.chosen) installVersion(projectDir, id, n, pick.chosen);
    return { ...pick, problems: [] };
  } catch (e) {
    return { chosen: null, serious: 0, swappedBack: false, flag: null, problems: [`frame ${n}: its versions could not be settled (${errorText(e)}); it keeps what is live`] };
  }
}

// ── Building and measuring one attempt (pre-mortem #4–#8, #14) ──────────────────────────────────────

/** Applying and measuring run one at a time, whatever the models do (pre-mortem #14). */
class Lane {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

/** The frame as compiled, kept as `v0` once, with its findings and its words, before anything changes it. */
async function keepOriginal(projectDir: string, w: FrameWork, kit: SolverKit): Promise<FrameVersion> {
  const v0 = readVersions(projectDir, w.id).find((v) => v.label === 'v0');
  if (v0) return v0;
  let words: string[] = [];
  try {
    words = [...(await kit.readWords(w.id))];
  } catch {
    words = [];
  }
  const blueprint = w.blueprint ?? undefined;
  const v: FrameVersion = {
    label: 'v0',
    seq: nextSeq(projectDir, w.id),
    round: 0,
    kind: 'compiled',
    built: true,
    usd: 0,
    treatment: storyboardTreatment(projectDir, w.n) ?? '',
    findings: w.findings.filter((f) => f.from !== 'review'),
    review: w.findings.filter((f) => f.from === 'review'),
    pictures: blueprint ? blueprintAssets(blueprint) : [],
    ...(blueprint ? { blueprint } : {}),
    words,
  };
  keepLive(projectDir, w.id, v);
  return v;
}

/** The live version: the newest one installed, by solved.json, else the compiled one. */
function liveVersion(projectDir: string, id: string): FrameVersion | null {
  const versions = readVersions(projectDir, id);
  const solved = readSolved(projectDir)[id];
  if (!solved) return versions.find((v) => v.label === 'v0') ?? null;
  return [...versions].reverse().find((v) => v.built && v.kind === solved.kind && v.round === solved.round) ?? versions.find((v) => v.label === 'v0') ?? null;
}

/**
 * Write a submission into the project and try it. Problems mean it didn't build; the frame's last good version is then put
 * back. Built, it becomes live (and listed in `assets/solved.json`), and its measured and words findings are returned.
 */
async function buildAttempt(
  input: { projectDir: string; plan: DirectorPlan; work: FrameWork; submit: SolverSubmit; label: string; round: 1 | 2 | 3; allowed: string; baseline: readonly string[] },
  kit: SolverKit,
): Promise<{ problems: string[]; version: FrameVersion | null }> {
  const { projectDir, work, submit } = input;
  const previous = liveVersion(projectDir, work.id);
  const restore = () => {
    if (previous) installVersion(projectDir, work.id, work.n, previous);
  };
  const problems: string[] = [];
  let treatment = storyboardTreatment(projectDir, work.n) ?? '';
  let blueprint: Blueprint | undefined;
  try {
    if (submit.change.kind === 'plan') {
      if (submit.change.makes?.length) problems.push(...(await kit.makeAssets!(submit.change.makes, work.n)));
      if (problems.length) return { problems, version: null };
      blueprint = submit.change.blueprint;
      const plan: DirectorPlan = { ...input.plan, frames: input.plan.frames.map((f) => (f.n === work.n ? { ...f, blueprint, asset_ids: [...new Set([...blueprintAssets(blueprint), ...(f.asset_ids ?? [])])] } : f)) };
      const frame = plan.frames.find((f) => f.n === work.n);
      treatment = String(blueprintTreatment(frame) ?? treatment);
      setStoryboardTreatment(projectDir, work.n, treatment);
      const compiled = await kit.compileFrame(plan, work.n);
      const broke = compiled.filter((p) => /compile failed|no blueprint to compile/.test(p));
      if (broke.length) problems.push(...broke);
    } else {
      const dir = path.join(projectDir, 'assets', 'frames');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${work.id}.js`), submit.change.module.endsWith('\n') ? submit.change.module : `${submit.change.module}\n`);
      fs.writeFileSync(path.join(dir, `${work.id}.events.json`), `${JSON.stringify(submit.change.events, null, 1)}\n`);
      // try.mjs waives [hand_placed] for listed frames only: list this one while it's tried.
      writeSolved(projectDir, { ...readSolved(projectDir), [work.id]: { kind: 'code', round: input.round, usd: 0 } });
    }
    if (!problems.length) problems.push(...(await kit.tryFrame(work.id)));
  } catch (e) {
    problems.push(`it could not be built (${errorText(e)})`);
  }
  if (problems.length) {
    restore();
    return { problems, version: null };
  }
  const kind = submit.change.kind;
  const v: FrameVersion = {
    label: input.label,
    seq: nextSeq(projectDir, work.id),
    round: input.round,
    kind,
    built: true,
    usd: 0,
    treatment,
    findings: [],
    review: null,
    pictures: blueprint ? blueprintAssets(blueprint) : [],
    submit,
    ...(blueprint ? { blueprint } : {}),
  };
  keepLive(projectDir, work.id, v);
  installVersion(projectDir, work.id, work.n, v);
  v.findings = await measureVersion(work, kit, input.allowed, input.baseline);
  writeVersionMeta(projectDir, work.id, v);
  return { problems: [], version: v };
}

/** The measured checks and the words check on the live frame. Never throws: a check that can't run says so. */
async function measureVersion(work: FrameWork, kit: SolverKit, allowed: string, baseline: readonly string[]): Promise<FrameFinding[]> {
  const out: FrameFinding[] = [];
  try {
    out.push(...(await kit.measureFrame(work.id)).map((l) => measuredFinding(work.n, l)));
  } catch (e) {
    out.push({ frame: work.n, from: 'measured', what: `the measured checks could not run (${errorText(e)})` });
  }
  try {
    const fresh = newWords(await kit.readWords(work.id), `${allowed}\n${CREDIT_WORDS}\n${baseline.join('\n')}`);
    if (fresh.length) out.push({ frame: work.n, from: 'words', item: 'new_words', what: `[new_words] on-screen words the reel doesn't state: ${fresh.slice(0, 8).join(', ')}` });
  } catch (e) {
    out.push({ frame: work.n, from: 'words', what: `the words on screen could not be read (${errorText(e)})` });
  }
  return out;
}

// ── One frame's call (round 1 or 2) ─────────────────────────────────────────────────────────────────

function voiceTiming(projectDir: string, id: string): string {
  try {
    const t = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'timing', `${id}.json`), 'utf8')) as { words?: { text: string; start: number }[] };
    return (t.words ?? []).map((w) => `[${w.start.toFixed(2)}] ${w.text}`).join(' ');
  } catch {
    return '';
  }
}

/** The shared first block of every frame call: identical across frames and rounds, so it is marked for the cache. */
function sharedBlock(brief: ReelBrief): Anthropic.ContentBlockParam {
  return { type: 'text', text: [section('The script', brief.script), section('Pictures available', brief.pictures)].join('\n\n'), cache_control: ephemeralCache('1h') } as Anthropic.ContentBlockParam;
}

async function frameUser(input: { projectDir: string; brief: ReelBrief; work: FrameWork; treatment: string; previous: FrameVersion | null }, deps: SolverDeps, problems: string[]): Promise<Anthropic.ContentBlockParam[]> {
  const { work } = input;
  const timed = voiceTiming(input.projectDir, work.id);
  const facts = [
    `Voice: "${one(work.voice)}"`,
    timed ? `Words with their start, seconds from the frame's start: ${timed}` : '',
    `Length: ${work.duration}s, fixed.`,
    `Job: ${one(work.job)}`,
    work.aim ? `What it must do once fixed: ${one(work.aim)}` : '',
    `Storyboard treatment (frame code exports this): ${input.treatment}`,
    `What the checks found:\n${findingLines(work.findings)}`,
  ].filter(Boolean);
  const user: Anthropic.ContentBlockParam[] = [
    sharedBlock(input.brief),
    { type: 'text', text: [section(`Frame ${work.n}: ${work.name}`, facts.join('\n')), section('Its blueprint', work.blueprint ?? '(none: it shows its first picture, plain)')].join('\n\n') },
    { type: 'text', text: 'Sheets of this frame, from the finished video:' },
    ...(await imageBlocks(deps, work.sheets, problems)),
    ...(work.still ? await imageBlocks(deps, [work.still], problems) : []),
  ];
  for (const nb of work.neighbours) {
    user.push({ type: 'text', text: `Frame ${nb.n}, ${nb.n < work.n ? 'before' : 'after'} it:` }, ...(await imageBlocks(deps, nb.sheets, problems)));
  }
  if (input.previous?.submit) {
    const still = seriousFindings([...input.previous.findings, ...(input.previous.review ?? [])]);
    user.push({ type: 'text', text: section("This frame's previous attempt, which wasn't enough", { diagnosis: input.previous.submit.diagnosis, approach: input.previous.submit.approach, change: input.previous.submit.change, still_wrong: still.map((f) => f.what) }) });
  }
  else if (input.previous && !input.previous.built) {
    // The previous attempt never built: what stopped it is what this one must avoid.
    user.push({ type: 'text', text: section("This frame's previous attempt, which didn't build", { why: input.previous.findings.map((f) => f.what) }) });
  }
  return user;
}

/**
 * Rework one frame: one call on `model`, then the build. A submission that doesn't parse or build gets one retry in the same
 * conversation; a second failure leaves the frame's last good version. `build` runs in the round's one lane.
 */
export async function solverReworkFrame(
  input: { projectDir: string; plan: DirectorPlan; brief: ReelBrief; work: FrameWork; round: 1 | 2; model: string; assets: ReadonlySet<string>; guard: SpendGuard; lane?: { run<T>(job: () => Promise<T>): Promise<T> } },
  deps: SolverDeps,
): Promise<FrameAttempt> {
  const { work, round } = input;
  const label = `r${round}`;
  const attempt = (a: Partial<FrameAttempt>): FrameAttempt => ({ frame: work.n, id: work.id, label, built: false, kind: null, usd: 0, findings: [], newPictures: [], problems: [], ...a });
  const lane = input.lane ?? new Lane();
  const problems: string[] = [];
  try {
    const original = await lane.run(() => keepOriginal(input.projectDir, work, deps.kit));
    const previous = round === 2 ? [...readVersions(input.projectDir, work.id)].reverse().find((v) => v.round === 1) ?? null : null;
    const treatment = storyboardTreatment(input.projectDir, work.n) ?? original.treatment;
    const baseline = original.words ?? [];
    const before = liveVersion(input.projectDir, work.id) ?? original;
    const user = await frameUser({ projectDir: input.projectDir, brief: input.brief, work, treatment, previous }, deps, problems);
    let built: FrameVersion | null = null;
    const turn = await converse<SolverSubmit>(
      deps,
      input.guard,
      { component: `solver_round${round}`, model: input.model, system: systemFor((deps.loadPrompt ?? loadSolverPrompt)('solver-frame'), deps.kitGuide), tool: SUBMIT_FRAME_TOOL, user, maxTokens: SOLVER_MAX_TOKENS.frame, effort: FRAME_EFFORT },
      async (raw) => {
        const parsed = parseSubmit(raw, { n: work.n, duration: work.duration, treatment, assets: input.assets, allowed: input.brief.allowed, canMake: Boolean(deps.kit.makeAssets) });
        if (!parsed.value || parsed.problems.length) return parsed;
        const submit = parsed.value;
        const res = await lane.run(() => buildAttempt({ projectDir: input.projectDir, plan: input.plan, work, submit, label, round, allowed: `${input.brief.allowed}\n${creditsIn(input.brief.pictures)}`, baseline }, deps.kit));
        if (res.version) built = res.version;
        return { value: res.version ? submit : null, problems: res.problems };
      },
    ).catch((e: unknown) => {
      if (e instanceof SpendLimitError) return { value: null, usd: (e as { usd?: number }).usd ?? 0, problems: [], limit: true } as Turn<SolverSubmit> & { limit?: boolean };
      throw e;
    });
    const v = built as FrameVersion | null;
    if (v) {
      v.usd = turn.usd;
      writeVersionMeta(input.projectDir, work.id, v);
      const solved = readSolved(input.projectDir);
      if (solved[work.id]) writeSolved(input.projectDir, { ...solved, [work.id]: { ...solved[work.id]!, usd: Math.round(turn.usd * 1e4) / 1e4 } });
      const had = new Set(before.pictures);
      const now = v.kind === 'code' ? moduleAssets(v.submit?.change.kind === 'code' ? v.submit.change.module : '', input.assets) : v.pictures;
      return attempt({ built: true, kind: v.kind as 'plan' | 'code', usd: turn.usd, findings: v.findings, newPictures: now.filter((id) => !had.has(id)), problems });
    }
    if ((turn as { limit?: boolean }).limit) return attempt({ usd: turn.usd, skipped: 'limit', problems: [...problems, `frame ${work.n}: round ${round} didn't run: the solver's limit`] });
    // Kept, so the round isn't redone after a restart and the record shows what failed.
    await lane.run(async () => writeVersionMeta(input.projectDir, work.id, { label, seq: nextSeq(input.projectDir, work.id), round, kind: 'code', built: false, usd: turn.usd, treatment, findings: turn.problems.map((what) => ({ frame: work.n, from: 'build' as const, what })), review: null, pictures: [] }));
    return attempt({ usd: turn.usd, problems: [...problems, `frame ${work.n}: round ${round} failed (${turn.problems.join('; ')}); it keeps its last good version`] });
  } catch (e) {
    return attempt({ usd: (e as { usd?: number }).usd ?? 0, problems: [...problems, `frame ${work.n}: round ${round} failed (${errorText(e)}); it keeps its last good version`] });
  }
}

/**
 * One round over the listed frames, worst first. The first frame runs alone so the rest read a warm cache (pre-mortem #13);
 * then up to SOLVER_PARALLEL models at once, applying one at a time. A frame this round already ran for (a restart) is skipped.
 */
export async function solverRound(
  input: { projectDir: string; plan: DirectorPlan; brief: ReelBrief; round: 1 | 2; frames: FrameWork[]; inventoryIds: readonly string[] },
  deps: SolverDeps,
): Promise<{ attempts: FrameAttempt[]; usd: number; problems: string[] }> {
  const guard = SpendGuard.load(input.projectDir, deps.limitUsd);
  const lane = new Lane();
  const model = input.round === 1 ? deps.models.first : deps.models.second;
  const assets = new Set(input.inventoryIds);
  const attempts: FrameAttempt[] = [];
  const todo = input.frames.filter((w) => {
    if (!readVersions(input.projectDir, w.id).some((v) => v.round === input.round)) return true;
    attempts.push({ frame: w.n, id: w.id, label: `r${input.round}`, built: false, kind: null, usd: 0, findings: [], newPictures: [], problems: [], skipped: 'done' });
    return false;
  });
  const one_ = (w: FrameWork) => solverReworkFrame({ projectDir: input.projectDir, plan: input.plan, brief: input.brief, work: w, round: input.round, model, assets, guard, lane }, deps);
  if (todo.length) attempts.push(await one_(todo[0]!));
  let next = 1;
  const worker = async () => {
    while (next < todo.length) attempts.push(await one_(todo[next++]!));
  };
  await Promise.all(Array.from({ length: Math.min(SOLVER_PARALLEL, Math.max(0, todo.length - 1)) }, worker));
  attempts.sort((a, b) => input.frames.findIndex((w) => w.n === a.frame) - input.frames.findIndex((w) => w.n === b.frame));
  return { attempts, usd: attempts.reduce((s, a) => s + a.usd, 0), problems: attempts.flatMap((a) => a.problems) };
}

/**
 * The last resort (contract §7) for a frame still serious after round 2 or at the limit: `plainBlueprint`, built and measured
 * as version `last`. No model. `settleFrame` ships it only when it has fewer serious findings than the best version.
 */
export async function lastResort(input: { projectDir: string; plan: DirectorPlan; work: FrameWork; allowed: string }, kit: SolverKit): Promise<FrameAttempt> {
  const { work } = input;
  const base: FrameAttempt = { frame: work.n, id: work.id, label: 'last', built: false, kind: null, usd: 0, findings: [], newPictures: [], problems: [] };
  try {
    if (readVersions(input.projectDir, work.id).some((v) => v.round === 3)) return { ...base, skipped: 'done' };
    const original = await keepOriginal(input.projectDir, work, kit);
    const frame = input.plan.frames.find((f) => f.n === work.n);
    const blueprint = plainBlueprint({ asset_ids: frame?.asset_ids ?? [] });
    const submit: SolverSubmit = { frame: work.n, diagnosis: 'still serious after the solver', approach: 'the last resort: its first picture, held', change: { kind: 'plan', blueprint } };
    const res = await buildAttempt({ projectDir: input.projectDir, plan: input.plan, work, submit, label: 'last', round: 3, allowed: input.allowed, baseline: original.words ?? [] }, kit);
    if (!res.version) return { ...base, problems: [`frame ${work.n}: the last resort didn't build (${res.problems.join('; ')})`] };
    res.version.kind = 'plain';
    writeVersionMeta(input.projectDir, work.id, res.version);
    installVersion(input.projectDir, work.id, work.n, res.version);
    return { ...base, built: true, kind: 'plan', findings: res.version.findings };
  } catch (e) {
    return { ...base, problems: [`frame ${work.n}: the last resort failed (${errorText(e)})`] };
  }
}

// ── The kit, live (free, no model) ──────────────────────────────────────────────────────────────────

/** How long one kit check may run before it counts as a failure (pre-mortem #4). */
export const KIT_TIMEOUT_MS = 3 * 60 * 1000;

/** A subprocess that doesn't block the event loop, so the round's other model calls keep going while a frame is measured. */
export type AsyncRunner = (cmd: string, args: string[], opts: { cwd: string; env?: NodeJS.ProcessEnv; timeoutMs?: number }) => Promise<RunResult>;

export const asyncRunner: AsyncRunner = (cmd, args, { cwd, env, timeoutMs }) =>
  new Promise((resolve) => {
    execFile(cmd, args, { cwd, env: env ?? process.env, timeout: timeoutMs, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as (Error & { code?: number | string; killed?: boolean }) | null;
      const status = !e ? 0 : typeof e.code === 'number' ? e.code : null;
      resolve({ status, stdout: stdout ?? '', stderr: stderr ?? '', ...(e && status === null ? { error: e.killed ? `timed out after ${timeoutMs} ms` : e.message } : {}) });
    });
  });

/** The kit's CLIs on the project: compile, try.mjs, bounds and screen, compiled-read. Each run is cut off at KIT_TIMEOUT_MS. */
export function liveSolverKit(projectDir: string, opts: { inventory?: VisualsInventory | null; run?: Runner | AsyncRunner; makeAssets?: SolverKit['makeAssets'] } = {}): SolverKit {
  const run = opts.run ?? asyncRunner;
  const node = async (script: string, args: string[]) => run(process.execPath, [`assets/kit/${script}.mjs`, ...args], { cwd: projectDir, env: { ...process.env, ...HYPERFRAMES_ENV }, timeoutMs: KIT_TIMEOUT_MS });
  const errorsOf = async (script: string, id: string): Promise<string[]> => {
    const res = await node(script, [id]);
    const parsed = jsonOut<{ errors?: string[] }>(res);
    if (parsed) return parsed.errors ?? [];
    return [`${script} ${res.error ? `timed out or failed to run (${tail(res, 200)})` : `failed: ${tail(res, 200)}`}`];
  };
  return {
    compileFrame: async (plan, n) => (await compileReel({ plan, inventory: opts.inventory ?? null, projectDir, only: [n], rewrite: [n] })).problems.filter((p) => p.startsWith(`frame ${n}:`)),
    tryFrame: (id) => errorsOf('try', id),
    measureFrame: async (id) => [...(await errorsOf('bounds', id)), ...(await errorsOf('screen', id))],
    readWords: async (id) => {
      const res = await node('compiled-read', [id]);
      const parsed = jsonOut<{ frames?: Record<string, { id: string; words?: string[] }> }>(res);
      return Object.values(parsed?.frames ?? {}).find((f) => f.id === id)?.words ?? [];
    },
    ...(opts.makeAssets ? { makeAssets: opts.makeAssets } : {}),
  };
}
