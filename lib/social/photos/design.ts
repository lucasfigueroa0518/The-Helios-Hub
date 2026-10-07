/**
 * Photos for a whole draft (spec §5.1 Photo chain v1): the chosen cover
 * first, then each story slide in order, one shared post context so no photo
 * repeats and each subject is identity-checked once (the cache is shared with
 * the Writer's photo_available for the same story).
 */
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { FilledDraft } from '@/lib/social/writer/draft';

import { findPhoto, newPhotoContext, type PhotoDeps, type PhotoSlot, type PhotoTrace } from './find';

/** Where a slide type draws its photo. */
export function slotFor(type: FilledDraft['slides'][number]['type']): PhotoSlot {
  return type === 'stat' || type === 'split_stat' ? 'backdrop' : type === 'quote' ? 'quote' : 'split';
}

export type DraftPhotos = { cover: PhotoTrace; slides: PhotoTrace[] };

export async function photosForDraft(
  draft: FilledDraft,
  brief: Brief,
  pages: PageReadOk[],
  deps: PhotoDeps,
  history: Parameters<typeof newPhotoContext>[2] = {},
): Promise<DraftPhotos> {
  const ctx = newPhotoContext(brief, pages, history);
  const chosen = draft.cover_options[draft.chosen_cover - 1]!;
  const cover = await findPhoto(chosen.image, ctx, deps, { text: [chosen.text], speaker: null, slot: 'split', cover: true });
  const slides: PhotoTrace[] = [];
  // In order, not in parallel: the used set decides which candidate each slide gets.
  for (const s of draft.slides) {
    const text = [s.headline.text, s.body?.text ?? '', s.quote?.text ?? ''];
    // The speaker by ID (Tommy, 2026-10-06), never by name text.
    slides.push(await findPhoto(s.image, ctx, deps, { text, speaker: s.quote?.speaker_subject ?? null, slot: slotFor(s.type) }));
  }
  return { cover, slides };
}
