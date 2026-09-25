import {
  ARTICLE_FEED_CAP,
  BODY_MAX_CHARS,
  COMPLETE_TEXT_MIN_CHARS,
  FIRST_NIGHT_LOOKBACK_HOURS,
  FULL_TEXT_MIN_CHARS,
  JUNK_BAR,
  NON_ENGLISH_BAR,
  OFF_TOPIC_BAR,
  PLANTED_INSTRUCTION_BAR,
  RANKED_REPEAT_DAYS,
} from '@/lib/reels/config';
import { INGEST_FILTER } from '@/lib/reels/jev/questions/ingest-filter';
import { PLANTED_INSTRUCTION } from '@/lib/reels/jev/questions/planted-instruction';
import { mergeSets, type JevRunner } from '@/lib/reels/jev/runner';
import { excerpt } from '@/lib/reels/jev/state';
import { normalizeText, parsePage } from '@/lib/reels/net/html';
import {
  canonicalizeUrl,
  fetchPageFollowingRedirects,
  type FetchedPage,
} from '@/lib/reels/net/http';
import {
  findFingerprints,
  getWatermark,
  insertSource,
  markWatermarkAttempt,
  markWatermarkSuccess,
  refreshEngagement,
  touchFingerprint,
} from '@/lib/reels/repository';
import type {
  Adapter,
  AdapterItem,
  DropReason,
  SourceResult,
} from '@/lib/reels/types';

/**
 * Drops worth looking at stay in the pool with their reason, so an
 * over-aggressive filter is visible at review (CLN-03 / D-048). Duplicates and
 * overflow are counted instead: they say nothing about the filters and would
 * bury the real candidates.
 */
const VISIBLE_DROPS: ReadonlySet<DropReason> = new Set([
  'no_full_text',
  'fetch_failed',
  'off_topic',
  'junk',
  'non_english',
  'planted_instruction',
]);

export type IngestDeps = {
  jev: JevRunner;
  /** Injected so the destination fetch can be stubbed offline in tests. */
  fetchPage?: (url: string, signal?: AbortSignal) => Promise<FetchedPage>;
};

export type IngestOptions = {
  runId: string;
  runStartedAt: Date;
  now: Date;
  signal?: AbortSignal;
};

export async function ingestAdapter(
  adapter: Adapter,
  deps: IngestDeps,
  options: IngestOptions,
): Promise<SourceResult> {
  const result: SourceResult = {
    adapterId: adapter.id,
    name: adapter.name,
    status: 'ok',
    fetched: 0,
    ingested: 0,
    dropped: 0,
    refreshed: 0,
  };

  const watermark = await getWatermark(adapter.id);
  const since =
    watermark ?? new Date(options.now.getTime() - FIRST_NIGHT_LOOKBACK_HOURS * 3600_000);

  await markWatermarkAttempt(adapter.id);

  let items: AdapterItem[];
  try {
    items = await adapter.fetchItems({
      since,
      now: options.now,
      runId: options.runId,
      signal: options.signal,
      jev: deps.jev,
    });
  } catch (error) {
    // The night continues on whatever did arrive, and the next run backfills
    // from the unchanged watermark (ING-08 / D-038).
    result.status = 'failed';
    result.error = error instanceof Error ? error.message : String(error);
    return result;
  }

  result.fetched = items.length;

  const deduped = dedupeByUrl(items);
  const { kept, overflow } = applyCap(adapter, deduped);
  result.dropped += overflow;

  const fingerprints = await findFingerprints(kept.map((item) => canonicalizeUrl(item.canonicalUrl)));

  for (const item of kept) {
    const url = canonicalizeUrl(item.canonicalUrl);
    const firstSeen = fingerprints.get(url);
    const seenBeforeTonight = firstSeen != null && firstSeen < options.runStartedAt;
    const withinWindow =
      firstSeen != null &&
      options.now.getTime() - firstSeen.getTime() < RANKED_REPEAT_DAYS * 86_400_000;

    if (seenBeforeTonight && withinWindow && !item.allowRepeat) {
      // A ranked item still on the list refreshes its signals; the body stays
      // as first stored (ING-02 / ING-09 / D-032).
      if (adapter.kind === 'ranked' && item.engagement) {
        const updated = await refreshEngagement(url, item.engagement);
        if (updated) result.refreshed += 1;
      } else {
        result.dropped += 1;
      }
      continue;
    }

    const resolved = await resolveBody(item, deps, options.signal);
    const dropReason =
      resolved.dropReason ?? (await screen(item, resolved.body, deps, options));

    // A tracking link is a different URL for every recipient, so the article
    // it points at is the real identity. Fingerprint both: the destination so
    // the item dedupes, the original so we do not re-follow it tomorrow.
    const storedUrl = resolved.resolvedUrl ? canonicalizeUrl(resolved.resolvedUrl) : url;

    await store(adapter, item, storedUrl, resolved, dropReason, options);
    await touchFingerprint(storedUrl, adapter.id);
    if (storedUrl !== url) await touchFingerprint(url, adapter.id);

    if (dropReason) result.dropped += 1;
    else result.ingested += 1;
  }

  await markWatermarkSuccess(adapter.id, options.now);
  return result;
}

function dedupeByUrl(items: AdapterItem[]): AdapterItem[] {
  const seen = new Set<string>();
  const out: AdapterItem[] = [];
  for (const item of items) {
    const url = canonicalizeUrl(item.canonicalUrl);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push(item);
  }
  return out;
}

/**
 * Ranked lists ingest whole; article feeds take the cap, ordered by engagement
 * where the source has it and by recency otherwise (ING-04 / D-035).
 */
export function applyCap(
  adapter: Adapter,
  items: AdapterItem[],
): { kept: AdapterItem[]; overflow: number } {
  if (adapter.kind === 'ranked' || adapter.kind === 'catalog' || adapter.kind === 'generated') {
    return { kept: items, overflow: 0 };
  }

  const cap = adapter.cap ?? ARTICLE_FEED_CAP;
  if (items.length <= cap) return { kept: items, overflow: 0 };

  const ordered = [...items].sort((a, b) => {
    const aScore = engagementScore(a);
    const bScore = engagementScore(b);
    if (aScore !== bScore) return bScore - aScore;
    return (b.publishTime?.getTime() ?? 0) - (a.publishTime?.getTime() ?? 0);
  });

  return { kept: ordered.slice(0, cap), overflow: ordered.length - cap };
}

function engagementScore(item: AdapterItem): number {
  const engagement = item.engagement;
  if (!engagement) return 0;
  return engagement.points ?? engagement.upvotes ?? engagement.starsToday ?? 0;
}

type ResolvedBody = {
  body: string;
  mediaUrls: string[];
  author: string | null;
  publishTime: Date | null;
  dropReason: DropReason | null;
  /** Where a pointer actually landed, once redirects were followed. */
  resolvedUrl: string | null;
};

/**
 * Pointers are followed to the destination; anything we cannot read in full and
 * for free is skipped rather than stored as a blurb (ING-06 / REC-03, D-036,
 * D-041). Adapters that already hold the whole item — abstracts, READMEs,
 * changelog entries — are exempt from the article floor (D-067).
 */
async function resolveBody(
  item: AdapterItem,
  deps: IngestDeps,
  signal?: AbortSignal,
): Promise<ResolvedBody> {
  const base: ResolvedBody = {
    body: normalizeText(item.body ?? ''),
    mediaUrls: item.mediaUrls ?? [],
    author: item.author ?? null,
    publishTime: item.publishTime ?? null,
    dropReason: null,
    resolvedUrl: null,
  };

  if (item.textIsComplete) {
    if (base.body.length < COMPLETE_TEXT_MIN_CHARS) {
      return { ...base, dropReason: 'no_full_text' };
    }
    return { ...base, body: base.body.slice(0, BODY_MAX_CHARS) };
  }

  const target = item.destinationUrl ?? item.canonicalUrl;
  let fetched: FetchedPage;
  try {
    const fetchPage =
      deps.fetchPage ?? ((url, sig) => fetchPageFollowingRedirects(url, { signal: sig }));
    fetched = await fetchPage(target, signal);
  } catch {
    return { ...base, dropReason: 'fetch_failed' };
  }

  const page = parsePage(fetched.html);
  if (page.paywalled || page.text.length < FULL_TEXT_MIN_CHARS) {
    return { ...base, dropReason: 'no_full_text', resolvedUrl: fetched.finalUrl };
  }

  return {
    body: page.text.slice(0, BODY_MAX_CHARS),
    mediaUrls: [...base.mediaUrls, ...page.imageUrls],
    author: base.author ?? page.author,
    publishTime: base.publishTime ?? page.publishedAt,
    dropReason: null,
    resolvedUrl: fetched.finalUrl,
  };
}

/**
 * The ingest screen (ING-03 / D-033, CLN-01 / D-047) plus the injection check
 * (JEV-06 / D-030), in one Jev call.
 *
 * A Noul returns a probability, not a confidence, so "low confidence keeps the
 * item" is enforced by only dropping on a decisive yes. Anything in the middle
 * stays in the pool.
 */
async function screen(
  item: AdapterItem,
  body: string,
  deps: IngestDeps,
  options: IngestOptions,
): Promise<DropReason | null> {
  const { sets, questions } = mergeSets(INGEST_FILTER, PLANTED_INSTRUCTION);

  const { answers } = await deps.jev.ask({
    component: 'ingest-screen',
    state: {
      headline: item.headline,
      untrusted_content: excerpt(body),
    },
    sets,
    questions,
    runId: options.runId,
  });

  if (answers.plantedInstruction.noul >= PLANTED_INSTRUCTION_BAR) return 'planted_instruction';
  if (answers.junk.noul >= JUNK_BAR) return 'junk';
  if (answers.nonEnglish.noul >= NON_ENGLISH_BAR) return 'non_english';
  if (answers.offTopic.noul >= OFF_TOPIC_BAR) return 'off_topic';
  return null;
}

async function store(
  adapter: Adapter,
  item: AdapterItem,
  url: string,
  resolved: ResolvedBody,
  dropReason: DropReason | null,
  options: IngestOptions,
): Promise<void> {
  if (dropReason && !VISIBLE_DROPS.has(dropReason)) return;

  await insertSource({
    runId: options.runId,
    canonicalUrl: url,
    headline: item.headline,
    body: resolved.body,
    author: resolved.author,
    byline: item.byline ?? null,
    sourceName: adapter.name,
    sourceType: adapter.type,
    adapterId: adapter.id,
    bucket: adapter.bucket,
    publishTime: resolved.publishTime,
    language: dropReason === 'non_english' ? null : 'en',
    engagement: item.engagement ?? {},
    // Image and video URLs only; nothing is downloaded (ING-07 / D-037).
    mediaUrls: resolved.mediaUrls,
    citationUrls: item.citationUrls ?? [],
    // Kept beside the record for 3 weeks and never sent to Jev or Claude
    // (REC-04 / D-042).
    rawPayload: item.rawPayload ?? null,
    dropReason,
  });
}
