/**
 * Hook pass budgets: measured on the rendered slide, never guessed
 * (hook-pass draft, "What code does"). Code renders every story slide with
 * a hook line of increasing length (the real render check: text fit,
 * bounds, contrast, faces) and takes, per slide, the longest length that
 * still passes, with every shorter probe passing too. A slide that fails
 * with no line, or with the shortest probe, gets 0 (full).
 *
 * "Passes" also means nothing shrank to make room: every existing text
 * region keeps its size from the render with no line, and the hook line
 * renders at its own full size (two lines at most, by its CSS height).
 * Text fit alone would accept a line by shrinking the slide's body copy
 * (seen in the first probe run, 2026-10-06).
 *
 * One render per probe length covers all slides at once; slides are
 * independent frames.
 */
import type { Photo } from '@/lib/social/photos/find';
import type { FitCheck, FitResult } from '@/lib/social/render/fit-check';
import { toRenderPost, type PostMeta } from '@/lib/social/render/from-draft';
import type { FilledDraft } from '@/lib/social/writer/draft';

export const HOOK_PROBES = [30, 45, 60, 75, 90, 110, 130] as const;

const FILLER = 'Not everyone in the room was ready to let that claim stand without asking who would pay for it first';

/** Realistic words, cut at a word boundary, at most `n` characters. */
export function fillerLine(n: number): string {
  let out = '';
  for (const w of Array(4).fill(FILLER).join(' ').split(' ')) {
    const next = out ? `${out} ${w}` : w;
    if (next.length > n) break;
    out = next;
  }
  return out;
}

/** The hook line's designed font size (preview.css .helios-hook). */
export const HOOK_FONT_PX = 34;

/** Does 1-based render slide `k` pass in this result? Problems not tied to a slide (fonts, images) throw. */
function slidePasses(fit: FitResult, k: number, base?: FitResult): boolean {
  for (const p of fit.problems) if (!/^slide \d+ /.test(p)) throw new Error(`render check can't measure budgets: ${p}`);
  if (fit.problems.some((p) => p.startsWith(`slide ${k} `)) || fit.violations.some((v) => v.slide === k)) return false;
  if (!base) return true;
  const sizes = fit.sizes?.[k - 1];
  const was = base.sizes?.[k - 1];
  if (!sizes || !was) throw new Error('render check returned no text sizes; budgets need them');
  const hook = sizes.filter((s) => s.element === 'helios-hook');
  const rest = sizes.filter((s) => s.element !== 'helios-hook');
  if (hook.some((h) => h.px < HOOK_FONT_PX - 0.5)) return false;
  return rest.length === was.length && rest.every((s, j) => s.px >= was[j]!.px - 0.5);
}

export type HookBudgets = { budgets: number[]; baselineFailures: number[]; renders: number };

export async function measureHookBudgets(
  filled: FilledDraft,
  photos: { cover: Photo | null; slides: Array<Photo | null> },
  meta: PostMeta,
  fitCheck: FitCheck,
  probes: readonly number[] = HOOK_PROBES,
): Promise<HookBudgets> {
  const once = (len: number | null) =>
    fitCheck(toRenderPost({ ...filled, slides: filled.slides.map((s) => ({ ...s, hook: len ? { text: fillerLine(len), kind: 'tease' as const, facts: [] } : null })) }, photos, meta));
  // A failure not tied to a slide (a remote photo that didn't load) is retried once before it stops the measurement.
  const render = async (len: number | null) => {
    const fit = await once(len);
    return fit.problems.some((p) => !/^slide \d+ /.test(p)) ? once(len) : fit;
  };
  const base = await render(null);
  // Story slide i is render slide i + 2 (cover = 1).
  const alive = filled.slides.map((_, i) => slidePasses(base, i + 2));
  const budgets = filled.slides.map(() => 0);
  let renders = 1;
  for (const len of probes) {
    if (!alive.some(Boolean)) break;
    const fit = await render(len);
    renders++;
    alive.forEach((ok, i) => {
      if (!ok) return;
      if (slidePasses(fit, i + 2, base)) budgets[i] = fillerLine(len).length;
      else alive[i] = false;
    });
  }
  return { budgets, baselineFailures: filled.slides.flatMap((_, i) => (slidePasses(base, i + 2) ? [] : [i + 2])), renders };
}
