import { dbQuery } from '@/lib/db';
import { fingerprintListings } from '@/lib/networking/hash';
import type { DedupedEvent } from '@/lib/networking/dedupe';
import type {
  EventAnchor,
  EventHost,
  EventSignalExtras,
  IngestRunSummary,
  IngestSourceResult,
  Metro,
  RejectedEvent,
  StoredNetworkingEvent,
} from '@/lib/networking/types';

export type EventRow = {
  id: string;
  fingerprint: string;
  title: string;
  description: string;
  canonical_url: string;
  listing_urls: string[];
  start_at: Date;
  end_at: Date | null;
  timezone: string | null;
  venue_name: string | null;
  address: string | null;
  city: string | null;
  metro: StoredNetworkingEvent['metro'];
  lat: number | null;
  lng: number | null;
  attendance: StoredNetworkingEvent['attendance'];
  access: StoredNetworkingEvent['access'];
  access_evidence: string | null;
  bucket: StoredNetworkingEvent['bucket'];
  industries: string[];
  host_name: string | null;
  status: StoredNetworkingEvent['status'];
  first_seen_at: Date;
  last_seen_at: Date;
  organizer_name: string | null;
  organizer_kind: StoredNetworkingEvent['organizerKind'];
  organizer_url: string | null;
  hosts: EventHost[] | null;
  guest_count: number | null;
  capacity: number | null;
  spots_remaining: number | null;
  is_sold_out: boolean | null;
  waitlist_active: boolean | null;
  requires_approval: boolean | null;
  is_free: boolean | null;
  price_min_cents: number | null;
  price_max_cents: number | null;
  price_currency: string | null;
  organizer_event_count: number | null;
  organizer_member_count: number | null;
  /** numeric(3,2): node-postgres returns it as a string. */
  organizer_rating: string | number | null;
  organizer_rating_count: number | null;
  series_key: string | null;
  source_tags: string[] | null;
  rsvp_offsite: boolean | null;
  signals: EventSignalExtras | null;
  description_source: string | null;
  details_fetched_at: Date | null;
};

/**
 * The query handle the event reads and writes take. Live code uses the shared pool; tests pass
 * PGlite loaded with db/networking_schema.sql.
 */
export type NetworkingQuery = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<{ rows: T[] }>;

export const liveNetworkingQuery: NetworkingQuery = async <T,>(text: string, params?: unknown[]) => {
  const result = await dbQuery(text, params);
  return { rows: result.rows as T[] };
};

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function numeric(value: string | number | null): number | null {
  if (value == null) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function mapEvent(row: EventRow, listings: StoredNetworkingEvent['listings']): StoredNetworkingEvent {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    title: row.title,
    description: row.description,
    canonicalUrl: row.canonical_url,
    listingUrls: row.listing_urls || [],
    startAt: iso(row.start_at)!,
    endAt: iso(row.end_at),
    timezone: row.timezone,
    venueName: row.venue_name,
    address: row.address,
    city: row.city,
    metro: row.metro,
    lat: row.lat,
    lng: row.lng,
    attendance: row.attendance,
    access: row.access,
    accessEvidence: row.access_evidence,
    bucket: row.bucket,
    industries: row.industries || [],
    hostName: row.host_name,
    status: row.status,
    listings,
    firstSeenAt: iso(row.first_seen_at)!,
    lastSeenAt: iso(row.last_seen_at)!,
    organizerName: row.organizer_name ?? null,
    organizerKind: row.organizer_kind ?? null,
    organizerUrl: row.organizer_url ?? null,
    hosts: Array.isArray(row.hosts) ? row.hosts : [],
    guestCount: row.guest_count ?? null,
    capacity: row.capacity ?? null,
    spotsRemaining: row.spots_remaining ?? null,
    isSoldOut: row.is_sold_out ?? null,
    waitlistActive: row.waitlist_active ?? null,
    requiresApproval: row.requires_approval ?? null,
    isFree: row.is_free ?? null,
    priceMinCents: row.price_min_cents ?? null,
    priceMaxCents: row.price_max_cents ?? null,
    priceCurrency: row.price_currency ?? null,
    organizerEventCount: row.organizer_event_count ?? null,
    organizerMemberCount: row.organizer_member_count ?? null,
    organizerRating: numeric(row.organizer_rating ?? null),
    organizerRatingCount: row.organizer_rating_count ?? null,
    seriesKey: row.series_key ?? null,
    sourceTags: row.source_tags || [],
    rsvpOffsite: row.rsvp_offsite ?? null,
    signals: row.signals && typeof row.signals === 'object' ? row.signals : {},
    descriptionSource: row.description_source ?? null,
    detailsFetchedAt: iso(row.details_fetched_at ?? null),
  };
}

export async function startIngestRun(weekKey: string): Promise<string> {
  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO networking.ingest_runs (week_key, status)
     VALUES ($1, 'running')
     RETURNING id`,
    [weekKey],
  );
  return rows[0].id;
}

export async function finishIngestRun(
  runId: string,
  input: {
    status: 'done' | 'failed';
    sourceResults: IngestSourceResult[];
    keptCount: number;
    rejectedCount: number;
    error?: string;
  },
): Promise<void> {
  await dbQuery(
    `UPDATE networking.ingest_runs
        SET status = $2,
            finished_at = now(),
            source_results = $3::jsonb,
            kept_count = $4,
            rejected_count = $5,
            error = $6
      WHERE id = $1`,
    [
      runId,
      input.status,
      JSON.stringify(input.sourceResults),
      input.keptCount,
      input.rejectedCount,
      input.error ?? null,
    ],
  );
}

export async function expirePastEvents(now = new Date()): Promise<number> {
  const result = await dbQuery(
    `UPDATE networking.events
        SET status = 'expired', updated_at = now()
      WHERE start_at < $1 AND status = 'scheduled'`,
    [now],
  );
  return result.rowCount ?? 0;
}

/**
 * How a re-ingest folds into the stored row. `replace` takes this week's value; `coalesce` and
 * `nonblank` keep what the details job filled when this week's source has nothing (Luma
 * discover has no description, the Meetup find page no end time); `union` and `merge` add to
 * what is there.
 */
type MergeRule = 'replace' | 'coalesce' | 'nonblank' | 'with_description' | 'nonempty_array' | 'union' | 'merge';

type EventColumn = {
  name: string;
  cast?: string;
  rule: MergeRule;
  value: (event: DedupedEvent) => unknown;
};

const intOrNull = (value: number | undefined) => (value == null || !Number.isFinite(value) ? null : Math.round(value));

const EVENT_COLUMNS: EventColumn[] = [
  { name: 'title', rule: 'replace', value: (e) => e.title },
  { name: 'description', rule: 'nonblank', value: (e) => e.description },
  { name: 'canonical_url', rule: 'replace', value: (e) => e.canonicalUrl },
  {
    name: 'listing_urls',
    cast: 'text[]',
    rule: 'replace',
    value: (e) => [...new Set(e.listings.map((l) => l.url).filter(Boolean))],
  },
  { name: 'start_at', cast: 'timestamptz', rule: 'replace', value: (e) => e.startAt },
  { name: 'end_at', cast: 'timestamptz', rule: 'coalesce', value: (e) => e.endAt ?? null },
  { name: 'timezone', rule: 'replace', value: (e) => e.timezone ?? null },
  { name: 'venue_name', rule: 'replace', value: (e) => e.venueName ?? null },
  { name: 'address', rule: 'replace', value: (e) => e.address ?? null },
  { name: 'city', rule: 'replace', value: (e) => e.city ?? null },
  { name: 'metro', rule: 'replace', value: (e) => e.metro },
  { name: 'lat', cast: 'double precision', rule: 'replace', value: (e) => e.lat ?? null },
  { name: 'lng', cast: 'double precision', rule: 'replace', value: (e) => e.lng ?? null },
  { name: 'attendance', rule: 'replace', value: (e) => e.attendance },
  { name: 'access', rule: 'replace', value: (e) => e.access },
  { name: 'access_evidence', rule: 'replace', value: (e) => e.accessEvidence },
  { name: 'bucket', rule: 'replace', value: (e) => e.bucket },
  { name: 'industries', cast: 'text[]', rule: 'replace', value: (e) => e.industries },
  { name: 'host_name', rule: 'replace', value: (e) => e.hostName ?? null },
  { name: 'organizer_name', rule: 'coalesce', value: (e) => e.organizerName ?? null },
  { name: 'organizer_kind', rule: 'coalesce', value: (e) => e.organizerKind ?? null },
  { name: 'organizer_url', rule: 'coalesce', value: (e) => e.organizerUrl ?? null },
  { name: 'hosts', cast: 'jsonb', rule: 'nonempty_array', value: (e) => JSON.stringify(e.hosts ?? []) },
  { name: 'guest_count', cast: 'integer', rule: 'replace', value: (e) => intOrNull(e.guestCount) },
  { name: 'capacity', cast: 'integer', rule: 'coalesce', value: (e) => intOrNull(e.capacity) },
  { name: 'spots_remaining', cast: 'integer', rule: 'replace', value: (e) => intOrNull(e.spotsRemaining) },
  { name: 'is_sold_out', cast: 'boolean', rule: 'replace', value: (e) => e.isSoldOut ?? null },
  { name: 'waitlist_active', cast: 'boolean', rule: 'replace', value: (e) => e.waitlistActive ?? null },
  { name: 'requires_approval', cast: 'boolean', rule: 'replace', value: (e) => e.requiresApproval ?? null },
  { name: 'is_free', cast: 'boolean', rule: 'replace', value: (e) => e.isFree ?? null },
  { name: 'price_min_cents', cast: 'integer', rule: 'replace', value: (e) => intOrNull(e.priceMinCents) },
  { name: 'price_max_cents', cast: 'integer', rule: 'replace', value: (e) => intOrNull(e.priceMaxCents) },
  { name: 'price_currency', rule: 'replace', value: (e) => e.priceCurrency ?? null },
  { name: 'organizer_event_count', cast: 'integer', rule: 'coalesce', value: (e) => intOrNull(e.organizerEventCount) },
  { name: 'organizer_member_count', cast: 'integer', rule: 'coalesce', value: (e) => intOrNull(e.organizerMemberCount) },
  { name: 'organizer_rating', cast: 'numeric', rule: 'coalesce', value: (e) => e.organizerRating ?? null },
  { name: 'organizer_rating_count', cast: 'integer', rule: 'coalesce', value: (e) => intOrNull(e.organizerRatingCount) },
  { name: 'series_key', rule: 'coalesce', value: (e) => e.seriesKey ?? null },
  { name: 'source_tags', cast: 'text[]', rule: 'union', value: (e) => e.sourceTags ?? [] },
  { name: 'rsvp_offsite', cast: 'boolean', rule: 'replace', value: (e) => e.rsvpOffsite ?? null },
  { name: 'signals', cast: 'jsonb', rule: 'merge', value: (e) => JSON.stringify(e.signals ?? {}) },
  { name: 'description_source', rule: 'with_description', value: (e) => (e.description ? e.descriptionSource ?? e.source : null) },
];

function mergeExpr(column: EventColumn, incoming: (name: string) => string, current: (name: string) => string): string {
  const inc = incoming(column.name);
  const cur = current(column.name);
  switch (column.rule) {
    case 'replace':
      return inc;
    case 'coalesce':
      return `COALESCE(${inc}, ${cur})`;
    case 'nonblank':
      return `COALESCE(NULLIF(${inc}, ''), ${cur})`;
    case 'with_description':
      return `CASE WHEN COALESCE(${incoming('description')}, '') <> '' THEN ${inc} ELSE ${cur} END`;
    case 'nonempty_array':
      return `CASE WHEN jsonb_array_length(COALESCE(${inc}, '[]'::jsonb)) > 0 THEN ${inc} ELSE ${cur} END`;
    case 'union':
      return `ARRAY(SELECT DISTINCT tag FROM unnest(COALESCE(${cur}, '{}'::text[]) || COALESCE(${inc}, '{}'::text[])) AS tag ORDER BY tag)`;
    case 'merge':
      return `COALESCE(${cur}, '{}'::jsonb) || COALESCE(${inc}, '{}'::jsonb)`;
  }
}

/** `$n::cast` for a column, its parameters starting at `$first`. */
function placeholder(name: string, first: number): string {
  const index = EVENT_COLUMNS.findIndex((column) => column.name === name);
  const cast = EVENT_COLUMNS[index].cast;
  return `$${first + index}${cast ? `::${cast}` : ''}`;
}

const SEEN_NOW = `status = 'scheduled', last_seen_at = now(), updated_at = now()`;

/** $1 is the event id; columns follow from $2. */
const UPDATE_EVENT_SQL = `UPDATE networking.events
    SET ${EVENT_COLUMNS.map(
      (column) =>
        `${column.name} = ${mergeExpr(column, (name) => placeholder(name, 2), (name) => `networking.events.${name}`)}`,
    ).join(',\n        ')},
        ${SEEN_NOW}
  WHERE id = $1`;

/** $1 is the fingerprint; columns follow from $2. */
const INSERT_EVENT_SQL = `INSERT INTO networking.events (fingerprint, ${EVENT_COLUMNS.map((c) => c.name).join(', ')})
  VALUES ($1, ${EVENT_COLUMNS.map((c) => placeholder(c.name, 2)).join(', ')})
  ON CONFLICT (fingerprint) DO UPDATE SET
    ${EVENT_COLUMNS.map(
      (column) =>
        `${column.name} = ${mergeExpr(column, (name) => `EXCLUDED.${name}`, (name) => `networking.events.${name}`)}`,
    ).join(',\n    ')},
    ${SEEN_NOW}
  RETURNING id`;

export async function upsertKeptEvents(
  events: DedupedEvent[],
  query: NetworkingQuery = liveNetworkingQuery,
): Promise<number> {
  let kept = 0;
  for (const event of events) {
    const fingerprint = fingerprintListings(event.listings);
    const values = EVENT_COLUMNS.map((column) => column.value(event));
    let eventId: string | undefined;
    for (const listing of event.listings) {
      const existing = await query<{ event_id: string }>(
        `SELECT event_id
           FROM networking.event_listings
          WHERE source = $1 AND source_event_id = $2
          LIMIT 1`,
        [listing.source, listing.sourceEventId],
      );
      if (existing.rows[0]) {
        eventId = existing.rows[0].event_id;
        break;
      }
    }
    if (eventId) {
      await query(UPDATE_EVENT_SQL, [eventId, ...values]);
    } else {
      const inserted = await query<{ id: string }>(INSERT_EVENT_SQL, [fingerprint, ...values]);
      eventId = inserted.rows[0].id;
    }
    for (const listing of event.listings) {
      await query(
        `INSERT INTO networking.event_listings (event_id, source, source_event_id, url, raw)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (source, source_event_id) DO UPDATE SET
            event_id = EXCLUDED.event_id,
            url = EXCLUDED.url,
            raw = COALESCE(EXCLUDED.raw, networking.event_listings.raw)`,
        [eventId, listing.source, listing.sourceEventId, listing.url, listing.raw ? JSON.stringify(listing.raw) : null],
      );
    }
    kept += 1;
  }
  return kept;
}

/** Conference rows as satellite anchors (`networking.anchors`), one statement for the batch. */
export async function upsertAnchors(
  anchors: EventAnchor[],
  query: NetworkingQuery = liveNetworkingQuery,
): Promise<number> {
  if (anchors.length === 0) return 0;
  await query(
    `INSERT INTO networking.anchors (name, metro, starts_on, ends_on, url, source)
     SELECT * FROM unnest($1::text[], $2::text[], $3::date[], $4::date[], $5::text[], $6::text[])
     ON CONFLICT (name, metro, starts_on) DO UPDATE SET
        ends_on = EXCLUDED.ends_on,
        url = EXCLUDED.url,
        source = EXCLUDED.source`,
    [
      anchors.map((a) => a.name),
      anchors.map((a) => a.metro),
      anchors.map((a) => a.startsOn),
      anchors.map((a) => a.endsOn),
      anchors.map((a) => a.url),
      anchors.map((a) => a.source),
    ],
  );
  return anchors.length;
}

export async function upsertRejects(runId: string, rejects: RejectedEvent[]): Promise<number> {
  let count = 0;
  for (const reject of rejects) {
    const c = reject.candidate;
    await dbQuery(
      `INSERT INTO networking.event_rejects (
          source, source_event_id, url, title, start_at, city, reason_codes, payload, ingest_run_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       ON CONFLICT (source, source_event_id) DO UPDATE SET
          url = EXCLUDED.url,
          title = EXCLUDED.title,
          start_at = EXCLUDED.start_at,
          city = EXCLUDED.city,
          reason_codes = EXCLUDED.reason_codes,
          payload = EXCLUDED.payload,
          ingest_run_id = EXCLUDED.ingest_run_id`,
      [
        c.source,
        c.sourceEventId,
        c.url ?? null,
        c.title,
        c.startAt,
        c.city ?? null,
        reject.reasonCodes,
        JSON.stringify({ hostName: c.hostName, organizerName: c.organizerName, trusted: c.trusted }),
        runId,
      ],
    );
    count += 1;
  }
  return count;
}

export type ListEventsFilter = {
  /** Required by the internal API, which passes `INTERNAL_METROS` (or one of them). */
  metros?: readonly Metro[];
  bucket?: 'tech' | 'vertical' | 'both';
  industry?: string;
  access?: 'open' | 'paid' | 'invite_only';
  from?: Date;
  to?: Date;
};

/** The SELECT behind `listKeptEvents`, built without touching the database. */
export function listEventsQuery(filter: ListEventsFilter = {}): { text: string; params: unknown[] } {
  const clauses = [`e.status = 'scheduled'`];
  const params: unknown[] = [];
  const add = (value: unknown, sql: string) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };
  if (filter.metros) add([...filter.metros], 'e.metro = ANY (?::text[])');
  if (filter.bucket === 'both') add('both', 'e.bucket = ?');
  else if (filter.bucket) add(filter.bucket, '(e.bucket = ? OR e.bucket = \'both\')');
  if (filter.industry) add(filter.industry, '? = ANY (e.industries)');
  if (filter.access) add(filter.access, 'e.access = ?');
  if (filter.from) add(filter.from, 'e.start_at >= ?');
  if (filter.to) add(filter.to, 'e.start_at <= ?');
  return {
    text: `SELECT e.*
       FROM networking.events e
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.start_at ASC`,
    params,
  };
}

export async function listKeptEvents(
  filter: ListEventsFilter = {},
  query: NetworkingQuery = liveNetworkingQuery,
): Promise<StoredNetworkingEvent[]> {
  const select = listEventsQuery(filter);
  const { rows } = await query<EventRow>(select.text, select.params);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const listings = await query<{
    event_id: string;
    source: string;
    source_event_id: string;
    url: string;
  }>(
    `SELECT event_id, source, source_event_id, url
       FROM networking.event_listings
      WHERE event_id = ANY ($1::uuid[])`,
    [ids],
  );
  const byEvent = new Map<string, StoredNetworkingEvent['listings']>();
  for (const listing of listings.rows) {
    const list = byEvent.get(listing.event_id) ?? [];
    list.push({ source: listing.source, sourceEventId: listing.source_event_id, url: listing.url });
    byEvent.set(listing.event_id, list);
  }
  return rows.map((row) => mapEvent(row, byEvent.get(row.id) ?? []));
}

export async function latestIngestRun(): Promise<IngestRunSummary | null> {
  const { rows } = await dbQuery<{
    id: string;
    week_key: string;
    status: IngestRunSummary['status'];
    started_at: Date;
    finished_at: Date | null;
    source_results: IngestSourceResult[];
    kept_count: number;
    rejected_count: number;
    error: string | null;
  }>(
    `SELECT id, week_key, status, started_at, finished_at, source_results, kept_count, rejected_count, error
       FROM networking.ingest_runs
      ORDER BY started_at DESC
      LIMIT 1`,
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    weekKey: row.week_key,
    status: row.status,
    startedAt: iso(row.started_at)!,
    finishedAt: iso(row.finished_at),
    sourceResults: row.source_results || [],
    keptCount: row.kept_count,
    rejectedCount: row.rejected_count,
    error: row.error,
  };
}

export async function eventCounts(
  filter: { metros?: readonly Metro[]; from?: Date; to?: Date },
  query: NetworkingQuery = liveNetworkingQuery,
) {
  const events = await listKeptEvents(filter, query);
  return {
    total: events.length,
    boston: events.filter((e) => e.metro === 'boston').length,
    miami: events.filter((e) => e.metro === 'miami').length,
    tech: events.filter((e) => e.bucket === 'tech' || e.bucket === 'both').length,
    vertical: events.filter((e) => e.bucket === 'vertical' || e.bucket === 'both').length,
    open: events.filter((e) => e.access === 'open').length,
    paid: events.filter((e) => e.access === 'paid').length,
    inviteOnly: events.filter((e) => e.access === 'invite_only').length,
  };
}
