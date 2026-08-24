import assert from 'node:assert/strict';
import test from 'node:test';

import { parseJsonLdEvents, normalizeEventbriteEvent } from '@/lib/networking/adapters/eventbrite';
import { parseIcsEvents, icsEventToCandidate } from '@/lib/networking/adapters/ics';
import { normalizeLumaEvent } from '@/lib/networking/adapters/luma';
import {
  extractMeetupEventsFromApollo,
  normalizeMeetupEvent,
} from '@/lib/networking/adapters/meetup';
import { normalizeConferenceRows } from '@/lib/networking/adapters/conferences';
import { normalizeBevyEvent } from '@/lib/networking/adapters/bevy';

test('Luma fixture normalizes api_id, time, and city', () => {
  const candidate = normalizeLumaEvent(
    {
      event: {
        api_id: 'evt-123',
        name: 'Boston AI Mixer',
        start_at: '2026-09-15T22:00:00.000Z',
        timezone: 'America/New_York',
        url: 'boston-ai-mixer',
        geo_address_info: { city: 'Boston', short_address: 'CIC' },
        coordinate: { latitude: 42.36, longitude: -71.06 },
      },
    },
    { trusted: false },
  );
  assert.ok(candidate);
  assert.equal(candidate?.sourceEventId, 'evt-123');
  assert.equal(candidate?.city, 'Boston');
  assert.equal(candidate?.isOnline, false);
  assert.equal(candidate?.url, 'https://luma.com/boston-ai-mixer');
});

test('Meetup Apollo fixture extracts Event nodes', () => {
  const apollo = {
    'Event:1': {
      __typename: 'Event',
      id: '1',
      title: 'Boston Python Meetup',
      dateTime: '2026-09-20T23:00:00.000Z',
      eventUrl: 'https://www.meetup.com/bostonpython/events/1/',
      eventType: 'PHYSICAL',
      venue: { name: 'Cambridge Brewing', city: 'Cambridge', lat: 42.37, lng: -71.1 },
      group: { name: 'Boston Python' },
      isFree: true,
    },
  };
  const raw = extractMeetupEventsFromApollo(apollo);
  assert.equal(raw.length, 1);
  const candidate = normalizeMeetupEvent(raw[0], { cityFallback: 'Boston', trusted: false });
  assert.equal(candidate?.city, 'Cambridge');
  assert.equal(candidate?.isFree, true);
});

test('Eventbrite JSON-LD ItemList fixture', () => {
  const html = `<script type="application/ld+json">${JSON.stringify({
    '@type': 'ItemList',
    itemListElement: [
      {
        item: {
          '@type': 'Event',
          name: 'Miami Tech Networking',
          startDate: '2026-10-01T23:00:00-04:00',
          url: 'https://www.eventbrite.com/e/miami-tech-networking-11111111111',
          location: {
            name: 'Wynwood',
            address: { addressLocality: 'Miami', streetAddress: '1 NW 2nd Ave' },
          },
          offers: { price: '0' },
        },
      },
    ],
  })}</script>`;
  const parsed = parseJsonLdEvents(html);
  assert.equal(parsed.length, 1);
  const candidate = normalizeEventbriteEvent(parsed[0], 'Miami');
  assert.equal(candidate?.city, 'Miami');
  assert.equal(candidate?.isFree, true);
});

test('ICS VEVENT fixture', () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
UID:vc-1
SUMMARY:Thursday Gathering
DTSTART:20260903T220000Z
LOCATION:Cambridge\\, MA
URL:https://venturecafecambridge.org/event
END:VEVENT
END:VCALENDAR`;
  const events = parseIcsEvents(ics);
  assert.equal(events.length, 1);
  const candidate = icsEventToCandidate(events[0], {
    feedUrl: 'https://example.com/cal.ics',
    name: 'Venture Cafe',
    metro: 'boston',
  });
  assert.equal(candidate?.title, 'Thursday Gathering');
  assert.equal(candidate?.trusted, true);
});

test('conference JSON geo-filters to Boston/Miami', () => {
  const rows = [
    { name: 'JSConf Boston', startDate: '2026-10-01', city: 'Boston', country: 'US', url: 'https://example.com/js' },
    { name: 'Berlin Node', startDate: '2026-10-01', city: 'Berlin', country: 'DE', url: 'https://example.com/de' },
  ];
  const events = normalizeConferenceRows(rows, 'confs.tech');
  assert.equal(events.length, 1);
  assert.equal(events[0].city, 'Boston');
});

test('Bevy GDG fixture marks virtual as online', () => {
  const online = normalizeBevyEvent({
    id: 9,
    title: 'Virtual GDG',
    start_date_iso: '2026-09-01T17:00:00Z',
    audience_type: 'Virtual',
    chapter_city: 'Boston',
  });
  assert.equal(online?.isOnline, true);
  const inPerson = normalizeBevyEvent({
    id: 10,
    title: 'GDG Boston Meetup',
    start_date_iso: '2026-09-01T17:00:00Z',
    audience_type: 'In-person',
    venue_city: 'Cambridge',
    chapter_title: 'GDG Boston',
    _geoloc: { lat: 42.37, lng: -71.1 },
  });
  assert.equal(inPerson?.isOnline, false);
  assert.equal(inPerson?.city, 'Cambridge');
});
