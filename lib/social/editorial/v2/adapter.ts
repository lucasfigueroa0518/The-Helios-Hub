/**
 * Plain-text v2 output → renderer `Post` shape (design v1).
 *
 * Field-driven mapping per docs/DESIGN-V1-HANDOFF.md §Adapter:
 *
 *   QUOTE present                                       → quote
 *   SECOND NUMBER present                               → split_stat
 *   BIG NUMBER present                                  → stat
 *   IMAGE = "brief image N" (validated), no numbers/quote → image
 *   HEADLINE only (no body/numbers/quote/brief image)   → landing
 *   HEADLINE + BODY                                     → text
 *   BODY only (fallback, writer drift)                  → text (headline blank)
 *
 * Cover keeps its C1/C2/C3 codes (renderer branches on them). Non-cover
 * slides carry no `variant`.
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
  // Cover: orange highlight is allowed. Green (names) is not per spec.
  const headline = colorSpans(text, highlight, [], brief, /* allowGreen */ false);
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

/* ── Beat slides — field-driven type picker ───────────────────────── */

function buildBeatSlide(slide: ParsedSlide, brief: Brief, position: number): SlideCopy {
  const briefImage = resolveBriefImage(slide.image ?? '', brief);
  const highlight = slide.highlight ?? '';
  const altSeed = slide.headline || slide.body || slide.quote || slide.bigNumber || '';

  // 1. QUOTE → quote slide
  if (slide.quote) {
    const out: SlideCopy = {
      position,
      layoutVariant: 'quote',
      // The quote text can carry the highlight span (rare — spec allows
      // orange within QUOTE). Names inside quotes are NOT painted green
      // per the "green only on names of people/companies" rule combined
      // with the visual rule of one accent per slide.
      quoteText: colorSpans(slide.quote, highlight, [], brief, /* allowGreen */ false),
      altText: truncateAlt(slide.quote),
    };
    if (slide.quoteBy) out.quoteBy = slide.quoteBy.trim();
    // Optional round speaker photo — only when the brief image shows the
    // speaker. Portrait check: same rule as cover C1.
    if (briefImage?.link && isPortraitOfNamedSubject(briefImage, brief)) {
      out.photoUrl = briefImage.link;
      if (briefImage.credit) out.photoCredit = shortPhotoCredit(briefImage.credit);
    }
    return out;
  }

  // 2. SECOND NUMBER → split_stat slide
  if (slide.secondNumber) {
    const out: SlideCopy = {
      position,
      layoutVariant: 'split_stat',
      title: colorSpans(slide.bigNumber ?? '', highlight, [], brief, /* allowGreen */ false),
      altText: truncateAlt(slide.headline ?? slide.bigNumber ?? ''),
    };
    if (slide.headline) out.headline = colorSpans(slide.headline, highlight, [], brief, /* allowGreen */ true);
    if (slide.numberNote) out.numberNote = slide.numberNote.trim();
    out.secondNumber = slide.secondNumber.trim();
    if (slide.secondNote) out.secondNote = slide.secondNote.trim();
    if (briefImage?.link) {
      out.photoUrl = briefImage.link;
      if (briefImage.credit) out.photoCredit = shortPhotoCredit(briefImage.credit);
    }
    return out;
  }

  // 3. BIG NUMBER → stat slide
  if (slide.bigNumber) {
    const out: SlideCopy = {
      position,
      layoutVariant: 'stat',
      title: colorSpans(slide.bigNumber, highlight, [], brief, /* allowGreen */ false),
      altText: truncateAlt(slide.headline ?? slide.bigNumber),
    };
    if (slide.headline) out.headline = colorSpans(slide.headline, highlight, [], brief, /* allowGreen */ true);
    if (slide.body) out.body = colorSpans(slide.body, highlight, [], brief, /* allowGreen */ true);
    if (slide.numberNote) out.numberNote = slide.numberNote.trim();
    if (briefImage?.link) {
      out.photoUrl = briefImage.link;
      if (briefImage.credit) out.photoCredit = shortPhotoCredit(briefImage.credit);
    }
    return out;
  }

  // 4. IMAGE = brief image N (no numbers/quote above) → image slide
  if (briefImage?.link && slide.headline) {
    const out: SlideCopy = {
      position,
      layoutVariant: 'image',
      headline: colorSpans(slide.headline, highlight, [], brief, /* allowGreen */ true),
      photoUrl: briefImage.link,
      altText: truncateAlt(slide.headline),
    };
    if (briefImage.credit) out.photoCredit = shortPhotoCredit(briefImage.credit);
    if (slide.body) out.body = colorSpans(slide.body, highlight, [], brief, /* allowGreen */ true);
    return out;
  }

  // 5. HEADLINE only (no body / no numbers / no quote / no brief image) → landing
  if (slide.headline && !slide.body) {
    const out: SlideCopy = {
      position,
      layoutVariant: 'landing',
      headline: colorSpans(slide.headline, highlight, [], brief, /* allowGreen */ true),
      altText: truncateAlt(slide.headline),
    };
    if (slide.note) out.note = slide.note.trim();
    return out;
  }

  // 6. HEADLINE + BODY → text slide (also handles BODY-only fallback)
  const out: SlideCopy = {
    position,
    layoutVariant: 'text',
    altText: truncateAlt(altSeed),
  };
  if (slide.headline) out.headline = colorSpans(slide.headline, highlight, [], brief, /* allowGreen */ true);
  if (slide.body) out.body = colorSpans(slide.body, highlight, [], brief, /* allowGreen */ true);
  if (briefImage?.link) {
    out.photoUrl = briefImage.link;
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

/* ── Green-name rule ───────────────────────────────────────────────── */

/**
 * Technical / generic-noun deny list. A TERMS entry that matches one of
 * these — even if the writer capitalized it at the start of a sentence —
 * stays white. Words are matched lowercase, whole-token, so "sandbox"
 * blocks "Sandbox" too.
 */
const TECHNICAL_TERMS = new Set([
  'sandbox', 'inference', 'container', 'kernel', 'api', 'sdk', 'gpu', 'cpu',
  'latency', 'throughput', 'dns', 'resolver', 'tls', 'ssl', 'http', 'https',
  'json', 'yaml', 'sql', 'cache', 'queue', 'worker', 'daemon', 'thread',
  'process', 'runtime', 'kernel', 'compiler', 'agent', 'model', 'weights',
  'token', 'tokens', 'embedding', 'benchmark', 'dataset', 'pipeline',
  'framework', 'protocol', 'endpoint', 'schema', 'payload', 'firmware',
]);

const NAME_STOPWORDS = new Set(['of', 'and', 'the', 'for', 'de', 'la', 'von', 'van']);

/**
 * Should the term get a green (pivot) span on the slide?
 *
 * Rules (all three must hold):
 *   1. The match at the given position in the slide text starts with A–Z.
 *   2. If multi-word, every non-stopword token ≥ 3 chars starts with A–Z.
 *   3. The term (lowercased) is not in TECHNICAL_TERMS.
 *
 * Tests: OpenAI → green, Hugging Face → green, sandbox → white,
 * inference → white, DNS resolver → white, "openai" (lowercase in text) →
 * white, "Sandbox" at sentence start → white (deny-list wins).
 */
export function shouldColorGreen(termName: string, matchedText: string): boolean {
  if (!termName || !matchedText) return false;
  if (TECHNICAL_TERMS.has(termName.toLowerCase())) return false;
  // Rule 1: first char capital
  const firstChar = matchedText.charCodeAt(0);
  if (firstChar < 65 || firstChar > 90) return false;
  // Rule 2: every substantive word capitalized
  const words = matchedText.split(/\s+/);
  for (const w of words) {
    if (w.length < 3) continue;
    if (NAME_STOPWORDS.has(w.toLowerCase())) continue;
    const c = w.charCodeAt(0);
    if (c < 65 || c > 90) return false;
  }
  return true;
}

/* ── SpanRun construction ──────────────────────────────────────────── */

/**
 * Build a SpanRun from text: default `narrative`, mark `highlightPhrase`
 * as `hook` (orange), and mark green pivots only where the green-name
 * rule permits. `extraPivotPhrases` bypasses the rule (used for the
 * date regex).
 *
 * Non-overlapping — highlight wins where they collide.
 */
export function colorSpans(
  text: string,
  highlightPhrase: string,
  extraPivotPhrases: string[],
  brief: Brief | null,
  allowGreen: boolean,
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

  // Green name pivots — only when allowed on this slide type.
  if (allowGreen && brief) {
    for (const term of brief.terms) {
      const name = term.name.trim();
      if (name.length < 2) continue;
      const re = new RegExp(`\\b${escapeRegExp(name)}\\b`, 'g');
      let m: RegExpExecArray | null;
      while ((m = re.exec(text)) !== null) {
        if (shouldColorGreen(name, m[0])) {
          pushMarker(m.index, m.index + m[0].length, 'pivot');
        }
      }
    }
  }

  // Extra pivot phrases (used sparingly; ignored under the green-name rule
  // to keep dates + terms white per spec).
  for (const phrase of extraPivotPhrases) {
    if (!phrase || phrase.length < 2) continue;
    const re = new RegExp(`\\b${escapeRegExp(phrase)}\\b`, 'gi');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      pushMarker(m.index, m.index + m[0].length, 'pivot');
    }
  }

  // Resolve overlaps: sort by start; when overlapping, hook wins over pivot.
  const sorted = markers.slice().sort((a, b) => a.start - b.start);
  const resolved: typeof markers = [];
  for (const marker of sorted) {
    const last = resolved[resolved.length - 1];
    if (!last || marker.start >= last.end) {
      resolved.push(marker);
      continue;
    }
    if (marker.role === 'hook' && last.role !== 'hook') {
      resolved.pop();
      resolved.push(marker);
    } else if (last.role === 'hook' && marker.role !== 'hook') {
      continue;
    } else {
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

/* ── storyType classifier (pure code, kept for schema compliance) ──── */

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
