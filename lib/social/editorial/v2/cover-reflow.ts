/**
 * Cover reflow-around-arrow — shared browser-side logic (2026-09-29 late
 * second pass).
 *
 * Tommy's rule: "After layout, if any word's rect intersects the arrow
 * box, insert a line break before that word and re-measure (repeat if
 * needed). Nothing else changes: font, size, margins, other lines.
 * cover_fit HARD fires only if the cover still doesn't fit after that
 * (too many lines to fit on the slide, or a single word wider than the
 * safe width)."
 *
 * The reflow logic runs in the Playwright browser via `page.evaluate`.
 * It walks the cover headline's text nodes, finds the first word whose
 * bounding rect collides with the chevron, splits that text node and
 * inserts a `<br data-cover-fit-inserted>` immediately before the word.
 * Re-measures. Repeats up to a small cap.
 *
 * Both `checkCoverFit` and `renderPreview` inject the same source so
 * the check and the shipped PNG stay in sync: what the check measured
 * is what the reader sees.
 */

/**
 * JS source executed via `page.evaluate(REFLOW_COVER_JS)` — an IIFE
 * that returns a JSON object describing the outcome. Kept as a plain
 * string so both callers can share it without a dependency on any
 * browser-side bundle.
 *
 * Return shape: `{ inserted, stillOverlaps, tooTall, singleWordOverflow, textOverFace, reason? }`.
 *
 * `textOverFace` (2026-09-29 late second pass): on photo-bleed covers,
 * reads the face-zone from the cover element's `data-face-zone` attribute
 * (a CSS-percentage of image height where the face lives — set at render
 * time from the vision-detected face box or a 40% top-band fallback).
 * True if the reflowed headline top < face-zone bottom + 40px margin.
 * The cover-fit gate treats this as HARD "text covers face" — the Editor
 * shortens the cover; if it still can't fit, the pipeline drops the
 * photo per Tommy's rule.
 */
export const REFLOW_COVER_JS = `
(() => {
  const slide = document.querySelector('.helios-slide[data-slide-ready="true"]');
  if (!slide) return { inserted: 0, stillOverlaps: false, tooTall: false, singleWordOverflow: false, reason: 'slide not ready' };
  const headline = slide.querySelector('.helios-cover__headline');
  const chevron = slide.querySelector('.helios-cover__chevron');
  if (!headline) return { inserted: 0, stillOverlaps: false, tooTall: false, singleWordOverflow: false, reason: 'no headline' };
  if (!chevron) return { inserted: 0, stillOverlaps: false, tooTall: false, singleWordOverflow: false, reason: 'no chevron' };

  const BUFFER = 8;
  const slideBox = slide.getBoundingClientRect();
  const safeLeft = slideBox.left + 96;
  const safeRight = slideBox.right - 96;
  const usableWidth = safeRight - safeLeft;
  const chevronBox = chevron.getBoundingClientRect();

  const overlapsChevron = (r) => {
    const overlapsY = r.bottom > chevronBox.top - BUFFER && r.top < chevronBox.bottom + BUFFER;
    const overlapsX = r.right > chevronBox.left - BUFFER && r.left < chevronBox.right + BUFFER;
    return overlapsY && overlapsX;
  };

  /**
   * Walk the headline for text nodes. For each whitespace-separated word,
   * measure its Range. If it collides with the chevron, insert a <br>
   * immediately before the word and return true. Return false when no
   * more overlapping words are found.
   */
  function insertBreakForOverlap() {
    const walker = document.createTreeWalker(headline, NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || '';
      // Advance through word boundaries.
      let i = 0;
      while (i < text.length) {
        while (i < text.length && /\\s/.test(text[i])) i++;
        if (i >= text.length) break;
        const wordStart = i;
        while (i < text.length && !/\\s/.test(text[i])) i++;
        const wordEnd = i;
        const range = document.createRange();
        range.setStart(node, wordStart);
        range.setEnd(node, wordEnd);
        const rects = Array.from(range.getClientRects());
        for (const r of rects) {
          if (overlapsChevron(r)) {
            // Split at wordStart and insert <br> before the word.
            const parent = node.parentNode;
            const before = document.createTextNode(text.slice(0, wordStart));
            const after = document.createTextNode(text.slice(wordStart));
            const br = document.createElement('br');
            br.setAttribute('data-cover-fit-inserted', 'true');
            parent.insertBefore(before, node);
            parent.insertBefore(br, node);
            parent.insertBefore(after, node);
            parent.removeChild(node);
            return true;
          }
        }
      }
      node = walker.nextNode();
    }
    return false;
  }

  let inserted = 0;
  const MAX_ITER = 6;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    const changed = insertBreakForOverlap();
    if (!changed) break;
    inserted++;
  }

  // Final state.
  const range = document.createRange();
  range.selectNodeContents(headline);
  const lineRects = Array.from(range.getClientRects());
  let stillOverlaps = false;
  for (const r of lineRects) {
    if (overlapsChevron(r)) { stillOverlaps = true; break; }
  }

  // Too tall: any line extends past the slide bottom.
  let tooTall = false;
  for (const r of lineRects) {
    if (r.bottom > slideBox.bottom - BUFFER) { tooTall = true; break; }
  }

  // Single word wider than the safe area — no line break can help.
  // Detect via per-word rects.
  let singleWordOverflow = false;
  const walker2 = document.createTreeWalker(headline, NodeFilter.SHOW_TEXT);
  outer: for (let n = walker2.nextNode(); n; n = walker2.nextNode()) {
    const text = n.textContent || '';
    let i = 0;
    while (i < text.length) {
      while (i < text.length && /\\s/.test(text[i])) i++;
      if (i >= text.length) break;
      const wordStart = i;
      while (i < text.length && !/\\s/.test(text[i])) i++;
      const wordEnd = i;
      const rng = document.createRange();
      rng.setStart(n, wordStart);
      rng.setEnd(n, wordEnd);
      const rects = Array.from(rng.getClientRects());
      for (const r of rects) {
        if (r.width > usableWidth + BUFFER) { singleWordOverflow = true; break outer; }
      }
    }
  }

  // Rule 2 (2026-09-29 late second pass): on photo-bleed covers, the
  // face zone at the top of the image must stay clear of headline text
  // with a 40px margin. Face zone bottom defaults to 40% of image
  // height (typical headshot framing). The vision-detected face box can
  // narrow this via the cover element's data-face-zone-bottom attribute
  // (a percent value from 0 to 1).
  let textOverFace = false;
  const cover = slide.querySelector('.helios-cover');
  const bleed = cover && cover.classList.contains('helios-cover--bleed');
  if (bleed) {
    const bgImg = slide.querySelector('.helios-cover__bg');
    if (bgImg) {
      const imgBox = bgImg.getBoundingClientRect();
      const faceZoneBottomAttr = cover.getAttribute('data-face-zone-bottom');
      const faceZoneBottomPct = faceZoneBottomAttr ? parseFloat(faceZoneBottomAttr) : 0.40;
      const faceBottomY = imgBox.top + imgBox.height * faceZoneBottomPct;
      const headlineTopY = headline.getBoundingClientRect().top;
      if (headlineTopY < faceBottomY + 40) {
        textOverFace = true;
      }
    }
  }

  return { inserted, stillOverlaps, tooTall, singleWordOverflow, textOverFace };
})();
`;
