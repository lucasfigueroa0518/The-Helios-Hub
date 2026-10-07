/**
 * Hook pass budgets: measured on the rendered slide, never guessed
 * (hook-pass draft, "What code does"). Code renders every story slide with
 * a hook line of increasing length (the real render check: text fit,
 * bounds, contrast, faces) and takes, per slide, the longest length that
 * still passes, with every shorter probe passing too. A slide that fails
 * with no line, or with the shortest probe, gets 0 (full).
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

/** Does 1-based render slide `k` pass in this result? Problems not tied to a slide (fonts, images) throw. */
function slidePasses(fit: FitResult, k: number): boolean {
  for (const p of fit.problems) if (!/^slide \d+ /.test(p)) throw new Error(`render check can't measure budgets: ${p}`);
  return !fit.problems.some((p) => p.startsWith(`slide ${k} `)) && !fit.violations.some((v) => v.slide === k);
}

export type HookBudgets = { budgets: number[]; baselineFailures: number[]; renders: number };

export async function measureHookBudgets(
  filled: FilledDraft,
  photos: { cover: Photo | null; slides: Array<Photo | null> },
  meta: PostMeta,
  fitCheck: FitCheck,
  probes: readonly number[] = HOOK_PROBES,
): Promise<HookBudgets> {
  const render = (len: number | null) =>
    fitCheck(toRenderPost({ ...filled, slides: filled.slides.map((s) => ({ ...s, hook: len ? { text: fillerLine(len), kind: 'tease' as const, facts: [] } : null })) }, photos, meta));
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
      if (slidePasses(fit, i + 2)) budgets[i] = fillerLine(len).length;
      else alive[i] = false;
    });
  }
  return { budgets, baselineFailures: filled.slides.flatMap((_, i) => (slidePasses(base, i + 2) ? [] : [i + 2])), renders };
}
