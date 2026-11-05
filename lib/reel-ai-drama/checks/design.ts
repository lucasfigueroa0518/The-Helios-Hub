import { readFile } from 'node:fs/promises';

import type Anthropic from '@anthropic-ai/sdk';

import { designReviewSystem, type DesignItemSet } from '@/lib/reel-ai-drama/prompts';
import type { Sheet } from '@/lib/reel-ai-drama/render/sheets';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { DirectorPlan, ScriptLine, WriterDraft } from '@/lib/reel-ai-drama/types';
import { runSubmit, WritingError, type Ledger, type Parsed, type SendMessage, type SubmitTool } from '@/lib/reel-ai-drama/writing/llm';

/**
 * The design reviewer (MD-129, MD-132, MD-133, MD-140). After render, beside the first viewer, it looks at
 * the sheets of every story frame's moments (render/sheets.ts), with each frame's storyboard summary, and
 * judges the approved 12-item checklist in two calls: the mechanical items on the vision model (Haiku, `design_review_fast`) and the judgment items
 * on the design judge model (Sonnet, `design_review_judge`). `problem` findings join the first viewer's
 * picture problems in the one fix session; `warning` findings ship as flags. It fails open: a call that
 * errors leaves an `errors` line and the other call's findings still count.
 *
 * Caching: each call's system prompt (shared intro + its item set) and tool are the stable prefix
 * (`runSubmit` marks it); the sheets and summaries are the per-reel suffix in the user message.
 */

export const FAST_ITEMS = ['off_edge', 'readable_text', 'clean_cutouts', 'marks_on_target', 'nothing_missing', 'no_redundancy'] as const;
export const JUDGE_ITEMS = ['one_medium', 'good_crops', 'deliberate_layout', 'composed', 'focal_point', 'formed_opening'] as const;
export type DesignItem = (typeof FAST_ITEMS)[number] | (typeof JUDGE_ITEMS)[number];

/** The checklist names as Lucas approved them (MD-132), for flags and the fix. */
export const DESIGN_ITEM_LABELS: Record<DesignItem, string> = {
  off_edge: 'nothing off the edge',
  readable_text: 'text readable',
  clean_cutouts: 'clean cutouts and drawings',
  marks_on_target: 'marks on target',
  nothing_missing: 'nothing missing',
  no_redundancy: 'no redundancy',
  one_medium: 'one medium per frame',
  good_crops: 'good crops',
  deliberate_layout: 'deliberate layout',
  composed: 'composed, not lazy',
  focal_point: 'a clear focal point',
  formed_opening: 'a formed opening',
};

export type DesignSeverity = 'problem' | 'warning';
export type DesignFinding = { frame: number; item: DesignItem; severity: DesignSeverity; what: string };
export type DesignReview = { problems: DesignFinding[]; warnings: DesignFinding[]; errors: string[]; usd: number };

export const DESIGN_CALLS: Record<DesignItemSet, { component: string; items: readonly DesignItem[]; maxTokens: number }> = {
  fast: { component: 'design_review_fast', items: FAST_ITEMS, maxTokens: 6_000 },
  judge: { component: 'design_review_judge', items: JUDGE_ITEMS, maxTokens: 10_000 },
};

/** One strict tool per item set: the enum keeps each call to its own items. Stable bytes per set. */
export function designReviewTool(items: readonly DesignItem[]): SubmitTool {
  const finding = {
    type: 'object',
    additionalProperties: false,
    required: ['frame', 'item', 'severity', 'what'],
    properties: {
      frame: { type: 'integer' },
      item: { type: 'string', enum: [...items] },
      severity: { type: 'string', enum: ['problem', 'warning'] },
      what: { type: 'string' },
    },
  };
  return {
    name: 'submit_design_review',
    description: 'Submit every design finding for the frames you were shown, once. An empty list means every frame passes.',
    strict: true,
    input_schema: { type: 'object', additionalProperties: false, required: ['findings'], properties: { findings: { type: 'array', items: finding } } },
  };
}

const TOOLS: Record<DesignItemSet, SubmitTool> = { fast: designReviewTool(FAST_ITEMS), judge: designReviewTool(JUDGE_ITEMS) };

/**
 * Read a call's findings; exported for tests. A finding for a frame that wasn't shown, an item outside the
 * call's set or with no `what` is dropped (no paid fix round for it); only unreadable output is a problem.
 */
export function parseDesignFindings(frames: ReadonlySet<number>, items: readonly DesignItem[]): (raw: unknown) => Parsed<DesignFinding[]> {
  return (raw) => {
    const list = (raw as { findings?: unknown } | null)?.findings;
    if (!Array.isArray(list)) return { value: null, problems: ['`findings` must be a list (empty when every frame passes)'] };
    const out: DesignFinding[] = [];
    for (const f of list as Partial<DesignFinding>[]) {
      if (!f || typeof f !== 'object') continue;
      const what = typeof f.what === 'string' ? f.what.trim() : '';
      if (!frames.has(Number(f.frame)) || !items.includes(f.item as DesignItem) || !what) continue;
      out.push({ frame: Number(f.frame), item: f.item as DesignItem, severity: f.severity === 'problem' ? 'problem' : 'warning', what });
    }
    return { value: out, problems: [] };
  };
}

/** A finding in one line, for flags: `Frame 3, nothing off the edge: …`. */
export function designFindingText(f: Pick<DesignFinding, 'frame' | 'item' | 'what'>): string {
  return `Frame ${f.frame}, ${DESIGN_ITEM_LABELS[f.item] ?? f.item}: ${f.what}`;
}

/** The storyboard summary the reviewer reads above a frame's sheets: treatment, purpose, focus, narration, labels. */
export function frameBrief(number: number, plan: DirectorPlan, draft: WriterDraft, total: number): string {
  const frame = plan.frames.find((f) => f.n === number);
  const lines = new Map<string, ScriptLine>(draft.rungs.flatMap((r) => r.lines.map((l) => [l.id, l] as const)));
  const out = [frame ? `Frame ${number} of ${total} — "${frame.name}" · treatment: ${frame.treatment}` : `Frame ${number} of ${total}`];
  if (!frame) return out.join('\n');
  out.push(`Purpose: ${frame.purpose}`);
  if (frame.focus) out.push(`Focus: ${frame.focus.kind} — ${frame.focus.what}`);
  const spoken = frame.line_ids.map((id) => lines.get(id)).filter((l): l is ScriptLine => !!l);
  if (spoken.length) out.push(`Narration: ${spoken.map((l) => `"${l.text}"`).join(' ')}`);
  const dropped = new Set(frame.drop_labels ?? []);
  const labels = spoken
    .filter((l) => l.on_screen && !dropped.has(l.id))
    .map((l) => `"${l.on_screen}"${l.on_screen_kind === 'date' ? ' (date)' : ''}`);
  if (frame.on_screen && !labels.some((l) => l.startsWith(`"${frame.on_screen}"`))) labels.push(`"${frame.on_screen}"`);
  out.push(`On-screen labels: ${labels.length ? labels.join('; ') : 'none'}`);
  return out.join('\n');
}

export type DesignDeps = Ledger & {
  create: SendMessage;
  settings?: ReelAiDramaSettings;
  root?: string;
  /** Reads a sheet as base64; defaults to the file at that path. */
  readSheet?: (file: string) => Promise<string>;
};

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Both calls, in parallel, on the same user content (every frame's summary, then its sheets, in order). */
export async function checkDesign(deps: DesignDeps, input: { sheets: Sheet[]; plan: DirectorPlan; draft: WriterDraft }): Promise<DesignReview> {
  const settings = deps.settings ?? DEFAULT_SETTINGS;
  const review: DesignReview = { problems: [], warnings: [], errors: [], usd: 0 };
  if (!input.sheets.length) return { ...review, errors: ['no sheets to review'] };
  const read = deps.readSheet ?? (async (file: string) => (await readFile(file)).toString('base64'));
  const user: Anthropic.ContentBlockParam[] = [];
  const frames = new Set(input.sheets.map((s) => s.frame));
  for (const frame of [...frames].sort((a, b) => a - b)) {
    user.push({ type: 'text', text: frameBrief(frame, input.plan, input.draft, frames.size) });
    for (const sheet of input.sheets.filter((s) => s.frame === frame)) {
      user.push({ type: 'image', source: { type: 'base64', media_type: /\.png$/i.test(sheet.file) ? 'image/png' : 'image/jpeg', data: await read(sheet.file) } });
    }
  }
  user.push({ type: 'text', text: 'Review every frame above against your checklist, then call submit_design_review once.' });
  const models: Record<DesignItemSet, string> = { fast: settings.vision_model, judge: settings.design_judge_model };
  const sets: DesignItemSet[] = ['fast', 'judge'];
  const results = await Promise.allSettled(
    sets.map((set) =>
      runSubmit(deps.create, deps, {
        component: DESIGN_CALLS[set].component,
        model: models[set],
        system: designReviewSystem(set, deps.root),
        user,
        tool: TOOLS[set],
        maxTokens: DESIGN_CALLS[set].maxTokens,
        ...(set === 'judge' ? { effort: 'medium' as const } : {}),
        parse: parseDesignFindings(frames, DESIGN_CALLS[set].items),
      }),
    ),
  );
  results.forEach((r, i) => {
    const component = DESIGN_CALLS[sets[i]!].component;
    if (r.status === 'rejected') {
      review.errors.push(`${component}: ${errorText(r.reason)}`);
      if (r.reason instanceof WritingError) review.usd += r.reason.usd;
      return;
    }
    review.usd += r.value.usd;
    for (const f of r.value.value) (f.severity === 'problem' ? review.problems : review.warnings).push(f);
  });
  const order = (a: DesignFinding, b: DesignFinding) => a.frame - b.frame;
  review.problems.sort(order);
  review.warnings.sort(order);
  return review;
}
