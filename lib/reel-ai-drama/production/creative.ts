import fs from 'node:fs';
import path from 'node:path';

import type Anthropic from '@anthropic-ai/sdk';

import { blueprintFields, draftLines, frameVoice } from '@/explainers/reel-ai-drama/kit/project-files.mjs';
import { hookOptions, resolveHook, type HookOption } from '@/lib/reel-ai-drama/hooks/eligibility';
import { acceptTouches, NO_TOUCHES, readCompiled, TOUCHES_FILE, type CompiledRead } from '@/lib/reel-ai-drama/render/compile';
import type { CustomPiece, DirectorPlan, HookChoice, SourceRef, Touch, Touches, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, section, WritingError, type Ledger, type Parsed, type SendMessage } from '@/lib/reel-ai-drama/writing/llm';
import { SUBMIT_TOUCHES_TOOL } from '@/lib/reel-ai-drama/writing/schemas';

/**
 * The creative pass (ITERATION-10 §X, contract §5). Once per reel it sees the compiled reel as pictures and the script, and may
 * add: a line, words in turn, closer cuts, a mark, a change of light, a sound, or a small custom piece. It can't move, change or
 * remove anything code built, and none is required. Its one exception is the opening: it may swap frame 1's hook (`hook_swap`) among
 * the hooks the bank can carry; the swap passes through `resolveHook` and is measured like a touch.
 *
 * Caching: `runSubmit` puts the breakpoint on the system prompt, so the tool and the prompt are the stable prefix (tools →
 * system); the stills and the reel's frames are the per-reel suffix in the user message. It fails open: an error means no
 * touches and a problem line.
 */

export const CREATIVE_MODEL = 'claude-sonnet-5-5';
const MAX_TOKENS = 8_000;

export type CreativeResult = { touches: Touches; usd: number; problems: string[] };

export type CreativeCtx = Ledger & {
  create: SendMessage;
  loadPrompt: () => string;
  model?: string;
  /** The compiled frames' stills, one per frame at its main beat. Default: the kit's browser (free). */
  stills?: (projectDir: string, dir: string) => Promise<CompiledRead> | CompiledRead;
  readStill?: (file: string) => Promise<string> | string;
};

const isSwap = (v: unknown): v is HookChoice => typeof v === 'object' && v !== null && typeof (v as { id?: unknown }).id === 'string';

/** What the model sent, kept to what can be a touch; the limits are `acceptTouches`'s. Never costs a fix round. Pure. */
export function parseTouches(raw: unknown): Parsed<Touches> {
  const r = raw as { touches?: unknown; custom?: unknown; hook_swap?: unknown } | null;
  if (!r || typeof r !== 'object') return { value: null, problems: ['submit { touches: [], custom: [] }'] };
  return { value: { touches: Array.isArray(r.touches) ? (r.touches as Touch[]) : [], custom: Array.isArray(r.custom) ? (r.custom as CustomPiece[]) : [], ...(isSwap(r.hook_swap) ? { hook_swap: r.hook_swap } : {}) }, problems: [] };
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The workspace's inventory: what the hooks' asset gates read. Null when it can't be read, and then no swap is offered. */
function projectInventory(projectDir: string): VisualsInventory | null {
  try {
    const inv = JSON.parse(fs.readFileSync(path.join(projectDir, 'assets', 'inventory.json'), 'utf8')) as VisualsInventory;
    return Array.isArray(inv?.assets) ? inv : null;
  } catch {
    return null;
  }
}

/**
 * The swap the reel may take: only among hooks that still qualify, then through `resolveHook`. A swap to a hook that doesn't qualify is
 * dropped and the opening stays as it was, since a code-chosen replacement isn't what the pass asked for. Pure.
 */
export function acceptSwap(
  swap: HookChoice | null | undefined,
  options: readonly HookOption[],
  ctx: { inventory: VisualsInventory; sources: SourceRef[]; words: string },
): { hook_swap: HookChoice | null; problems: string[] } {
  if (!swap) return { hook_swap: null, problems: [] };
  if (!options.some((o) => o.id === swap.id)) return { hook_swap: null, problems: [`hook swap to ${swap.id} dropped: the bank can't carry it; the opening stays as it was`] };
  const hook_swap = resolveHook(swap, [...options], ctx);
  return { hook_swap, problems: (hook_swap?.flags ?? []).map((f) => `hook swap: ${f}`) };
}

export async function creativePass(input: { draft: WriterDraft; plan: DirectorPlan; projectDir: string; sources?: SourceRef[] }, ctx: CreativeCtx): Promise<CreativeResult> {
  const { draft, plan, projectDir } = input;
  const none = (problem: string, usd = 0): CreativeResult => ({ touches: { ...NO_TOUCHES }, usd, problems: [problem] });
  try {
    const dir = path.join(projectDir, 'renders', 'compiled');
    const read = await (ctx.stills ?? ((p: string, d: string) => readCompiled(p, { stills: d })))(projectDir, dir);
    if (!read.stills.length) return none(`no stills of the compiled reel (${read.skipped ?? 'nothing came back'}); it ships as compiled`);
    const load = ctx.readStill ?? ((file: string) => fs.readFileSync(file).toString('base64'));
    const lines = draftLines(draft);
    const sources = input.sources ?? [];
    const inventory = projectInventory(projectDir);
    const options = inventory ? hookOptions(inventory, sources) : [];
    const user: Anthropic.ContentBlockParam[] = [
      {
        type: 'text',
        text: [
          section('The opening now', plan.hook ? { hook: plan.hook.id, beats: plan.hook.beats, charged: plan.hook.charged } : 'Frame 1 plays its plain blueprint picture, with no hook.'),
          section('Hook options', options),
        ].join('\n\n'),
      },
    ];
    for (const still of read.stills) {
      const f = plan.frames.find((x) => x.n === still.number);
      // A hook replaces what frame 1's blueprint would draw, so its fields would describe a picture that isn't there.
      const fields = still.number === 1 && plan.hook ? [`Plays the ${plan.hook.id} hook`] : (blueprintFields(f?.blueprint) as [string, string][]).map(([k, v]) => `${k}: ${v}`);
      user.push({ type: 'text', text: section(`Frame ${still.number}: ${still.name} (still at ${still.at}s)`, [`Voice: "${f ? frameVoice(f, lines) : ''}"`, f ? `Job: ${f.purpose}` : '', ...fields].filter(Boolean).join('\n')) });
      user.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: await load(still.file) } });
    }
    user.push({ type: 'text', text: 'Add only what makes a line clearer or makes it hit harder, then call submit_touches once. Empty lists are a good answer.' });
    const result = await runSubmit(ctx.create, ctx, {
      component: 'creative_pass',
      model: ctx.model ?? CREATIVE_MODEL,
      system: ctx.loadPrompt(),
      user,
      tool: SUBMIT_TOUCHES_TOOL,
      maxTokens: MAX_TOKENS,
      parse: parseTouches,
      fixes: 0,
    });
    const { touches: kept, rejected } = acceptTouches(result.value, plan);
    const words = plan.frames[0] ? frameVoice(plan.frames[0], lines) : '';
    const swap = inventory ? acceptSwap(result.value.hook_swap, options, { inventory, sources, words }) : { hook_swap: null, problems: result.value.hook_swap ? ['hook swap dropped: the inventory could not be read'] : [] };
    // A hook frame has no pieces to touch: what would land on frame 1's blueprint would land on nothing.
    const hooked = Boolean(swap.hook_swap ?? plan.hook);
    const onHook = (t: { frame: number }) => hooked && t.frame === 1;
    const refused = [...kept.touches, ...kept.custom].filter(onHook).map((t) => `frame 1: touch ${t.id} dropped: frame 1 plays a hook`);
    const touches: Touches = { touches: kept.touches.filter((t) => !onHook(t)), custom: kept.custom.filter((c) => !onHook(c)), ...(swap.hook_swap ? { hook_swap: swap.hook_swap } : {}) };
    fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
    fs.writeFileSync(path.join(projectDir, TOUCHES_FILE), `${JSON.stringify(touches, null, 1)}\n`);
    return { touches, usd: result.usd, problems: [...rejected.map((r) => `frame ${r.frame}: touch ${r.id} dropped: ${r.why}`), ...refused, ...swap.problems] };
  } catch (error) {
    return none(`the pass failed (${errorText(error)}); the reel ships as compiled`, error instanceof WritingError ? error.usd : 0);
  }
}

/** A finding's sense without its numbers: a touch moving something by a pixel isn't new breakage. Pure. */
const findingKey = (f: string) => f.replace(/-?\d+(?:\.\d+)?/g, '#').replace(/\s+/g, ' ').trim();
/** What's in `after` and wasn't in `before`. Pure. */
export function newFindings(before: readonly string[], after: readonly string[]): string[] {
  const had = new Set(before.map(findingKey));
  return after.filter((f) => !had.has(findingKey(f)));
}

/**
 * The removal rule (contract §5): each touch is compiled onto its frame and measured against that frame's clean baseline. Any new
 * layout, breakage or plan-check finding removes it and the frame goes back to compiled. Never throws: a touch that can't be
 * measured is removed too.
 */
export async function applyTouches(input: {
  proposed: Touches;
  /** Compile `touches`, writing only `frame`. */
  compile: (touches: Touches, frame: number) => Promise<void>;
  findings: (frame: number) => Promise<string[]>;
}): Promise<{ accepted: Touches; removed: { id: string; frame: number; why: string }[] }> {
  let accepted: Touches = { ...NO_TOUCHES };
  const removed: { id: string; frame: number; why: string }[] = [];
  const { hook_swap } = input.proposed;
  const offered: { item: Pick<Touch, 'id' | 'frame'>; add: (t: Touches) => Touches }[] = [
    // First, so what's added after it is measured on the opening that will ship.
    ...(hook_swap ? [{ item: { id: 'hook_swap', frame: 1 }, add: (t: Touches) => ({ ...t, hook_swap }) }] : []),
    ...input.proposed.touches.map((item) => ({ item, add: (t: Touches) => ({ ...t, touches: [...t.touches, item] }) })),
    ...input.proposed.custom.map((item) => ({ item, add: (t: Touches) => ({ ...t, custom: [...t.custom, item] }) })),
  ];
  for (const { item, add } of offered) {
    const clean = accepted;
    try {
      const before = await input.findings(item.frame);
      const trial = add(clean);
      await input.compile(trial, item.frame);
      const fresh = newFindings(before, await input.findings(item.frame));
      if (fresh.length) {
        removed.push({ id: item.id, frame: item.frame, why: fresh.slice(0, 3).join('; ') });
        await input.compile(clean, item.frame);
      } else accepted = trial;
    } catch (error) {
      removed.push({ id: item.id, frame: item.frame, why: `it could not be measured (${errorText(error)})` });
      await input.compile(clean, item.frame).catch(() => undefined);
    }
  }
  return { accepted, removed };
}
