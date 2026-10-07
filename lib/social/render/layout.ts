/**
 * Slide layout (slide buckets spec; Tommy, 2026-10-07): Jev's two decisions
 * for a post, after its photos are picked.
 *
 *   1. bucket   content decides cover, stat and quote; a text slide is a
 *               story slide unless it starts the post's one spread. Code finds
 *               the neighbouring text pairs whose first photo is a wide scene;
 *               one pair → it is the spread; several → Jev picks
 *               (slide-bucket@1); none → no spread, reported.
 *   2. variant  per slide, in order: code keeps the bucket's variants the
 *               slide can take and that the post hasn't used; Jev picks among
 *               2+ (slide-variant@1). A bucket with none left reuses its least
 *               recently used variant that the slide can take, never the
 *               previous slide's (logged).
 *
 * Jev reads text only (the copy, lengths, the photo's kind and Haiku tags).
 */
import type { JevAsk } from '@/lib/social/jev/client';
import * as SlideBucket from '@/lib/social/jev/questions/slide-bucket.v1';
import * as SlideVariant from '@/lib/social/jev/questions/slide-variant.v1';
import { SPREAD_MIN_ASPECT, type Photo, type PhotoTrace } from '@/lib/social/photos/find';
import type { FilledDraft } from '@/lib/social/writer/draft';

import { TEMPLATES, allowedTemplates, type Bucket, type PhotoShape, type SlideFacts, type TemplateId } from './buckets';
import { BACKDROP_MAX_UPSCALE, SLIDE, SPREAD, fillsSharp } from './framing';
import { canBleedPerson, photoKindOf } from './from-draft';

export type Layout = {
  /** The template per slide, cover first (no entry for the follow slide). */
  templates: TemplateId[];
  /** The draft slide index (0-based) that starts the spread, or null. */
  spreadAt: number | null;
  log: string[];
};

export function photoShape(p: Photo | null): PhotoShape {
  if (!p) return 'none';
  const kind = photoKindOf(p);
  return kind === 'logo' ? 'logo' : kind === 'scene' ? 'scene' : canBleedPerson(p) ? 'person-bleed' : 'person';
}

const sizeOf = (p: Photo | null) => (p?.width && p.height ? { w: p.width, h: p.height } : null);
/** Wide enough for a spread and sharp across both slides (adaptive framing). */
const isWide = (p: Photo | null) => !!p && photoKindOf(p) === 'scene' && !!p.width && !!p.height && p.width / p.height >= SPREAD_MIN_ASPECT && fillsSharp(sizeOf(p), SPREAD);

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function chooseLayout(draft: FilledDraft, photos: { cover: PhotoTrace; slides: PhotoTrace[] }, jev: JevAsk): Promise<Layout> {
  const log: string[] = [];
  const slidePhotos = photos.slides.map((t) => t.photo);

  // ── Decision 1: the spread (the one open bucket choice) ──
  const pairs = draft.slides.flatMap((s, i) => {
    const next = draft.slides[i + 1];
    return s.type === 'text' && next?.type === 'text' && isWide(slidePhotos[i] ?? null) ? [i] : [];
  });
  let spreadAt: number | null = null;
  if (pairs.length === 1) spreadAt = pairs[0]!;
  else if (pairs.length > 1) {
    const options = pairs.map((i) => ({ id: `slides_${i + 2}_${i + 3}`, first: draft.slides[i]!.headline.text, second: draft.slides[i + 1]!.headline.text, photo_tags: photos.slides[i]!.tags ?? [] }));
    try {
      const res = await jev({ state: { pairs: options }, questions: SlideBucket.buildQuestions(options) }, { version: SlideBucket.VERSION, subjectId: draft.cover });
      const picked = res.answers[SlideBucket.QUESTION_ID]?.choice;
      spreadAt = pairs[options.findIndex((o) => o.id === picked)] ?? pairs[0]!;
      log.push(`spread: Jev picked ${picked} of ${options.map((o) => o.id).join(', ')}`);
    } catch (err) {
      spreadAt = pairs[0]!;
      log.push(`spread: Jev error (${errText(err)}) → the first pair`);
    }
  }
  if (spreadAt === null) log.push('spread: none (no neighbouring text slides with a wide scene photo)');
  else log.push(`spread: slides ${spreadAt + 2}–${spreadAt + 3}`);

  // ── Decision 2: the variant, slide by slide ──
  const used = new Set<TemplateId>();
  const lastUse = new Map<TemplateId, number>();
  const templates: TemplateId[] = [];
  const cover = draft.cover_options[draft.chosen_cover - 1]!;
  const places = [
    { bucket: 'cover' as Bucket, photo: photos.cover.photo, tags: photos.cover.tags ?? [], headline: draft.cover, body: '', quote: '', speakerPhoto: false, content: 'cover' },
    ...draft.slides.map((s, i) => {
      const inSpread = spreadAt !== null && (i === spreadAt || i === spreadAt + 1);
      const photo = inSpread ? slidePhotos[spreadAt!] ?? null : slidePhotos[i] ?? null;
      return {
        bucket: (inSpread ? 'spread' : s.type === 'stat' ? 'stat' : s.type === 'quote' ? 'quote' : 'story') as Bucket,
        photo,
        tags: (inSpread ? photos.slides[spreadAt!] : photos.slides[i])?.tags ?? [],
        headline: s.headline.text,
        body: s.body?.text ?? '',
        quote: s.quote?.text ?? '',
        speakerPhoto: !!photo?.qid && !!s.quote?.speaker_subject && photo.subject === s.quote.speaker_subject,
        content: s.type === 'stat' ? (s.numbers.length === 2 ? 'two numbers' : 'one number') : s.type,
      };
    }),
  ];
  void cover;
  for (const [n, p] of places.entries()) {
    // The spread's second slide takes the first one's variant (one photo, one look).
    if (p.bucket === 'spread' && n === spreadAt! + 2) {
      templates.push(templates[n - 1]!);
      continue;
    }
    const facts: SlideFacts = { bucket: p.bucket, photo: photoShape(p.photo), speakerPhoto: p.speakerPhoto, wide: isWide(p.photo), sharpBleed: fillsSharp(sizeOf(p.photo), SLIDE), sharpBackdrop: fillsSharp(sizeOf(p.photo), SLIDE, BACKDROP_MAX_UPSCALE), headlineChars: p.headline.length, bodyChars: p.body.length, quoteChars: p.quote.length };
    let options = allowedTemplates(facts, used);
    let reused = false;
    if (!options.length) {
      // Every variant the slide can take is used: the least recently used one, never the previous slide's.
      const prev = templates[n - 1];
      options = TEMPLATES.filter((t) => t.bucket === p.bucket && t.needs(facts) && t.id !== prev).sort((a, b) => (lastUse.get(a.id) ?? -1) - (lastUse.get(b.id) ?? -1)).slice(0, 1);
      reused = options.length > 0;
    }
    let id: TemplateId;
    if (!options.length) {
      // Nothing fits (a photo no variant takes): the bucket's no-photo variant, logged.
      id = (TEMPLATES.find((t) => t.bucket === p.bucket && t.needs({ ...facts, photo: 'none', speakerPhoto: false, sharpBleed: false, sharpBackdrop: false }))?.id ?? TEMPLATES.find((t) => t.bucket === p.bucket)!.id);
      log.push(`slide ${n + 1}: no ${p.bucket} variant takes a ${facts.photo} photo → ${id}`);
    } else if (options.length === 1) {
      id = options[0]!.id;
      log.push(`slide ${n + 1}: ${p.bucket} → ${id}${reused ? ' (every variant used; least recently used)' : ' (the only one left)'}`);
    } else {
      const state: SlideVariant.VariantState = {
        slide: { content: p.content, headline: p.headline, body_chars: p.body.length, quote_chars: p.quote.length, photo: facts.photo, photo_tags: p.tags },
        previous_slide_variant: templates[n - 1] ?? null,
      };
      try {
        const res = await jev({ state, questions: SlideVariant.buildQuestions(options.map((o) => ({ id: o.id, look: o.look }))) }, { version: SlideVariant.VERSION, subjectId: `${draft.cover.slice(0, 60)} #${n + 1}` });
        const a = res.answers[SlideVariant.QUESTION_ID];
        id = (options.find((o) => o.id === a?.choice) ?? options[0]!).id;
        log.push(`slide ${n + 1}: ${p.bucket} → ${id} (Jev of ${options.map((o) => `${o.id} ${(a?.probabilities?.[o.id] ?? 0).toFixed(2)}`).join(', ')})`);
      } catch (err) {
        id = options[0]!.id;
        log.push(`slide ${n + 1}: Jev error (${errText(err)}) → ${id}`);
      }
    }
    templates.push(id);
    used.add(id);
    lastUse.set(id, n);
  }
  return { templates, spreadAt, log };
}
