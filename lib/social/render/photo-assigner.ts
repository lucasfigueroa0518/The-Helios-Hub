import { pickPhoto } from '@/lib/social/photos/picker';
import type { FactSheet } from '@/lib/social/editorial/fact-sheet';
import type { Beat, Post, SlideCopy, StoryType } from '@/lib/social/render/types';

/**
 * Photo assignment — fills photoUrl + photoCredit on the render Post's
 * slides using the existing photo picker (subject → article → atmosphere).
 *
 * Enforces the no-duplicate-within-carousel rule by tracking assigned URLs.
 * Cycles through multiple atmosphere keywords per storyType so consecutive
 * story beats don't share the same fallback photo.
 *
 * Deferred (design skill §Photo policy): the 10-post cross-carousel reuse
 * window. That check needs a DB call to `helios_social.posts.post_json` and
 * belongs in the compose pipeline's persistence step, not here.
 */

/**
 * Rotation table for interior atmosphere beats. When the primary atmosphere
 * keyword for a storyType is already taken by an earlier slide, we pull the
 * next one from this list. Each list starts with the picker.ts default so
 * calling code without the rotation still lands on the same photo.
 */
const ATMOSPHERE_ROTATION: Record<StoryType, string[]> = {
  ai_funding:      ['boardroom', 'office', 'cityscape', 'conference'],
  model_launch:    ['chip', 'code', 'research', 'data'],
  agents:          ['code', 'office', 'chip', 'data'],
  safety:          ['research', 'code', 'office', 'data'],
  policy:          ['boardroom', 'cityscape', 'conference', 'office'],
  infrastructure:  ['chip', 'data', 'office', 'code'],
  benchmark:       ['data', 'chip', 'research', 'code'],
  leadership:      ['conference', 'boardroom', 'office', 'cityscape'],
  deal:            ['boardroom', 'office', 'conference', 'cityscape'],
  research:        ['research', 'code', 'chip', 'data'],
  tech:            ['office', 'code', 'chip', 'research'],
};

/** Beats whose slide should carry a photo when one is available. Empty
 * space reads worse than an atmosphere photo, so MECHANISM/SCALE/ANALOGY
 * are on the list too; if the pipeline can find something, it fills. */
const PHOTO_BEATS = new Set<Beat>([
  'HOOK', 'GROUND', 'CONTEXT', 'SCENARIO',
  'STAKES', 'TWIST', 'QUOTE', 'PROOF',
  'MECHANISM', 'ANALOGY', 'SCALE', 'DEBATE',
]);

function firstNamedPerson(factSheet: FactSheet): string | null {
  for (const p of factSheet.players) {
    // Only people names — companies are unlikely to have a Wikipedia press
    // portrait we'd want on a HOOK cover.
    if (/[A-Z]\w+\s[A-Z]\w+/.test(p.name)) return p.name;
  }
  return null;
}

function speakerFromSlide(slide: SlideCopy, factSheet: FactSheet): string | null {
  // For QUOTE slides, the editorial pipeline puts the attribution into
  // `headline` (see editorial skill §5 QUOTE spec). Search for a fact_sheet
  // quote whose speaker matches to derive the real name.
  const headlineText = (slide.headline ?? []).map((s) => s.text).join('');
  const cleaned = headlineText.replace(/^—\s*/, '').split(',')[0]?.trim() ?? '';
  if (!cleaned) return null;
  for (const q of factSheet.quotes) {
    if (q.speaker.toLowerCase().includes(cleaned.toLowerCase())) return q.speaker;
    if (cleaned.toLowerCase().includes(q.speaker.split(',')[0]?.trim().toLowerCase() ?? '')) return q.speaker;
  }
  return cleaned;
}

function normalizeCredit(
  pick: { source: string; attribution?: string },
  ctx: { sourceOutlet?: string } = {},
): string {
  if (pick.attribution && pick.attribution.length > 0) {
    return pick.attribution.toUpperCase();
  }
  if (pick.source === 'article' && ctx.sourceOutlet) {
    // News-article style caption — small "Via [Outlet]" attribution below
    // the image, matching how a news post credits a syndicated photo.
    return `VIA ${ctx.sourceOutlet.toUpperCase()}`;
  }
  if (pick.source === 'article') return 'PHOTO · ARTICLE HERO';
  return 'PHOTO';
}

export type PhotoAssignmentInput = {
  post: Post;
  factSheet: FactSheet;
  articleUrl: string;
};

export type PhotoAssignmentResult = {
  post: Post;
  assigned: number;
  skipped: number;
};

export async function assignPhotos(input: PhotoAssignmentInput): Promise<PhotoAssignmentResult> {
  const { post, factSheet, articleUrl } = input;
  const storyType = post.storyType;
  const rotation = ATMOSPHERE_ROTATION[storyType] ?? ATMOSPHERE_ROTATION.tech;
  const usedUrls = new Set<string>();
  let rotationCursor = 0;
  let assigned = 0;
  let skipped = 0;

  const namedPerson = firstNamedPerson(factSheet);

  const enrichedSlides: SlideCopy[] = [];
  for (const slide of post.slides) {
    const beat = slide.beat;
    if (!beat || !PHOTO_BEATS.has(beat)) {
      enrichedSlides.push(slide);
      continue;
    }

    // C3 (type-only cover) and C4 (big-number cover) intentionally carry no
    // photo — the type IS the composition. The picker chose C3/C4 because
    // no portrait/metaphor image was appropriate; forcing an atmosphere
    // photo here would fight the layout.
    if (beat === 'HOOK' && (slide.variant === 'C3' || slide.variant === 'C4')) {
      enrichedSlides.push(slide);
      skipped += 1;
      continue;
    }

    let subject: string | null = null;
    let atmosphereKeyword: string | undefined;
    let useArticleHero = false;

    if (beat === 'HOOK') {
      subject = namedPerson;
    } else if (beat === 'QUOTE') {
      subject = speakerFromSlide(slide, factSheet);
    } else if (beat === 'PROOF') {
      // PROOF beats prefer the actual artifact if the article carries a
      // usable og:image; otherwise fall through to atmosphere.
      useArticleHero = true;
      atmosphereKeyword = rotation[rotationCursor % rotation.length];
      rotationCursor += 1;
    } else if (beat === 'GROUND') {
      // GROUND is the "who did what" slide — the article's own hero image
      // (the photo the outlet chose to publish with the story) fits this
      // beat's role better than a random atmosphere shot. Fall back to
      // atmosphere if the article's og:image isn't reachable.
      useArticleHero = true;
      atmosphereKeyword = rotation[rotationCursor % rotation.length];
      rotationCursor += 1;
    } else {
      // CONTEXT / SCENARIO / STAKES / TWIST → atmosphere.
      atmosphereKeyword = rotation[rotationCursor % rotation.length];
      rotationCursor += 1;
    }

    // Skip subject search when the same person just got a portrait upstream.
    let attemptedUrl: string | null = null;
    let credit = '';

    // Priority-0 — fact_sheet.assets whose subject matches the slide's
    // asset_needs. Fact-sheet assets are named by Sonnet; when they carry
    // a URL, they're semantically closest to what the beat wants.
    const needsKeywords = (slide as unknown as { asset_needs?: string[] }).asset_needs ?? [];
    const needsLower = needsKeywords.join(' ').toLowerCase();
    if (needsLower.length > 0) {
      const match = factSheet.assets.find((a) => {
        if (!a.url || usedUrls.has(a.url)) return false;
        if (a.kind !== 'photo' && a.kind !== 'figure' && a.kind !== 'headline') return false;
        const subjectLower = a.subject.toLowerCase();
        // Loose match — either direction of substring inclusion.
        return subjectLower.split(/\W+/).some((token) => token.length > 3 && needsLower.includes(token));
      });
      if (match?.url) {
        attemptedUrl = match.url;
        credit = `IMAGE · ${match.subject.toUpperCase().slice(0, 60)}`;
      }
    }

    // Priority-1 — the pickPhoto ladder (subject → article hero → atmosphere).
    if (!attemptedUrl) for (let attempt = 0; attempt < rotation.length + 2; attempt += 1) {
      const pick = await pickPhoto({
        subject: subject ?? undefined,
        articleUrl: useArticleHero ? articleUrl : undefined,
        storyType,
        atmosphereKeyword,
      });
      if (!pick) break;
      if (usedUrls.has(pick.imageUrl)) {
        // Try the next atmosphere keyword — only when we're in atmosphere path.
        if (atmosphereKeyword) {
          rotationCursor += 1;
          atmosphereKeyword = rotation[rotationCursor % rotation.length];
          subject = null;
          useArticleHero = false;
          continue;
        }
        // Subject or article hero collision — drop the photo, don't retry.
        break;
      }
      attemptedUrl = pick.imageUrl;
      credit = normalizeCredit(pick, { sourceOutlet: post.source });
      break;
    }

    if (attemptedUrl) {
      usedUrls.add(attemptedUrl);
      enrichedSlides.push({
        ...slide,
        photoUrl: attemptedUrl,
        photoCredit: credit,
      });
      assigned += 1;
    } else {
      enrichedSlides.push(slide);
      skipped += 1;
    }
  }

  return {
    post: { ...post, slides: enrichedSlides },
    assigned,
    skipped,
  };
}
