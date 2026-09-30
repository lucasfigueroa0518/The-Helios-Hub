/**
 * Code checks that run before every Fact-checker round.
 *
 * Rules from docs/HELIOS-PIPELINE-V2-HANDOFF.md §Orchestration rules → Code
 * checks: slide count 4-11 (cover + follow inclusive), char limits per field,
 * HIGHLIGHT must be an exact substring, brief-image-N must exist, caption
 * 400-800 ex-Source, no hashtags, banned phrases split into always-wrong vs
 * judgment, numbers trace against fetched source texts with normalization.
 */

import type { Brief, ParsedPost } from './parse';
import { BANNED_ALWAYS, BANNED_JUDGMENT } from './voice-block';

export type CheckErrorKind =
  | 'slide_count'
  | 'char_limit'
  | 'highlight_substring'
  | 'image_ref'
  | 'caption_length'
  | 'caption_hashtag'
  | 'banned_always'
  | 'banned_judgment'
  | 'number_trace'
  | 'rhythm'
  | 'variety'
  | 'cover_photo'
  | 'cover_photo_unnamed'
  | 'cover_fit'
  | 'quote_verbatim'
  | 'term_unexplained'
  | 'stat_missing_note'
  | 'past_statement_reference'
  | 'sequence_incomplete'
  | 'outline_kind_mismatch'
  | 'slide_repeats'
  | 'cover_claim_uniqueness';

export type CheckError = {
  kind: CheckErrorKind;
  target: 'slide' | 'cover' | 'follow' | 'caption';
  slidePosition?: number;
  field?: string;
  message: string;
  /** For banned_judgment: the word so the Editor can decide judgment vs banned use. */
  word?: string;
};

export type CheckReport = { ok: boolean; errors: CheckError[] };

/** Character budgets from §Orchestration rules + design v1. */
export const LIMITS = {
  // Cover tightened 100 → 90 (2026-09-29). The template is fixed by
  // design v1 and can't be restyled; at 100 chars the headline drops to
  // xl=60px and collides with the fixed-position orange arrow bottom-
  // right on the Suleyman preview. 90 chars gives the headline the lg
  // (72px) step or better and clears the arrow.
  cover: 90,
  headline: 60,
  body: 220,
  bigNumber: 12,
  follow: 100,
  note: 60,
  numberNote: 60,
  secondNumber: 12,
  secondNote: 60,
  // Quote cap tightened from 200 → 140 (2026-09-29). At 69px Pragmatica
  // on 888px inner width, 200 chars overflowed the canvas and pushed
  // the attribution off the bottom on the Suleyman preview (slide 5).
  // 140 chars = ~3 lines at that face + size, leaving room for the
  // orange glyph, the round speaker photo, and the attribution above
  // the 1350px slide bottom.
  quote: 140,
  quoteBy: 60,
  /**
   * Cap on the FULL published caption — Caption stage output PLUS the
   * image-credit block that the publish pipeline appends. Includes the
   * "Source:" line. No minimum.
   */
  captionMax: 2200,
  /**
   * STORY slides between the cover and the follow slide. Cover + follow
   * are anchors and don't count. A post has 5 to 8 story slides,
   * meaning `post.slides.length` (which excludes cover + follow) is
   * between 5 and 8 inclusive. Total published slides run 7–10 — inside
   * Instagram's 10-item carousel cap. Max lowered from 10 on 2026-09-29
   * per docs/RULE-CONFLICTS-2026-09-29.md item 3.
   */
  storySlidesMin: 5,
  storySlidesMax: 8,
};

/**
 * Cover with a photo of a person must NAME that person in the cover
 * text (Tommy's rule, 2026-09-29 late second pass). Full name, or
 * "Rep./Sen./Gov./CEO/etc. + surname", or the surname alone next to a
 * relevant role. If the cover text doesn't contain the surname, the
 * Editor is asked to add it (still within 90 chars, still passing
 * cover-fit). If it still can't be added, the pipeline drops the photo
 * and the cover goes type-only.
 *
 * Called from the orchestrate ship path (post-image-step, pre-final-gate)
 * with the picked cover subject. Returns a HARD `cover_photo_unnamed`
 * error when the surname is missing.
 */
export function checkCoverNamesPicturedPerson(
  cover: ParsedPost['cover'],
  coverPersonName: string | undefined,
): CheckReport {
  const errors: CheckError[] = [];
  if (!coverPersonName) return { ok: true, errors };
  const surname = extractSurname(coverPersonName);
  if (!surname) return { ok: true, errors };
  const text = (cover.text ?? '').toLowerCase();
  if (text.includes(surname.toLowerCase())) return { ok: true, errors };
  errors.push({
    kind: 'cover_photo_unnamed',
    target: 'cover',
    field: 'TEXT',
    message: `COVER TEXT does not name the pictured person ("${coverPersonName}"). Photo covers must lead with the person: add their surname (or role + surname, e.g. "Rep. ${surname}") to the cover — keep it under 90 chars and passing cover-fit. If you can't fit the name, drop the photo and go type-only.`,
  });
  return { ok: false, errors };
}

/**
 * Extract the surname from a person's name. Handles common shapes:
 * "Josh Gottheimer" → "Gottheimer"; "Mary R. Barra" → "Barra";
 * "Dr. Fei-Fei Li" → "Li"; "Sam Altman" → "Altman".
 * Returns null when the input isn't a person-shaped name.
 */
function extractSurname(fullName: string): string | null {
  const cleaned = fullName.replace(/\([^)]*\)/g, '').trim();
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 2) return null;
  // Drop leading titles.
  const titles = /^(mr|mrs|ms|dr|prof|sir|dame|rep|sen|gov|pres|hon)\.?$/i;
  while (tokens.length > 1 && titles.test(tokens[0]!)) tokens.shift();
  // Return the last token, minus trailing punctuation.
  const last = tokens[tokens.length - 1]!.replace(/[.,;:!?]+$/g, '');
  return last.length >= 2 ? last : null;
}

/**
 * Canonical cover-text character counter. One source of truth for every
 * place that reports "cover length" — summary.md, code-checks, prompts,
 * replay, docs. Counts the visible text (post.cover.text) exactly; no
 * markup, no highlight tags, no HTML. If a caller uses .length directly
 * elsewhere and produces a different number, that caller is wrong.
 * 2026-09-29 late: the count drifted across summary (90), replay report
 * (108 — my visual estimate, not a computed value), and my off-the-cuff
 * "118" (which was the OTHER Suleyman run). Making the counter a named
 * exported function prevents future drift.
 */
export function countCoverChars(cover: ParsedPost['cover']): number {
  return (cover.text ?? '').length;
}

export function checkPost(post: ParsedPost, brief: Brief): CheckReport {
  const errors: CheckError[] = [];

  // ── Story-slide count. Cover + follow are anchors and don't count.
  // A post has 5–10 story slides (post.slides.length in the parser
  // excludes cover + follow, so we check it directly).
  const storySlides = post.slides.length;
  if (storySlides < LIMITS.storySlidesMin) {
    const short = LIMITS.storySlidesMin - storySlides;
    errors.push({
      kind: 'slide_count',
      target: 'slide',
      message: `Story-slide count is ${storySlides} (cover + follow don't count). The minimum is ${LIMITS.storySlidesMin}. Add at least ${short} more slide${short === 1 ? '' : 's'} between the cover and the follow slide.`,
    });
  }
  if (storySlides > LIMITS.storySlidesMax) {
    const over = storySlides - LIMITS.storySlidesMax;
    errors.push({
      kind: 'slide_count',
      target: 'slide',
      message: `Story-slide count is ${storySlides} (cover + follow don't count). The maximum is ${LIMITS.storySlidesMax}. Cut at least ${over} slide${over === 1 ? '' : 's'} between the cover and the follow slide.`,
    });
  }

  // ── Cover length + highlight substring + image reference
  const coverText = post.cover.text ?? '';
  const coverChars = countCoverChars(post.cover); // canonical counter
  if (coverChars > LIMITS.cover) {
    errors.push({
      kind: 'char_limit',
      target: 'cover',
      field: 'TEXT',
      message: makeCharLimitMessage('COVER TEXT', coverChars, LIMITS.cover),
    });
  }
  const coverHighlight = post.cover.highlight ?? '';
  if (coverHighlight && !coverText.includes(coverHighlight)) {
    errors.push({
      kind: 'highlight_substring',
      target: 'cover',
      field: 'HIGHLIGHT',
      message: `COVER HIGHLIGHT ("${coverHighlight}") is not an exact substring of the cover text (${coverChars} characters). Rewrite the highlight so it matches a phrase in the cover verbatim, or edit the cover to include the highlight phrase word-for-word.`,
    });
  }
  const coverImageError = checkImageRef(post.cover.image ?? '', brief);
  if (coverImageError) {
    errors.push({ kind: 'image_ref', target: 'cover', field: 'IMAGE', message: coverImageError });
  }
  // Cover-photo soft check: if THE NEWS names a person and the writer
  // put "type only" on the cover, send it back to the Editor. Per
  // spec: "The cover asks for a photo of the person or organization at
  // the center of the story."
  const coverImage = (post.cover.image ?? '').trim().toLowerCase();
  if (coverImage === 'type only' && briefNewsNamesAPerson(brief)) {
    errors.push({
      kind: 'cover_photo',
      target: 'cover',
      field: 'IMAGE',
      message: `COVER IMAGE is "type only" but THE NEWS names a person (${describePersonInNews(brief) ?? 'see brief'}). Change COVER IMAGE to "photo of <that person or organization>" — the cover should show whoever is at the center of the story.`,
    });
  }
  errors.push(...scanVoiceOnText('cover', 'TEXT', coverText, undefined, LIMITS.cover));

  // ── Per-slide checks
  for (const slide of post.slides) {
    if (slide.headline && slide.headline.length > LIMITS.headline) {
      errors.push({
        kind: 'char_limit',
        target: 'slide',
        slidePosition: slide.position,
        field: 'HEADLINE',
        message: makeCharLimitMessage(`SLIDE ${slide.position} HEADLINE`, slide.headline.length, LIMITS.headline),
      });
    }
    if (slide.body && slide.body.length > LIMITS.body) {
      errors.push({
        kind: 'char_limit',
        target: 'slide',
        slidePosition: slide.position,
        field: 'BODY',
        message: makeCharLimitMessage(`SLIDE ${slide.position} BODY`, slide.body.length, LIMITS.body),
      });
    }
    if (slide.bigNumber && slide.bigNumber.length > LIMITS.bigNumber) {
      errors.push({
        kind: 'char_limit',
        target: 'slide',
        slidePosition: slide.position,
        field: 'BIG NUMBER',
        message: makeCharLimitMessage(`SLIDE ${slide.position} BIG NUMBER`, slide.bigNumber.length, LIMITS.bigNumber),
      });
    }
    // Design v1 length limits
    const perFieldLimit = (name: string, val: string | undefined, limit: number) => {
      if (val && val.length > limit) {
        errors.push({
          kind: 'char_limit',
          target: 'slide',
          slidePosition: slide.position,
          field: name,
          message: makeCharLimitMessage(`SLIDE ${slide.position} ${name}`, val.length, limit),
        });
      }
    };
    perFieldLimit('NOTE', slide.note, LIMITS.note);
    perFieldLimit('NUMBER NOTE', slide.numberNote, LIMITS.numberNote);
    perFieldLimit('SECOND NUMBER', slide.secondNumber, LIMITS.secondNumber);
    perFieldLimit('SECOND NOTE', slide.secondNote, LIMITS.secondNote);
    perFieldLimit('QUOTE', slide.quote, LIMITS.quote);
    perFieldLimit('QUOTE BY', slide.quoteBy, LIMITS.quoteBy);
    // HIGHLIGHT must be an exact substring of one of the slide's visible
    // copy fields. Includes stat-slide fields (BIG NUMBER, NUMBER NOTE,
    // SECOND NUMBER, SECOND NOTE) so a stat slide can highlight its own
    // number or its number-note — 2026-09-29 Suleyman replay found the
    // check falsely flagged SLIDE 9 HIGHLIGHT="~1,200" as unresolved
    // because BIG NUMBER wasn't in the haystack.
    if (slide.highlight) {
      const hayFields = [
        slide.headline,
        slide.body,
        slide.quote,
        slide.note,
        slide.numberNote,
        slide.secondNote,
        slide.bigNumber,
        slide.secondNumber,
      ];
      const hay = hayFields.filter(Boolean).join('\n');
      if (!hay.includes(slide.highlight)) {
        const lens = {
          HEADLINE: (slide.headline ?? '').length,
          BODY: (slide.body ?? '').length,
          QUOTE: (slide.quote ?? '').length,
          NOTE: (slide.note ?? '').length,
          'BIG NUMBER': (slide.bigNumber ?? '').length,
          'NUMBER NOTE': (slide.numberNote ?? '').length,
          'SECOND NUMBER': (slide.secondNumber ?? '').length,
          'SECOND NOTE': (slide.secondNote ?? '').length,
        };
        const nonEmpty = Object.entries(lens).filter(([, l]) => l > 0);
        const summary = nonEmpty.map(([n, l]) => `${n} (${l} chars)`).join(', ');
        errors.push({
          kind: 'highlight_substring',
          target: 'slide',
          slidePosition: slide.position,
          field: 'HIGHLIGHT',
          message: `SLIDE ${slide.position} HIGHLIGHT ("${slide.highlight}") is not an exact substring of any of the slide's visible fields: ${summary || '(all empty)'}. Rewrite the highlight so it matches a phrase in the slide verbatim, or edit the slide to include the highlight phrase word-for-word.`,
        });
      }
    }
    if (slide.image) {
      const err = checkImageRef(slide.image, brief);
      if (err) errors.push({ kind: 'image_ref', target: 'slide', slidePosition: slide.position, field: 'IMAGE', message: err });
    }
    errors.push(...scanVoiceOnText('slide', 'HEADLINE', slide.headline ?? '', slide.position, LIMITS.headline));
    errors.push(...scanVoiceOnText('slide', 'BODY', slide.body ?? '', slide.position, LIMITS.body));
  }

  // ── FOLLOW
  if (post.follow.length > LIMITS.follow) {
    errors.push({
      kind: 'char_limit',
      target: 'follow',
      field: 'TEXT',
      message: makeCharLimitMessage('FOLLOW TEXT', post.follow.length, LIMITS.follow),
    });
  }
  errors.push(...scanVoiceOnText('follow', 'TEXT', post.follow, undefined, LIMITS.follow));

  // ── Rhythm: no two consecutive slides share a type (soft). Cover +
  // follow don't participate. Only compares the middle N slides.
  const typeOf = classifySlideType;
  for (let i = 1; i < post.slides.length; i++) {
    const prev = post.slides[i - 1]!;
    const cur = post.slides[i]!;
    const prevType = typeOf(prev);
    const curType = typeOf(cur);
    if (prevType === curType) {
      errors.push({
        kind: 'rhythm',
        target: 'slide',
        slidePosition: cur.position,
        field: 'TYPE',
        message: `SLIDE ${cur.position} and SLIDE ${prev.position} are both "${curType}" slides. Two slides in a row of the same kind reads as repetition. Change one to a different kind (Text / Landing / Stat / Split stat / Quote / Image) or merge them.`,
      });
    }
  }

  // ── Variety (soft): a post with 6+ slides between the cover and the
  // follow slide must use at least 3 different slide kinds — otherwise
  // the whole carousel reads as one long note. Under 6 middle slides
  // there isn't enough space for 3 kinds to matter; skip the check.
  const middleSlides = post.slides; // post.slides is already just the middle beats (cover + follow are separate)
  if (middleSlides.length >= 6) {
    const kinds = new Set(middleSlides.map(typeOf));
    if (kinds.size < 3) {
      const kindList = [...kinds].join(', ');
      errors.push({
        kind: 'variety',
        target: 'slide',
        field: 'TYPES',
        message: `This post has ${middleSlides.length} slides between the cover and the follow slide but only ${kinds.size} distinct kind${kinds.size === 1 ? '' : 's'} (${kindList}). A long post needs at least 3 different kinds — mix in a Landing line, Stat, Split stat, Quote or Image slide so the carousel doesn't read as one long note.`,
      });
    }
  }

  // Terms explained: every TERM used in a slide must be explained on that
  // slide or the very next one, using its description from the brief's
  // TERMS list. "Explained" = the TERM's description appears in either
  // the same slide's text or the next slide's text (fuzzy substring).
  for (const err of checkTermsExplained(post, brief)) errors.push(err);

  // Main-story-only: cite-of-prior-statement patterns. Rule (docs/
  // HELIOS-PIPELINE-V2-HANDOFF.md): "Earlier statements, later
  // announcements and other companies' news are separate stories, even
  // when sources connect them." A slide that leans on "its earlier
  // writing", "the CEO previously argued", "in an earlier essay", etc.,
  // is pulling in a separate story to fill space. Cut it or replace it
  // with content about the actual news. Runs on cover, every slide, and
  // the follow line.
  for (const err of checkNoPastStatement('cover', 'TEXT', coverText, undefined)) errors.push(err);
  for (const slide of post.slides) {
    for (const err of checkNoPastStatement('slide', 'HEADLINE', slide.headline ?? '', slide.position)) errors.push(err);
    for (const err of checkNoPastStatement('slide', 'BODY', slide.body ?? '', slide.position)) errors.push(err);
    for (const err of checkNoPastStatement('slide', 'NOTE', slide.note ?? '', slide.position)) errors.push(err);
    for (const err of checkNoPastStatement('slide', 'QUOTE', slide.quote ?? '', slide.position)) errors.push(err);
  }
  for (const err of checkNoPastStatement('follow', 'TEXT', post.follow, undefined)) errors.push(err);

  // Numbered-sequence integrity. Rule: if the post labels beats with
  // ordinals ("first objection", "second phase", "third round"), every
  // ordinal up to the highest used must be present AND they must appear
  // in slide-position order. Run 2026-09-29T06-45-36 shipped
  // "first objection" on SLIDE 7 and "third objection" on SLIDE 9 with
  // no "second objection" anywhere — a broken sequence the reader
  // notices instantly.
  for (const err of checkSequenceIntegrity(post)) errors.push(err);

  // Stat slides must be self-explanatory. A slide with BIG NUMBER but no
  // NUMBER NOTE (or no HEADLINE) is a floating number with nothing anchoring
  // it to the story. Same for SECOND NUMBER + SECOND NOTE on split stats.
  for (const slide of post.slides) {
    if (slide.bigNumber && !slide.numberNote) {
      errors.push({
        kind: 'stat_missing_note',
        target: 'slide',
        slidePosition: slide.position,
        field: 'NUMBER NOTE',
        message: `SLIDE ${slide.position} has BIG NUMBER "${slide.bigNumber}" but no NUMBER NOTE. A stat slide must say what its number is about on the same slide. Add a NUMBER NOTE (≤60 chars) that anchors the number to the story, or cut the slide / convert it to a Text slide.`,
      });
    }
    if (slide.bigNumber && !slide.headline) {
      errors.push({
        kind: 'stat_missing_note',
        target: 'slide',
        slidePosition: slide.position,
        field: 'HEADLINE',
        message: `SLIDE ${slide.position} has BIG NUMBER "${slide.bigNumber}" but no HEADLINE. A stat slide needs a headline that tells the reader what claim the number supports.`,
      });
    }
    if (slide.secondNumber && !slide.secondNote) {
      errors.push({
        kind: 'stat_missing_note',
        target: 'slide',
        slidePosition: slide.position,
        field: 'SECOND NOTE',
        message: `SLIDE ${slide.position} has SECOND NUMBER "${slide.secondNumber}" but no SECOND NOTE. A split-stat slide must label each number.`,
      });
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Validate the Writer's OUTLINE before its slide prose is trusted.
 * Runs the same three structural checks that later hit prose (slide
 * count 5-10, no consecutive same-kind, variety ≥3 kinds when 6+
 * slides), plus a "kind must be one of the recognized kinds" check.
 * Emits `outline_invalid` errors that the orchestrator translates into
 * a Writer CHECK ERRORS retry.
 *
 * 2026-09-29 late: replaces the post-hoc kind snapshot with a
 * validate-before-prose gate. The Writer now writes an OUTLINE first,
 * code validates it, and only a valid OUTLINE gets accepted as the
 * approved plan.
 */
export function validateOutline(
  outline: ReadonlyArray<{
    position: number;
    kind: string;
    beat: string;
    headline?: string;
    note?: string;
    bigNumber?: string;
    numberNote?: string;
    secondNumber?: string;
    secondNote?: string;
    quote?: string;
    quoteBy?: string;
  }> | undefined,
): CheckReport {
  const errors: CheckError[] = [];
  if (!outline) {
    errors.push({
      kind: 'outline_kind_mismatch',
      target: 'slide',
      field: 'OUTLINE',
      message: 'Writer did not emit an OUTLINE: block before the slides. Add "OUTLINE:" as the first line of the response, followed by one line per slide: "SLIDE N: <kind> — <beat>". Kinds: text, landing, stat, split_stat, quote, image.',
    });
    return { ok: false, errors };
  }
  if (outline.length < LIMITS.storySlidesMin) {
    errors.push({
      kind: 'outline_kind_mismatch',
      target: 'slide',
      field: 'OUTLINE',
      message: `OUTLINE has ${outline.length} slide(s); minimum is ${LIMITS.storySlidesMin}. Add ${LIMITS.storySlidesMin - outline.length} more slide(s) to the OUTLINE before writing prose.`,
    });
  }
  if (outline.length > LIMITS.storySlidesMax) {
    errors.push({
      kind: 'outline_kind_mismatch',
      target: 'slide',
      field: 'OUTLINE',
      message: `OUTLINE has ${outline.length} slide(s); maximum is ${LIMITS.storySlidesMax}. Cut ${outline.length - LIMITS.storySlidesMax} slide(s).`,
    });
  }
  const VALID_KINDS = new Set(['text', 'landing', 'stat', 'split_stat', 'quote', 'image']);
  for (const [i, s] of outline.entries()) {
    if (!VALID_KINDS.has(s.kind)) {
      errors.push({
        kind: 'outline_kind_mismatch',
        target: 'slide',
        slidePosition: s.position,
        field: 'OUTLINE KIND',
        message: `SLIDE ${s.position} OUTLINE kind "${s.kind}" is not one of ${[...VALID_KINDS].join(', ')}. Rewrite with a valid kind.`,
      });
    }
    // Beat is required only for text/image kinds (which don't carry
    // fixed-length content fields). Non-text kinds' content lives in
    // headline/quote/note fields validated below.
    if ((s.kind === 'text' || s.kind === 'image') && (!s.beat || s.beat.length < 6)) {
      errors.push({
        kind: 'outline_kind_mismatch',
        target: 'slide',
        slidePosition: s.position,
        field: 'OUTLINE BEAT',
        message: `SLIDE ${s.position} OUTLINE beat is missing or under 6 chars. Add a one-sentence beat describing what the slide says.`,
      });
    }
    if (i > 0 && outline[i - 1]!.kind === s.kind) {
      errors.push({
        kind: 'outline_kind_mismatch',
        target: 'slide',
        slidePosition: s.position,
        field: 'OUTLINE KIND',
        message: `OUTLINE: SLIDE ${outline[i - 1]!.position} and SLIDE ${s.position} are both "${s.kind}". No two consecutive slides may share a kind — change one to a different kind (text / landing / stat / split_stat / quote / image) or merge them.`,
      });
    }
    // Content-aware length checks (2026-09-29 late second pass). Non-text
    // kinds carry fixed-length content that MUST fit on the slide as
    // written; a landing NOTE at 97 chars can't be rendered as a landing
    // without the Editor demoting the slide to text — which then breaks
    // rhythm. Reject the OUTLINE now, force the Writer to cut words.
    const checkField = (field: string, value: string | undefined, limit: number, required: boolean) => {
      if (!value) {
        if (required) errors.push({
          kind: 'outline_kind_mismatch', target: 'slide', slidePosition: s.position, field: `OUTLINE ${field}`,
          message: `SLIDE ${s.position} OUTLINE ${s.kind} is missing required ${field}. Add "${field.toLowerCase()}: <value>" to the outline line.`,
        });
        return;
      }
      if (value.length > limit) errors.push({
        kind: 'outline_kind_mismatch', target: 'slide', slidePosition: s.position, field: `OUTLINE ${field}`,
        message: `SLIDE ${s.position} OUTLINE ${s.kind} ${field} is ${value.length} chars, limit ${limit}. Cut ${value.length - limit} chars — this kind can't be approved unless its content already fits on the slide as rendered. If you can't cut, change the kind to "text" (which allows a longer body).`,
      });
    };
    switch (s.kind) {
      case 'landing':
        checkField('HEADLINE', s.headline, LIMITS.headline, true);
        checkField('NOTE', s.note, LIMITS.note, false);
        break;
      case 'quote':
        checkField('QUOTE', s.quote, LIMITS.quote, true);
        checkField('BY', s.quoteBy, LIMITS.quoteBy, true);
        break;
      case 'stat':
        checkField('HEADLINE', s.headline, LIMITS.headline, true);
        checkField('BIG', s.bigNumber, LIMITS.bigNumber, true);
        checkField('NOTE', s.numberNote ?? s.note, LIMITS.numberNote, true);
        break;
      case 'split_stat':
        checkField('HEADLINE', s.headline, LIMITS.headline, true);
        checkField('BIG', s.bigNumber, LIMITS.bigNumber, true);
        checkField('NOTE', s.numberNote ?? s.note, LIMITS.numberNote, true);
        checkField('SECOND', s.secondNumber, LIMITS.secondNumber, true);
        checkField('SECOND NOTE', s.secondNote, LIMITS.secondNote, true);
        break;
      // text and image kinds don't have fixed short content — the beat is
      // just a description of what the slide says.
    }
  }
  if (outline.length >= LONG_POST_STORY_SLIDE_THRESHOLD_FOR_VARIETY) {
    const kinds = new Set(outline.map((s) => s.kind));
    if (kinds.size < 3) {
      errors.push({
        kind: 'outline_kind_mismatch',
        target: 'slide',
        field: 'OUTLINE VARIETY',
        message: `OUTLINE has ${outline.length} slides but only ${kinds.size} distinct kind(s) (${[...kinds].join(', ')}). A 6+-slide post needs at least 3 different kinds — mix in another kind.`,
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

const LONG_POST_STORY_SLIDE_THRESHOLD_FOR_VARIETY = 6;

/**
 * Compare the FINAL post's slide kinds against the approved outline
 * (post-enforce-structure Writer draft). Any kind change on a surviving
 * position is a mismatch. Position drift (add/drop slides) is reported
 * as a length delta rather than per-slot, so a reordered post with the
 * same kinds doesn't spam N errors.
 *
 * Soft: a mismatch surfaces in the summary and to the Editor as a repair
 * hint, but doesn't hard-fail the run — Editor kind changes during
 * fact-check repair are sometimes the right fix. HARD would over-block.
 */
export function checkOutlineMatch(
  post: ParsedPost,
  approved: ReadonlyArray<{ position: number; kind: string }> | undefined,
): CheckReport {
  const errors: CheckError[] = [];
  if (!approved || approved.length === 0) return { ok: true, errors };
  const finalByPos = new Map(post.slides.map((s) => [s.position, classifySlideType(s)]));
  const approvedByPos = new Map(approved.map((s) => [s.position, s.kind]));
  for (const [pos, approvedKind] of approvedByPos) {
    const finalKind = finalByPos.get(pos);
    if (finalKind === undefined) continue; // slide dropped; length-delta handles it
    if (finalKind !== approvedKind) {
      errors.push({
        kind: 'outline_kind_mismatch',
        target: 'slide',
        slidePosition: pos,
        field: 'KIND',
        message: `SLIDE ${pos} kind changed from "${approvedKind}" (approved outline, post-enforce-structure) to "${finalKind}" (final post). Editor / soft-repair pass silently restructured this slide. Restore the approved kind (Text / Landing / Stat / Split stat / Quote / Image) or, if the change was intentional to satisfy another check, note the reason in EDIT NOTES.`,
      });
    }
  }
  const approvedLen = approved.length;
  const finalLen = post.slides.length;
  if (approvedLen !== finalLen) {
    errors.push({
      kind: 'outline_kind_mismatch',
      target: 'slide',
      field: 'COUNT',
      message: `Slide count changed from ${approvedLen} (approved outline) to ${finalLen} (final post). Editor / soft-repair added or dropped ${Math.abs(approvedLen - finalLen)} slide(s). Verify the change was intentional; if not, restore the outline.`,
    });
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Cite-of-prior-statement patterns. Each pattern names the exact clause
 * shape the model reaches for when it wants to lean on a *separate*
 * prior story to fill a slide. Deliberately narrow — bare words like
 * "earlier" or "before" have too many legitimate uses.
 *
 * Kept as an exported array so the Editor prompt can reference the same
 * shapes and so the check + prompt can't drift.
 */
export const PAST_STATEMENT_PATTERNS: Array<{ pattern: string; label: string }> = [
  { pattern: '\\bearlier\\s+writ(?:e|es|ing|ings|ten)\\b', label: '"earlier writing/writings/written"' },
  { pattern: '\\bearlier\\s+(?:said|wrote|argued|warned|claimed|noted|maintained|stated|held|posted|published)\\b', label: '"earlier said/wrote/argued/warned/…"' },
  { pattern: '\\b(?:has|had|have)\\s+long\\s+(?:argued|said|maintained|warned|claimed|held|written|wrote|contended|insisted)\\b', label: '"has long argued/said/maintained/…"' },
  { pattern: '\\bpreviously\\s+(?:said|argued|written|wrote|warned|claimed|noted|stated|held|maintained|posted|published|contended)\\b', label: '"previously said/argued/written/…"' },
  { pattern: '\\bin\\s+(?:an|a|its|his|her|their)\\s+earlier\\s+(?:essay|post|statement|paper|interview|blog|piece|letter|memo|thread|response|writing)\\b', label: '"in an earlier essay/post/statement/…"' },
  { pattern: '\\blong[- ]?standing\\s+(?:position|stance|view|argument|claim)\\b', label: '"long-standing position/stance/view"' },
  // 2026-09-29 late: reverted 3 additional patterns for "its public
  // position is X" / "its constitution says Y". Reworded prior-work
  // references are a semantic call, not a regex call — the Fact-checker
  // (LLM, on FULL sources) is the correct enforcer for those. Keeping a
  // regex would either over-block ("its public position on climate is
  // X" — legitimate news about a new position) or drift with English
  // paraphrasing. Only the 6 patterns above stay — each names a very
  // narrow explicit-temporal cue ("earlier writing", "has long argued")
  // that can't be misread as current-news content.
];

/**
 * Check one field for cite-of-prior-statement patterns. Returns one
 * error per matched pattern; the message names the exact clause so the
 * Editor knows which words to cut without hunting.
 */
function checkNoPastStatement(
  target: CheckError['target'],
  field: string,
  text: string,
  slidePosition: number | undefined,
): CheckError[] {
  const out: CheckError[] = [];
  if (!text) return out;
  const label = labelFor(target, slidePosition, field);
  for (const { pattern, label: what } of PAST_STATEMENT_PATTERNS) {
    const re = new RegExp(pattern, 'iu');
    const m = re.exec(text);
    if (m) {
      out.push({
        kind: 'past_statement_reference',
        target,
        slidePosition,
        field,
        message: `${label}: contains ${what} ("${m[0]}"). Earlier statements are a separate story from the main news, even when sources link them. Cut the clause and either drop the slide, replace it with content about the actual news, or, if the point is essential, restate it without citing the prior statement.`,
      });
    }
  }
  return out;
}

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8,
};
const CARDINAL_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8,
};
// Nouns that almost never act as a sequence marker even next to a numeric
// word (e.g., "one time", "one place", "first person", "half two", "third
// party", "one grade", "one class"). Kept alphabetized for review.
const SEQUENCE_DENY_NOUNS = new Set([
  'class', 'floor', 'grade', 'half', 'party', 'person', 'place', 'quarter', 'time',
]);

/**
 * Scan every slide's text for enumeration markers and flag any incomplete
 * or out-of-order sequence. Three surface forms are recognized:
 *
 *   `<ordinal> <noun>`   "first objection", "third phase"
 *   `<noun> <cardinal>`  "objection one", "objection three" (2026-09-29
 *                        Suleyman run: SLIDE 6 + SLIDE 8 used this form
 *                        and the old check missed it entirely)
 *   `<noun> <digit>`     "objection 1", "phase 3"
 *
 * For each noun, if any ordinal in [1..max(used)] is missing OR the
 * ordinals don't appear in ascending slide-position order, emit one
 * error.
 */
function checkSequenceIntegrity(post: ParsedPost): CheckError[] {
  const errors: CheckError[] = [];
  const groups = new Map<string, Array<{ position: number; ord: number; match: string }>>();
  const push = (noun: string, position: number, ord: number, match: string) => {
    const key = noun.toLowerCase();
    if (SEQUENCE_DENY_NOUNS.has(key)) return;
    const arr = groups.get(key) ?? [];
    arr.push({ position, ord, match });
    groups.set(key, arr);
  };
  const ordRe = new RegExp(`\\b(${Object.keys(ORDINAL_WORDS).join('|')})\\s+([a-z]{4,20})\\b`, 'giu');
  const cardBeforeRe = new RegExp(`\\b([a-z]{4,20})\\s+(${Object.keys(CARDINAL_WORDS).join('|')})\\b`, 'giu');
  const digitAfterRe = new RegExp(`\\b([a-z]{4,20})\\s+(\\d{1,2})\\b`, 'giu');
  const scan = (position: number, text: string | undefined) => {
    if (!text) return;
    let m: RegExpExecArray | null;
    while ((m = ordRe.exec(text)) !== null) {
      push(m[2]!, position, ORDINAL_WORDS[m[1]!.toLowerCase()]!, m[0]);
    }
    while ((m = cardBeforeRe.exec(text)) !== null) {
      // Skip if this "<word> <cardinal>" match is really a two-word phrase
      // whose noun is a stop-word ("said one", "wrote two lines"). Leaving
      // the deny-list to catch these keeps the check narrow.
      push(m[1]!, position, CARDINAL_WORDS[m[2]!.toLowerCase()]!, m[0]);
    }
    while ((m = digitAfterRe.exec(text)) !== null) {
      const d = Number(m[2]);
      if (d < 1 || d > 8) continue;
      push(m[1]!, position, d, m[0]);
    }
  };
  for (const s of post.slides) {
    scan(s.position, s.headline);
    scan(s.position, s.body);
    scan(s.position, s.note);
    scan(s.position, s.quote);
  }
  for (const [noun, occurrences] of groups) {
    if (occurrences.length < 2) continue;
    const ordsSeen = [...new Set(occurrences.map((o) => o.ord))].sort((a, b) => a - b);
    const maxOrd = ordsSeen[ordsSeen.length - 1]!;
    const missing: number[] = [];
    for (let i = 1; i < maxOrd; i++) {
      if (!ordsSeen.includes(i)) missing.push(i);
    }
    const nameOf = (n: number): string => Object.keys(ORDINAL_WORDS).find((k) => ORDINAL_WORDS[k] === n) ?? String(n);
    if (missing.length > 0) {
      const firstUse = occurrences[0]!;
      errors.push({
        kind: 'sequence_incomplete',
        target: 'slide',
        slidePosition: firstUse.position,
        message: `Numbered sequence "<ordinal> ${noun}" is incomplete: found ${ordsSeen.map(nameOf).join(', ')} but missing ${missing.map(nameOf).join(', ')}. Either add the missing beat as its own slide, or drop the ordinal labels entirely and rewrite the beats without numbering.`,
      });
      continue;
    }
    // Order check: the first occurrence of each ordinal must appear in
    // ascending slide-position order.
    const firstPerOrd = new Map<number, number>();
    for (const o of occurrences) {
      if (!firstPerOrd.has(o.ord)) firstPerOrd.set(o.ord, o.position);
    }
    const positionsInOrder = ordsSeen.map((o) => firstPerOrd.get(o)!);
    for (let i = 1; i < positionsInOrder.length; i++) {
      if (positionsInOrder[i]! < positionsInOrder[i - 1]!) {
        errors.push({
          kind: 'sequence_incomplete',
          target: 'slide',
          slidePosition: positionsInOrder[i],
          message: `Numbered sequence "<ordinal> ${noun}" is out of order: ${ordsSeen.map(nameOf).join(', ')} appears on slides ${positionsInOrder.join(', ')}. Reorder the slides so ${nameOf(ordsSeen[0]!)} comes before ${nameOf(ordsSeen[1]!)} and so on, or relabel the beats without ordinals.`,
        });
        break;
      }
    }
  }
  return errors;
}

/**
 * A TERM is "explained" on the slide (or next slide) where it first
 * appears, if that slide's or the next slide's text contains any
 * substantive fragment (≥ 8 chars) from the TERM's description.
 *
 * Terms whose name IS the description (e.g., "OpenAI: an AI company")
 * are considered self-explanatory when the reader can infer them from
 * the surrounding text; we still require a real gloss for jargon-y
 * ones. The "≥ 8-char fragment" heuristic catches "moral consideration"
 * or "training data" but not tiny words like "AI" alone.
 */
function checkTermsExplained(post: import('./parse').ParsedPost, brief: import('./parse').Brief): CheckError[] {
  const errors: CheckError[] = [];
  const slides = post.slides;
  const slideText = (i: number): string => {
    const s = slides[i];
    if (!s) return '';
    return [s.headline, s.body, s.note, s.numberNote, s.secondNote, s.quote].filter(Boolean).join(' ').toLowerCase();
  };
  for (const term of brief.terms) {
    const termName = term.name.trim();
    const termDesc = (term.description ?? '').trim().toLowerCase();
    if (!termName || termName.length < 3) continue;
    if (termDesc.length < 15) continue; // too short to require a gloss
    const needleName = termName.toLowerCase();
    // First-appearance slide index (in slides[], excluding cover / follow).
    let firstIdx = -1;
    for (let i = 0; i < slides.length; i++) {
      if (slideText(i).includes(needleName)) { firstIdx = i; break; }
    }
    if (firstIdx < 0) continue; // term not used in slides at all — OK
    // Pull ≥ 9-char content fragments from the description. 9 is chosen
    // so common gloss words like "internal", "external", "software" don't
    // false-positive-match other terms (2026-09-29 test case: Antigravity's
    // gloss contained "internal", which also appears in Google Labs's
    // gloss, so an "internal team" mention on a Google Labs slide would
    // erroneously satisfy the Antigravity check).
    const descFragments = termDesc
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 9);
    if (descFragments.length === 0) continue;
    const thisAndNext = slideText(firstIdx) + ' ' + slideText(firstIdx + 1);
    const anyMatch = descFragments.some((f) => thisAndNext.includes(f));
    if (!anyMatch) {
      errors.push({
        kind: 'term_unexplained',
        target: 'slide',
        slidePosition: slides[firstIdx]!.position,
        message: `TERM "${termName}" first appears on SLIDE ${slides[firstIdx]!.position} but neither that slide nor SLIDE ${slides[firstIdx + 1]?.position ?? 'N/A'} explains it using the brief's TERMS description ("${term.description}"). Add a plain-language gloss on one of the two slides, or drop the term.`,
      });
    }
  }
  return errors;
}

/**
 * Classify a parsed slide as one of the design-v1 kinds so the rhythm
 * check can compare consecutive slides. Same first-match order as the
 * adapter uses to pick a layoutVariant.
 */
export function classifySlideType(slide: import('./parse').ParsedSlide): string {
  if (slide.quote) return 'quote';
  if (slide.secondNumber) return 'split_stat';
  if (slide.bigNumber) return 'stat';
  // Image slide only fires when there is a brief image + headline AND no
  // body — a text slide with body + image uses the text layout with a
  // bottom-half fade photo instead.
  if (slide.image && /^brief image\s+\d+/i.test(slide.image) && slide.headline && !slide.body) return 'image';
  if (slide.headline && !slide.body) return 'landing';
  return 'text';
}

/**
 * Caption checks — single total cap on caption (Source line included) plus
 * an estimate of the image credits the publish pipeline appends. Also:
 * no hashtags, banned voice.
 *
 * @param caption The full text returned by the Caption stage, including
 *   its "Source:" line.
 * @param appendedCreditsChars Character count of the image-credit block
 *   the publish pipeline will append. Estimate from the validated brief
 *   images (over-including is safe). Pass 0 in unit tests when credits
 *   aren't relevant.
 */
export function checkCaption(caption: string, appendedCreditsChars = 0): CheckReport {
  const errors: CheckError[] = [];
  const total = caption.length + appendedCreditsChars;
  if (total > LIMITS.captionMax) {
    const over = total - LIMITS.captionMax;
    errors.push({
      kind: 'caption_length',
      target: 'caption',
      message: `CAPTION (${caption.length} characters + ${appendedCreditsChars} appended image credits = ${total} total, limit ${LIMITS.captionMax}): cut at least ${over} characters (about ${estimateWords(over)} words) from the caption body. Cut words, not facts: remove filler, glosses already explained on a slide, and restated context first. If a fact must go, say which one in EDIT NOTES.`,
    });
  }
  if (/#\w/.test(caption)) {
    errors.push({
      kind: 'caption_hashtag',
      target: 'caption',
      message: `CAPTION (${caption.length} characters): contains a hashtag. Remove every "#word" — Instagram hashtags are banned in Helios captions.`,
    });
  }
  // Voice scan runs on the caption body (excluding "Source:") since the
  // Source line is a code-inserted attribution and shouldn't trigger a
  // false positive on outlet names or a colon.
  const sourceMatch = caption.match(/^(Source:.*)$/m);
  const body = sourceMatch ? caption.slice(0, sourceMatch.index).trimEnd() : caption;
  errors.push(...scanVoiceOnText('caption', 'TEXT', body, undefined, LIMITS.captionMax));
  return { ok: errors.length === 0, errors };
}

/**
 * "SLIDE 7 BODY (243 characters, limit 220): cut at least 23 characters.
 * Cut words, not facts — remove filler, glosses already made elsewhere,
 * and restated context first. If a fact must go, name it in EDIT NOTES."
 * — one shape for every char-limit error. Prior wording ("cut a whole
 * clause or sentence rather than rewording") systematically removed
 * specifics; specifics are longer so they win the coin toss and the slide
 * gets vaguer with every repair. The new wording prioritises tightening
 * before facts.
 */
function makeCharLimitMessage(field: string, actual: number, limit: number): string {
  const over = actual - limit;
  return `${field} (${actual} characters, limit ${limit}): cut at least ${over} characters (about ${estimateWords(over)} words). Cut words, not facts: remove filler, glosses already explained elsewhere, and restated context first. If a fact must go, say which one in EDIT NOTES.`;
}

/** ~6 chars per word including spaces. Minimum 1. */
function estimateWords(chars: number): number {
  return Math.max(1, Math.round(chars / 6));
}

/**
 * Number-trace check: every number in slides + caption must appear in at
 * least one fetched source text. Normalizes `$21 billion` == `$21B`, etc.
 * Skips the caption's "Source:" line and skips numbers that are clearly
 * slide-count markers (position labels).
 */
export function checkNumberTrace(
  post: ParsedPost,
  caption: string,
  sourceTexts: string[],
): CheckReport {
  const errors: CheckError[] = [];
  const haystack = sourceTexts.map(normalizeNumeric).join('\n');

  const inspect = (targetText: string, target: CheckError['target'], slidePosition?: number, field?: string) => {
    for (const raw of extractNumbers(targetText)) {
      let found = false;
      for (const candidate of numberCandidates(raw)) {
        if (haystack.includes(candidate)) { found = true; break; }
      }
      if (found) continue;
      const label = labelFor(target, slidePosition, field);
      const prefix = `${label} (${targetText.length} characters)`;
      errors.push({
        kind: 'number_trace',
        target,
        slidePosition,
        field,
        message: `${prefix}: number "${raw}" does not appear in any fetched source. Either remove the number, replace it with one the sources actually state, or drop this slide.`,
      });
    }
  };

  inspect(post.cover.text ?? '', 'cover', undefined, 'TEXT');
  for (const slide of post.slides) {
    inspect(slide.headline ?? '', 'slide', slide.position, 'HEADLINE');
    inspect(slide.body ?? '', 'slide', slide.position, 'BODY');
    inspect(slide.bigNumber ?? '', 'slide', slide.position, 'BIG NUMBER');
    inspect(slide.numberNote ?? '', 'slide', slide.position, 'NUMBER NOTE');
    inspect(slide.secondNumber ?? '', 'slide', slide.position, 'SECOND NUMBER');
    inspect(slide.secondNote ?? '', 'slide', slide.position, 'SECOND NOTE');
    inspect(slide.note ?? '', 'slide', slide.position, 'NOTE');
  }
  inspect(post.follow, 'follow', undefined, 'TEXT');

  const sourceMatch = caption.match(/^(Source:.*)$/m);
  const captionBody = sourceMatch ? caption.slice(0, sourceMatch.index) : caption;
  inspect(captionBody, 'caption', undefined, 'TEXT');

  return { ok: errors.length === 0, errors };
}

/* ── Helpers ─────────────────────────────────────────────────────────── */

function checkImageRef(ref: string, brief: Brief): string | null {
  if (!ref) return null;
  const m = ref.match(/^brief image\s+(\d+)/i);
  if (!m) return null; // free-text or "type only" — legal
  const n = Number(m[1]);
  const found = brief.images.find((img) => img.number === n);
  if (!found) {
    const available = brief.images.map((img) => img.number).join(', ');
    return available
      ? `IMAGE reference "brief image ${n}" is not in the brief's IMAGES list (available: ${available}). Change the reference to one of the available images, use "type only", or write a description.`
      : `IMAGE reference "brief image ${n}" is invalid because the brief has no IMAGES. Use "type only" or write a description instead.`;
  }
  return null;
}

function scanVoiceOnText(
  target: CheckError['target'],
  field: string,
  text: string,
  slidePosition: number | undefined,
  limit?: number,
): CheckError[] {
  const out: CheckError[] = [];
  if (!text) return out;
  const prefix = fieldPrefix(target, slidePosition, field, text.length, limit);
  for (const rule of BANNED_ALWAYS) {
    const re = rule.kind === 'literal'
      ? new RegExp(rule.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu')
      : new RegExp(rule.pattern, 'iu');
    if (re.test(text)) {
      out.push({
        kind: 'banned_always',
        target,
        slidePosition,
        field,
        message: `${prefix}: contains banned ${rule.label}. Remove it (rewrite the phrase without it) — this construction is never allowed in Helios voice.`,
      });
    }
  }
  for (const word of BANNED_JUDGMENT) {
    const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'iu');
    if (re.test(text)) {
      out.push({
        kind: 'banned_judgment',
        target,
        slidePosition,
        field,
        message: `${prefix}: contains the judgment word "${word}". If it's the inflated marketing use, rewrite; if it's a genuine normal use (e.g. physical "space", a product legitimately "features" X), keep it and note the reason in EDIT NOTES.`,
        word,
      });
    }
  }
  return out;
}

/**
 * Build the "SLIDE 7 BODY (243 characters, limit 220)" prefix that heads
 * every field-scoped error message so the Editor sees the current length
 * of every failing field alongside its rule violation.
 */
function fieldPrefix(
  target: CheckError['target'],
  slidePosition: number | undefined,
  field: string | undefined,
  actualChars: number,
  limit?: number,
): string {
  const label = labelFor(target, slidePosition, field);
  return limit !== undefined
    ? `${label} (${actualChars} characters, limit ${limit})`
    : `${label} (${actualChars} characters)`;
}

function labelFor(target: CheckError['target'], slidePosition?: number, field?: string): string {
  if (target === 'slide' && slidePosition !== undefined) return `SLIDE ${slidePosition} ${field ?? ''}`.trim();
  if (target === 'cover') return `COVER ${field ?? 'TEXT'}`.trim();
  if (target === 'follow') return `FOLLOW ${field ?? 'TEXT'}`.trim();
  return 'CAPTION';
}

/**
 * Split errors into HARD (stop the run at the code-check gate) and SOFT
 * (char_limit / highlight_substring / rhythm — flag but let the pipeline
 * continue to Fact-checker; if they survive the whole run, the post goes
 * to human review at the end without rendering). Per handoff §Orchestration
 * rules + design v1 §Rhythm ("code checks it", soft).
 */
export function partitionErrors(errors: CheckError[]): { hard: CheckError[]; soft: CheckError[] } {
  const hard: CheckError[] = [];
  const soft: CheckError[] = [];
  for (const e of errors) {
    // Cover char_limit is HARD (2026-09-29 late): a cover over 90 chars
    // renders under the fixed-position orange arrow and wraps to 6-7
    // lines that eat the whole slide. No soft-repair fix has ever
    // cleared it reliably; force the Editor to rewrite shorter.
    if (e.kind === 'char_limit' && e.target === 'cover') {
      hard.push(e);
      continue;
    }
    // outline_kind_mismatch is HARD (2026-09-29 late second pass). Once the
    // Writer's OUTLINE is approved, no stage may change a slide's kind.
    // Length errors on prose are fixed by cutting words, never by demoting
    // the kind. Making this HARD in-round means the Editor sees the
    // mismatch as a CHECK ERROR and restores the kind — same round.
    if (e.kind === 'outline_kind_mismatch') {
      hard.push(e);
      continue;
    }
    // rhythm demoted back to SOFT (2026-09-30, copy-audit rec-set).
    // A rhythm violation on two distinct-beat slides is preferable to a
    // clean rhythm bought with a repeated fact. See slide_repeats +
    // cover_claim_uniqueness below — those SOFT checks now carry the
    // "no repetition" load rhythm used to proxy for.
    if (
      e.kind === 'char_limit'
      || e.kind === 'highlight_substring'
      || e.kind === 'variety'
      || e.kind === 'cover_photo'
      || e.kind === 'term_unexplained'
      || e.kind === 'rhythm'
      || e.kind === 'slide_repeats'
      || e.kind === 'cover_claim_uniqueness'
    ) soft.push(e);
    else hard.push(e);
  }
  return { hard, soft };
}

/**
 * Does the brief's THE NEWS line name a person? A TERMS entry counts as
 * "a person" when its description matches one of the role keywords the
 * image step uses to detect people (governor, CEO, president, etc.).
 * Detection is intentionally conservative: only fires when the TERMS
 * entry's name string appears literally in THE NEWS.
 */
export function briefNewsNamesAPerson(brief: import('./parse').Brief): boolean {
  const news = (brief.news ?? '').toLowerCase();
  if (!news) return false;
  for (const t of brief.terms) {
    if (!isPersonTerm(t)) continue;
    if (news.includes(t.name.toLowerCase())) return true;
  }
  return false;
}

function describePersonInNews(brief: import('./parse').Brief): string | null {
  const news = (brief.news ?? '').toLowerCase();
  for (const t of brief.terms) {
    if (!isPersonTerm(t)) continue;
    if (news.includes(t.name.toLowerCase())) return t.name;
  }
  return null;
}

function isPersonTerm(term: { description?: string }): boolean {
  const d = (term.description ?? '').toLowerCase().trim();
  // The role word appears within the first ~30 chars, AND is not preceded
  // by a "by/from/of/for/…" preposition that would name the person WHO
  // ACTED on this term rather than the term itself. See the mirror
  // termIsPerson in image-step/index.ts for the full rationale (2026-09-29
  // late second pass: rejected "U.S. Congressman from New Jersey" and
  // similar country-prefixed roles under the older strict-lead rule).
  const roleRe = /\b(ceo|cto|cfo|coo|president|governor|senator|secretary|minister|director|founder|chair|chief|editor|reporter|prime minister|attorney|judge|mayor|congressman|congresswoman)\b/;
  const head = d.slice(0, 30);
  if (!roleRe.test(head)) return false;
  if (/\b(?:by|from|for|of|about|between)\s+(?:a|an|the)?\s*(?:former\s+)?(?:ceo|cto|cfo|coo|president|governor|senator|secretary|minister|director|founder|chair|chief|editor|reporter|prime minister|attorney|judge|mayor|congressman|congresswoman)\b/.test(head)) return false;
  return true;
}

/**
 * QUOTE hard check: every QUOTE line must appear word-for-word in at least
 * one fetched source text, after normalizing curly quotes and whitespace.
 * Design v1 §Adapter and code checks: "This is a hard check."
 *
 * Fed the same `sourceTexts[]` that `checkNumberTrace` uses.
 */
export function checkQuotes(
  post: import('./parse').ParsedPost,
  sourceTexts: string[],
): CheckReport {
  const errors: CheckError[] = [];
  const haystack = sourceTexts.map(normalizeQuoteText).join('\n');
  for (const slide of post.slides) {
    if (!slide.quote) continue;
    const needle = normalizeQuoteText(slide.quote);
    if (!needle) continue;
    if (!haystack.includes(needle)) {
      errors.push({
        kind: 'quote_verbatim',
        target: 'slide',
        slidePosition: slide.position,
        field: 'QUOTE',
        message: `SLIDE ${slide.position} QUOTE ("${slide.quote}") does not appear word-for-word in any fetched source (after normalizing curly quotes and whitespace). Either paste the exact sentence from a source or drop the QUOTE from this slide.`,
      });
    }
  }
  return { ok: errors.length === 0, errors };
}

/**
 * Normalize a quote so a curly-quoted / double-spaced / newline-broken
 * source text still matches the writer's paraphrase-free copy. Also
 * ignores trailing punctuation just inside the quote marks — a source
 * might write "…serve a customer in Colorado," while the writer
 * quotes it as "…serve a customer in Colorado." The words are identical,
 * only the terminal punctuation differs.
 *
 * 2026-09-29 late: DO NOT normalize commas or dashes for the slide-QUOTE
 * check. Tommy's rule: comma/dash equivalence is for brief-integrity
 * (STORY-time quote matching only). SLIDES must keep exact source
 * punctuation — if the essay writes "believes X - that Y" (spaced
 * hyphen), the slide must too; a slide with commas fails and the Writer
 * fixes it. Curly-quote equivalence stays (` ` and `'` are same glyph
 * in most editors) and terminal-punctuation stripping stays (a very
 * common truncated-mid-sentence pattern that's not a punctuation drift).
 */
function normalizeQuoteText(s: string): string {
  return s
    .replace(/[‘’‛′]/g, "'")
    .replace(/[“”‟″]/g, '"')
    .replace(/\s+/g, ' ')
    // Strip trailing sentence-ending punctuation that would otherwise
    // cause a "period vs comma" mismatch on an otherwise word-for-word
    // quote. Run twice so a trailing `."` becomes ` ` after both
    // characters are stripped.
    .replace(/[.,;:!?]+(?=$|["'])/g, '')
    .replace(/[.,;:!?]+$/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Render the "LENGTHS:" summary block the Editor sees at the top of every
 * repair input. Lists every field with its current character count against
 * its limit, marking overs. Gives the Editor an at-a-glance view of what
 * to cut before it opens any specific CHECK ERRORS.
 */
export function renderLengthsBlock(
  post: import('./parse').ParsedPost,
  caption: string | null,
  appendedCreditsChars = 0,
): string {
  const rows: string[] = ['LENGTHS:'];
  rows.push(fmtRow('COVER', countCoverChars(post.cover), LIMITS.cover));
  for (const s of post.slides) {
    if (s.headline) rows.push(fmtRow(`SLIDE ${s.position} HEADLINE`, s.headline.length, LIMITS.headline));
    if (s.body) rows.push(fmtRow(`SLIDE ${s.position} BODY`, s.body.length, LIMITS.body));
    if (s.note) rows.push(fmtRow(`SLIDE ${s.position} NOTE`, s.note.length, LIMITS.note));
    if (s.bigNumber) rows.push(fmtRow(`SLIDE ${s.position} BIG NUMBER`, s.bigNumber.length, LIMITS.bigNumber));
    if (s.numberNote) rows.push(fmtRow(`SLIDE ${s.position} NUMBER NOTE`, s.numberNote.length, LIMITS.numberNote));
    if (s.secondNumber) rows.push(fmtRow(`SLIDE ${s.position} SECOND NUMBER`, s.secondNumber.length, LIMITS.secondNumber));
    if (s.secondNote) rows.push(fmtRow(`SLIDE ${s.position} SECOND NOTE`, s.secondNote.length, LIMITS.secondNote));
    if (s.quote) rows.push(fmtRow(`SLIDE ${s.position} QUOTE`, s.quote.length, LIMITS.quote));
    if (s.quoteBy) rows.push(fmtRow(`SLIDE ${s.position} QUOTE BY`, s.quoteBy.length, LIMITS.quoteBy));
  }
  rows.push(fmtRow('FOLLOW', post.follow.length, LIMITS.follow));
  if (caption !== null) {
    const total = caption.length + appendedCreditsChars;
    const over = total > LIMITS.captionMax ? ' — OVER' : '';
    rows.push(`- CAPTION: ${caption.length} characters + ${appendedCreditsChars} appended credits = ${total} total (limit ${LIMITS.captionMax})${over}`);
  }
  return rows.join('\n');
}

function fmtRow(label: string, actual: number, limit: number): string {
  const over = actual > limit ? ' — OVER' : '';
  return `- ${label}: ${actual} characters (limit ${limit})${over}`;
}

/**
 * Extract number-bearing tokens from text. Catches: percentages, currency
 * ($21B, $3.9M), plain integers, comma-grouped thousands ("1,200"),
 * approximate markers ("~1,200"), decimals, 4-digit years, AND dates
 * ("September 16", "16 September") as verifiable tokens.
 *
 * 2026-09-29 late: dates are now matched, not skipped. If a slide writes
 * "September 16" and no source contains that date, it's flagged as
 * unsourced — the Suleyman run's Writer-invented "September 16" would
 * fire this check now. Comma-grouped thousands stay whole ("1,200" is
 * one token, not "1" and "200").
 */
function extractNumbers(text: string): string[] {
  const out = new Set<string>();
  // Percent
  for (const m of text.matchAll(/\b\d+(?:\.\d+)?\s*%/g)) out.add(m[0]);
  // Currency with unit suffix, comma-grouped thousands allowed
  for (const m of text.matchAll(/\$\s*\d+(?:,\d{3})*(?:\.\d+)?\s*(?:B|M|K|billion|million|thousand)?\b/gi)) out.add(m[0]);
  // Years (4 digits, 1900-2099)
  for (const m of text.matchAll(/\b(?:19|20)\d{2}\b/g)) out.add(m[0]);
  // Dates: "Month D" and "D Month" (the day-of-month digit is verified as
  // part of the whole date token, so "September 16" is checked against
  // sources as a single string). Build a mask of digit positions that
  // are part of a date so the plain-integer pass doesn't double-count.
  const dateMask = new Array<boolean>(text.length).fill(false);
  const monthRe = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\b/gi;
  for (const m of text.matchAll(monthRe)) {
    const start = m.index!;
    const end = start + m[0].length;
    // "Month D" — optional comma / whitespace, then 1–2 digit day.
    const after = text.slice(end, end + 6);
    const dayMatch = after.match(/^[\s,]*(\d{1,2})/);
    if (dayMatch) {
      const dayStart = end + after.indexOf(dayMatch[1]!);
      const dayEnd = dayStart + dayMatch[1]!.length;
      // Emit the whole date token ("September 16") as one entry.
      out.add(text.slice(start, dayEnd));
      for (let i = start; i < dayEnd; i++) dateMask[i] = true;
    }
    // "D Month" — 1–2 digit day right before the month.
    const before = text.slice(Math.max(0, start - 4), start);
    const dayBefore = before.match(/(\d{1,2})\s*$/);
    if (dayBefore) {
      const dayStart = start - (before.length - before.indexOf(dayBefore[1]!));
      out.add(text.slice(dayStart, end));
      for (let i = dayStart; i < end; i++) dateMask[i] = true;
    }
  }
  // Plain integers / decimals, comma-grouped thousands preserved.
  // Skip years already captured, and skip numbers whose entire span sits
  // inside dateMask (those are already covered by the "Month D" token).
  for (const m of text.matchAll(/(?<![\d,])\d{1,3}(?:,\d{3})+(?:\.\d+)?|(?<![\d,])\d{2,}(?:\.\d+)?/g)) {
    const s = m[0];
    if (/^(?:19|20)\d{2}$/.test(s)) continue;
    const start = m.index!;
    let allInDate = true;
    for (let i = start; i < start + s.length; i++) {
      if (!dateMask[i]) { allInDate = false; break; }
    }
    if (allInDate) continue;
    out.add(s);
  }
  return [...out];
}

/**
 * Turn one raw number into candidate normalized strings we look for in the
 * source haystack. Covers "$21 billion" ↔ "$21B", "26%" ↔ "26 percent",
 * "1,000" ↔ "1000", "nearly $21 billion" ↔ "$21B", etc.
 */
function numberCandidates(raw: string): string[] {
  const out = new Set<string>();
  const trimmed = raw.trim();
  out.add(trimmed);
  out.add(normalizeNumeric(trimmed));

  // % ↔ percent
  const pct = trimmed.match(/^(\d+(?:\.\d+)?)\s*%$/);
  if (pct) {
    out.add(`${pct[1]}percent`);
    out.add(`${pct[1]} percent`);
    out.add(`${pct[1]}%`);
  }

  // $NUM UNIT → $NUM<letter>
  const cur = trimmed.match(/^\$\s*(\d+(?:\.\d+)?)\s*(billion|million|thousand|B|M|K)?$/i);
  if (cur) {
    const num = cur[1]!;
    const unit = (cur[2] ?? '').toLowerCase();
    const letter = unit.startsWith('b') ? 'B' : unit.startsWith('m') ? 'M' : unit.startsWith('k') ? 'K' : '';
    out.add(`$${num}${letter}`);
    if (letter === 'B') out.add(`$${num} billion`);
    if (letter === 'M') out.add(`$${num} million`);
    if (letter === 'K') out.add(`$${num} thousand`);
  }

  // Comma-separated integers → collapsed
  if (/,/.test(trimmed)) out.add(trimmed.replace(/,/g, ''));

  return [...out].map(normalizeNumeric);
}

/** Normalize whitespace and case for number-trace haystack + needle. */
function normalizeNumeric(s: string): string {
  return s
    .replace(/\s+/g, '')
    .toLowerCase();
}

/**
 * Repetition checks (2026-09-30, copy-audit recs 1 + 9).
 *
 * `slide_repeats`: flag any story slide whose main-claim tokens overlap
 * with the cover or any earlier story slide by ≥ REPETITION_THRESHOLD
 * non-entity content tokens.
 *
 * `cover_claim_uniqueness`: flag when the cover's main claim overlaps
 * (same metric) with more than one story slide. The cover summarises
 * the change of the whole post; it may echo up to one story slide,
 * but restating multiple slides is a sign the whole post is one beat.
 *
 * Both are SOFT and both exclude the story's key entities from the
 * overlap set — TERMS names, the cover subject, any person / company
 * that the story is about. Entity mentions are expected to recur; the
 * check catches SHARED CONCEPTUAL PAYLOAD, not shared subjects.
 */
const REPETITION_THRESHOLD = 3;

const REPETITION_STOPWORDS = new Set([
  'about', 'after', 'again', 'against', 'along', 'already', 'also', 'always',
  'among', 'and', 'another', 'any', 'anyone', 'anything', 'are', 'around',
  'because', 'been', 'before', 'being', 'below', 'between', 'both', 'but',
  'came', 'can', 'come', 'could', 'did', 'does', 'doing', 'done', 'down',
  'during', 'each', 'every', 'few', 'for', 'from', 'get', 'gets', 'give',
  'going', 'good', 'got', 'had', 'has', 'have', 'having', 'her', 'here',
  'him', 'his', 'how', 'however', 'into', 'its', 'just', 'know', 'less',
  'like', 'long', 'made', 'make', 'makes', 'making', 'many', 'may', 'might',
  'more', 'most', 'much', 'must', 'need', 'never', 'new', 'next', 'now',
  'off', 'often', 'once', 'one', 'only', 'other', 'others', 'our', 'out',
  'over', 'own', 'past', 'per', 'ready', 'rest', 'said', 'says', 'same',
  'seem', 'seems', 'set', 'sets', 'she', 'should', 'since', 'some', 'still',
  'such', 'take', 'takes', 'than', 'that', 'the', 'their', 'them', 'then',
  'there', 'these', 'they', 'thing', 'things', 'this', 'those', 'through',
  'today', 'together', 'too', 'toward', 'under', 'until', 'upon', 'use',
  'uses', 'using', 'very', 'want', 'was', 'way', 'ways', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'whose', 'why', 'will', 'with',
  'without', 'would', 'yet', 'you', 'your', 'yours',
  // Rendering markers the model often adds
  'slide', 'cover', 'text', 'headline', 'body', 'note', 'quote', 'image',
  'highlight', 'follow',
]);

/**
 * Extract entity tokens to EXCLUDE from the overlap set. These are the
 * proper-noun subjects the story is legitimately about — TERMS entries
 * (broken into their individual words) plus common role tokens.
 * "Newsom" appearing on 3 slides is fine; "kill switch" appearing on
 * 3 slides is a repeat.
 */
function repetitionEntitySet(brief: Brief): Set<string> {
  const out = new Set<string>();
  const push = (raw: string) => {
    const norm = raw.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (norm.length >= 3) out.add(norm);
  };
  for (const term of brief.terms) {
    // Whole TERMS name, plus each word inside it (so "Rep. Josh Gottheimer"
    // excludes "rep", "josh", "gottheimer").
    push(term.name.replace(/[^a-z0-9]+/gi, ''));
    for (const w of term.name.split(/[^A-Za-z0-9]+/)) push(w);
  }
  // Common role words the story might use to refer to a TERMS person.
  for (const w of [
    'gov', 'governor', 'rep', 'representative', 'sen', 'senator',
    'president', 'ceo', 'cto', 'cfo', 'director', 'chair', 'chief',
    'secretary', 'minister', 'mayor', 'congressman', 'congresswoman',
    'act', 'bill', 'company', 'agency', 'model', 'models',
  ]) out.add(w);
  return out;
}

/**
 * Break a text into content tokens: lowercased, word-only, length ≥ 4,
 * not a stopword, not an entity token from the brief. This is the token
 * set used for repetition overlap.
 */
function repetitionTokens(text: string, entities: Set<string>): Set<string> {
  const out = new Set<string>();
  if (!text) return out;
  for (const raw of text.toLowerCase().split(/[^a-z0-9']+/)) {
    const w = raw.replace(/^['\-]+|['\-]+$/g, '');
    if (w.length < 4) continue;
    if (REPETITION_STOPWORDS.has(w)) continue;
    if (entities.has(w)) continue;
    // Simple singular normalisation: strip trailing "s" so "checks"
    // and "check" collide.
    const stem = w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
    out.add(stem);
  }
  return out;
}

/**
 * All the text on a slide that matters for repetition — headline + body
 * + note + quote + numberNote + secondNote + highlight. BIG NUMBER on its
 * own is a value, not a claim, so it's excluded (a repeated number is
 * fine).
 */
function slidePayloadText(slide: import('./parse').ParsedSlide): string {
  return [
    slide.headline, slide.body, slide.note, slide.quote,
    slide.numberNote, slide.secondNote, slide.highlight,
  ].filter(Boolean).join(' ');
}

/** Overlap count between two token sets. */
function overlap(a: Set<string>, b: Set<string>): string[] {
  const out: string[] = [];
  for (const t of a) if (b.has(t)) out.push(t);
  return out.sort();
}

export function checkSlideRepeats(post: ParsedPost, brief: Brief): CheckReport {
  const errors: CheckError[] = [];
  const entities = repetitionEntitySet(brief);
  const coverTokens = repetitionTokens(post.cover?.text ?? '', entities);
  // Slide index → tokens, in order.
  const slideTokens: Array<{ position: number; tokens: Set<string> }> = post.slides.map((s) => ({
    position: s.position,
    tokens: repetitionTokens(slidePayloadText(s), entities),
  }));
  for (let i = 0; i < slideTokens.length; i += 1) {
    const { position, tokens } = slideTokens[i]!;
    // Compare against cover.
    const vsCover = overlap(tokens, coverTokens);
    if (vsCover.length >= REPETITION_THRESHOLD) {
      errors.push({
        kind: 'slide_repeats',
        target: 'slide',
        slidePosition: position,
        message: `SLIDE ${position} shares ${vsCover.length} content tokens with COVER (${vsCover.slice(0, 5).map((t) => `"${t}"`).join(', ')}${vsCover.length > 5 ? '…' : ''}). This slide is restating the cover — either rewrite it around a different reader question or pull a fact from UNUSED BRIEF FACTS.`,
      });
    }
    // Compare against every earlier slide.
    for (let j = 0; j < i; j += 1) {
      const prior = slideTokens[j]!;
      const vs = overlap(tokens, prior.tokens);
      if (vs.length >= REPETITION_THRESHOLD) {
        errors.push({
          kind: 'slide_repeats',
          target: 'slide',
          slidePosition: position,
          message: `SLIDE ${position} shares ${vs.length} content tokens with SLIDE ${prior.position} (${vs.slice(0, 5).map((t) => `"${t}"`).join(', ')}${vs.length > 5 ? '…' : ''}). One of these two slides is a repeat — rewrite one around a different reader question or pull a fact from UNUSED BRIEF FACTS.`,
        });
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function checkCoverClaimUniqueness(post: ParsedPost, brief: Brief): CheckReport {
  const errors: CheckError[] = [];
  const entities = repetitionEntitySet(brief);
  const coverTokens = repetitionTokens(post.cover?.text ?? '', entities);
  if (coverTokens.size === 0) return { ok: true, errors };
  const overlapping: Array<{ position: number; tokens: string[] }> = [];
  for (const s of post.slides) {
    const tokens = repetitionTokens(slidePayloadText(s), entities);
    const vs = overlap(coverTokens, tokens);
    if (vs.length >= REPETITION_THRESHOLD) {
      overlapping.push({ position: s.position, tokens: vs });
    }
  }
  if (overlapping.length > 1) {
    const summary = overlapping
      .map((o) => `SLIDE ${o.position} (${o.tokens.slice(0, 3).map((t) => `"${t}"`).join(', ')}${o.tokens.length > 3 ? '…' : ''})`)
      .join(', ');
    errors.push({
      kind: 'cover_claim_uniqueness',
      target: 'cover',
      message: `COVER claim overlaps with ${overlapping.length} story slides: ${summary}. The cover should summarize the change of the whole post, not restate multiple slides. Either broaden the cover to a higher-level frame or rewrite the affected slides around different reader questions.`,
    });
  }
  return { ok: errors.length === 0, errors };
}

