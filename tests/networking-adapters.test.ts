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
import { classifyCandidate } from '@/lib/networking/keep-drop';

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
      featuredEventPhoto: { __ref: 'EventPhoto:1' },
    },
    'EventPhoto:1': {
      __typename: 'EventPhoto',
      highResUrl: 'https://secure-content.meetupstatic.com/images/event/1/highres.jpg',
    },
  };
  const raw = extractMeetupEventsFromApollo(apollo);
  assert.equal(raw.length, 1);
  const candidate = normalizeMeetupEvent(raw[0], { cityFallback: 'Boston', trusted: false });
  assert.equal(candidate?.city, 'Cambridge');
  assert.equal(candidate?.isFree, true);
  assert.equal(candidate?.signals?.coverUrl, 'https://secure-content.meetupstatic.com/images/event/1/highres.jpg');
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

test('conference JSON geo-filters to our metros', () => {
  const rows = [
    { name: 'JSConf Boston', startDate: '2026-10-01', city: 'Boston', country: 'US', url: 'https://example.com/js' },
    { name: 'Berlin Node', startDate: '2026-10-01', city: 'Berlin', country: 'DE', url: 'https://example.com/de' },
  ];
  const events = normalizeConferenceRows(rows, 'confs.tech', new Date('2026-09-01T00:00:00Z'));
  assert.equal(events.length, 1);
  assert.equal(events[0].city, 'Boston');
  assert.equal(events[0].timezone, 'America/New_York');
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

// Luma discover entry as returned by discover/get-paginated-events?slug=nyc (trimmed).
const LUMA_KINGS_COUNTY_ENTRY = {
  api_id: 'entry-1',
  event: {
    api_id: 'evt-BsmcOi27AxagBFs',
    name: 'Philosophy Club x Dead Letter #9',
    start_at: '2026-10-21T23:00:00.000Z',
    end_at: '2026-10-22T02:00:00.000Z',
    timezone: 'America/New_York',
    url: 'ivsqpgf8',
    location_type: 'offline',
    geo_address_info: {
      city: 'Kings County',
      type: 'google',
      region: 'New York',
      address: 'Dead Letter No. 9',
      country: 'United States',
      city_state: 'Kings County, New York',
      sublocality: 'Williamsburg',
      country_code: 'US',
      full_address: 'Dead Letter No. 9, 63 Grand St, Brooklyn, NY 11249, USA',
      short_address: '63 Grand St, Brooklyn',
      mode: 'shown',
    },
    coordinate: { longitude: -73.964839, latitude: 40.716096 },
  },
  calendar: { api_id: 'cal-dGP82mVkrg1FRmr', name: 'The New York Philosophy Club', slug: 'philosophy' },
  guest_count: 164,
};

// Luma calendar/get-items entry for Frontier Tower: offline with a manual address only.
const LUMA_MANUAL_ADDRESS_ENTRY = {
  api_id: 'entry-2',
  event: {
    api_id: 'evt-uiZAyuL7tkvg80Q',
    name: 'Pioneers: European YC Alumni and Angels Evening',
    start_at: '2026-10-23T00:30:00.000Z',
    end_at: '2026-10-23T03:00:00.000Z',
    timezone: 'America/Los_Angeles',
    url: 'pioneers-french-yc-alumni-angels-evening',
    location_type: 'offline',
    geo_address_info: {
      type: 'manual',
      address: 'Frontier Tower @ Spaceship 995 Market Street, San Francisco',
      mode: 'shown',
    },
    coordinate: null,
  },
};

test('Luma discover entry carries region and coordinates for NYC', () => {
  const candidate = normalizeLumaEvent(LUMA_KINGS_COUNTY_ENTRY, { trusted: false });
  assert.ok(candidate);
  assert.equal(candidate?.city, 'Kings County');
  assert.equal(candidate?.region, 'New York');
  assert.equal(candidate?.isOnline, false);
  assert.equal(candidate?.lat, 40.716096);
  const result = classifyCandidate(
    { ...candidate!, title: 'AI founders mixer', startAt: new Date('2026-10-21T23:00:00.000Z') },
    { now: new Date('2026-10-20T12:00:00Z') },
  );
  assert.equal(result.keep, true);
  if (result.keep) assert.equal(result.event.metro, 'nyc');
});

test('Luma offline manual address is in person and resolves from the address', () => {
  const candidate = normalizeLumaEvent(LUMA_MANUAL_ADDRESS_ENTRY, { trusted: true, hostName: 'Frontier Tower SF' });
  assert.ok(candidate);
  assert.equal(candidate?.isOnline, false);
  assert.equal(candidate?.address, 'Frontier Tower @ Spaceship 995 Market Street, San Francisco');
  assert.equal(candidate?.city, undefined);
  assert.equal(candidate?.lat, undefined);
  const result = classifyCandidate(candidate!, { now: new Date('2026-10-20T12:00:00Z') });
  assert.equal(result.keep, true);
  if (result.keep) {
    assert.equal(result.event.metro, 'sf');
    assert.equal(result.event.attendance, 'in_person');
  }
});

test('Luma online and address-less events stay online', () => {
  const online = normalizeLumaEvent(
    { event: { api_id: 'evt-o', name: 'Webinar', start_at: '2026-10-23T00:30:00.000Z', location_type: 'online' } },
    { trusted: false },
  );
  assert.equal(online?.isOnline, true);
  const unknown = normalizeLumaEvent(
    { event: { api_id: 'evt-u', name: 'TBD', start_at: '2026-10-23T00:30:00.000Z', geo_address_info: {} } },
    { trusted: false },
  );
  assert.equal(unknown?.isOnline, true);
});

// Meetup group page (/bostonpython/events/): Apollo stores venue and group as refs.
const MEETUP_GROUP_PAGE_APOLLO = {
  'Event:316751857': {
    __typename: 'Event',
    id: '316751857',
    title: 'Python Over Coffee',
    eventUrl: 'https://www.meetup.com/bostonpython/events/316751857/',
    group: { __ref: 'Group:469457' },
    eventHosts: [{ __typename: 'EventHost', memberId: '4238616' }],
    feeSettings: null,
    venue: { __ref: 'Venue:25251434' },
    dateTime: '2026-10-18T12:30:00-04:00',
    endTime: '2026-10-18T13:30:00-04:00',
    eventType: 'PHYSICAL',
  },
  'Event:316751858': {
    __typename: 'Event',
    id: '316751858',
    title: 'Project Night (online)',
    eventUrl: 'https://www.meetup.com/bostonpython/events/316751858/',
    group: { __ref: 'Group:469457' },
    venue: { __ref: 'Venue:26906060' },
    dateTime: '2026-10-22T19:00:00-04:00',
    eventType: 'ONLINE',
  },
  'Venue:25251434': {
    __typename: 'Venue',
    id: '25251434',
    name: 'Caffe Nero',
    address: '321 Broadway',
    city: 'Arlington',
    state: 'MA',
    country: 'US',
    lat: 42.4154,
    lon: -71.1565,
  },
  'Venue:26906060': { __typename: 'Venue', id: '26906060', name: 'Online event', address: '', city: '', state: '', country: '' },
  'Group:469457': {
    __typename: 'Group',
    id: '469457',
    name: 'The Boston Python User Group',
    urlname: 'bostonpython',
    stats: { __typename: 'GroupStats', memberCounts: { all: 10203 }, eventRatings: { average: 4.72, total: 4414 } },
  },
};

test('Meetup group-page refs are dereferenced: venue city, region, lon and group name', () => {
  const raw = extractMeetupEventsFromApollo(MEETUP_GROUP_PAGE_APOLLO);
  assert.equal(raw.length, 2);
  const inPerson = normalizeMeetupEvent(raw.find((r) => r.id === '316751857')!, { cityFallback: 'Boston', trusted: true });
  assert.equal(inPerson?.city, 'Arlington');
  assert.equal(inPerson?.region, 'MA');
  assert.equal(inPerson?.isOnline, false);
  assert.equal(inPerson?.hostName, 'The Boston Python User Group');
  assert.equal(inPerson?.lat, 42.4154);
  assert.equal(inPerson?.lng, -71.1565);
  assert.equal(inPerson?.venueName, 'Caffe Nero');
  assert.ok(inPerson?.endAt);
  const online = normalizeMeetupEvent(raw.find((r) => r.id === '316751858')!, { cityFallback: 'Boston', trusted: true });
  assert.equal(online?.isOnline, true);
});

test('Meetup find-page group ref with inline fields resolves the group name', () => {
  // Find pages inline the venue, but the group is a ref (sometimes with inline urlname).
  const apollo = {
    'Event:316892062': {
      __typename: 'Event',
      id: '316892062',
      title: 'Hackers and Founders San Francisco',
      dateTime: '2026-10-21T18:00:00-07:00',
      eventType: 'PHYSICAL',
      eventUrl: 'https://www.meetup.com/hackers-and-founders/events/316892062/',
      group: { __typename: 'Group', urlname: 'hackers-and-founders', __ref: 'Group:1084744' },
      venue: {
        __typename: 'Venue',
        name: 'Local Edition',
        address: '691 Market St, San Francisco, CA 94105, USA',
        city: 'San Francisco',
        state: 'CA',
        country: 'us',
      },
      rsvps: { __typename: 'RsvpConnection', totalCount: 27 },
    },
    'Event:316388671': {
      __typename: 'Event',
      id: '316388671',
      dateTime: '2026-10-31T09:30:00-07:00',
      group: { __typename: 'Group', urlname: 'founders-running-club' },
    },
    'Group:1084744': {
      __typename: 'Group',
      id: '1084744',
      name: 'Hackers/Founders',
      urlname: 'hackers-and-founders',
      timezone: 'America/Los_Angeles',
      stats: { __typename: 'GroupStats', eventRatings: { average: 4.62, totalRatings: 1159 } },
    },
  };
  const raw = extractMeetupEventsFromApollo(apollo);
  assert.equal(raw.length, 1, 'title-less stub events are skipped');
  const candidate = normalizeMeetupEvent(raw[0], { cityFallback: 'San Francisco', trusted: false });
  assert.equal(candidate?.hostName, 'Hackers/Founders');
  assert.equal(candidate?.city, 'San Francisco');
  assert.equal(candidate?.region, 'CA');
  assert.equal(candidate?.isOnline, false);
});

test('JSON-LD on event pages: extra script attributes and SocialEvent types are read', () => {
  const html = `<script data-next-head="" type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'SocialEvent',
    name: 'Harvard AI Summit',
    startDate: '2026-11-05T09:00:00-05:00',
    url: 'https://www.eventbrite.com/e/harvard-ai-summit-1234567890',
    location: { name: 'Harvard Science Center', address: { addressLocality: 'Cambridge', addressRegion: 'MA' } },
  })}</script><script data-cfasync="false" type="application/ld+json">${JSON.stringify({
    '@type': ['Event'],
    name: 'Luma JSON-LD event',
    startDate: '2026-11-06T18:00:00-05:00',
  })}</script><script type="application/ld+json">${JSON.stringify({ '@type': 'Organization', name: 'Not an event' })}</script>`;
  const parsed = parseJsonLdEvents(html);
  assert.deepEqual(parsed.map((e) => e.name), ['Harvard AI Summit', 'Luma JSON-LD event']);
  assert.equal(normalizeEventbriteEvent(parsed[0], '')?.region, 'MA');
});

test('an ICS event imported without a feed metro takes no city guess', () => {
  const [event] = parseIcsEvents(`BEGIN:VCALENDAR
BEGIN:VEVENT
UID:x-1
SUMMARY:No location
DTSTART:20261103T230000Z
END:VEVENT
END:VCALENDAR`);
  const candidate = icsEventToCandidate(event, { feedUrl: 'https://example.com/one.ics', name: 'example.com' });
  assert.equal(candidate?.city, undefined, 'never "Boston" by default');
});

test('Eventbrite addressRegion passes through to region', () => {
  const candidate = normalizeEventbriteEvent(
    {
      name: 'Founders Night',
      startDate: '2026-10-01T23:00:00-04:00',
      url: 'https://www.eventbrite.com/e/founders-night-12345678901',
      location: {
        name: 'Communitech Hub',
        address: { addressLocality: 'Cambridge', addressRegion: 'ON', streetAddress: '151 Charles St W' },
      },
    },
    'Boston',
  );
  assert.equal(candidate?.region, 'ON');
  // Without the region, "Cambridge" alone would resolve to Boston.
  const result = classifyCandidate(
    { ...candidate!, title: 'AI founders night' },
    { now: new Date('2026-09-20T00:00:00Z') },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('outside_metro'));
});

// developers.events all-events.json rows (real shape: epoch-ms days, hyperlink, status).
const DAY = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const DEVELOPERS_EVENTS_ROWS = [
  {
    name: 'AIE CODE Summit',
    date: [DAY(2026, 11, 10), DAY(2026, 11, 12)],
    hyperlink: 'https://www.ai.engineer/code',
    location: 'San Francisco, CA (USA)',
    city: 'San Francisco, CA',
    country: 'USA',
    misc: '',
    cfp: {},
    status: 'open',
    tags: [],
  },
  {
    name: 'AI DevCon NYC',
    date: [DAY(2026, 11, 2)],
    hyperlink: 'https://example.com/ai-devcon',
    city: 'New York, NY',
    country: 'USA',
    status: 'open',
  },
  {
    name: 'OWASP Global AppSec US 2026 - CFP (San Francisco)',
    date: [DAY(2026, 11, 3), DAY(2026, 11, 4)],
    hyperlink: 'https://sessionize.com/owasp',
    city: 'San Francisco, CA',
    country: 'USA',
    status: 'open',
  },
  { name: 'DevFest Cambridge', date: [DAY(2026, 11, 5)], city: 'Cambridge, ON', country: 'Canada', status: 'open' },
  { name: 'Cancelled Conf', date: [DAY(2026, 11, 6)], city: 'Boston, MA', country: 'USA', status: 'Canceled' },
  { name: 'Moved Online Conf', date: [DAY(2026, 11, 7)], city: 'Miami, FL', country: 'USA', status: 'Virtualized' },
  { name: 'Web Summit Online', date: [DAY(2026, 11, 8)], city: 'Online', country: 'Online', status: 'open' },
  { name: 'Elastic{ON} 2018', date: [DAY(2018, 2, 27), DAY(2018, 3, 1)], city: 'San Francisco, CA', country: 'USA', status: 'open' },
];

test('developers.events rows map date[] and hyperlink; CFP, canceled, virtual, foreign and past rows are skipped', () => {
  const events = normalizeConferenceRows(DEVELOPERS_EVENTS_ROWS, 'developers.events', new Date('2026-10-21T12:00:00Z'));
  assert.deepEqual(
    events.map((e) => e.title),
    ['AIE CODE Summit', 'AI DevCon NYC'],
  );
  const [aie, devcon] = events;
  assert.equal(aie.url, 'https://www.ai.engineer/code');
  assert.equal(aie.timezone, 'America/Los_Angeles');
  // Calendar days become 9 AM to 6 PM local (PST after Nov 1).
  assert.equal(aie.startAt.toISOString(), '2026-11-10T17:00:00.000Z');
  assert.equal(aie.endAt?.toISOString(), '2026-11-13T02:00:00.000Z');
  assert.equal(aie.trusted, true);
  // A one-day row ends the same day; NYC is EST after Nov 1.
  assert.equal(devcon.startAt.toISOString(), '2026-11-02T14:00:00.000Z');
  assert.equal(devcon.endAt?.toISOString(), '2026-11-02T23:00:00.000Z');
  const kept = classifyCandidate(aie, { now: new Date('2026-10-21T12:00:00Z') });
  assert.equal(kept.keep, true);
  if (kept.keep) assert.equal(kept.event.metro, 'sf');
});

test('developers.events ids are stable and distinct per edition', () => {
  const rows = [
    { name: 'NG Cruise', date: [DAY(2026, 12, 1)], city: 'Miami, FL', country: 'USA', status: 'open' },
    { name: 'NG Cruise', date: [DAY(2026, 12, 8)], city: 'Miami, FL', country: 'USA', status: 'open' },
  ];
  const now = new Date('2026-10-21T12:00:00Z');
  const first = normalizeConferenceRows(rows, 'developers.events', now);
  const again = normalizeConferenceRows(rows, 'developers.events', now);
  assert.equal(first.length, 2);
  assert.notEqual(first[0].sourceEventId, first[1].sourceEventId);
  assert.deepEqual(
    first.map((e) => e.sourceEventId),
    again.map((e) => e.sourceEventId),
  );
});
