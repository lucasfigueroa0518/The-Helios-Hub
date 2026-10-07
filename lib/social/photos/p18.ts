/**
 * A subject's Wikidata main image (P18): the one definition both links use
 * (spec §5.1 Photo chain v1). The Writer's `photo_available` and the photo
 * finder's subject step call this same function, with the same identity
 * check and the same usability rule, so they always agree: a subject is
 * photo-available exactly when its P18 is usable.
 *
 *   identity: the full identity check (identity.ts: resolver, Jev, P31),
 *             cached per post/story so one subject costs one check
 *   usable:   on Commons, an allowed licence (PD / CC0 / CC BY / CC BY-SA),
 *             a credited author, jpg/png, short side ≥ STOCK_MIN_SHORT_SIDE
 *
 * Whether it's free to use in a given post (7-day rule, not used yet in this
 * post) is the finder's question, not availability's.
 */
import { fetchEntityP18, fetchImageInfo, toCandidate, type CommonsCandidate } from '@/lib/social/editorial/v2/image-step/commons';
import type { JevAsk } from '@/lib/social/jev/client';
import type { Brief } from '@/lib/social/reporter/brief';

import { checkIdentity, type IdentityResult } from './identity';

/** The only Commons size rule (Tommy, 2026-10-06): reject thumbnails. */
export const P18_MIN_SHORT_SIDE = 600;

export type IdentityCache = Map<string, Promise<IdentityResult>>;

export type SubjectP18 = {
  identity: IdentityResult;
  /** The P18 file name, when the entry has one. */
  file: string | null;
  /** The usable P18 candidate, or null with `why`. */
  pick: CommonsCandidate | null;
  why: string | null;
};

/** The identity check, once per subject per cache. */
export function identityOf(name: string, brief: Brief, deps: { jev: JevAsk; http?: typeof fetch }, cache: IdentityCache): Promise<IdentityResult> {
  let pending = cache.get(name);
  if (!pending) {
    const subject = brief.subjects.find((s) => s.name === name) ?? { name, role: null };
    pending = checkIdentity(subject, brief, { jev: deps.jev, http: deps.http });
    cache.set(name, pending);
  }
  return pending;
}

export async function subjectP18(name: string, brief: Brief, deps: { jev: JevAsk; http?: typeof fetch }, cache: IdentityCache): Promise<SubjectP18> {
  const identity = await identityOf(name, brief, deps, cache);
  if (!identity.ok) return { identity, file: null, pick: null, why: `identity failed: ${identity.reason}` };
  const p18 = await fetchEntityP18(identity.qid, { http: deps.http });
  if (!p18) return { identity, file: null, pick: null, why: 'no Wikidata main image (P18)' };
  const file = `File:${p18}`;
  const info = (await fetchImageInfo([file], { http: deps.http }))[file];
  const pick = info ? toCandidate(file, info, 'P18', { minShortSide: P18_MIN_SHORT_SIDE }) : null;
  return { identity, file: p18, pick, why: pick ? null : 'main image (P18) not usable (licence, size or type)' };
}

/** `photo_available` for the Writer: true exactly when the subject's P18 is usable (same check as the finder). */
export function createHasPhoto(deps: { jev: JevAsk; http?: typeof fetch }, cacheFor: (brief: Brief) => IdentityCache) {
  return async (subject: { name: string }, brief: Brief): Promise<boolean> => (await subjectP18(subject.name, brief, deps, cacheFor(brief))).pick !== null;
}
