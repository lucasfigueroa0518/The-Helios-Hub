import { dbQuery } from '@/lib/db';
import { fingerprintListings } from '@/lib/networking/hash';
import type { DedupedEvent } from '@/lib/networking/dedupe';
import type {
  IngestRunSummary,
  IngestSourceResult,
  RejectedEvent,
  StoredNetworkingEvent,
} from '@/lib/networking/types';

type EventRow = {
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
};

function iso(value: Date | string | null): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function mapEvent(row: EventRow, listings: StoredNetworkingEvent['listings']): StoredNetworkingEvent {
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

export async function upsertKeptEvents(events: DedupedEvent[]): Promise<number> {
  let kept = 0;
  for (const event of events) {
    const listingUrls = [...new Set(event.listings.map((l) => l.url).filter(Boolean))];
    const fingerprint = fingerprintListings(event.listings);
    let eventId: string | undefined;
    for (const listing of event.listings) {
      const existing = await dbQuery<{ event_id: string }>(
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
      await dbQuery(
        `UPDATE networking.events
            SET title = $2,
                description = $3,
                canonical_url = $4,
                listing_urls = $5,
                start_at = $6,
                end_at = $7,
                timezone = $8,
                venue_name = $9,
                address = $10,
                city = $11,
                metro = $12,
                lat = $13,
                lng = $14,
                attendance = $15,
                access = $16,
                access_evidence = $17,
                bucket = $18,
                industries = $19,
                host_name = $20,
                status = 'scheduled',
                last_seen_at = now(),
                updated_at = now()
          WHERE id = $1`,
        [
          eventId,
          event.title,
          event.description,
          event.canonicalUrl,
          listingUrls,
          event.startAt,
          event.endAt ?? null,
          event.timezone ?? null,
          event.venueName ?? null,
          event.address ?? null,
          event.city ?? null,
          event.metro,
          event.lat ?? null,
          event.lng ?? null,
          event.attendance,
          event.access,
          event.accessEvidence,
          event.bucket,
          event.industries,
          event.hostName ?? null,
        ],
      );
    } else {
      const inserted = await dbQuery<{ id: string }>(
        `INSERT INTO networking.events (
            fingerprint, title, description, canonical_url, listing_urls,
            start_at, end_at, timezone, venue_name, address, city, metro,
            lat, lng, attendance, access, access_evidence, bucket, industries, host_name
         ) VALUES (
            $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
         )
         ON CONFLICT (fingerprint) DO UPDATE SET
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            canonical_url = EXCLUDED.canonical_url,
            listing_urls = EXCLUDED.listing_urls,
            start_at = EXCLUDED.start_at,
            end_at = EXCLUDED.end_at,
            timezone = EXCLUDED.timezone,
            venue_name = EXCLUDED.venue_name,
            address = EXCLUDED.address,
            city = EXCLUDED.city,
            metro = EXCLUDED.metro,
            lat = EXCLUDED.lat,
            lng = EXCLUDED.lng,
            attendance = EXCLUDED.attendance,
            access = EXCLUDED.access,
            access_evidence = EXCLUDED.access_evidence,
            bucket = EXCLUDED.bucket,
            industries = EXCLUDED.industries,
            host_name = EXCLUDED.host_name,
            status = 'scheduled',
            last_seen_at = now(),
            updated_at = now()
         RETURNING id`,
        [
          fingerprint,
          event.title,
          event.description,
          event.canonicalUrl,
          listingUrls,
          event.startAt,
          event.endAt ?? null,
          event.timezone ?? null,
          event.venueName ?? null,
          event.address ?? null,
          event.city ?? null,
          event.metro,
          event.lat ?? null,
          event.lng ?? null,
          event.attendance,
          event.access,
          event.accessEvidence,
          event.bucket,
          event.industries,
          event.hostName ?? null,
        ],
      );
      eventId = inserted.rows[0].id;
    }
    for (const listing of event.listings) {
      await dbQuery(
        `INSERT INTO networking.event_listings (event_id, source, source_event_id, url)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (source, source_event_id) DO UPDATE SET
            event_id = EXCLUDED.event_id,
            url = EXCLUDED.url`,
        [eventId, listing.source, listing.sourceEventId, listing.url],
      );
    }
    kept += 1;
  }
  return kept;
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
        JSON.stringify({ hostName: c.hostName, trusted: c.trusted }),
        runId,
      ],
    );
    count += 1;
  }
  return count;
}

export type ListEventsFilter = {
  metro?: 'boston' | 'miami';
  bucket?: 'tech' | 'vertical' | 'both';
  industry?: string;
  access?: 'open' | 'paid' | 'invite_only';
  from?: Date;
  to?: Date;
};

export async function listKeptEvents(filter: ListEventsFilter = {}): Promise<StoredNetworkingEvent[]> {
  const clauses = [`e.status = 'scheduled'`];
  const params: unknown[] = [];
  const add = (value: unknown, sql: string) => {
    params.push(value);
    clauses.push(sql.replace('?', `$${params.length}`));
  };
  if (filter.metro) add(filter.metro, 'e.metro = ?');
  if (filter.bucket === 'both') add('both', 'e.bucket = ?');
  else if (filter.bucket) add(filter.bucket, '(e.bucket = ? OR e.bucket = \'both\')');
  if (filter.industry) add(filter.industry, '? = ANY (e.industries)');
  if (filter.access) add(filter.access, 'e.access = ?');
  if (filter.from) add(filter.from, 'e.start_at >= ?');
  if (filter.to) add(filter.to, 'e.start_at <= ?');

  const { rows } = await dbQuery<EventRow>(
    `SELECT e.*
       FROM networking.events e
      WHERE ${clauses.join(' AND ')}
      ORDER BY e.start_at ASC`,
    params,
  );
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const listings = await dbQuery<{
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

export async function eventCounts(filter: { metro?: 'boston' | 'miami'; from?: Date; to?: Date }) {
  const events = await listKeptEvents(filter);
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
