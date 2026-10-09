/**
 * What the photo bank keeps, and how it tags it (DECISIONS_LOG D49). Pure:
 * plain code over finder data, no database, no network.
 *
 * Store the IMAGE only for vetted photos, and only after the licence pass:
 *
 *   picked, passed (a runner-up that passed every check), used (published)
 *                      → stored, when the licence passes
 *   verified           → stored when identity-verified (headshot, second
 *                        photo, CEO, headquarters, logo), picked or not
 *   rejected           → never stored (its sighting is the negative knowledge)
 *   raw search hits    → nothing (they never reach the bank)
 *
 * The licence pass is the carousel's own credit check (C6,
 * mechanical/checks.ts checkPhotoCredit) with a brief carrying the story's
 * SUBJECTS, then the credit class:
 *
 *   open (CC0, CC BY, CC BY-SA, public domain, Commons) → reuse_ok
 *   government (White House, NASA, .gov …)              → reuse_ok
 *   company / official ("Image: X", "Courtesy of X")    → library only (reuse_ok false)
 *   anything else                                       → not stored
 *
 * Tags: the contact sheet's tile tags (lowercased), the words of the
 * requests the photo passed, and the words of the vision check's "what it
 * shows" line, minus stopwords.
 */
import { checkPhotoCredit } from '@/lib/social/mechanical/checks';
import { classifyCredit } from '@/lib/social/photos/credit';
import type { Lane, Photo, PhotoSource } from '@/lib/social/photos/find';
import type { Brief } from '@/lib/social/reporter/brief';

import type { Licence, Outcome, SightingVision } from './types';

/** Lanes whose photos are identity-verified (Wikidata): stored even when not picked. */
export const IDENTITY_STORE_LANES = new Set<string>(['headshot', 'second', 'ceo', 'hq', 'logo']);
/** Searched scenes: what a thematic or setting request may get back from the bank. */
export const SCENE_LANES = ['stocksnap', 'openverse', 'commons-search'] as const;

const LICENCE_RANK: Record<Licence, number> = { open: 3, government: 2, company: 1, unknown: 0 };

export type LicenceVerdict = { licence: Licence; reuseOk: boolean; reason: string } | { licence: null; reuseOk: false; reason: string };

/** A brief that carries only the story's SUBJECTS (all the credit check reads: their names; the type is not read). */
export function briefFor(subjects: string[]): Brief {
  return {
    single_story: { yes: true, note: null },
    the_news: { text: '', ids: [] },
    why_it_matters: [],
    facts: [],
    background: [],
    quotes: [],
    numbers: [],
    terms: [],
    subjects: subjects.map((name, i) => ({ id: `S${i + 1}`, name, role: null, type: 'organization' as const })),
    events: [],
    article_photos: [],
    not_answered: [],
    sources: [],
    fetch_failures: [],
  };
}

/**
 * The licence pass. `subjects`: the story's SUBJECTS names (the C6 check's
 * brief); `organizations`: the names a "company's own photo" credit may name
 * (default: the subjects).
 */
export function licenceOf(photo: { url?: string; credit: string; source: PhotoSource | string }, subjects: string[], organizations?: string[]): LicenceVerdict {
  const credit = (photo.credit ?? '').trim();
  const source = photo.source as PhotoSource;
  const asPhoto: Photo = { url: photo.url ?? '', credit, source, width: null, height: null, qid: null, subject: null };
  let failures;
  try {
    failures = checkPhotoCredit(asPhoto, 'photo bank', briefFor(subjects));
  } catch (err) {
    return { licence: null, reuseOk: false, reason: `credit check error: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (failures.length) return { licence: null, reuseOk: false, reason: failures.map((f) => f.detail).join('; ') };
  if (source === 'official') return { licence: 'company', reuseOk: false, reason: 'official image (the company’s own page)' };
  const orgs = organizations?.length ? organizations : subjects;
  const v = classifyCredit({ caption: null, credit, page: null, organizations: orgs });
  if (v.verdict === 'allowed') {
    if (v.reason === 'official government') return { licence: 'government', reuseOk: true, reason: v.reason };
    if (v.reason.startsWith('open licence')) return { licence: 'open', reuseOk: true, reason: v.reason };
    if (v.reason.startsWith("company's own photo")) return { licence: 'company', reuseOk: false, reason: v.reason };
  }
  return { licence: null, reuseOk: false, reason: `licence not recognised (${v.reason})` };
}

/** Does this sighting earn the image a place in the bank? */
export function shouldStore(outcome: Outcome, c: { lane: Lane | string | null; verified: boolean }, licence: LicenceVerdict): boolean {
  if (licence.licence === null || licence.licence === 'unknown') return false;
  if (outcome === 'picked' || outcome === 'passed' || outcome === 'used') return true;
  if (outcome === 'verified') return c.verified && !!c.lane && IDENTITY_STORE_LANES.has(c.lane);
  return false;
}

/** Words that say nothing about what a photo shows. */
const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'in', 'on', 'at', 'to', 'for', 'with', 'by', 'from', 'into', 'onto', 'over', 'under', 'near',
  'its', 'it', 'is', 'are', 'was', 'be', 'this', 'that', 'these', 'those', 'as', 'some', 'one', 'two', 'three', 'very', 'their', 'his', 'her',
  'photo', 'photograph', 'image', 'picture', 'shot', 'shows', 'showing', 'show', 'shown', 'view', 'close', 'closeup', 'up',
  'background', 'foreground', 'scene', 'blank',
]);

/** A text's tag words: lowercased, accents dropped, stopwords, single letters and bare numbers out. */
export function words(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const w of text.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
    if (w.length < 2 || /^\d+$/.test(w) || STOPWORDS.has(w) || out.includes(w)) continue;
    out.push(w);
  }
  return out;
}

/** At most this many tags per photo. */
export const MAX_TAGS = 40;

export type TaggedSighting = {
  outcome: Outcome | string;
  tile_tags?: string[] | null;
  request_query?: string | null;
  vision?: Pick<SightingVision, 'what_it_shows'> | null;
};

/** A photo's tags from its vetted sightings (rejected ones never tag). */
export function tagsOf(sightings: TaggedSighting[]): string[] {
  const out: string[] = [];
  const add = (t: string) => {
    const tag = t.trim().toLowerCase().replace(/\s+/g, ' ');
    if (tag.length >= 2 && tag.length <= 40 && !STOPWORDS.has(tag) && !out.includes(tag) && out.length < MAX_TAGS) out.push(tag);
  };
  const vetted = sightings.filter((s) => s.outcome !== 'rejected');
  for (const s of vetted) for (const t of s.tile_tags ?? []) if (words(t).length) add(t);
  for (const s of vetted) for (const t of s.tile_tags ?? []) words(t).forEach(add);
  for (const s of vetted) words(s.request_query).forEach(add);
  for (const s of vetted) words(s.vision?.what_it_shows).forEach(add);
  return out;
}

export type MetaSource = { url: string; lane: string | null; credit: string | null; licence: Licence | null; reuse_ok: boolean; last_ok_at?: string | Date | null };
export type MetaSighting = TaggedSighting & {
  request_kind?: string | null;
  qid?: string | null;
  subject?: string | null;
  verified?: boolean;
  vision?: SightingVision | null;
};

export type PhotoMeta = { credit: string; licence: Licence; reuse_ok: boolean; qids: string[]; subjects: string[]; scenes: string[]; tags: string[]; vision_pass: boolean };

const SCENE_KINDS = new Set(['thematic', 'setting', 'event', 'product']);
const time = (v: string | Date | null | undefined) => (v ? new Date(v).getTime() || 0 : 0);
const uniq = (xs: Array<string | null | undefined>) => [...new Set(xs.filter((x): x is string => !!x && !!x.trim()))];

/**
 * A photo's library fields from all its sources and sightings: the credit
 * and licence of its most permissive source (open > government > company),
 * the verified identities, the scenes it was found for, its tags, and
 * whether it ever passed the close-up check.
 */
export function metaOf(sources: MetaSource[], sightings: MetaSighting[]): PhotoMeta {
  const best = [...sources].sort((a, b) => LICENCE_RANK[b.licence ?? 'unknown'] - LICENCE_RANK[a.licence ?? 'unknown'] || time(b.last_ok_at) - time(a.last_ok_at))[0];
  const vetted = sightings.filter((s) => s.outcome !== 'rejected');
  const sceneLanes = new Set(sources.map((s) => s.lane).filter((l) => l && (SCENE_LANES as readonly string[]).includes(l)));
  return {
    credit: best?.credit?.trim() || 'Unknown source',
    licence: best?.licence ?? 'unknown',
    reuse_ok: Boolean(best?.reuse_ok && best.licence && best.licence !== 'unknown' && best.licence !== 'company'),
    qids: uniq(vetted.filter((s) => s.verified).map((s) => s.qid)),
    subjects: uniq(vetted.filter((s) => s.verified).map((s) => s.subject)),
    scenes: uniq(vetted.filter((s) => (s.request_kind ? SCENE_KINDS.has(s.request_kind) : !s.qid && sceneLanes.size > 0)).map((s) => s.request_query)),
    tags: tagsOf(vetted),
    vision_pass: vetted.some((s) => s.vision?.pass === true && (s.vision.inferred === true || s.vision.scene === s.request_query)),
  };
}

/** A social.used_photos `source` as a finder lane (StockSnap is told apart by its credit). */
export function laneForUsedSource(source: string | null | undefined, credit: string | null | undefined): Lane | null {
  switch (source) {
    case 'stock':
      return /stocksnap|rawpixel/i.test(credit ?? '') ? 'stocksnap' : 'openverse';
    case 'commons':
      return 'headshot';
    case 'second':
    case 'logo':
    case 'ceo':
    case 'hq':
    case 'commons-search':
    case 'article':
    case 'official':
      return source;
    default:
      return null;
  }
}
