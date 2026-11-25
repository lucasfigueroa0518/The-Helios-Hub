/**
 * The news photo finder's photos into the photo bank (DECISIONS_LOG D49; Lucas, 2026-11-24: "Stories and LFD builds
 * ABSOLUTELY need to add photos to the photo bank"). The old Stories finder and lfdPhotoFinder fed the bank; PR #76
 * removed them, so the Morning Download build, the Last Few Days run and both Social Hub photo revisions offer what
 * findStoryPhoto found through here.
 *
 * What is offered, per PhotoResult: the pick as `picked` (or `passed` when its story did not post), and every
 * runner-up (good or usable, not turned down by the AI check) as `passed`. The bytes are the graded JPEG the finder
 * already holds (≤1024 px), so nothing is downloaded again (held.ts). Licence: the bank's own pass (policy.ts
 * licenceOf → storedLicence) with the brief's subject as the story's SUBJECTS, as the old finder ran it; a news
 * photo's credit lands as `unknown`, never reusable.
 *
 * Run refs follow the old feeders: `stories-build:<iso>` (MD), `lfd:<run id>` (LFD), `stories-revision:<set>:<iso>` and
 * `lfd-revision:<key>:<iso>` (revisions); run kind 'story' for all. Slide is the render position (1 = cover, story k
 * = k + 1); 0 for a story that did not make the post.
 *
 * Never throws and never waits: the bank's offerHeld is synchronous and best effort; any error is logged and dropped.
 */
import type { FullPhotoBank } from '@/lib/media-library/bank';
import type { HeldOfferInput, HeldPhoto } from '@/lib/media-library/held';
import { licenceOf, storedLicence } from '@/lib/media-library/policy';

import type { GradedPhoto } from './grade';
import type { PhotoResult } from './index';

/** What a build needs of the bank: the held offer, and (one-shot runs) a bounded drain. */
export type PhotoBankSink = Pick<FullPhotoBank, 'offerHeld'> & { drain?: (ms: number) => Promise<void> };

export type BankOfferOpts = {
  runRef: string;
  /** Render position: 1 = cover, story k = k + 1; 0 when the story did not make the post. */
  slide: number;
  /** The story's photo was posted (or swapped in): the pick is `picked`; otherwise every photo is `passed`. */
  posted: boolean;
  /** The story's headline (the bank's title for its sources). */
  headline?: string | null;
  at?: Date;
};

/** The licence pass's source: page photos (article, other outlets, lead image, harvest) carry article credits; a web image search hit needs a licence in its credit. */
const licenceSource = (c: GradedPhoto['source']) => (c === 'search' ? 'search' : 'article');

type Request = { subject: string | null; request: string; requestKind: string };

function held(c: GradedPhoto, outcome: HeldPhoto['outcome'], aiChecked: boolean, q: Request, o: BankOfferOpts): HeldPhoto {
  const { licence, reuseOk } = storedLicence(licenceOf({ url: c.src, credit: c.credit, source: licenceSource(c.source) }, q.subject ? [q.subject] : []));
  return {
    url: c.src,
    bytes: c.jpeg,
    source: c.source,
    lane: 'news-photos',
    title: o.headline?.trim() || null,
    date: null,
    credit: c.credit,
    licence,
    reuseOk,
    request: q.request,
    requestKind: q.requestKind,
    // A good photo shows the brief's subject itself (grade.ts tier rule); a usable one is only related.
    shows: c.tier === 'good' && q.subject ? q.subject : null,
    slide: o.slide,
    outcome,
    pass: true,
    verdict: { tier: c.tier, clarity: Math.round(c.clarity * 10) / 10, candidate: c.source, ai_checked: aiChecked },
  };
}

/** The held offer for one finder result, or null when it found nothing. Pure. */
export function photoBankOffer(r: PhotoResult | null | undefined, o: BankOfferOpts): HeldOfferInput | null {
  if (!r) return null;
  const subject = r.brief?.subject?.trim() || null;
  const q: Request = { subject, request: subject ?? (o.headline?.trim() || r.id), requestKind: r.brief?.kind?.trim() || 'news' };
  const items: HeldPhoto[] = [];
  const seen = new Set<string>();
  const add = (c: GradedPhoto, outcome: HeldPhoto['outcome'], aiChecked: boolean) => {
    if (!c?.src || !c.jpeg?.length || seen.has(c.src)) return;
    seen.add(c.src);
    items.push(held(c, outcome, aiChecked, q, o));
  };
  // The pick passed the AI check; runner-ups after it in pick order were never asked (pick.ts stops at the pick).
  if (r.pick) add(r.pick, o.posted ? 'picked' : 'passed', true);
  for (const c of r.passed ?? []) add(c, 'passed', false);
  if (!items.length) return null;
  return { runKind: 'story', runRef: o.runRef, items, ...(o.at ? { at: o.at } : {}) };
}

/** Offer one result to the bank. No bank, or nothing found: nothing happens. Never throws. */
export function offerToBank(bank: PhotoBankSink | null | undefined, r: PhotoResult | null | undefined, o: BankOfferOpts, log?: (line: string) => void): void {
  if (!bank) return;
  try {
    const offer = photoBankOffer(r, o);
    if (offer) bank.offerHeld(offer);
  } catch (err) {
    try {
      log?.(`photo bank offer ${o.runRef}: ${err instanceof Error ? err.message : String(err)}`);
    } catch {
      /* logging is best effort */
    }
  }
}

/** Wait at most `ms` for the bank's queued writes (a one-shot run or a worker pass, before it ends). Never throws. */
export async function drainBank(bank: PhotoBankSink | null | undefined, ms: number): Promise<void> {
  if (!bank?.drain) return;
  try {
    await bank.drain(ms);
  } catch {
    /* best effort */
  }
}
