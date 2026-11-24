import type { ContentLeaf, Want } from '@/lib/field-notes/types';

import { NOT_A_KIND, validKind } from './classify';
import type { OneBoxInput, SeedVerticalKey, Verified } from './types';

/**
 * Filing a verified finding (design section 6): the one-box builds exactly the fields each type's existing add function takes,
 * and calls it, so "Yours", the 7-day expiry, the caps, scoring and never-cut are unchanged. The add functions are injected
 * (`FileDeps`) so tests stub them; `file-live.ts` wires the real ones.
 */

export const MAX_SOURCE_CHARS = 20_000;

export type FileDeps = {
  reel: (a: { headline: string; url: string; text: string }) => Promise<{ status: 'added'; id: string; title: string } | { status: 'duplicate'; existing: { id: string; headline: string; net: number | null; yours: boolean } } | { status: 'needs_paid_confirm' | 'no_match' }>;
  carousel: (a: { url: string; headline: string }) => Promise<{ id: string; title: string }>;
  lfd: (a: { url: string; headline: string }) => Promise<{ id: string; title: string }>;
  story: (body: Record<string, unknown>) => Promise<{ key: string; title: string }>;
  explainer: (t: { title: string; origin: 'manual'; sourceUrl: string; sourceText: string }) => Promise<{ topicId: string; title: string }>;
  fieldNote: (a: { sourceUrl: string; leaf: ContentLeaf; want: Want; note: string }) => Promise<{ id: string; title: string } | { duplicate: string }>;
  /** Headlines already in a pool (read-only, at most 40), for the agent's duplicate check. */
  headlines: (vertical: SeedVerticalKey) => Promise<string[]>;
  /** The free duplicate check on the found URL: the existing idea's headline, or null. */
  existing: (vertical: SeedVerticalKey, url: string, headline: string) => Promise<string | null>;
};

export type FileResult =
  | { status: 'added'; ideaId: string; title: string }
  | { status: 'duplicate'; existing: string }
  | { status: 'refused'; reason: string };

/** Primary source first, each page prefixed with its URL, clipped to the Explainers source limit. */
function sourceText(v: Verified): string {
  return v.passed.map((p) => `${p.url}\n${p.text}`).join('\n\n').slice(0, MAX_SOURCE_CHARS);
}

/** Field Notes: the link, its kind and want, and the person's words as the note, through the seed API's own save. */
export async function fileFieldNote(i: { deps: FileDeps; sourceUrl: string; leaf: unknown; want: unknown; note: string }): Promise<FileResult> {
  const kind = validKind(i.leaf, i.want);
  if (!kind) return { status: 'refused', reason: NOT_A_KIND };
  try {
    const out = await i.deps.fieldNote({ sourceUrl: i.sourceUrl, ...kind, note: i.note });
    return 'duplicate' in out ? { status: 'duplicate', existing: out.duplicate } : { status: 'added', ideaId: out.id, title: out.title };
  } catch (error) {
    return { status: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
}

export async function fileIdea(i: { input: OneBoxInput; verified: Verified; deps: FileDeps }): Promise<FileResult> {
  const { input, verified: v, deps } = i;
  const primary = v.passed[0]!;
  const e = primary.entry;
  try {
    switch (input.vertical) {
      case 'reels': {
        const out = await deps.reel({ headline: e.headline!, url: e.url!, text: primary.text.slice(0, MAX_SOURCE_CHARS) });
        if (out.status === 'added') return { status: 'added', ideaId: out.id, title: out.title };
        if (out.status === 'duplicate') return { status: 'duplicate', existing: out.existing.headline };
        return { status: 'refused', reason: 'The idea could not be scored or filed.' };
      }
      case 'carousels': {
        const out = await deps.carousel({ url: e.url!, headline: e.headline! });
        return { status: 'added', ideaId: out.id, title: out.title };
      }
      case 'last_few_days': {
        const out = await deps.lfd({ url: e.url!, headline: e.headline! });
        return { status: 'added', ideaId: out.id, title: out.title };
      }
      case 'stories': {
        const body: Record<string, unknown> = { series: 'morning_download', headline: e.headline, url: e.url, notes: input.blurb };
        const out = await deps.story(body);
        return { status: 'added', ideaId: out.key, title: out.title };
      }
      case 'explainers': {
        const out = await deps.explainer({ title: e.title!, origin: 'manual', sourceUrl: e.sourceUrl!, sourceText: sourceText(v) });
        return { status: 'added', ideaId: out.topicId, title: out.title };
      }
      case 'field_notes':
        return await fileFieldNote({ deps, sourceUrl: e.url!, leaf: e.leaf, want: e.want, note: input.blurb });
      default:
        return { status: 'refused', reason: `${input.vertical} is not filed by this runner.` };
    }
  } catch (error) {
    return { status: 'refused', reason: error instanceof Error ? error.message : String(error) };
  }
}
