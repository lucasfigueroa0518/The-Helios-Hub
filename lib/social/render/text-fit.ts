/**
 * Text fit (layout-system rule, Tommy 2026-10-06): every text region
 * shrinks its font until its longest word fits on one line and the block
 * fits the region, down to a minimum size; otherwise the render fails.
 *
 * A text region is any element with `data-fit-min` (the minimum font size
 * in px). Its width is the element's width; its height is its CSS
 * `max-height`. Mid-word breaks are off in CSS (overflow-wrap / word-break
 * normal, no hyphens), so a word too long for the line overflows sideways
 * and is caught here instead of being split ("CYBERSECURIT/Y").
 *
 * Self-contained on purpose (no imports, no closures): the preview page
 * calls it directly, and the render-fit check passes its source into
 * headless Chromium.
 */
export type TextFitFailure = { element: string; text: string; minPx: number; reason: string };

export function fitText(root: ParentNode): TextFitFailure[] {
  const failures: TextFitFailure[] = [];
  const STEP_PX = 2;
  const els = Array.from(root.querySelectorAll<HTMLElement>('[data-fit-min]'));
  for (const el of els) {
    el.style.fontSize = '';
    const min = Number(el.dataset.fitMin);
    const maxH = parseFloat(getComputedStyle(el).maxHeight);
    const wide = () => el.scrollWidth > el.clientWidth + 1;
    const tall = () => !Number.isNaN(maxH) && el.scrollHeight > maxH + 1;
    let size = parseFloat(getComputedStyle(el).fontSize);
    while ((wide() || tall()) && size > min) {
      size = Math.max(min, size - STEP_PX);
      el.style.fontSize = `${size}px`;
    }
    el.dataset.fitPx = String(size);
    if (wide() || tall()) {
      failures.push({
        element: `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}`,
        text: (el.textContent ?? '').trim().slice(0, 80),
        minPx: min,
        reason: wide() ? 'longest word wider than the region at the minimum size' : 'text taller than the region at the minimum size',
      });
    }
  }
  return failures;
}
