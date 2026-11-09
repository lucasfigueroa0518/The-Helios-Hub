import { blueprintAssets, mapBlueprintAssets, type DirectorPlan, type StoryboardFrame } from '@/lib/reel-ai-drama/types';

/**
 * MD-68: the director plans the shots first and names the media it lacks as wishes (W1, W2…); the
 * targeted search looks for them. `applyWishes` then resolves every wish id in the plan: the found asset
 * id, else the wish's `fallback` (an inventory asset or one of the plan's makes). It rewrites each frame's
 * `asset_ids` (de-duplicated, order kept), `shows[].asset_id`, and the ids named in `motion` and `marks`,
 * and the makes' `from_assets`. Resolved wishes leave `wishes`; a wish with neither a find nor a fallback
 * is removed from the frames and stays listed. A wish that kept several pictures (`count`, MD-139) expands to
 * all of them in `asset_ids` and shot lists, and to its first in `shows[].asset_id`. A make that was only a fallback and is no longer used
 * after resolution is dropped, so it is never paid for. Pure.
 */
export function applyWishes(plan: DirectorPlan, found: ReadonlyMap<string, string | readonly string[]>): DirectorPlan {
  const wishes = plan.wishes ?? [];
  if (!wishes.length) return plan;

  const to = new Map<string, string[]>();
  for (const w of wishes) {
    const hits = [found.get(w.id) ?? []].flat().map((id) => id.trim()).filter(Boolean);
    const fallback = w.fallback?.trim();
    to.set(w.id, hits.length ? hits : fallback ? [fallback] : []);
  }
  const ids = [...to.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(?:${ids.map((id) => id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'g');
  const text = (s: string) => (typeof s === 'string' ? s.replace(re, (id) => to.get(id)?.join(', ') || id) : s);
  const all = (list: readonly string[] | undefined) => [...new Set((list ?? []).flatMap((id) => to.get(id) ?? [id]))];

  const frames: StoryboardFrame[] = plan.frames.map((f) => {
    // A beat's media belongs to its frame even when the frame's own list left it out (MD-136).
    const assetIds = [...new Set([...f.asset_ids, ...(f.shots ?? []).flatMap((sh) => sh.asset_ids)])];
    const out: StoryboardFrame = { ...f, asset_ids: all(assetIds) };
    if (f.motion !== undefined) out.motion = text(f.motion);
    if (f.marks !== undefined) out.marks = text(f.marks);
    // A blueprint's piece names one picture: a wish that kept several gives it the first; one with nothing takes the piece away.
    if (f.blueprint) {
      out.blueprint = mapBlueprintAssets(f.blueprint, (id) => (to.has(id) ? to.get(id)![0] ?? null : id));
      out.asset_ids = [...new Set([...out.asset_ids, ...blueprintAssets(out.blueprint)])];
    }
    if (f.shows) {
      out.shows = f.shows.flatMap((sh) => {
        const next = to.has(sh.asset_id) ? to.get(sh.asset_id)![0] : sh.asset_id;
        return next ? [{ ...sh, asset_id: next }] : [];
      });
    }
    if (f.shots) out.shots = f.shots.map((sh) => ({ ...sh, asset_ids: all(sh.asset_ids) }));
    return out;
  });

  let makes = plan.makes?.map((m) => ({ ...m, from_assets: all(m.from_assets).filter((id) => id !== m.id) }));
  if (makes) {
    const fallbacks = new Set(wishes.map((w) => w.fallback?.trim()).filter(Boolean));
    const usedIn = (list: readonly StoryboardFrame[]) => list.flatMap((f) => [...(f.asset_ids ?? []), ...(f.shows ?? []).map((sh) => sh.asset_id), ...(f.shots ?? []).flatMap((sh) => sh.asset_ids)]);
    const used = new Set(usedIn(frames));
    for (const m of makes) for (const id of m.from_assets) used.add(id);
    const wasUsed = new Set(usedIn(plan.frames));
    makes = makes.filter((m) => used.has(m.id) || !fallbacks.has(m.id) || wasUsed.has(m.id));
  }

  const left = wishes.filter((w) => !to.get(w.id)?.length);
  const next: DirectorPlan = { ...plan, frames, ...(makes ? { makes } : {}) };
  if (left.length) next.wishes = left;
  else delete next.wishes;
  return next;
}
