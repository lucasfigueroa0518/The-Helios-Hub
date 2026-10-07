/**
 * Photos for a whole draft (photo spec §4; Link 5): the chosen cover first,
 * then each story slide in order, one shared post context so no photo
 * repeats and each subject is identity-checked once (the cache is shared with
 * the Writer's availability flags for the same story).
 *
 * Each slide goes down its chain with its subject tags, its icon and, on a
 * quote slide, its speaker. ARTICLE PHOTOS are the same code-built list the
 * Writer saw (article-list.ts), with the same subject types.
 */
import type { Brief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import { DEFAULT_ICON, isIcon } from '@/lib/social/render/icons';
import type { FilledDraft } from '@/lib/social/writer/draft';

import { articlePhotosFor } from './article-list';
import { findPhoto, newPhotoContext, type PhotoDeps, type PhotoSlot, type PhotoTrace } from './find';
import type { SubjectType } from './identity';
import type { IdentityCache } from './p18';

/** Where a slide type draws its photo. */
export function slotFor(type: FilledDraft['slides'][number]['type']): PhotoSlot {
  return type === 'stat' || type === 'split_stat' ? 'backdrop' : type === 'quote' ? 'quote' : 'split';
}

export type DraftPhotos = { cover: PhotoTrace; slides: PhotoTrace[] };

/** Each subject's type: the identity check's (already cached by the Writer's lookup), else the Reporter's mark. */
export async function subjectKinds(brief: Brief, identities?: IdentityCache): Promise<Map<string, SubjectType | null>> {
  const out = new Map<string, SubjectType | null>(brief.subjects.map((s) => [s.name, s.type ?? null]));
  for (const [name, pending] of identities ?? []) {
    const id = await pending.catch(() => null);
    if (id?.type) out.set(name, id.type);
  }
  return out;
}

export async function photosForDraft(
  draft: FilledDraft,
  brief: Brief,
  pages: PageReadOk[],
  deps: PhotoDeps,
  history: { recent?: Set<string>; lastUsed?: Map<string, string>; identities?: IdentityCache } = {},
): Promise<DraftPhotos> {
  const kinds = await subjectKinds(brief, history.identities);
  const ctx = newPhotoContext(brief, pages, { ...history, kinds, photos: articlePhotosFor(brief, pages, kinds) });
  const icon = (name: string | undefined) => (isIcon(name) ? name : DEFAULT_ICON);
  const chosen = draft.cover_options[draft.chosen_cover - 1]!;
  const cover = await findPhoto(chosen.image, ctx, deps, { text: [chosen.text], speaker: null, slot: 'split', cover: true, tags: chosen.subject_ids ?? [], icon: icon(chosen.icon) });
  const slides: PhotoTrace[] = [];
  // In order, not in parallel: the used set decides which candidate each slide gets.
  for (const s of draft.slides) {
    const text = [s.headline.text, s.body?.text ?? '', s.quote?.text ?? ''];
    // The speaker by ID (Tommy, 2026-10-06), never by name text.
    slides.push(await findPhoto(s.image, ctx, deps, { text, speaker: s.quote?.speaker_subject ?? null, slot: slotFor(s.type), tags: s.subject_ids ?? [], icon: icon(s.icon) }));
  }
  return { cover, slides };
}
