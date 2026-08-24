import { createHash } from 'node:crypto';

export function makeEventId(prefix: string, sourceId: string): string {
  const digest = createHash('sha256').update(`${prefix}:${sourceId}`).digest('hex').slice(0, 24);
  return `${prefix}_${digest}`;
}

export function fingerprintListings(
  listings: Array<{ source: string; sourceEventId: string }>,
): string {
  const keys = listings
    .map((listing) => `${listing.source}:${listing.sourceEventId}`)
    .sort();
  return createHash('sha256').update(keys.join('|')).digest('hex').slice(0, 32);
}
