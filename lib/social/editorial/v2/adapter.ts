/**
 * Plain-text v2 output → renderer `Post` shape.
 *
 * The renderer (`lib/social/render/SlideTemplate.tsx`) and its Zod validator
 * (`lib/social/compose/postSchema.ts`) are unchanged. This adapter is the
 * one-way translator: parsed EDITED POST + parsed CAPTION + BRIEF → a Post
 * that satisfies `PostSchema` and renders correctly under the existing
 * layouts.
 *
 * Layout / variant mapping is from the approved Phase 1 plan, derived by
 * reading SlideTemplate.tsx and ~/.claude/skills/helios-social-skill/SKILL.md
 * against what each variant actually renders:
 *
 *   Cover with brief-image, portrait subject → cover / C1
 *   Cover with brief-image, non-portrait     → cover / C2
 *   Cover with type-only or free-text image  → cover / C3
 *   BIG NUMBER present on a beat             → data_block / D1
 *   HEADLINE only                            → story_beat / B5 (landing mode)
 *   BODY only                                → story_beat / B1 (default: body-top only)
 *   HEADLINE + BODY                          → story_beat / B1 (title + body chapter-mark)
 *   FOLLOW                                   → follow / F1
 */

import type { Post, SlideCopy, Span, SpanRun, StoryType, Variant } from '@/lib/social/render/types';

import type { Brief, BriefImage, ParsedPost, ParsedSlide } from './parse';

export type AdapterInput = {
  brief: Brief;
  post: ParsedPost;
  caption: string;
  articlePublishedAt: string;
  issueNumber: number;
};

export function adaptToPost(input: AdapterInput): Post {
  const { brief, post, caption, articlePublishedAt, issueNumber } = input;
  const primarySource = brief.sources[0];
  const source = primarySource?.outlet || 'Source';
  const sourceUrl = primarySource?.url || '';
  const publishedAt = primarySource?.publishedAt || articlePublishedAt;

  const slides: SlideCopy[] = [];

  // Slide 0 — cover.
  slides.push(buildCoverSlide(post.cover.text, post.cover.highlight, post.cover.image, brief));

  // Slides 1..N-2 — beats.
  for (let i = 0; i < post.slides.length; i++) {
    const s = post.slides[i]!;
    slides.push(buildBeatSlide(s, brief, slides.length));
  }

  // Slide N-1 — follow.
  slides.push(buildFollowSlide(post.follow, slides.length));

  return {
    format: 'carousel',
    storyType: pickStoryType(brief),
    source,
    sourceUrl,
    publishedAt,
    issueNumber,
    slides,
    caption,
    attributionBlock: buildAttributionBlock(brief, slides),
  };
}

/* ── Cover ─────────────────────────────────────────────────────────── */

function buildCoverSlide(text: string, highlight: string, imageRef: string, brief: Brief): SlideCopy {
  const briefImage = resolveBriefImage(imageRef, brief);
  const variant: Variant = pickCoverVariant(briefImage, brief);
  const headline = colorSpans(text, highlight, [], []);
  const slide: SlideCopy = {
    position: 0,
    layoutVariant: 'cover',
    variant,
    headline,
    altText: truncateAlt(text || 'Cover'),
  };
  if (briefImage?.link) {
    slide.photoUrl = briefImage.link;
    if (briefImage.credit) slide.photoCredit = shortPhotoCredit(briefImage.credit);
  }
  return slide;
}

function pickCoverVariant(image: BriefImage | undefined, brief: Brief): Variant {
  if (!image) return 'C3'; // type-only or free-text description
  if (isPortraitOfNamedSubject(image, brief)) return 'C1';
  return 'C2';
}

/**
 * Portrait detection: the IMAGE's description contains a proper-noun
 * sequence matching any name in brief TERMS. No LLM.
 */
function isPortraitOfNamedSubject(image: BriefImage, brief: Brief): boolean {
  const desc = image.description.toLowerCase();
  for (const term of brief.terms) {
    const name = term.name.trim();
    if (name.length < 3) continue;
    if (desc.includes(name.toLowerCase())) return true;
  }
  return false;
}

/* ── Beat slides ───────────────────────────────────────────────────── */

function buildBeatSlide(slide: ParsedSlide, brief: Brief, position: number): SlideCopy {
  const briefImage = resolveBriefImage(slide.image ?? '', brief);
  const highlightPhrase = slide.highlight ?? '';
  const pivotWords = collectPivotCandidates(brief);

  // BIG NUMBER present → data_block / D1
  if (slide.bigNumber) {
    const title = colorSpans(slide.bigNumber, highlightPhrase, [], []);
    const headline = slide.headline ? colorSpans(slide.headline, highlightPhrase, pivotWords, []) : undefined;
    const body = slide.body ? colorSpans(slide.body, highlightPhrase, pivotWords, []) : undefined;
    const out: SlideCopy = {
      position,
      layoutVariant: 'data_block',
      variant: 'D1',
      title,
      altText: truncateAlt(slide.bigNumber),
    };
    if (headline) out.headline = headline;
    if (body) out.body = body;
    if (briefImage?.link) {
      out.photoUrl = briefImage.link;
      if (briefImage.credit) out.photoCredit = shortPhotoCredit(briefImage.credit);
    }
    return out;
  }

  // HEADLINE only → story_beat / B5 landing (headline is the landing line)
  if (slide.headline && !slide.body) {
    return {
      position,
      layoutVariant: 'story_beat',
      variant: 'B5',
      headline: colorSpans(slide.headline, highlightPhrase, [], []),
      altText: truncateAlt(slide.headline),
    };
  }

  // BODY only → story_beat / B1 default (body-top only, no title)
  if (slide.body && !slide.headline) {
    const out: SlideCopy = {
      position,
      layoutVariant: 'story_beat',
      variant: 'B1',
      body: colorSpans(slide.body, highlightPhrase, pivotWords, []),
      altText: truncateAlt(slide.body),
    };
    if (briefImage?.link) {
      out.photoUrl = briefImage.link;
      out.photoTreatment = 'card';
      if (briefImage.credit) out.photoCredit = shortPhotoCredit(briefImage.credit);
    }
    return out;
  }

  // HEADLINE + BODY → story_beat / B1 chapter-mark stack (title + body)
  const out: SlideCopy = {
    position,
    layoutVariant: 'story_beat',
    variant: 'B1',
    title: colorSpans(slide.headline ?? '', highlightPhrase, [], []),
    body: colorSpans(slide.body ?? '', highlightPhrase, pivotWords, []),
    altText: truncateAlt(slide.headline ?? slide.body ?? ''),
  };
  if (briefImage?.link) {
    out.photoUrl = briefImage.link;
    out.photoTreatment = 'card';
    if (briefImage.credit) out.photoCredit = shortPhotoCredit(briefImage.credit);
  }
  return out;
}

/* ── Follow ────────────────────────────────────────────────────────── */

function buildFollowSlide(followText: string, position: number): SlideCopy {
  return {
    position,
    layoutVariant: 'follow',
    variant: 'F1',
    storySpecificLine: followText.trim(),
    altText: truncateAlt(followText || 'Follow Helios'),
  };
}

/* ── SpanRun construction ──────────────────────────────────────────── */

/**
 * Build a SpanRun from text: default `narrative`, mark `highlightPhrase`
 * as `hook`, and mark any pivot word (from `pivotWords` + date regex) as
 * `pivot`. Non-overlapping — highlight wins where they collide.
 */
export function colorSpans(
  text: string,
  highlightPhrase: string,
  pivotWords: string[],
  extraPivotPhrases: string[],
): SpanRun {
  if (!text) return [{ text: '', role: 'narrative' }];

  const markers: Array<{ start: number; end: number; role: Span['role'] }> = [];
  const pushMarker = (start: number, end: number, role: Span['role']) => {
    if (start >= end) return;
    markers.push({ start, end, role });
  };

  // Highlight (single phrase, exact) — hook role.
  if (highlightPhrase) {
    const idx = text.indexOf(highlightPhrase);
    if (idx >= 0) pushMarker(idx, idx + highlightPhrase.length, 'hook');
  }

  // Pivot words — case-insensitive, whole-word.
  for (const word of [...pivotWords, ...extraPivotPhrases]) {
    if (!word || word.length < 2) continue;
    const re = new RegExp(`\\b${escapeRegExp(word)}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushMarker(m.index, m.index + m[0].length, 'pivot');
    }
  }

  // Dates — simple ISO and month-day patterns.
  const dateRe = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:,\s*\d{4})?\b|\b(?:19|20)\d{2}\b/g;
  let dm: RegExpExecArray | null;
  while ((dm = dateRe.exec(text)) !== null) pushMarker(dm.index, dm.index + dm[0].length, 'pivot');

  // Resolve overlaps: sort by start; when overlapping, hook wins over pivot.
  const sorted = markers.slice().sort((a, b) => a.start - b.start);
  const resolved: typeof markers = [];
  for (const marker of sorted) {
    const last = resolved[resolved.length - 1];
    if (!last || marker.start >= last.end) {
      resolved.push(marker);
      continue;
    }
    // Overlap: hook wins.
    if (marker.role === 'hook' && last.role !== 'hook') {
      resolved.pop();
      resolved.push(marker);
    } else if (last.role === 'hook' && marker.role !== 'hook') {
      // Keep last.
      continue;
    } else {
      // Same role or hook/hook — keep the wider one.
      if (marker.end - marker.start > last.end - last.start) {
        resolved.pop();
        resolved.push(marker);
      }
    }
  }

  // Emit narrative/marker/narrative/... spans.
  const spans: Span[] = [];
  let cursor = 0;
  for (const marker of resolved) {
    if (marker.start > cursor) {
      spans.push({ text: text.slice(cursor, marker.start), role: 'narrative' });
    }
    spans.push({ text: text.slice(marker.start, marker.end), role: marker.role });
    cursor = marker.end;
  }
  if (cursor < text.length) {
    spans.push({ text: text.slice(cursor), role: 'narrative' });
  }
  if (spans.length === 0) spans.push({ text, role: 'narrative' });
  return spans;
}

function collectPivotCandidates(brief: Brief): string[] {
  return brief.terms
    .map((t) => t.name.trim())
    .filter((n) => n.length >= 2)
    .slice(0, 40);
}

/* ── storyType classifier (pure code) ──────────────────────────────── */

const STORY_TYPE_KEYWORDS: Array<{ type: StoryType; words: string[] }> = [
  { type: 'ai_funding', words: ['raises', 'raised', 'funding', 'valuation', 'series a', 'series b', 'series c', 'series d', 'series e', 'seed round'] },
  { type: 'model_launch', words: ['launch', 'releases', 'released', 'unveils', 'unveiled', 'gpt-', 'claude', 'gemini', 'llama', 'sonnet', 'opus', 'haiku'] },
  { type: 'agents', words: ['agent', 'agents', 'agentic', 'autonomous', 'tool use', 'multi-agent'] },
  { type: 'safety', words: ['safety', 'red team', 'alignment', 'jailbreak', 'refusal', 'sandbagging'] },
  { type: 'policy', words: ['regulation', 'regulator', 'senate', 'congress', 'executive order', 'eu ai act', 'export controls', 'ftc', 'antitrust'] },
  { type: 'infrastructure', words: ['data center', 'datacenter', 'chip', 'chips', 'gpu', 'gpus', 'tpu', 'cluster', 'megawatt', 'gigawatt'] },
  { type: 'benchmark', words: ['benchmark', 'eval', 'evaluation', 'score', 'leaderboard', 'mmlu', 'gsm8k'] },
  { type: 'leadership', words: ['ceo', 'cto', 'coo', 'president', 'chairman', 'chairperson', 'resigns', 'appointed', 'hired', 'left'] },
  { type: 'deal', words: ['acquires', 'acquired', 'acquisition', 'partnership', 'deal', 'contract', 'agreement'] },
  { type: 'research', words: ['research', 'paper', 'preprint', 'arxiv', 'authors', 'method', 'findings'] },
];

export function pickStoryType(brief: Brief): StoryType {
  const hay = `${brief.news} ${brief.story}`.toLowerCase();
  let bestType: StoryType = 'tech';
  let bestScore = 0;
  for (const entry of STORY_TYPE_KEYWORDS) {
    let score = 0;
    for (const w of entry.words) if (hay.includes(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      bestType = entry.type;
    }
  }
  return bestType;
}

/* ── Attribution + credits ──────────────────────────────────────────── */

function buildAttributionBlock(brief: Brief, slides: SlideCopy[]): string | undefined {
  const photos = slides
    .map((s) => (s.photoUrl && s.photoCredit ? s.photoCredit : null))
    .filter((c): c is string => Boolean(c));
  if (photos.length === 0) return undefined;
  const dedup = Array.from(new Set(photos));
  return `Photos:\n${dedup.join('\n')}`;
}

function shortPhotoCredit(credit: string): string {
  return credit.trim().replace(/\s+/g, ' ').toUpperCase();
}

/* ── Helpers ───────────────────────────────────────────────────────── */

function resolveBriefImage(ref: string, brief: Brief): BriefImage | undefined {
  const m = ref.match(/^brief image\s+(\d+)/i);
  if (!m) return undefined;
  const n = Number(m[1]);
  return brief.images.find((img) => img.number === n);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function truncateAlt(text: string): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > 120 ? `${clean.slice(0, 117)}...` : clean || 'Slide';
}
