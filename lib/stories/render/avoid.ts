/**
 * Text keeps off the photo's subject (RA-28). A text stack marked `data-avoid` (the subject in frame pixels, JSON
 * {top, bottom, left, right}) and `data-band` ("top,bottom": the band it may use) is moved, after the text fit, into
 * the empty space above or below the subject:
 *
 *   clear    its blocks share no column with the subject: it stays where the slide put it
 *   whole    it fits in one empty band: the slide's own side (`data-prefer`, top or bottom) when that fits, else the other
 *   split    `data-split` stacks only: the first block above the subject and the rest below
 *   least    nothing fits: the side with more room (the intake check makes this rare: layout.ts hasRoom)
 *
 * Self-contained on purpose (no imports, no closures): the renderer passes its source into headless Chromium, as it
 * does text-fit.ts. Offsets, not screen rectangles, so a scaled preview places it the same.
 */
export type AvoidResult = { placed: 'clear' | 'top' | 'bottom' | 'split' | 'least'; overlapPx: number };

export function avoidSubject(root: ParentNode): AvoidResult[] {
  const PAD = 24;
  const out: AvoidResult[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLElement>('[data-avoid]'))) {
    const s = JSON.parse(el.dataset.avoid ?? '{}') as { top: number; bottom: number; left: number; right: number };
    const [bandTop, bandBottom] = (el.dataset.band ?? '').split(',').map(Number) as [number, number];
    const frame = el.offsetParent as HTMLElement | null;
    if (!frame || ![s.top, s.bottom, s.left, s.right, bandTop, bandBottom].every(Number.isFinite)) continue;
    const frameH = frame.offsetHeight;
    const kids = Array.from(el.children) as HTMLElement[];
    const crosses = kids.some((k) => el.offsetLeft + k.offsetLeft < s.right && s.left < el.offsetLeft + k.offsetLeft + k.offsetWidth);
    if (!crosses) {
      out.push({ placed: 'clear', overlapPx: 0 });
      continue;
    }
    const h = el.offsetHeight;
    const above = s.top - PAD - bandTop;
    const below = bandBottom - (s.bottom + PAD);
    const atTop = () => {
      el.style.top = `${bandTop}px`;
      el.style.bottom = 'auto';
    };
    const atBottom = () => {
      el.style.top = 'auto';
      el.style.bottom = `${frameH - bandBottom}px`;
    };
    const fitsTop = h <= above;
    const fitsBottom = h <= below;
    const prefer = el.dataset.prefer === 'bottom' ? 'bottom' : 'top';
    if (fitsTop && (prefer === 'top' || !fitsBottom)) {
      atTop();
      out.push({ placed: 'top', overlapPx: 0 });
      continue;
    }
    if (fitsBottom) {
      atBottom();
      out.push({ placed: 'bottom', overlapPx: 0 });
      continue;
    }
    if (el.dataset.split !== undefined && kids.length > 1) {
      const gap = parseFloat(getComputedStyle(el).rowGap) || 0;
      const headH = kids[0]!.offsetHeight;
      const restH = h - headH - gap;
      if (headH <= above && restH <= below) {
        el.style.top = `${bandTop}px`;
        el.style.bottom = `${frameH - bandBottom}px`;
        el.style.justifyContent = 'flex-start';
        kids[1]!.style.marginTop = 'auto';
        out.push({ placed: 'split', overlapPx: 0 });
        continue;
      }
    }
    if (above >= below) atTop();
    else atBottom();
    out.push({ placed: 'least', overlapPx: Math.round(h - Math.max(0, above, below)) });
  }
  return out;
}
