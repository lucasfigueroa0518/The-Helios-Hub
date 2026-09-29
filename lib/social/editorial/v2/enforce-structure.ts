/**
 * Deterministic structural repair between Writer and Editor.
 *
 * The three problems this catches — slide count over max, two consecutive
 * same-kind slides, and fewer than 3 slide kinds in a 6+ slide post — are
 * mechanical: the fix does not require reading the sources or making an
 * editorial judgment about what to keep. Doing them here means the Editor
 * only ever sees a structurally valid draft, and the CHECK ERRORS repair
 * budget stops being burned on rhythm churn.
 *
 * Everything in this module is code-only. When it can't fix cleanly, it
 * returns a `needsEditor` payload naming the exact slides that still
 * violate the rules; the orchestrator then hands those to a single
 * targeted Editor call before bailing.
 */

import type { ParsedPost, ParsedSlide } from './parse';
import { classifySlideType, LIMITS } from './code-checks';

const MAX_STORY_SLIDES = LIMITS.storySlidesMax;
const MIN_KINDS_IN_LONG_POST = 3;
const LONG_POST_STORY_SLIDE_THRESHOLD = 6;

export type EnforceStructureResult = {
  /** Post after every deterministic fix. Slides may be re-ordered / merged / dropped. */
  post: ParsedPost;
  /**
   * Log lines describing each mutation, so the debug transcript can show
   * "merged SLIDE 3 into SLIDE 2 (both text, combined 187 chars, same
   * topic keywords 'Google Labs')".
   */
  log: string[];
  /**
   * If deterministic fixes can't clear every rule, this names the
   * specific slides that still violate (rhythm pair or variety gap) so
   * the orchestrator can make ONE targeted Editor call.
   */
  needsEditor:
    | { kind: 'rhythm'; violatingPairs: Array<[number, number]> }
    | { kind: 'variety'; distinctKinds: number; needed: number }
    | null;
};

/**
 * Word-set overlap heuristic for "same topic". Two slides are same-topic
 * if they share ≥ 3 non-stopword content tokens (length ≥ 4). Very
 * conservative — rejects merges that would fuse unrelated slides.
 */
function sameTopic(a: ParsedSlide, b: ParsedSlide): boolean {
  const tokens = (s: ParsedSlide) => {
    const text = [s.headline, s.body, s.note, s.quote, s.numberNote].filter(Boolean).join(' ').toLowerCase();
    const out = new Set<string>();
    for (const w of text.matchAll(/[a-z][a-z']{3,}/g)) {
      const t = w[0];
      if (!/^(the|and|but|for|from|with|this|that|these|those|will|have|been|when|were|then|also|into|about|their|there|which|other|would|could|should|might|onto|only|more|much|than|over|under|between)$/.test(t)) {
        out.add(t);
      }
    }
    return out;
  };
  const A = tokens(a);
  const B = tokens(b);
  let overlap = 0;
  for (const t of A) if (B.has(t)) overlap += 1;
  return overlap >= 3;
}

/**
 * Concatenate two text slides into one. Uses A's HEADLINE (drops B's),
 * concatenates bodies with a space. Highlight comes from A if present,
 * else B. Image / photo lines default to A's.
 */
function mergeTextSlides(a: ParsedSlide, b: ParsedSlide): ParsedSlide {
  const body = [(a.body ?? '').trim(), (b.body ?? '').trim()].filter(Boolean).join(' ');
  return {
    ...a,
    body,
    highlight: a.highlight ?? b.highlight,
    image: a.image ?? b.image,
  };
}

export function enforceStructure(post: ParsedPost): EnforceStructureResult {
  let slides = [...post.slides];
  const log: string[] = [];

  // ── 1. Slide count > max → merge shortest adjacent same-topic text pair.
  while (slides.length > MAX_STORY_SLIDES) {
    // Find adjacent text pairs whose combined body is ≤ 220 and topic matches.
    const candidates: Array<{ i: number; combinedLen: number }> = [];
    for (let i = 0; i < slides.length - 1; i++) {
      const a = slides[i]!;
      const b = slides[i + 1]!;
      if (classifySlideType(a) !== 'text' || classifySlideType(b) !== 'text') continue;
      const combined = [(a.body ?? '').trim(), (b.body ?? '').trim()].filter(Boolean).join(' ');
      if (combined.length > LIMITS.body) continue;
      if (!sameTopic(a, b)) continue;
      candidates.push({ i, combinedLen: combined.length });
    }
    if (candidates.length === 0) break; // give up mechanically
    candidates.sort((x, y) => x.combinedLen - y.combinedLen);
    const { i } = candidates[0]!;
    const merged = mergeTextSlides(slides[i]!, slides[i + 1]!);
    log.push(`enforceStructure: merged SLIDE ${slides[i]!.position} + SLIDE ${slides[i + 1]!.position} (both text, same topic, combined body ${merged.body!.length} chars) into one slide`);
    slides = [...slides.slice(0, i), merged, ...slides.slice(i + 2)];
    // Renumber positions so downstream code checks report contiguous slide numbers.
    slides = slides.map((s, idx) => ({ ...s, position: idx + 2 }));
  }

  // ── 2. Rhythm: no two consecutive same-kind slides.
  // Deterministic pass — merge same-topic text pairs where merged body ≤ 220.
  // Slides that can't be fixed here get sent to a targeted Editor call.
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < slides.length - 1; i++) {
      const a = slides[i]!;
      const b = slides[i + 1]!;
      if (classifySlideType(a) !== classifySlideType(b)) continue;
      // Try merging when both are text AND same-topic AND combined body ≤ 220.
      if (classifySlideType(a) === 'text' && sameTopic(a, b)) {
        const combined = [(a.body ?? '').trim(), (b.body ?? '').trim()].filter(Boolean).join(' ');
        if (combined.length <= LIMITS.body) {
          const merged = mergeTextSlides(a, b);
          log.push(`enforceStructure: rhythm-merged SLIDE ${a.position} + SLIDE ${b.position} (both text, same topic, combined body ${merged.body!.length} chars)`);
          slides = [...slides.slice(0, i), merged, ...slides.slice(i + 2)];
          slides = slides.map((s, idx) => ({ ...s, position: idx + 2 }));
          changed = true;
          break;
        }
      }
      // Try dropping the shorter of two adjacent landing slides (headline-only, easy to drop).
      if (classifySlideType(a) === 'landing' && classifySlideType(b) === 'landing') {
        const keep = (a.headline ?? '').length >= (b.headline ?? '').length ? i : i + 1;
        const drop = keep === i ? i + 1 : i;
        log.push(`enforceStructure: dropped consecutive landing SLIDE ${slides[drop]!.position} (kept the longer of two adjacent landing slides)`);
        slides = [...slides.slice(0, drop), ...slides.slice(drop + 1)];
        slides = slides.map((s, idx) => ({ ...s, position: idx + 2 }));
        changed = true;
        break;
      }
    }
  }

  // ── 3. Compute remaining violations.
  const rhythmPairs: Array<[number, number]> = [];
  for (let i = 0; i < slides.length - 1; i++) {
    if (classifySlideType(slides[i]!) === classifySlideType(slides[i + 1]!)) {
      rhythmPairs.push([slides[i]!.position, slides[i + 1]!.position]);
    }
  }
  const kinds = new Set(slides.map((s) => classifySlideType(s)));
  const needsVariety =
    slides.length >= LONG_POST_STORY_SLIDE_THRESHOLD && kinds.size < MIN_KINDS_IN_LONG_POST;

  let needsEditor: EnforceStructureResult['needsEditor'] = null;
  if (rhythmPairs.length > 0) {
    needsEditor = { kind: 'rhythm', violatingPairs: rhythmPairs };
  } else if (needsVariety) {
    needsEditor = { kind: 'variety', distinctKinds: kinds.size, needed: MIN_KINDS_IN_LONG_POST };
  }

  return {
    post: { ...post, slides },
    log,
    needsEditor,
  };
}
