import type { OneBoxInput, SeedVerticalKey, StorySeries, Verified } from './types';

/**
 * Filing a verified finding (design section 6): the one-box builds exactly the fields each type's existing add function takes,
 * and calls it, so "Yours", the 7-day expiry, the caps, scoring and never-cut are unchanged. The add functions are injected
 * (`FileDeps`) so tests stub them; `file-live.ts` wires the real ones.
 */

export const MAX_SOURCE_CHARS = 20_000;

export type FileDeps = {
  reel: (a: { headline: string; url: string }) => Promise<{ status: 'added'; id: string; title: string } | { status: 'duplicate'; existing: { id: string; headline: string; net: number | null; yours: boolean } } | { status: 'needs_paid_confirm' | 'no_match' }>;
  carousel: (a: { url: string; headline: string }) => Promise<{ id: string; title: string }>;
  lfd: (a: { url: string; headline: string }) => Promise<{ id: string; title: string }>;
  story: (body: Record<string, unknown>) => Promise<{ key: string; title: string }>;
  explainer: (t: { title: string; origin: 'manual'; sourceUrl: string; sourceText: string }) => Promise<{ topicId: string; title: string }>;
  /** Headlines already in a pool (read-only, at most 40), for the agent's duplicate check. */
  headlines: (vertical: SeedVerticalKey, series?: StorySeries) => Promise<string[]>;
  /** The free duplicate check on the found URL: the existing idea's headline, or null. */
  existing: (vertical: SeedVerticalKey, url: string, headline: string) => Promise<string | null>;
};

export type FileResult =
  | { status: 'added'; ideaId: string; title: string }
  | { status: 'duplicate'; existing: string }
  | { status: 'refused'; reason: string };

/** Primary source first, each page prefixed with its URL, clipped to the Explainers source limit. */
function sourceText(v: Verified): string {
  return v.articles.map((a) => `${a.url}\n${a.text}`).join('\n\n').slice(0, MAX_SOURCE_CHARS);
}

export async function fileIdea(i: { input: OneBoxInput; verified: Verified; deps: FileDeps }): Promise<FileResult> {
  const { input, verified: v, deps } = i;
  const primary = v.articles[0]!;
  try {
    switch (input.vertical) {
      case 'reels': {
        const out = await deps.reel({ headline: primary.headline, url: primary.url });
        if (out.status === 'added') return { status: 'added', ideaId: out.id, title: out.title };
        if (out.status === 'duplicate') return { status: 'duplicate', existing: out.existing.headline };
        return { status: 'refused', reason: 'The idea could not be scored or filed.' };
      }
      case 'carousels': {
        const out = await deps.carousel({ url: primary.url, headline: primary.headline });
        return { status: 'added', ideaId: out.id, title: out.title };
      }
      case 'last_few_days': {
        const out = await deps.lfd({ url: primary.url, headline: primary.headline });
        return { status: 'added', ideaId: out.id, title: out.title };
      }
      case 'stories': {
        const series = input.series ?? 'morning_download';
        const body: Record<string, unknown> =
          series === 'guess_the_number'
            ? { series, value: v.number!.value, fact: v.number!.fact, storyHeadline: v.number!.storyHeadline ?? primary.headline, url: primary.url }
            : series === 'free_vs_paid'
              ? { series, toolName: v.tool!.name, url: v.tool!.url, description: v.tool!.description }
              : { series, headline: primary.headline, url: primary.url, notes: input.blurb };
        const out = await deps.story(body);
        return { status: 'added', ideaId: out.key, title: out.title };
      }
      case 'explainers': {
        const out = await deps.explainer({ title: v.conceptTitle || input.blurb.slice(0, 120), origin: 'manual', sourceUrl: primary.url, sourceText: sourceText(v) });
        return { status: 'added', ideaId: out.topicId, title: out.title };
      }
    }
  } catch (error) {
    return { status: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
}
