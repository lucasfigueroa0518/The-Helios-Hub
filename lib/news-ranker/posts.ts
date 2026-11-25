/**
 * News chain stage 3: which reranked stories post (planning/MD-LFD Revisions/WIRING-CONTRACT.md, Owner A).
 * cleanup is the lab's (scripts/md-photo-trial.ts cleanup(), scripts/news-ranker-rerank.ts choosePosts) plus
 * the duplicates map; choosePosts is Lucas's Morning Download walk (D16/D17/"D23 corrected", WC1, WC5);
 * fillInOrder is Last Few Days (WC2). The caller supplies media verdicts (WC3); a golden video arrives as `good`.
 */
import type { Graded } from './rerank';

export type MediaVerdict = 'good' | 'usable' | 'none';

/** How many cleaned stories get the photo and video check; only these can post (WC4). */
export const CHECK_DEPTH = 8;
export const MIN_POSTS = 2;
export const MAX_POSTS = 5;

/**
 * Drop duplicates, then group stories linked by `crowds` (transitively) and keep the highest-ranked story of
 * each group. `merged` maps each kept id to the duplicates of its event (following duplicate chains), so the
 * photo finder can reuse their URLs. Input is in rerank order; output keeps it.
 */
export function cleanup(graded: Graded[]): { kept: Graded[]; merged: Map<string, Graded[]> } {
  const byId = new Map(graded.map((s) => [s.id, s]));
  const list = graded.filter((s) => !s.grade.duplicate_of);
  const parent = new Map<string, string>();
  const root = (x: string): string => { const p = parent.get(x); if (!p || p === x) return x; const r = root(p); parent.set(x, r); return r; };
  for (const s of list) for (const c of s.grade.crowds) if (c !== s.id && list.some((t) => t.id === c) && root(s.id) !== root(c)) parent.set(root(s.id), root(c));
  const seen = new Set<string>();
  const kept = list.filter((s) => { const r = root(s.id); if (seen.has(r)) return false; seen.add(r); return true; });
  const keptIds = new Set(kept.map((s) => s.id));
  const merged = new Map<string, Graded[]>(kept.map((s) => [s.id, []]));
  for (const d of graded) {
    if (!d.grade.duplicate_of) continue;
    let target = d.grade.duplicate_of;
    const hops = new Set<string>([d.id]);
    while (!hops.has(target)) { hops.add(target); const next = byId.get(target)?.grade.duplicate_of; if (!next) break; target = next; }
    if (keptIds.has(target)) merged.get(target)!.push(d);
  }
  return { kept, merged };
}

/** The stories that get the media check. */
export function checkWindow(kept: Graded[]): Graded[] {
  return kept.slice(0, CHECK_DEPTH);
}

/**
 * Morning Download (D16/D17/"D23 corrected", WC1, WC5). Over the check window in rank order:
 * stop at the first story that is not top tier or at max; post a top-tier story whose media is `good`, skip the rest.
 * Under min: add the best remaining checked stories with `good` or `usable` media in rank order (story strength
 * before media strength), then (WC5) checked stories with no media. A golden video only counts as `good` through
 * the caller's verdict; it never carries a story past the top-tier stop. Ids come back in rank order.
 */
export function choosePosts(kept: Graded[], verdict: (id: string) => MediaVerdict, o: { min?: number; max?: number } = {}): string[] {
  const min = o.min ?? MIN_POSTS, max = o.max ?? MAX_POSTS;
  const checked = checkWindow(kept).map((s) => ({ s, v: verdict(s.id) }));
  const posts = new Set<string>();
  for (const { s, v } of checked) {
    if (posts.size >= max || !s.grade.top_tier) break;
    if (v === 'good') posts.add(s.id);
  }
  for (const pass of [(v: MediaVerdict) => v !== 'none', (v: MediaVerdict) => v === 'none']) {
    for (const { s, v } of checked) {
      if (posts.size >= Math.min(min, max)) break;
      if (pass(v)) posts.add(s.id);
    }
  }
  return checked.filter(({ s }) => posts.has(s.id)).map(({ s }) => s.id);
}

/** Last Few Days (WC2): rerank order over the whole window, skip stories without usable media, stop at max. No top-tier stop; may return fewer than min when the list runs out. */
export function fillInOrder(kept: Graded[], verdict: (id: string) => MediaVerdict, o: { min: number; max: number }): string[] {
  const out: string[] = [];
  for (const s of kept) {
    if (out.length >= o.max) break;
    if (verdict(s.id) !== 'none') out.push(s.id);
  }
  return out;
}
