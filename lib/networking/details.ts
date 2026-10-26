import { mapPool } from '@/lib/async-pool';
import { fetchLumaCalendarTrackRecord, fetchLumaEventDetail } from '@/lib/networking/adapters/luma';
import { fetchMeetupEventDetail } from '@/lib/networking/adapters/meetup';
import { fetchJson, fetchText } from '@/lib/networking/http';
import { liveNetworkingQuery, type NetworkingQuery } from '@/lib/networking/repository';
import { hasOffsiteRsvp } from '@/lib/networking/signals';
import type { EventHost, EventSignalExtras } from '@/lib/networking/types';

/**
 * networking.event_details (AE-05/06): one detail fetch per kept, scheduled event starting in
 * the next ten days, never repeated (`details_fetched_at`). Luma `event/get` gives the
 * description, capacity and categories; the Meetup event page gives the full description, end
 * time, group size and YES/WAITLIST counts. Each Luma community calendar is resolved once per
 * run for its track record. Plain HTTP, no model calls (Rule 1 is not touched). Only events this
 * pipeline ingested are read, never a backfill of other tables (Rule 2 carve-out AE-05).
 */
export const DETAILS_WINDOW_DAYS = 10;
export const DETAILS_CONCURRENCY = 3;
/** Minimum gap between two request starts across all workers. */
export const DETAILS_SPACING_MS = 350;
/**
 * Luma rate-limits calendar lookups hard (most of 230 came back 429 at the event pace), so they
 * run one at a time, spaced, with backoff on 429. The job heartbeats, so a slower pass is safe.
 */
export const CALENDAR_SPACING_MS = 1_200;
export const CALENDAR_429_BACKOFF_MS = [5_000, 15_000] as const;
/** Safety bound per run; a normal week is well under it. */
export const DETAILS_MAX_EVENTS = 500;

export type DetailListing = { source: string; sourceEventId: string; url: string };

export type DetailTarget = {
  id: string;
  startAt: Date;
  description: string;
  endAt: Date | null;
  hostCount: number;
  sourceTags: string[];
  signals: EventSignalExtras;
  organizerKind: string | null;
  listings: DetailListing[];
};

/**
 * Scheduled events in [now, now + 10 days) with no details yet and at least one Luma or Meetup
 * listing (nothing else has a detail page to read).
 */
export const DETAIL_TARGETS_SQL = `
SELECT e.id,
       e.start_at,
       e.description,
       e.end_at,
       jsonb_array_length(e.hosts) AS host_count,
       e.source_tags,
       e.signals,
       e.organizer_kind,
       json_agg(json_build_object('source', l.source, 'sourceEventId', l.source_event_id, 'url', l.url)
                ORDER BY l.source, l.source_event_id) AS listings
  FROM networking.events e
  JOIN networking.event_listings l
    ON l.event_id = e.id AND l.source IN ('luma', 'meetup')
 WHERE e.status = 'scheduled'
   AND e.details_fetched_at IS NULL
   AND e.start_at >= $1
   AND e.start_at < $2
 GROUP BY e.id
 ORDER BY e.start_at ASC, e.id
 LIMIT $3`;

type TargetRow = {
  id: string;
  start_at: Date | string;
  description: string;
  end_at: Date | string | null;
  host_count: number;
  source_tags: string[] | null;
  signals: EventSignalExtras | null;
  organizer_kind: string | null;
  listings: DetailListing[] | string;
};

const asDate = (value: Date | string | null) => (value == null ? null : value instanceof Date ? value : new Date(value));

export async function selectDetailTargets(
  query: NetworkingQuery,
  now: Date,
  limit = DETAILS_MAX_EVENTS,
): Promise<DetailTarget[]> {
  const until = new Date(now.getTime() + DETAILS_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const { rows } = await query<TargetRow>(DETAIL_TARGETS_SQL, [now, until, limit]);
  return rows.map((row) => ({
    id: row.id,
    startAt: asDate(row.start_at)!,
    description: row.description ?? '',
    endAt: asDate(row.end_at),
    hostCount: Number(row.host_count) || 0,
    sourceTags: row.source_tags ?? [],
    signals: row.signals ?? {},
    organizerKind: row.organizer_kind,
    listings: typeof row.listings === 'string' ? (JSON.parse(row.listings) as DetailListing[]) : row.listings,
  }));
}

/** What one event's detail fetches add. Undefined fields leave the stored value alone. */
export type DetailPatch = {
  description?: string;
  descriptionSource?: string;
  capacity?: number;
  endAt?: Date;
  addTags: string[];
  organizerMemberCount?: number;
  organizerRating?: number;
  organizerRatingCount?: number;
  guestCount?: number;
  hosts?: EventHost[];
  rsvpOffsite?: boolean;
  signals: EventSignalExtras;
  /** False when a fetch failed in a way worth retrying (network, 5xx, 429): the event stays pending. */
  complete: boolean;
};

export type DetailsDeps = {
  query: NetworkingQuery;
  fetchJson: typeof fetchJson;
  fetchText: typeof fetchText;
  sleep: (ms: number) => Promise<void>;
};

const liveDeps = (): DetailsDeps => ({
  query: liveNetworkingQuery,
  fetchJson,
  fetchText,
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});

/** 2xx and 4xx (other than 429) are final answers; a 404 is not worth asking again. */
const definitive = (status: number) => status > 0 && status < 500 && status !== 429;

/** Spaces request starts at least `ms` apart, whichever worker asks. */
function spacer(ms: number, sleep: DetailsDeps['sleep']) {
  let nextAt = 0;
  return async () => {
    if (ms <= 0) return;
    const now = Date.now();
    const wait = Math.max(0, nextAt - now);
    nextAt = Math.max(now, nextAt) + ms;
    if (wait > 0) await sleep(wait);
  };
}

type FetchLog = { luma: { ok: number; failed: number }; meetup: { ok: number; failed: number }; errors: string[] };

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function fetchTargetDetails(
  target: DetailTarget,
  deps: DetailsDeps,
  wait: () => Promise<void>,
  log: FetchLog,
): Promise<DetailPatch> {
  const patch: DetailPatch = { addTags: [], signals: {}, complete: true };
  const hasLuma = target.listings.some((listing) => listing.source === 'luma');
  const needsDescription = !target.description.trim();
  const fail = (source: 'luma' | 'meetup', message: string) => {
    log[source].failed += 1;
    if (log.errors.length < 20) log.errors.push(`${source} ${target.id}: ${message}`);
  };

  for (const listing of target.listings) {
    if (listing.source === 'luma') {
      await wait();
      try {
        const { status, detail } = await fetchLumaEventDetail(listing.sourceEventId, deps.fetchJson);
        if (!definitive(status)) patch.complete = false;
        if (!detail) {
          fail('luma', `HTTP ${status}`);
          continue;
        }
        log.luma.ok += 1;
        if (needsDescription && detail.description && !patch.description) {
          patch.description = detail.description;
          patch.descriptionSource = 'luma_event_get';
        }
        if (detail.capacity != null) patch.capacity = detail.capacity;
        patch.addTags.push(...detail.sourceTags);
        if (detail.coverUrl && !patch.signals.coverUrl) patch.signals.coverUrl = detail.coverUrl;
      } catch (err) {
        patch.complete = false;
        fail('luma', describe(err));
      }
    } else if (listing.source === 'meetup' && listing.url) {
      await wait();
      try {
        const { status, detail } = await fetchMeetupEventDetail(listing.url, listing.sourceEventId, deps.fetchText);
        if (!definitive(status)) patch.complete = false;
        if (!detail) {
          fail('meetup', `HTTP ${status}`);
          continue;
        }
        log.meetup.ok += 1;
        const meetup = detail.signals;
        if (needsDescription && detail.description && !patch.description) {
          patch.description = detail.description;
          patch.descriptionSource = 'meetup_event_page';
        }
        if (!target.endAt && detail.endAt) patch.endAt = detail.endAt;
        patch.organizerMemberCount = meetup.organizerMemberCount ?? patch.organizerMemberCount;
        patch.organizerRating = meetup.organizerRating ?? patch.organizerRating;
        patch.organizerRatingCount = meetup.organizerRatingCount ?? patch.organizerRatingCount;
        // Luma reads attendance directly; a Meetup copy of a Luma event is often a cross-post.
        if (!hasLuma && meetup.guestCount != null) patch.guestCount = meetup.guestCount;
        if (target.hostCount === 0 && meetup.hosts?.length) patch.hosts = meetup.hosts;
        if (detail.description) patch.rsvpOffsite = hasOffsiteRsvp(detail.description);
        patch.addTags.push(...(meetup.sourceTags ?? []));
        if (meetup.signals?.waitlistCount != null) patch.signals.waitlistCount = meetup.signals.waitlistCount;
        if (meetup.signals?.recurrence) patch.signals.recurrence = meetup.signals.recurrence;
        if (meetup.signals?.coverUrl && !patch.signals.coverUrl) patch.signals.coverUrl = meetup.signals.coverUrl;
      } catch (err) {
        patch.complete = false;
        fail('meetup', describe(err));
      }
    }
  }
  return patch;
}

const APPLY_PATCH_SQL = `
UPDATE networking.events
   SET description = CASE WHEN description = '' AND $2::text IS NOT NULL THEN $2::text ELSE description END,
       description_source = CASE WHEN description = '' AND $2::text IS NOT NULL THEN $3::text ELSE description_source END,
       capacity = COALESCE($4::integer, capacity),
       end_at = COALESCE(end_at, $5::timestamptz),
       source_tags = ARRAY(SELECT DISTINCT tag FROM unnest(source_tags || $6::text[]) AS tag ORDER BY tag),
       organizer_member_count = COALESCE($7::integer, organizer_member_count),
       organizer_rating = COALESCE($8::numeric, organizer_rating),
       organizer_rating_count = COALESCE($9::integer, organizer_rating_count),
       guest_count = COALESCE($10::integer, guest_count),
       hosts = CASE WHEN jsonb_array_length(hosts) = 0 AND jsonb_array_length($11::jsonb) > 0 THEN $11::jsonb ELSE hosts END,
       rsvp_offsite = CASE WHEN $12::boolean IS NULL THEN rsvp_offsite ELSE COALESCE(rsvp_offsite, false) OR $12::boolean END,
       signals = signals || $13::jsonb,
       details_fetched_at = CASE WHEN $14::boolean THEN now() ELSE details_fetched_at END,
       updated_at = now()
 WHERE id = $1`;

export async function applyDetailPatch(query: NetworkingQuery, eventId: string, patch: DetailPatch): Promise<void> {
  const int = (value: number | undefined) => (value == null ? null : Math.round(value));
  await query(APPLY_PATCH_SQL, [
    eventId,
    patch.description ?? null,
    patch.descriptionSource ?? null,
    int(patch.capacity),
    patch.endAt ?? null,
    [...new Set(patch.addTags)],
    int(patch.organizerMemberCount),
    patch.organizerRating ?? null,
    int(patch.organizerRatingCount),
    int(patch.guestCount),
    JSON.stringify(patch.hosts ?? []),
    patch.rsvpOffsite ?? null,
    JSON.stringify(patch.signals),
    patch.complete,
  ]);
}

const APPLY_TRACK_RECORD_SQL = `
UPDATE networking.events
   SET organizer_event_count = $2::integer,
       signals = signals || jsonb_build_object('organizerUpcomingCount', $3::integer),
       updated_at = now()
 WHERE id = ANY ($1::uuid[])`;

export type EventDetailsResult = {
  targets: number;
  completed: number;
  pending: number;
  descriptionsAdded: number;
  luma: { ok: number; failed: number };
  meetup: { ok: number; failed: number };
  calendars: { resolved: number; failed: number };
  errors: string[];
};

export async function runEventDetails(
  options: {
    now?: Date;
    deps?: Partial<DetailsDeps>;
    concurrency?: number;
    spacingMs?: number;
    calendarSpacingMs?: number;
    limit?: number;
  } = {},
): Promise<EventDetailsResult> {
  const deps: DetailsDeps = { ...liveDeps(), ...options.deps };
  const now = options.now ?? new Date();
  const concurrency = options.concurrency ?? DETAILS_CONCURRENCY;
  const wait = spacer(options.spacingMs ?? DETAILS_SPACING_MS, deps.sleep);
  const log: FetchLog = { luma: { ok: 0, failed: 0 }, meetup: { ok: 0, failed: 0 }, errors: [] };

  const targets = await selectDetailTargets(deps.query, now, options.limit);
  let completed = 0;
  let descriptionsAdded = 0;
  await mapPool(targets, concurrency, async (target) => {
    const patch = await fetchTargetDetails(target, deps, wait, log);
    await applyDetailPatch(deps.query, target.id, patch);
    if (patch.complete) completed += 1;
    if (patch.description) descriptionsAdded += 1;
  });

  // Organizer track record: each community calendar once per run, applied to this run's events.
  const bySlug = new Map<string, string[]>();
  for (const target of targets) {
    const slug = target.organizerKind === 'luma_calendar' ? target.signals.lumaCalendarSlug : undefined;
    if (!slug) continue;
    bySlug.set(slug, [...(bySlug.get(slug) ?? []), target.id]);
  }
  const calendars = { resolved: 0, failed: 0 };
  const calendarWait = spacer(options.calendarSpacingMs ?? CALENDAR_SPACING_MS, deps.sleep);
  // Busiest calendars first, so a rate limit late in the pass costs the least.
  const slugs = [...bySlug.entries()].sort((a, b) => b[1].length - a[1].length);
  await mapPool(slugs, 1, async ([slug, ids]) => {
    await calendarWait();
    try {
      let { status, record } = await fetchLumaCalendarTrackRecord(slug, now, deps.fetchJson);
      for (const backoff of CALENDAR_429_BACKOFF_MS) {
        if (record || status !== 429) break;
        await deps.sleep(backoff);
        ({ status, record } = await fetchLumaCalendarTrackRecord(slug, now, deps.fetchJson));
      }
      if (!record) {
        calendars.failed += 1;
        if (log.errors.length < 20) log.errors.push(`luma calendar ${slug}: HTTP ${status}`);
        return;
      }
      await deps.query(APPLY_TRACK_RECORD_SQL, [ids, record.pastCount, record.upcomingCount]);
      calendars.resolved += 1;
    } catch (err) {
      calendars.failed += 1;
      if (log.errors.length < 20) log.errors.push(`luma calendar ${slug}: ${describe(err)}`);
    }
  });

  return {
    targets: targets.length,
    completed,
    pending: targets.length - completed,
    descriptionsAdded,
    luma: log.luma,
    meetup: log.meetup,
    calendars,
    errors: log.errors,
  };
}
