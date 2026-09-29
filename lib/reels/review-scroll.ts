/**
 * Which reel is on screen. A small drag stays on the current reel. Past that,
 * the index jumps to wherever the scroller has landed, including a fast flick
 * across more than one reel.
 */
export function reviewSlideIndex(scrollTop: number, slideHeight: number, count: number, current = 0): number {
  if (count <= 1 || !(slideHeight > 0)) return 0;
  const position = scrollTop / slideHeight;
  const clamped = Math.min(count - 1, Math.max(0, current));
  if (position > clamped + 0.42) {
    return Math.min(count - 1, Math.max(clamped + 1, Math.round(position)));
  }
  if (position < clamped - 0.42) {
    return Math.max(0, Math.min(clamped - 1, Math.round(position)));
  }
  return clamped;
}
