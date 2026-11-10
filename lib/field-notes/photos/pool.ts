/**
 * The photo pool's rules, pure (CONTRACT.md section 2): a photo sits out the `restPosts` posts after
 * its use, then may return; the pick is newest-uploaded first. Nothing here touches a database.
 */
import { mediaLibraryKey, usedMatch, type UsedLedger } from '@/lib/photos/used';

import type { PhotoKind, PoolPhoto } from '../types';

/**
 * CI-32: the pool photos any post published in the last 20 days, by their ledger key (`media-library:<id>`) or by
 * picture (`dhashes`: photo id → the bank's dHash). These sit out on top of the rest rule. Pure.
 */
export function publishedPhotoIds(pool: readonly PoolPhoto[], ledger: UsedLedger, dhashes: ReadonlyMap<string, string | null> = new Map()): Set<string> {
  return new Set(pool.filter((p) => usedMatch(ledger, { url: mediaLibraryKey(p.photoId), dhash: dhashes.get(p.photoId) ?? null })).map((p) => p.photoId));
}

/** Rest has ended once `restPosts` posts have been made since the photo's last use. */
export function restEnded(photo: PoolPhoto, nextSeq: number, restPosts: number): boolean {
  return photo.lastUsedPostSeq === null || nextSeq - photo.lastUsedPostSeq > restPosts;
}

/** Live, or resting with the rest over. Retired photos are never offered. */
export function isAvailable(photo: PoolPhoto, nextSeq: number, restPosts: number): boolean {
  if (photo.status === 'retired') return false;
  return photo.status === 'live' || restEnded(photo, nextSeq, restPosts);
}

const byNewestUpload = (a: PoolPhoto, b: PoolPhoto) => Date.parse(b.uploadedAt) - Date.parse(a.uploadedAt) || a.photoId.localeCompare(b.photoId);

/** Up to `count` available photos for the post numbered `nextSeq`, newest upload first. */
export function pickPhotos(o: { pool: PoolPhoto[]; nextSeq: number; restPosts: number; count: number }): PoolPhoto[] {
  return o.pool
    .filter((p) => isAvailable(p, o.nextSeq, o.restPosts))
    .sort(byNewestUpload)
    .slice(0, Math.max(0, o.count));
}

/** The photo after post `seq` used it: resting until `restPosts` more posts pass. */
export function markUsed(photo: PoolPhoto, seq: number): PoolPhoto {
  if (photo.status === 'retired') throw new Error(`photo ${photo.photoId} is retired and cannot be used`);
  return { ...photo, status: 'resting', lastUsedPostSeq: seq };
}

/** A resting photo whose rest is over goes back to live; anything else is unchanged. */
export function releaseIfRested(photo: PoolPhoto, nextSeq: number, restPosts: number): PoolPhoto {
  return photo.status === 'resting' && restEnded(photo, nextSeq, restPosts) ? { ...photo, status: 'live' } : photo;
}

/** Take a photo out of the pool for good (readable private screen, a stranger, a third-party logo...). A reason is required. */
export function rejectPhoto(photo: PoolPhoto, reason: string): PoolPhoto {
  const why = reason.trim();
  if (!why) throw new Error('a rejection needs a reason');
  return { ...photo, status: 'retired', rejectReason: why };
}

/** Put a retired photo back (a mistaken reject). Its use history stays, so a recent use still rests. */
export function restorePhoto(photo: PoolPhoto): PoolPhoto {
  return photo.status === 'retired' ? { ...photo, status: photo.lastUsedPostSeq === null ? 'live' : 'resting', rejectReason: null } : photo;
}

// ── Variety picker (Tommy and Lucas, 2026-11-05) ──
// Slide 1 is the cover and must be a `people` photo (our faces; starred opener preferred, newest first). The 3 to 6 tip
// slides vary over working, scenery and event (max 2 of a kind, which still covers 6 tip slides over the 3 kinds; relaxed only when the pool forces it, with a warning).
// The Follow slide's photo is reserved right after the cover, before the tip slides take theirs (Tommy, 2026-11-08: a
// Follow slide landed on a laptop screen with big lettering because the tip slides had used up the scenery): scenery,
// then event, then working (working photos tend to show screens), a people photo only as a last resort.
// The cover prefers a photo the face tagger confirmed (`facesCheck: 'faces'`); a people photo it never checked is the
// fallback, with a warning, and the renderer's `cover_no_face` check still swaps a cover with no face.
// Pure. The uploader picks working, scenery or event; `people` (and its opener flag) is set at upload by the local face
// check (photos/faces.ts, no model API), and a person can remove a wrong Faces tag from the pool grid.

/** At most this many photos of one kind among the tip slides, unless the pool forces more. */
export const MAX_PER_KIND = 2;
/** A post needs at least this many ready photos (cover + 3 tip slides + Follow) before anything is paid for. */
export const MIN_POST_PHOTOS = 5;

export type PostPhotoPick = {
  /** Photo ids in slide order: cover, the tip slides, then the Follow slide's. Shorter than `count` only when the pool is. */
  photoIds: string[];
  warnings: string[];
};

const byId = (pool: PoolPhoto[]) => new Map(pool.map((p) => [p.photoId, p]));
const kindCounts = (photos: PoolPhoto[]): Map<PhotoKind, number> => {
  const m = new Map<PhotoKind, number>();
  for (const p of photos) m.set(p.kind, (m.get(p.kind) ?? 0) + 1);
  return m;
};

/** A pool photo may carry its face check (store.PoolPhotoWithFaces); only 'faces' counts as confirmed. */
type MaybeChecked = PoolPhoto & { facesCheck?: string | null };
const faceConfirmed = (p: PoolPhoto): boolean => (p as MaybeChecked).facesCheck === 'faces';
/** The tagger looked and found no face: never a cover. */
const faceRefuted = (p: PoolPhoto): boolean => (p as MaybeChecked).facesCheck === 'none';

/**
 * The cover's photo: a people photo the face tagger confirmed (starred opener first, then the newest), else an
 * unchecked people photo (same order). A people photo the tagger checked and found no face in is never the cover.
 * `cands` arrive newest first.
 */
function bestCover(cands: PoolPhoto[]): PoolPhoto | null {
  const people = cands.filter((p) => p.kind === 'people' && !faceRefuted(p));
  const confirmed = people.filter(faceConfirmed);
  return confirmed.find((p) => p.opener) ?? confirmed[0] ?? people.find((p) => p.opener) ?? people[0] ?? null;
}

type Ctx = { prev?: PhotoKind; next?: PhotoKind; counts: Map<PhotoKind, number> };

/**
 * The best photo for a tip slide. `cands` arrive newest first and the sort is stable, so newest wins ties.
 * Non-people photos come first. Relaxed in order: kind spread and neighbours, then neighbours' kinds, then the
 * per-kind limit, then anything non-people, and only then a people photo.
 */
function bestTip(cands: PoolPhoto[], ctx: Ctx): PoolPhoto | null {
  const others = cands.filter((p) => p.kind !== 'people');
  const apart = (p: PoolPhoto) => p.kind !== ctx.prev && p.kind !== ctx.next;
  const room = (p: PoolPhoto) => (ctx.counts.get(p.kind) ?? 0) < MAX_PER_KIND;
  const tiers: Array<[PoolPhoto[], (p: PoolPhoto) => boolean]> = [
    [others, (p) => apart(p) && room(p)],
    [others, room],
    [others, apart],
    [others, () => true],
    [cands, (p) => apart(p) && room(p)],
    [cands, () => true],
  ];
  for (const [from, ok] of tiers) {
    const hit = from.filter(ok);
    if (hit.length) return [...hit].sort((a, b) => (ctx.counts.get(a.kind) ?? 0) - (ctx.counts.get(b.kind) ?? 0))[0]!;
  }
  return null;
}

/** The Follow slide's photo: the calmest left, which is scenery, then event, then working, then (last) people. */
function bestFollow(cands: PoolPhoto[], prev?: PhotoKind): PoolPhoto | null {
  const order: PhotoKind[] = ['scenery', 'event', 'working', 'people'];
  for (const pref of order.map((k) => (p: PoolPhoto) => p.kind === k)) {
    const hit = cands.filter(pref);
    const apart = hit.find((p) => p.kind !== prev);
    if (apart ?? hit[0]) return (apart ?? hit[0])!;
  }
  return null;
}

/** What a finished set of photos still lacks, in words for the run record (slide order: cover, tips..., Follow). */
export function describePicks(photos: PoolPhoto[], available: PoolPhoto[]): string[] {
  const warnings: string[] = [];
  const first = photos[0];
  if (first && first.kind !== 'people') warnings.push(`the cover uses a ${first.kind} photo: no people photo was available`);
  else if (first && !first.opener) warnings.push('no people photo is starred as an opener; the cover uses the newest one');
  if (first && first.kind === 'people' && !faceConfirmed(first)) warnings.push('the cover photo is not confirmed by the face tagger; the renderer still checks it for a face');
  const follow = photos.length >= 2 ? photos[photos.length - 1] : undefined;
  if (follow && follow.kind !== 'scenery' && follow.kind !== 'event') warnings.push(`the Follow slide uses a ${follow.kind} photo: no scenery or event photo was left`);
  const tips = photos.slice(1, -1);
  for (let i = 2; i < photos.length; i++) {
    if (photos[i]!.kind === photos[i - 1]!.kind) warnings.push(`slides ${i} and ${i + 1} share a kind (${photos[i]!.kind}); the pool had no other choice`);
  }
  for (const [kind, n] of kindCounts(tips)) if (n > MAX_PER_KIND) warnings.push(`${n} ${kind} photos on the tip slides; the pool had no other choice`);
  if (tips.some((p) => p.kind === 'people')) warnings.push('a tip slide uses a people photo: no other kind was left');
  if (available.filter((p) => p.kind !== 'people').length < 3) warnings.push('pool too narrow: fewer than 3 working, scenery or event photos are available, so the tip slides cannot vary');
  return warnings;
}

const availableSorted = (pool: PoolPhoto[], nextSeq: number, restPosts: number) => pool.filter((p) => isAvailable(p, nextSeq, restPosts)).sort(byNewestUpload);

/**
 * Whether a run may start: at least one available `people` photo for the cover and MIN_POST_PHOTOS in all.
 * Checked before anything is paid for. `message` is the plain reason for the review screen and the run record.
 */
export function checkPhotoPool(o: { pool: PoolPhoto[]; nextSeq: number; restPosts: number }): { ok: true } | { ok: false; message: string } {
  const available = availableSorted(o.pool, o.nextSeq, o.restPosts);
  const people = available.filter((p) => p.kind === 'people').length;
  if (people === 0) return { ok: false, message: `no photo of your faces is ready (the cover needs a Faces photo; resting ones come back after ${o.restPosts} posts). Upload a photo where a face is large and clear: Faces are found automatically.` };
  if (available.length < MIN_POST_PHOTOS) return { ok: false, message: `${available.length} photo(s) are ready and a post needs ${MIN_POST_PHOTOS} (resting ones come back after ${o.restPosts} posts). Upload more.` };
  return { ok: true };
}

/**
 * The photos for one post, in slide order: `count` = cover + tip slides + Follow (5 to 8).
 * Rules: only photos available under the rest rule; never a photo twice; slide 1 is a people photo (starred opener,
 * else newest); the tip slides take working, scenery and event photos, no kind more than MAX_PER_KIND and no
 * neighbours of one kind when the pool allows (kind used least so far wins, then newest upload); Follow takes the
 * calmest left. Every relaxation lands in `warnings`.
 */
export function pickPostPhotos(o: { pool: PoolPhoto[]; nextSeq: number; restPosts: number; count: number; published?: ReadonlySet<string> }): PostPhotoPick {
  // `published` (publishedPhotoIds): photos the used-photo ledger holds are never offered (CI-32).
  const available = availableSorted(o.pool, o.nextSeq, o.restPosts).filter((p) => !o.published?.has(p.photoId));
  const n = Math.min(Math.max(0, o.count), available.length);
  const chosen: PoolPhoto[] = [];
  const left = () => available.filter((p) => !chosen.includes(p));
  if (n >= 1) {
    const cover = bestCover(available) ?? available[0]!;
    chosen.push(cover);
  }
  // Follow's photo is reserved before the tip slides pick, so the calm photos are not used up first.
  const follow = n >= 2 ? bestFollow(left()) : null;
  if (follow) chosen.push(follow);
  const tips: PoolPhoto[] = [];
  const tipSlides = Math.max(0, n - 2);
  for (let i = 0; i < tipSlides; i++) {
    const pick = bestTip(left(), { prev: tips.length ? tips[tips.length - 1]!.kind : undefined, next: i === tipSlides - 1 ? follow?.kind : undefined, counts: kindCounts(tips) });
    if (!pick) break;
    tips.push(pick);
    chosen.push(pick);
  }
  // Slide order: cover, tip slides, Follow.
  chosen.splice(0, chosen.length, ...chosen.filter((p) => p !== follow), ...(follow ? [follow] : []));
  const warnings = describePicks(chosen, available);
  if (chosen.length < o.count) warnings.push(`pool too narrow: ${chosen.length} photos are available and the post needs ${o.count}`);
  return { photoIds: chosen.map((p) => p.photoId), warnings };
}

/**
 * A different photo for one slide of an already chosen set, for when the renderer rejects the photo (`no_calm_region`,
 * or `cover_no_face` on the cover). `exclude` holds every id that must not come back. The cover's replacement is
 * always another people photo (starred opener first); a tip slide's follows the tip rules against the neighbours that
 * stay; Follow's takes the calmest left. Null when nothing else is available.
 */
export function pickReplacement(o: { pool: PoolPhoto[]; nextSeq: number; restPosts: number; chosen: string[]; index: number; exclude?: string[] }): { photoId: string; warnings: string[] } | null {
  const available = availableSorted(o.pool, o.nextSeq, o.restPosts);
  const lookup = byId(o.pool);
  const banned = new Set([...(o.exclude ?? []), ...o.chosen]);
  const cands = available.filter((p) => !banned.has(p.photoId));
  const last = o.chosen.length - 1;
  const kindAt = (i: number) => lookup.get(o.chosen[i]!)?.kind;
  let pick: PoolPhoto | null;
  if (o.index === 0) pick = bestCover(cands);
  else if (o.index === last) pick = bestFollow(cands, kindAt(last - 1));
  else {
    const stay = o.chosen.slice(1, -1).filter((_, i) => i + 1 !== o.index).map((id) => lookup.get(id)).filter((p): p is PoolPhoto => !!p);
    pick = bestTip(cands, { prev: kindAt(o.index - 1), next: kindAt(o.index + 1), counts: kindCounts(stay) });
  }
  if (!pick) return null;
  const all = o.chosen.map((id, i) => (i === o.index ? pick! : lookup.get(id))).filter((p): p is PoolPhoto => !!p);
  return { photoId: pick.photoId, warnings: describePicks(all, available) };
}

export type PoolVariety = { counts: Record<PhotoKind, number>; openers: number; nonWorking: number; warnings: string[] };

/** Counts per kind across the live photos, and a plain warning when a post cannot start (no Faces photo) or could not vary (fewer than 2 scenery or event photos). */
export function poolVariety(pool: PoolPhoto[]): PoolVariety {
  const live = pool.filter((p) => p.status === 'live');
  const counts: Record<PhotoKind, number> = { working: 0, scenery: 0, people: 0, event: 0 };
  for (const p of live) counts[p.kind] += 1;
  const openers = live.filter((p) => p.opener).length;
  const nonWorking = live.length - counts.working;
  const warnings: string[] = [];
  if (live.length > 0 && counts.people === 0) warnings.push('No live photo is tagged Faces, so no post can start. Upload a photo where a face is large and clear; Faces are found automatically.');
  if (live.length > 0 && nonWorking - counts.people < 2) warnings.push('Fewer than 2 live photos are scenery or event, so the tip slides will look alike. Add some variety.');
  return { counts, openers, nonWorking, warnings };
}
