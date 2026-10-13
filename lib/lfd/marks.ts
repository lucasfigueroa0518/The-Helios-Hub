/** Split slide text into plain, highlight (orange, once) and name (green) runs. Pure; the renderer maps runs to spans. */
export type MarkRun = { text: string; mark: 'hl' | 'name' | null };

export function markRuns(text: string, highlight: string, names: string[]): MarkRun[] {
  type Hit = { start: number; end: number; mark: 'hl' | 'name' };
  const hits: Hit[] = [];
  if (highlight) {
    const at = text.indexOf(highlight);
    if (at !== -1) hits.push({ start: at, end: at + highlight.length, mark: 'hl' });
  }
  for (const name of names) {
    let from = 0;
    while (name && (from = text.indexOf(name, from)) !== -1) {
      const end = from + name.length;
      if (!hits.some((h) => from < h.end && end > h.start)) hits.push({ start: from, end, mark: 'name' });
      from = end;
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: MarkRun[] = [];
  let at = 0;
  for (const h of hits) {
    if (h.start > at) out.push({ text: text.slice(at, h.start), mark: null });
    out.push({ text: text.slice(h.start, h.end), mark: h.mark });
    at = h.end;
  }
  if (at < text.length) out.push({ text: text.slice(at), mark: null });
  return out;
}
