import { inferAccess } from '@/lib/networking/access';
import { METRO_PROFILES } from '@/lib/networking/cities';
import { mergeSignalCopies } from '@/lib/networking/signals';
import type { ClassifiedEvent } from '@/lib/networking/types';

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
const JACCARD_THRESHOLD = 0.85;

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter(Boolean),
  );
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = tokenize(a);
  const setB = tokenize(b);
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) intersection += 1;
  }
  const union = new Set([...setA, ...setB]);
  return intersection / union.size;
}

function pickMoreSpecificUrl(a: string, b: string): string {
  const isGeneric = (u: string) => {
    try {
      const path = new URL(u).pathname;
      return path === '/' || path === '/events' || path === '/discover';
    } catch {
      return false;
    }
  };
  if (isGeneric(a)) return b;
  if (isGeneric(b)) return a;
  const rsvpScore = (u: string) => {
    if (/luma\.com\/|lu\.ma\//i.test(u)) return 3;
    if (/eventbrite\.com\/e\//i.test(u)) return 3;
    if (/meetup\.com\/.+\/events\//i.test(u)) return 3;
    return 1;
  };
  const sa = rsvpScore(a);
  const sb = rsvpScore(b);
  if (sa !== sb) return sa > sb ? a : b;
  return a.length <= b.length ? a : b;
}

function listingKey(event: ClassifiedEvent): string {
  return `${event.source}:${event.sourceEventId}`;
}

function localDateKey(event: ClassifiedEvent): string {
  const start = event.startAt;
  // A UTC date would put a 5 PM PT Meetup copy on the next day, away from its Luma twin.
  const tz = event.timezone || METRO_PROFILES[event.metro]?.timezone;
  try {
    if (tz) {
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(start);
      const year = parts.find((p) => p.type === 'year')?.value;
      const month = parts.find((p) => p.type === 'month')?.value;
      const day = parts.find((p) => p.type === 'day')?.value;
      return `${event.metro}:${year}-${month}-${day}`;
    }
  } catch {
    // fall through
  }
  return `${event.metro}:${start.toISOString().slice(0, 10)}`;
}

export type DedupedListing = {
  source: string;
  sourceEventId: string;
  url: string;
  /** Trimmed upstream payload for `event_listings.raw`. */
  raw?: Record<string, unknown>;
};

export type DedupedEvent = ClassifiedEvent & {
  canonicalUrl: string;
  listings: DedupedListing[];
};

function listingOf(event: ClassifiedEvent): DedupedListing {
  return { source: event.source, sourceEventId: event.sourceEventId, url: event.url, raw: event.raw };
}

export function deduplicate(events: ClassifiedEvent[]): DedupedEvent[] {
  const unique: DedupedEvent[] = [];
  const byListing = new Map<string, DedupedEvent>();
  // Every source copy of a merged event, so its signals can be chosen per field afterwards.
  const copies = new Map<DedupedEvent, ClassifiedEvent[]>();

  for (const incoming of events) {
    const key = listingKey(incoming);
    const existingById = byListing.get(key);
    if (existingById) {
      if (!existingById.listings.some((l) => l.url === incoming.url) && incoming.url) {
        existingById.listings.push(listingOf(incoming));
      }
      continue;
    }

    const block = localDateKey(incoming);
    let merged: DedupedEvent | null = null;
    for (const existing of unique) {
      if (localDateKey(existing) !== block) continue;
      const timeDiff = Math.abs(incoming.startAt.getTime() - existing.startAt.getTime());
      if (timeDiff > TWO_HOURS_MS) continue;
      if (jaccardSimilarity(incoming.title, existing.title) <= JACCARD_THRESHOLD) continue;
      merged = existing;
      break;
    }

    if (merged) {
      merged.canonicalUrl = pickMoreSpecificUrl(merged.url, incoming.url);
      merged.url = merged.canonicalUrl;
      if (!merged.lat && incoming.lat != null) {
        merged.lat = incoming.lat;
        merged.lng = incoming.lng;
      }
      if (incoming.industries.length) {
        merged.industries = [...new Set([...merged.industries, ...incoming.industries])];
      }
      if (merged.bucket !== incoming.bucket) merged.bucket = 'both';
      merged.listings.push(listingOf(incoming));
      copies.get(merged)?.push(incoming);
      byListing.set(key, merged);
      continue;
    }

    const created: DedupedEvent = {
      ...incoming,
      canonicalUrl: incoming.url,
      listings: [listingOf(incoming)],
    };
    unique.push(created);
    copies.set(created, [incoming]);
    byListing.set(key, created);
  }

  // Signals come from the best source per field (Luma > Eventbrite > Meetup), the description
  // from the longest copy; access is read again from the merged price. A single-copy event
  // keeps its own values.
  for (const [event, group] of copies) {
    if (group.length < 2) continue;
    mergeSignalCopies(event, group);
    const access = inferAccess(event);
    event.access = access.access;
    event.accessEvidence = access.evidence;
  }
  return unique;
}
