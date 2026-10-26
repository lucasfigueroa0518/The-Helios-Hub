import {
  MAX_HOSTS,
  type CandidateEvent,
  type EventHost,
  type EventSignalExtras,
  type StoredNetworkingEvent,
} from '@/lib/networking/types';

/**
 * When two sources list the same event, a signal comes from the best source that has it
 * (Luma > Eventbrite > Meetup > the rest). Luma reads ticketing and guest data directly; a
 * Meetup copy of a Luma event is often a cross-post whose RSVP count understates the room.
 */
export const SOURCE_PRIORITY = ['luma', 'eventbrite', 'meetup', 'bevy', 'ics', 'conferences', 'url'] as const;

export function sourceRank(source: string): number {
  const index = (SOURCE_PRIORITY as readonly string[]).indexOf(source);
  return index === -1 ? SOURCE_PRIORITY.length : index;
}

/**
 * Signal fields merged by source priority. Fields that only make sense together (the organizer,
 * the price, the rating and its count) move as one group, from one source.
 */
const RANKED_GROUPS: ReadonlyArray<ReadonlyArray<keyof CandidateEvent>> = [
  ['organizerName', 'organizerKind', 'organizerUrl'],
  ['hosts'],
  ['guestCount'],
  ['capacity'],
  ['spotsRemaining'],
  ['isSoldOut'],
  ['waitlistActive'],
  ['requiresApproval'],
  ['isFree', 'priceAmount', 'priceMinCents', 'priceMaxCents', 'priceCurrency'],
  ['organizerEventCount'],
  ['organizerMemberCount'],
  ['organizerRating', 'organizerRatingCount'],
  ['seriesKey'],
  ['rsvpOffsite'],
];

function present(value: unknown): boolean {
  if (value == null || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

export function mergeSourceTags(...lists: Array<string[] | undefined>): string[] | undefined {
  const tags = [...new Set(lists.flatMap((list) => list ?? []))];
  return tags.length ? tags.sort() : undefined;
}

/**
 * Fold the signals of every copy of one event into `target`, field by field, from the
 * highest-priority source that has a value. Tags are unioned; `signals` keys merge the same way.
 * `copies` includes the target's own first copy.
 */
export function mergeSignalCopies<T extends CandidateEvent>(target: T, copies: CandidateEvent[]): T {
  // Stable sort: copies from the same source keep arrival order.
  const ranked = [...copies].sort((a, b) => sourceRank(a.source) - sourceRank(b.source));
  const out = target as Record<string, unknown>;
  for (const group of RANKED_GROUPS) {
    const best = ranked.find((copy) => group.some((field) => present(copy[field])));
    if (best) for (const field of group) out[field] = best[field];
  }
  target.sourceTags = mergeSourceTags(...ranked.map((copy) => copy.sourceTags));
  const extras: EventSignalExtras = {};
  for (const copy of [...ranked].reverse()) Object.assign(extras, definedOnly(copy.signals));
  target.signals = Object.keys(extras).length ? extras : undefined;
  // Description is the exception: the longest text wins (Eventbrite gives a 140-character summary, Meetup the full text).
  const described = ranked.reduce<CandidateEvent | null>(
    (best, copy) => (copy.description.trim().length > (best?.description.trim().length ?? 0) ? copy : best),
    null,
  );
  if (described) {
    target.description = described.description;
    target.descriptionSource = described.descriptionSource;
  }
  return target;
}

/** The keys of `value` that are not undefined. */
export function definedOnly<T extends object>(value: T | undefined): Partial<T> {
  if (!value) return {};
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ── Hosts ──────────────────────────────────────────────────────────────────

type RawLumaHost = {
  name?: string | null;
  bio_short?: string | null;
  linkedin_handle?: string | null;
  is_verified?: boolean | null;
};

function cleanLine(value: string | null | undefined, max: number): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim();
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** Luma `entry.hosts[]` to at most eight public host records (name, short bio, LinkedIn, verified). */
export function lumaHosts(raw: unknown): EventHost[] {
  if (!Array.isArray(raw)) return [];
  const hosts: EventHost[] = [];
  for (const item of raw as RawLumaHost[]) {
    const name = cleanLine(item?.name, 120);
    if (!name) continue;
    hosts.push({
      name,
      bioShort: cleanLine(item.bio_short, 280),
      linkedin: cleanLine(item.linkedin_handle, 200),
      isVerified: typeof item.is_verified === 'boolean' ? item.is_verified : undefined,
    });
    if (hosts.length >= MAX_HOSTS) break;
  }
  return hosts;
}

/** Host names only (Meetup lists organizers by name). Duplicates and blanks are dropped. */
export function namedHosts(names: Array<string | null | undefined>): EventHost[] {
  const seen = new Set<string>();
  const hosts: EventHost[] = [];
  for (const raw of names) {
    const name = cleanLine(raw, 120);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    hosts.push({ name });
    if (hosts.length >= MAX_HOSTS) break;
  }
  return hosts;
}

// ── Off-site RSVP ──────────────────────────────────────────────────────────

/** "PAID EVENT RSVP HERE ==>", "RSVP here: https://…", "Get your tickets at https://…". */
const OFFSITE_CUE_RE =
  /\bpaid event\b|\brsvp (?:here|at|on|via)\b[^\n]{0,40}(?:https?:\/\/|www\.)|\b(?:grab|get|buy) (?:a |your )?tickets?\b[^\n]{0,40}(?:https?:\/\/|www\.)|\btickets? (?:here|at|on)\b[^\n]{0,20}(?:https?:\/\/|www\.)/i;
/** A ticketing page on another platform: the real RSVP lives there. */
const TICKET_LINK_RE =
  /(?:https?:\/\/)?(?:www\.)?(?:eventbrite\.[a-z.]+\/e\/|lu\.ma\/[\w-]+|luma\.com\/(?!discover\b)[\w-]+|ti\.to\/|tickettailor\.com\/|posh\.vip\/|partiful\.com\/e\/)/i;

/** True when the listing sends people elsewhere to RSVP or pay, so its own RSVP count misleads. */
export function hasOffsiteRsvp(text: string | undefined): boolean {
  if (!text) return false;
  return OFFSITE_CUE_RE.test(text) || TICKET_LINK_RE.test(text);
}

// ── Raw payloads ───────────────────────────────────────────────────────────

/** Copy only the named keys that are present. Raw payloads are built from allowlists, never by deletion. */
export function pickFields(source: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const record = source as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) out[key] = record[key];
  }
  return Object.keys(out).length ? out : undefined;
}

export function tagSlug(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ── Coverage (scripts/networking_ingest_once.ts) ───────────────────────────

export type SignalCoverage = {
  events: number;
  organizer: number;
  hosts: number;
  guestCount: number;
  description: number;
  price: number;
  capacity: number;
  requiresApproval: number;
  organizerTrackRecord: number;
  sourceTags: number;
  detailsFetched: number;
};

/** How many stored events carry each signal. */
export function signalCoverage(events: StoredNetworkingEvent[]): SignalCoverage {
  const count = (test: (event: StoredNetworkingEvent) => boolean) => events.filter(test).length;
  return {
    events: events.length,
    organizer: count((e) => Boolean(e.organizerName)),
    hosts: count((e) => e.hosts.length > 0),
    guestCount: count((e) => e.guestCount != null),
    description: count((e) => e.description.trim().length > 0),
    price: count((e) => e.isFree != null || e.priceMinCents != null),
    capacity: count((e) => e.capacity != null),
    requiresApproval: count((e) => e.requiresApproval != null),
    organizerTrackRecord: count(
      (e) => e.organizerEventCount != null || e.organizerRatingCount != null || e.organizerMemberCount != null,
    ),
    sourceTags: count((e) => e.sourceTags.length > 0),
    detailsFetched: count((e) => e.detailsFetchedAt != null),
  };
}
