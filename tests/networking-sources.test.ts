import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchBevyEvents, searchBevyMetro } from '@/lib/networking/adapters/bevy';
import {
  fetchLumaCalendar,
  fetchLumaEvents,
  lumaDiscoverQueries,
} from '@/lib/networking/adapters/luma';
import { addCandidateBatch } from '@/lib/networking/adapters/merge';
import { FIND_LOCATIONS, fetchMeetupEvents } from '@/lib/networking/adapters/meetup';
import { INGEST_SOURCES } from '@/lib/networking/adapters/registry';
import { LUMA_CALENDARS, MEETUP_GROUPS } from '@/lib/networking/allowlists';
import { METRO_PROFILES } from '@/lib/networking/cities';
import type { CandidateEvent } from '@/lib/networking/types';

// Every request goes through this stub; anything unrouted answers 404, so nothing leaves the machine.
type Reply = { status?: number; body: unknown; delayMs?: number };
function stubFetch(route: (url: URL) => Reply | undefined) {
  const original = globalThis.fetch;
  const calls: URL[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    calls.push(url);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      const reply = route(url);
      if (reply?.delayMs) await new Promise((resolve) => setTimeout(resolve, reply.delayMs));
      if (!reply) return new Response('not found', { status: 404 });
      const body = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
      return new Response(body, { status: reply.status ?? 200 });
    } finally {
      inFlight -= 1;
    }
  }) as typeof fetch;
  return {
    calls,
    maxInFlight: () => maxInFlight,
    restore: () => {
      globalThis.fetch = original;
    },
  };
}

function lumaEntry(apiId: string, overrides: Record<string, unknown> = {}) {
  return {
    api_id: `entry-${apiId}`,
    event: {
      api_id: apiId,
      name: 'Frontier Tower AI Salon',
      start_at: '2026-10-28T01:00:00.000Z',
      timezone: 'America/Los_Angeles',
      url: 'frontier-ai-salon',
      location_type: 'offline',
      geo_address_info: { type: 'manual', address: 'Frontier Tower @ Spaceship 995 Market Street, San Francisco', mode: 'shown' },
      coordinate: null,
      ...overrides,
    },
  };
}

test('Luma discover covers the place feed of every metro plus tech and ai at each center', () => {
  const queries = lumaDiscoverQueries();
  assert.deepEqual(
    queries.filter((q) => q.latitude == null).map((q) => q.slug),
    ['boston', 'miami', 'nyc', 'sf'],
  );
  for (const slug of ['tech', 'ai']) {
    const centers = queries.filter((q) => q.slug === slug).map((q) => `${q.latitude},${q.longitude}`);
    assert.deepEqual(
      centers.sort(),
      Object.values(METRO_PROFILES)
        .map((p) => `${p.center.lat},${p.center.lng}`)
        .sort(),
    );
  }
  assert.equal(queries.length, 12);
});

test('Luma calendar with a known apiId skips the resolve call', async () => {
  const stub = stubFetch((url) => {
    if (url.pathname === '/calendar/get-items') {
      return { body: { entries: [lumaEntry('evt-ft1')], has_more: false } };
    }
    return undefined;
  });
  try {
    const events = await fetchLumaCalendar({ slug: 'frontiertower', name: 'Frontier Tower SF', metro: 'sf', apiId: 'cal-Sl7q1nHTRXQzjP2' });
    assert.equal(stub.calls.length, 1);
    assert.equal(stub.calls[0].searchParams.get('calendar_api_id'), 'cal-Sl7q1nHTRXQzjP2');
    assert.equal(stub.calls[0].searchParams.get('period'), 'future');
    assert.equal(events.length, 1);
    assert.equal(events[0].hostName, 'Frontier Tower SF');
    assert.equal(events[0].trusted, true);
    assert.equal(events[0].isOnline, false);
    assert.equal(events[0].city, 'SF Bay Area', 'metro label fills a missing city');
  } finally {
    stub.restore();
  }
});

test('Luma calendar without an apiId resolves it through /url, never calendar/get', async () => {
  const stub = stubFetch((url) => {
    if (url.pathname === '/url' && url.searchParams.get('url') === 'some-new-calendar') {
      return {
        body: {
          kind: 'calendar',
          data: {
            calendar: { api_id: 'cal-NEW123', name: 'Some New Calendar', slug: 'some-new-calendar' },
            event_start_ats: ['2026-09-01T23:00:00.000Z'],
          },
        },
      };
    }
    if (url.pathname === '/calendar/get-items' && url.searchParams.get('calendar_api_id') === 'cal-NEW123') {
      return { body: { entries: [lumaEntry('evt-new1')], has_more: false } };
    }
    return undefined;
  });
  try {
    const events = await fetchLumaCalendar({ slug: 'some-new-calendar', name: 'Some New Calendar', metro: 'sf' });
    assert.equal(events.length, 1);
    assert.deepEqual(
      stub.calls.map((c) => c.pathname),
      ['/url', '/calendar/get-items'],
    );
    assert.ok(stub.calls.every((c) => c.pathname !== '/calendar/get'));
  } finally {
    stub.restore();
  }
});

test('Luma calendar that does not resolve to a calendar is reported, not silently empty', async () => {
  const stub = stubFetch((url) => (url.pathname === '/url' ? { body: { kind: 'event', data: {} } } : undefined));
  try {
    await assert.rejects(() => fetchLumaCalendar({ slug: 'not-a-calendar', name: 'X' }), /did not resolve/);
  } finally {
    stub.restore();
  }
});

test('Luma calendar copies merge into the discover copy instead of being dropped', async () => {
  const frontier = LUMA_CALENDARS.find((cal) => cal.slug === 'frontiertower')!;
  const stub = stubFetch((url) => {
    if (url.pathname === '/discover/get-paginated-events') {
      // The same event shows up in the sf place feed without any host.
      const entries = url.searchParams.get('slug') === 'sf' && url.searchParams.get('latitude') == null ? [lumaEntry('evt-shared')] : [];
      return { body: { entries, has_more: false } };
    }
    if (url.pathname === '/calendar/get-items') {
      const entries = url.searchParams.get('calendar_api_id') === frontier.apiId ? [lumaEntry('evt-shared')] : [];
      return { body: { entries, has_more: false } };
    }
    return undefined;
  });
  try {
    const result = await fetchLumaEvents();
    assert.equal(result.error, undefined);
    assert.equal(result.events.length, 1);
    assert.equal(result.events[0].hostName, 'Frontier Tower SF');
    assert.equal(result.events[0].trusted, true);
    // Every allowlisted calendar carries its apiId, so no resolve calls are made.
    assert.ok(stub.calls.every((c) => c.pathname !== '/url' && c.pathname !== '/calendar/get'));
    assert.equal(stub.calls.filter((c) => c.pathname === '/discover/get-paginated-events').length, 12);
    assert.equal(stub.calls.filter((c) => c.pathname === '/calendar/get-items').length, LUMA_CALENDARS.length);
  } finally {
    stub.restore();
  }
});

test('merge keeps the first copy and fills only what is missing', () => {
  const base: CandidateEvent = {
    source: 'luma',
    sourceEventId: 'evt-1',
    title: 'Discover title',
    description: '',
    url: 'https://luma.com/a',
    startAt: new Date('2026-10-28T01:00:00Z'),
    isOnline: false,
    trusted: false,
  };
  const byId = new Map<string, CandidateEvent>();
  addCandidateBatch(byId, [base]);
  addCandidateBatch(byId, [
    { ...base, title: 'Calendar title', description: 'From the calendar', hostName: 'MassTLC', city: 'Boston', trusted: true },
  ]);
  const merged = byId.get('evt-1')!;
  assert.equal(byId.size, 1);
  assert.equal(merged.title, 'Discover title');
  assert.equal(merged.description, 'From the calendar');
  assert.equal(merged.hostName, 'MassTLC');
  assert.equal(merged.city, 'Boston');
  assert.equal(merged.trusted, true);
});

function meetupHtml(apollo: Record<string, unknown>): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { __APOLLO_STATE__: apollo } },
  })}</script></html>`;
}

test('Meetup asks for NYC and the Bay Area by state-qualified location, four requests at a time', async () => {
  const groupApollo = {
    'Event:900': {
      __typename: 'Event',
      id: '900',
      title: 'Hacker Dojo AI Night',
      dateTime: '2026-10-29T18:30:00-07:00',
      eventUrl: 'https://www.meetup.com/hackerdojo/events/900/',
      eventType: 'PHYSICAL',
      venue: { __ref: 'Venue:1' },
      group: { __ref: 'Group:1' },
    },
    'Venue:1': { __typename: 'Venue', id: '1', name: 'Hacker Dojo', address: '855 Maude Ave', city: 'Mountain View', state: 'CA', country: 'us' },
    'Group:1': { __typename: 'Group', id: '1', name: 'Hacker Dojo', urlname: 'hackerdojo' },
  };
  const stub = stubFetch((url) => {
    if (url.pathname === '/find/') return { body: meetupHtml({}), delayMs: 5 };
    if (url.pathname === '/hackerdojo/events/') return { body: meetupHtml(groupApollo), delayMs: 5 };
    if (/^\/[^/]+\/events\/$/.test(url.pathname)) return { body: meetupHtml({}), delayMs: 5 };
    return undefined;
  });
  try {
    const result = await fetchMeetupEvents();
    const locations = stub.calls.filter((c) => c.pathname === '/find/').map((c) => c.searchParams.get('location'));
    for (const loc of ['us--ny--New-York', 'us--ca--San-Francisco', 'us--ca--San-Jose', 'us--Boston', 'us--Miami']) {
      assert.equal(locations.filter((l) => l === loc).length, 2, `${loc} in both categories`);
    }
    assert.ok(!locations.includes('us--New-York'), 'us--New-York resolves to Buffalo');
    assert.equal(locations.length, FIND_LOCATIONS.length * 2);
    assert.equal(stub.calls.length, FIND_LOCATIONS.length * 2 + MEETUP_GROUPS.length);
    assert.ok(stub.maxInFlight() <= 4, `max in flight ${stub.maxInFlight()}`);
    assert.equal(result.events.length, 1);
    const [event] = result.events;
    assert.equal(event.hostName, 'Hacker Dojo');
    assert.equal(event.city, 'Mountain View');
    assert.equal(event.region, 'CA');
    assert.equal(event.trusted, true);
    assert.equal(event.isOnline, false);
  } finally {
    stub.restore();
  }
});

function bevyRow(id: number, start: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `GDG event ${id}`,
    start_date_iso: start,
    end_date_iso: start,
    event_timezone: 'America/New_York',
    url: `https://gdg.community.dev/events/details/${id}/`,
    venue_name: 'Google NYC',
    venue_address: '111 8th Ave',
    venue_city: 'New York',
    chapter_city: 'New York',
    chapter_title: 'GDG NYC',
    audience_type: 'In-person',
    _geoloc: { lat: 40.7414, lng: -74.0033 },
    ...overrides,
  };
}

test('Bevy searches by latitude/longitude, follows links.next up to 5 pages, keeps future events', async () => {
  const now = new Date('2026-10-21T12:00:00Z');
  let page = 0;
  const stub = stubFetch((url) => {
    if (url.hostname !== 'gdg.community.dev') return undefined;
    page += 1;
    return {
      body: {
        count: 64936,
        links: { next: `https://gdg.community.dev/api/search/event/?latitude=40.7128&longitude=-74.006&page=${page + 1}&page_size=100`, previous: null },
        results: [bevyRow(page * 10, '2026-11-05T23:00:00Z'), bevyRow(page * 10 + 1, '2019-03-01T17:00:00Z')],
      },
    };
  });
  try {
    const events = await searchBevyMetro('nyc', now);
    assert.equal(stub.calls.length, 5);
    const first = stub.calls[0];
    assert.equal(first.searchParams.get('latitude'), String(METRO_PROFILES.nyc.center.lat));
    assert.equal(first.searchParams.get('longitude'), String(METRO_PROFILES.nyc.center.lng));
    assert.equal(first.searchParams.get('page_size'), '100');
    assert.equal(first.searchParams.get('lat'), null);
    assert.equal(first.searchParams.get('start_date'), null);
    assert.equal(stub.calls[1].searchParams.get('page'), '2');
    assert.equal(events.length, 5, 'one future event per page; past ones dropped');
    assert.ok(events.every((e) => e.startAt.getTime() > now.getTime()));
  } finally {
    stub.restore();
  }
});

test('Bevy never follows a next link off the GDG host, and loops over every metro', async () => {
  const stub = stubFetch((url) => {
    if (url.hostname !== 'gdg.community.dev') return { body: { results: [] } };
    return {
      body: {
        links: { next: 'https://evil.example.com/api/search/event/?page=2' },
        results: [bevyRow(Number(url.searchParams.get('latitude')), '2099-01-01T17:00:00Z')],
      },
    };
  });
  try {
    const result = await fetchBevyEvents();
    assert.ok(stub.calls.every((c) => c.hostname === 'gdg.community.dev'));
    const latitudes = stub.calls.map((c) => c.searchParams.get('latitude'));
    assert.deepEqual(
      latitudes,
      Object.values(METRO_PROFILES).map((p) => String(p.center.lat)),
    );
    assert.equal(result.events.length, 4);
    assert.equal(result.error, undefined);
  } finally {
    stub.restore();
  }
});

test('Bevy reports a failed first page', async () => {
  const stub = stubFetch(() => ({ status: 503, body: 'unavailable' }));
  try {
    await assert.rejects(() => searchBevyMetro('sf'), /Bevy search HTTP 503/);
  } finally {
    stub.restore();
  }
});

test('Eventbrite is out of the weekly ingest (AE-07)', () => {
  const names = INGEST_SOURCES.map((source) => source.name);
  assert.deepEqual(names, ['luma', 'meetup', 'ics', 'bevy', 'conferences']);
  assert.ok(!names.includes('eventbrite'));
});
