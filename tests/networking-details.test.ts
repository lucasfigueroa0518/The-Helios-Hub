import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { normalizeLumaEvent } from '@/lib/networking/adapters/luma';
import { deduplicate } from '@/lib/networking/dedupe';
import { applyDetailPatch, runEventDetails, selectDetailTargets, DETAILS_WINDOW_DAYS } from '@/lib/networking/details';
import { internalEventsFilter } from '@/lib/networking/internal-filter';
import { classifyCandidate } from '@/lib/networking/keep-drop';
import {
  eventCounts,
  listKeptEvents,
  upsertAnchors,
  upsertKeptEvents,
  type NetworkingQuery,
} from '@/lib/networking/repository';
import type { CandidateEvent, ClassifiedEvent, Metro } from '@/lib/networking/types';

// Offline: PGlite loaded with the real db/networking_schema.sql, and every HTTP call stubbed.

function schemaSql(): string {
  return readFileSync(path.join(process.cwd(), 'db', 'networking_schema.sql'), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');
}

async function openDb(): Promise<{ pg: PGlite; query: NetworkingQuery }> {
  const pg = new PGlite();
  await pg.exec(schemaSql());
  const query: NetworkingQuery = async (text, params) => ({ rows: (await pg.query(text, params as unknown[])).rows as never[] });
  return { pg, query };
}

const NOW = new Date('2026-10-21T12:00:00Z');
const DAY_MS = 24 * 60 * 60 * 1000;
const inDays = (days: number) => new Date(NOW.getTime() + days * DAY_MS);

let seq = 0;
async function insertEvent(
  query: NetworkingQuery,
  input: {
    metro?: Metro;
    startAt: Date;
    status?: string;
    detailsFetchedAt?: Date | null;
    listings?: Array<{ source: string; id: string; url?: string }>;
    description?: string;
    organizerKind?: string;
    signals?: Record<string, unknown>;
    endAt?: Date | null;
  },
): Promise<string> {
  seq += 1;
  const { rows } = await query<{ id: string }>(
    `INSERT INTO networking.events (fingerprint, title, description, canonical_url, start_at, end_at, metro, attendance, access, bucket,
                                    status, details_fetched_at, organizer_kind, signals)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'in_person', 'open', 'tech', $8, $9, $10, $11::jsonb)
     RETURNING id`,
    [
      `fp-${seq}`,
      `Event ${seq}`,
      input.description ?? '',
      `https://example.com/${seq}`,
      input.startAt,
      input.endAt ?? null,
      input.metro ?? 'boston',
      input.status ?? 'scheduled',
      input.detailsFetchedAt ?? null,
      input.organizerKind ?? null,
      JSON.stringify(input.signals ?? {}),
    ],
  );
  const id = rows[0].id;
  for (const listing of input.listings ?? [{ source: 'luma', id: `evt-${seq}` }]) {
    await query(
      `INSERT INTO networking.event_listings (event_id, source, source_event_id, url) VALUES ($1, $2, $3, $4)`,
      [id, listing.source, listing.id, listing.url ?? `https://luma.com/${listing.id}`],
    );
  }
  return id;
}

// ── Schema ─────────────────────────────────────────────────────────────────

test('networking schema applies twice and allows the four metros only', async () => {
  const { pg, query } = await openDb();
  await pg.exec(schemaSql());
  for (const metro of ['boston', 'miami', 'nyc', 'sf']) {
    await insertEvent(query, { metro: metro as Metro, startAt: inDays(2) });
  }
  await assert.rejects(() => insertEvent(query, { metro: 'la' as Metro, startAt: inDays(2) }), /events_metro_check/);
  const columns = await query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'networking' AND table_name = 'events'`,
  );
  const names = new Set(columns.rows.map((r) => r.column_name));
  for (const column of [
    'organizer_name', 'organizer_kind', 'organizer_url', 'hosts', 'guest_count', 'capacity', 'spots_remaining', 'is_sold_out',
    'waitlist_active', 'requires_approval', 'is_free', 'price_min_cents', 'price_max_cents', 'price_currency',
    'organizer_event_count', 'organizer_member_count', 'organizer_rating', 'organizer_rating_count', 'series_key',
    'source_tags', 'rsvp_offsite', 'signals', 'description_source', 'details_fetched_at',
  ]) {
    assert.ok(names.has(column), `networking.events.${column}`);
  }
  for (const table of ['anchors', 'jev_logs', 'cost_events', 'event_scores', 'publish_state']) {
    const { rows } = await query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'networking' AND table_name = $1`, [table]);
    assert.equal(rows.length, 1, `networking.${table}`);
  }
  await pg.close();
});

test('anchors upsert on (name, metro, starts_on)', async () => {
  const { pg, query } = await openDb();
  const anchor = { name: 'AIE CODE Summit', metro: 'sf' as const, startsOn: '2026-11-10', endsOn: '2026-11-12', url: 'https://www.ai.engineer/code', source: 'developers.events' };
  assert.equal(await upsertAnchors([anchor], query), 1);
  await upsertAnchors([{ ...anchor, endsOn: '2026-11-13' }], query);
  const { rows } = await query<{ ends_on: Date | string }>(`SELECT ends_on FROM networking.anchors`);
  assert.equal(rows.length, 1);
  assert.match(String(rows[0].ends_on instanceof Date ? rows[0].ends_on.toISOString() : rows[0].ends_on), /2026-11-13/);
  await pg.close();
});

// ── Upsert and re-ingest ───────────────────────────────────────────────────

function lumaEntry(overrides: Record<string, unknown> = {}) {
  return {
    api_id: 'entry-1',
    event: {
      api_id: 'evt-upsert1',
      name: 'AI Founders Dinner',
      start_at: inDays(3).toISOString(),
      timezone: 'America/New_York',
      url: 'ai-founders-dinner',
      location_type: 'offline',
      show_guest_list: true,
      geo_address_info: { city: 'Boston', region: 'Massachusetts', region_short: 'MA' },
      coordinate: { latitude: 42.36, longitude: -71.06 },
    },
    calendar: { api_id: 'cal-up1', name: 'Boston AI Dinners', slug: 'bostonaidinners', is_personal: false },
    hosts: [{ name: 'Boston AI Dinners', bio_short: 'Monthly founder dinners' }],
    guest_count: 40,
    ticket_info: { price: null, is_free: true, is_sold_out: false, spots_remaining: 10, is_near_capacity: true, require_approval: true },
    waitlist_active: false,
    registration_availability: 'open',
    featured_guests: [{ name: 'Private Guest Person', bio_short: 'attendee' }],
    ...overrides,
  };
}

function keep(candidate: CandidateEvent): ClassifiedEvent {
  const result = classifyCandidate(candidate, { now: NOW });
  assert.ok(result.keep, 'fixture should be kept');
  return result.event;
}

test('kept events store their signals; a re-ingest keeps details and unions tags', async () => {
  const { pg, query } = await openDb();
  const first = normalizeLumaEvent(lumaEntry(), { trusted: false, sourceTag: 'discover:boston' })!;
  await upsertKeptEvents(deduplicate([keep(first)]), query);

  let [stored] = await listKeptEvents({}, query);
  assert.equal(stored.organizerName, 'Boston AI Dinners');
  assert.equal(stored.organizerKind, 'luma_calendar');
  assert.equal(stored.organizerUrl, 'https://luma.com/bostonaidinners');
  assert.deepEqual(stored.hosts, [{ name: 'Boston AI Dinners', bioShort: 'Monthly founder dinners' }]);
  assert.equal(stored.guestCount, 40);
  assert.equal(stored.isFree, true);
  assert.equal(stored.requiresApproval, true);
  assert.equal(stored.spotsRemaining, 10);
  assert.equal(stored.seriesKey, 'luma:cal-up1');
  assert.deepEqual(stored.sourceTags, ['discover:boston']);
  assert.equal(stored.signals.nearCapacity, true);
  assert.equal(stored.signals.lumaCalendarSlug, 'bostonaidinners');
  assert.equal(stored.detailsFetchedAt, null);
  const raw = await query<{ raw: Record<string, unknown> }>(`SELECT raw FROM networking.event_listings`);
  assert.ok(raw.rows[0].raw);
  assert.ok(!JSON.stringify(raw.rows[0].raw).includes('Private Guest Person'));

  // The details job fills the description and capacity once.
  await applyDetailPatch(query, stored.id, {
    description: 'Dinner for founders building with AI.',
    descriptionSource: 'luma_event_get',
    capacity: 60,
    addTags: ['category:ai'],
    signals: {},
    complete: true,
  });

  // Next Sunday's discover copy has no description, a new guest count and another feed.
  const again = normalizeLumaEvent(lumaEntry({ guest_count: 55 }), { trusted: false, sourceTag: 'discover:ai' })!;
  await upsertKeptEvents(deduplicate([keep(again)]), query);
  const all = await listKeptEvents({}, query);
  assert.equal(all.length, 1);
  [stored] = all;
  assert.equal(stored.description, 'Dinner for founders building with AI.');
  assert.equal(stored.descriptionSource, 'luma_event_get');
  assert.equal(stored.capacity, 60);
  assert.equal(stored.guestCount, 55);
  assert.deepEqual(stored.sourceTags, ['category:ai', 'discover:ai', 'discover:boston']);
  assert.ok(stored.detailsFetchedAt, 'a re-ingest never clears details_fetched_at');
  await pg.close();
});

// ── Internal view ──────────────────────────────────────────────────────────

test('the internal events filter never returns NYC or SF, in the list or the counts', async () => {
  const { pg, query } = await openDb();
  for (const metro of ['boston', 'miami', 'nyc', 'sf', 'nyc'] as Metro[]) {
    await insertEvent(query, { metro, startAt: inDays(3) });
  }
  for (const qs of ['', 'metro=all', 'metro=nyc', 'metro=sf', 'metro=bogus']) {
    const filter = internalEventsFilter(new URLSearchParams(qs));
    assert.deepEqual([...filter.metros], ['boston', 'miami'], qs || '(no metro)');
    const events = await listKeptEvents(filter, query);
    assert.deepEqual(events.map((e) => e.metro).sort(), ['boston', 'miami']);
    const counts = await eventCounts({ metros: filter.metros }, query);
    assert.equal(counts.total, 2);
  }
  const boston = internalEventsFilter(new URLSearchParams('metro=boston&bucket=tech&from=2026-10-01T00:00:00Z'));
  assert.deepEqual([...boston.metros], ['boston']);
  assert.equal(boston.bucket, 'tech');
  assert.equal(boston.from?.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.deepEqual((await listKeptEvents(boston, query)).map((e) => e.metro), ['boston']);
  await pg.close();
});

// ── Details job: selection ─────────────────────────────────────────────────

test('details selection: scheduled, next ten days, never fetched, with a Luma or Meetup listing', async () => {
  const { pg, query } = await openDb();
  const soon = await insertEvent(query, { startAt: inDays(2) });
  const meetup = await insertEvent(query, { startAt: inDays(9.5), listings: [{ source: 'meetup', id: '777', url: 'https://www.meetup.com/g/events/777/' }] });
  await insertEvent(query, { startAt: inDays(DETAILS_WINDOW_DAYS + 0.5) });
  await insertEvent(query, { startAt: inDays(2), detailsFetchedAt: inDays(-3) });
  await insertEvent(query, { startAt: inDays(-0.5) });
  await insertEvent(query, { startAt: inDays(2), status: 'expired' });
  await insertEvent(query, { startAt: inDays(2), listings: [{ source: 'conferences', id: 'c1', url: 'https://example.com/conf' }] });
  const both = await insertEvent(query, {
    startAt: inDays(4),
    listings: [
      { source: 'luma', id: 'evt-both' },
      { source: 'meetup', id: '888', url: 'https://www.meetup.com/g/events/888/' },
    ],
  });

  const targets = await selectDetailTargets(query, NOW);
  assert.deepEqual(targets.map((t) => t.id), [soon, both, meetup]);
  const bothTarget = targets.find((t) => t.id === both)!;
  assert.deepEqual(bothTarget.listings.map((l) => `${l.source}:${l.sourceEventId}`), ['luma:evt-both', 'meetup:888']);
  assert.equal((await selectDetailTargets(query, NOW, 1)).length, 1, 'the per-run cap holds');
  await pg.close();
});

// ── Details job: fetch and apply ───────────────────────────────────────────

type Reply = { status: number; body: string };

function stubHttp(route: (url: URL) => Reply | undefined) {
  const calls: URL[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const fetchText = async (url: string) => {
    const parsed = new URL(url);
    calls.push(parsed);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((resolve) => setTimeout(resolve, 2));
      const reply = route(parsed) ?? { status: 404, body: 'not found' };
      return { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: reply.body };
    } finally {
      inFlight -= 1;
    }
  };
  const fetchJson = async <T,>(url: string) => {
    const result = await fetchText(url);
    if (!result.ok) return { ok: false, status: result.status, json: null as T | null, text: result.text };
    return { ok: true, status: result.status, json: JSON.parse(result.text) as T, text: result.text };
  };
  return { calls, maxInFlight: () => maxInFlight, fetchText, fetchJson };
}

function lumaDetailBody(text: string, caps: Array<number | null>) {
  return JSON.stringify({
    event: {
      api_id: 'x',
      name: 'x',
      start_at: inDays(2).toISOString(),
      cover_url: 'https://images.lumacdn.com/event-covers/x.jpg',
    },
    description_mirror: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] },
    ticket_types: caps.map((max_capacity) => ({ max_capacity })),
    categories: [{ api_id: 'cat-ai', slug: 'ai' }],
    featured_guests: [{ name: 'Private Guest Person' }],
  });
}

function meetupPage(id: string, yes: number, waitlist: number) {
  const apollo = {
    [`Event:${id}`]: {
      __typename: 'Event',
      id,
      title: 'Agents meetup',
      description: 'Full Meetup text. Grab your tickets at https://www.eventbrite.com/e/agents-123',
      dateTime: '2026-10-25T18:00:00-04:00',
      endTime: '2026-10-25T20:30:00-04:00',
      eventHosts: [{ __ref: 'EventHost:1' }],
      group: { __ref: 'Group:1' },
      'rsvps({"filter":{"rsvpStatus":["YES"]}})': { totalCount: yes },
      'rsvps({"filter":{"rsvpStatus":["WAITLIST"]}})': { totalCount: waitlist },
      topics: { edges: [{ node: { __ref: 'Topic:1' } }] },
      featuredEventPhoto: { __ref: 'EventPhoto:1' },
    },
    'EventPhoto:1': {
      __typename: 'EventPhoto',
      highResUrl: 'https://secure-content.meetupstatic.com/images/event/photo/highres.jpg',
    },
    'EventHost:1': { __typename: 'EventHost', memberId: '1', name: 'Jamie Host' },
    'Group:1': { __typename: 'Group', id: '1', name: 'Agents Group', urlname: 'agents-group', stats: { memberCounts: { all: 2500 } } },
    'Topic:1': { __typename: 'Topic', id: '1', name: 'Artificial Intelligence', urlkey: 'artificial-intelligence' },
  };
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { __APOLLO_STATE__: apollo } },
  })}</script></html>`;
}

test('details job fetches each event once, three at a time, and fills what the listings lacked', async () => {
  const { pg, query } = await openDb();
  const calendar = { lumaCalendarSlug: 'demoventures' };
  const lumaA = await insertEvent(query, { startAt: inDays(1), listings: [{ source: 'luma', id: 'evt-a' }], organizerKind: 'luma_calendar', signals: calendar });
  const lumaB = await insertEvent(query, { startAt: inDays(2), listings: [{ source: 'luma', id: 'evt-b' }], organizerKind: 'luma_calendar', signals: calendar });
  const meetupOnly = await insertEvent(query, { startAt: inDays(3), listings: [{ source: 'meetup', id: '501', url: 'https://www.meetup.com/agents-group/events/501/' }] });
  const flaky = await insertEvent(query, { startAt: inDays(4), listings: [{ source: 'luma', id: 'evt-flaky' }] });
  const gone = await insertEvent(query, { startAt: inDays(5), listings: [{ source: 'luma', id: 'evt-gone' }] });
  const described = await insertEvent(query, {
    startAt: inDays(6),
    description: 'Already described by Meetup.',
    listings: [
      { source: 'luma', id: 'evt-c' },
      { source: 'meetup', id: '502', url: 'https://www.meetup.com/agents-group/events/502/' },
    ],
  });
  for (let i = 0; i < 4; i += 1) await insertEvent(query, { startAt: inDays(7 + i * 0.1), listings: [{ source: 'luma', id: `evt-extra-${i}` }] });

  const http = stubHttp((url) => {
    if (url.hostname === 'api.luma.com' && url.pathname === '/event/get') {
      const id = url.searchParams.get('event_api_id');
      if (id === 'evt-flaky') return { status: 503, body: 'busy' };
      if (id === 'evt-gone') return undefined;
      return { status: 200, body: lumaDetailBody(`Luma text for ${id}.`, id === 'evt-a' ? [80, 20] : [null]) };
    }
    if (url.hostname === 'api.luma.com' && url.pathname === '/url') {
      return {
        status: 200,
        body: JSON.stringify({ kind: 'calendar', data: { event_start_ats: ['2025-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2026-12-01T00:00:00Z'] } }),
      };
    }
    if (url.hostname === 'www.meetup.com') {
      const id = url.pathname.split('/').filter(Boolean).pop()!;
      return { status: 200, body: meetupPage(id, 64, 5) };
    }
    return undefined;
  });

  const result = await runEventDetails({
    now: NOW,
    spacingMs: 0,
    deps: { query, fetchJson: http.fetchJson as never, fetchText: http.fetchText as never, sleep: async () => {} },
  });
  assert.ok(http.calls.every((c) => c.hostname === 'api.luma.com' || c.hostname === 'www.meetup.com'));
  assert.ok(http.maxInFlight() <= 3, `max in flight ${http.maxInFlight()}`);
  assert.equal(result.targets, 10);
  assert.equal(result.completed, 9, 'only the 503 stays pending');
  assert.equal(result.pending, 1);
  assert.deepEqual(result.calendars, { resolved: 1, failed: 0 });
  assert.equal(http.calls.filter((c) => c.pathname === '/url').length, 1, 'one resolve per calendar per run');

  const byId = new Map((await listKeptEvents({}, query)).map((e) => [e.id, e]));
  const a = byId.get(lumaA)!;
  assert.equal(a.description, 'Luma text for evt-a.');
  assert.equal(a.descriptionSource, 'luma_event_get');
  assert.equal(a.capacity, 100);
  assert.deepEqual(a.sourceTags, ['category:ai']);
  assert.equal(a.organizerEventCount, 2);
  assert.equal(a.signals.organizerUpcomingCount, 1);
  assert.ok(a.detailsFetchedAt);
  assert.equal(a.signals.coverUrl, 'https://images.lumacdn.com/event-covers/x.jpg');
  assert.ok(!JSON.stringify(a).includes('Private Guest Person'));
  assert.equal(byId.get(lumaB)!.capacity, null, 'an uncapped ticket type stores no capacity');
  assert.equal(byId.get(lumaB)!.organizerEventCount, 2);

  const m = byId.get(meetupOnly)!;
  assert.match(m.description, /^Full Meetup text/);
  assert.equal(m.descriptionSource, 'meetup_event_page');
  assert.equal(m.endAt, '2026-10-26T00:30:00.000Z');
  assert.equal(m.guestCount, 64, 'YES count for a Meetup-only event');
  assert.equal(m.organizerMemberCount, 2500);
  assert.deepEqual(m.hosts, [{ name: 'Jamie Host' }]);
  assert.equal(m.rsvpOffsite, true);
  assert.equal(m.signals.waitlistCount, 5);
  assert.equal(m.signals.coverUrl, 'https://secure-content.meetupstatic.com/images/event/photo/highres.jpg');
  assert.deepEqual(m.sourceTags, ['topic:artificial-intelligence']);

  const d = byId.get(described)!;
  assert.equal(d.description, 'Already described by Meetup.', 'an existing description is never replaced');
  assert.equal(d.guestCount, null, 'a Meetup count never overrides an event Luma lists');

  assert.equal(byId.get(flaky)!.detailsFetchedAt, null);
  assert.ok(byId.get(gone)!.detailsFetchedAt, 'a 404 is final, not retried weekly');

  // A second run asks only for the event that failed.
  const callsBefore = http.calls.length;
  const second = await runEventDetails({
    now: NOW,
    spacingMs: 0,
    deps: { query, fetchJson: http.fetchJson as never, fetchText: http.fetchText as never, sleep: async () => {} },
  });
  assert.equal(second.targets, 1);
  assert.deepEqual(
    http.calls.slice(callsBefore).map((c) => c.searchParams.get('event_api_id')),
    ['evt-flaky'],
  );
  await pg.close();
});

test('calendar lookups run one at a time and back off on 429 before giving up', async () => {
  const { pg, query } = await openDb();
  await insertEvent(query, { startAt: inDays(1), listings: [{ source: 'luma', id: 'evt-r1' }], organizerKind: 'luma_calendar', signals: { lumaCalendarSlug: 'busycal' } });
  await insertEvent(query, { startAt: inDays(2), listings: [{ source: 'luma', id: 'evt-r2' }], organizerKind: 'luma_calendar', signals: { lumaCalendarSlug: 'limitedcal' } });
  let busyCalls = 0;
  const http = stubHttp((url) => {
    if (url.pathname === '/event/get') return { status: 200, body: lumaDetailBody('Text.', [null]) };
    if (url.pathname === '/url') {
      if (url.searchParams.get('url') === 'limitedcal') return { status: 429, body: 'slow down' };
      busyCalls += 1;
      if (busyCalls === 1) return { status: 429, body: 'slow down' };
      return { status: 200, body: JSON.stringify({ kind: 'calendar', data: { event_start_ats: ['2025-01-01T00:00:00Z'] } }) };
    }
    return undefined;
  });
  const sleeps: number[] = [];
  const result = await runEventDetails({
    now: NOW,
    spacingMs: 0,
    calendarSpacingMs: 0,
    deps: { query, fetchJson: http.fetchJson as never, fetchText: http.fetchText as never, sleep: async (ms: number) => { sleeps.push(ms); } },
  });
  assert.deepEqual(result.calendars, { resolved: 1, failed: 1 });
  assert.equal(busyCalls, 2, 'one 429, then a successful retry');
  assert.equal(http.calls.filter((c) => c.pathname === '/url').length, 5, 'limitedcal: 1 try + 2 backoffs; busycal: 2');
  assert.ok(sleeps.includes(5_000) && sleeps.includes(15_000), `backoffs ${sleeps.join(',')}`);
  await pg.close();
});
