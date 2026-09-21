/**
 * Photo picker — the entry point the compose pipeline calls when it needs
 * an image for a slide.
 *
 *   1. Named subject (Path A): if the slide has a specific person named,
 *      resolve their Wikipedia URL and let extract-image.ts fetch it.
 *   2. Article hero (bypass): if the slide is announcing a specific event
 *      and the article has an og:image, use that directly. Compose passes
 *      the article URL as `articleUrl`.
 *   3. Atmospheric (Path B): fall back to a curated editorial photo
 *      matched by keyword theme (see atmosphere.ts).
 *
 * The picker returns everything the compose pipeline needs to render a
 * slide + write attribution — a URL, a source label, and (for Unsplash)
 * the required photographer credit.
 */

import { extractArticleImage } from '@/lib/social/ingest/extract-image';
import { resolveAtmosphere } from '@/lib/social/photos/atmosphere';
import { resolveSubject } from '@/lib/social/photos/subjects';
import type { StoryType } from '@/lib/social/render/types';

export type PhotoPick = {
  imageUrl: string;
  /** Where the photo came from — drives attribution UX. */
  source: 'subject' | 'article' | 'atmosphere';
  /** Human-readable credit string to surface in caption + alt text. */
  attribution?: string;
};

export type PhotoPickInput = {
  /** Named subject (e.g. "Sam Altman"). Highest-priority source when set. */
  subject?: string;
  /** Article URL whose og:image serves as the beat's hero. Falls back to subject. */
  articleUrl?: string;
  /** Story-type — used to choose an atmospheric photo when nothing else matches. */
  storyType?: StoryType;
  /** Explicit atmospheric keyword (overrides the storyType default). */
  atmosphereKeyword?: string;
};

/**
 * Story-type → atmospheric keyword mapping. Kept next to the picker so
 * adding a new story-type is a two-line change in one place.
 */
const STORY_TYPE_ATMOSPHERE: Record<StoryType, string> = {
  ai_funding: 'boardroom',
  model_launch: 'chip',
  agents: 'code',
  safety: 'research',
  policy: 'boardroom',
  infrastructure: 'chip',
  benchmark: 'data',
  leadership: 'conference',
  deal: 'boardroom',
  research: 'research',
  tech: 'office',
};

export async function pickPhoto(input: PhotoPickInput): Promise<PhotoPick | null> {
  // Path A — named subject.
  if (input.subject) {
    const subjectUrl = resolveSubject(input.subject);
    if (subjectUrl) {
      const extracted = await extractArticleImage(subjectUrl);
      if (extracted) {
        return {
          imageUrl: extracted.imageUrl,
          source: 'subject',
          attribution: `${input.subject} · via Wikipedia`,
        };
      }
    }
  }

  // Article hero — use the story's actual publisher photo.
  if (input.articleUrl) {
    const extracted = await extractArticleImage(input.articleUrl);
    if (extracted) {
      return {
        imageUrl: extracted.imageUrl,
        source: 'article',
      };
    }
  }

  // Path B — atmospheric fallback.
  const keyword = input.atmosphereKeyword
    ?? (input.storyType ? STORY_TYPE_ATMOSPHERE[input.storyType] : undefined);
  if (keyword) {
    const photo = resolveAtmosphere(keyword);
    if (photo) {
      return {
        imageUrl: photo.url,
        source: 'atmosphere',
        attribution: `Photo: ${photo.attribution.photographer} · Unsplash`,
      };
    }
  }

  return null;
}
