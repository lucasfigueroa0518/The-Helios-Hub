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
  const tz = event.timezone;
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

export type DedupedEvent = ClassifiedEvent & {
  canonicalUrl: string;
  listings: Array<{ source: string; sourceEventId: string; url: string }>;
};

export function deduplicate(events: ClassifiedEvent[]): DedupedEvent[] {
  const unique: DedupedEvent[] = [];
  const byListing = new Map<string, DedupedEvent>();

  for (const incoming of events) {
    const key = listingKey(incoming);
    const existingById = byListing.get(key);
    if (existingById) {
      if (!existingById.listings.some((l) => l.url === incoming.url) && incoming.url) {
        existingById.listings.push({
          source: incoming.source,
          sourceEventId: incoming.sourceEventId,
          url: incoming.url,
        });
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
      if (!merged.description && incoming.description) merged.description = incoming.description;
      if (!merged.lat && incoming.lat != null) {
        merged.lat = incoming.lat;
        merged.lng = incoming.lng;
      }
      if (incoming.industries.length) {
        merged.industries = [...new Set([...merged.industries, ...incoming.industries])];
      }
      if (merged.bucket !== incoming.bucket) merged.bucket = 'both';
      merged.listings.push({
        source: incoming.source,
        sourceEventId: incoming.sourceEventId,
        url: incoming.url,
      });
      byListing.set(key, merged);
      continue;
    }

    const created: DedupedEvent = {
      ...incoming,
      canonicalUrl: incoming.url,
      listings: [
        {
          source: incoming.source,
          sourceEventId: incoming.sourceEventId,
          url: incoming.url,
        },
      ],
    };
    unique.push(created);
    byListing.set(key, created);
  }

  return unique;
}
