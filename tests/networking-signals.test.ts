import assert from 'node:assert/strict';
import test from 'node:test';

import { conferenceAnchors } from '@/lib/networking/adapters/conferences';
import {
  lumaCalendarTrackRecord,
  lumaEventDetail,
  normalizeLumaEvent,
} from '@/lib/networking/adapters/luma';
import { addCandidateBatch } from '@/lib/networking/adapters/merge';
import {
  extractMeetupEventsFromApollo,
  meetupEventPageDetail,
  normalizeMeetupEvent,
} from '@/lib/networking/adapters/meetup';
import { deduplicate } from '@/lib/networking/dedupe';
import { classifyCandidate } from '@/lib/networking/keep-drop';
import { proseMirrorToText } from '@/lib/networking/prosemirror';
import { hasOffsiteRsvp } from '@/lib/networking/signals';
import type { CandidateEvent, ClassifiedEvent } from '@/lib/networking/types';

// Shapes follow live responses (2026-10-21 probes); names and text are invented.

const PRIVATE_GUEST = 'Priya Attendee-Private';

function lumaHost(name: string, extra: Record<string, unknown> = {}) {
  return {
    api_id: `usr-${name.length}`,
    avatar_url: 'https://images.lumacdn.com/avatars/x.png',
    bio_short: '',
    first_name: name.split(' ')[0],
    last_name: name.split(' ').slice(1).join(' '),
    instagram_handle: null,
    is_verified: false,
    linkedin_handle: null,
    name,
    timezone: 'America/New_York',
    twitter_handle: null,
    username: null,
    website: null,
    ...extra,
  };
}

/** A discover/get-paginated-events entry with every quality field the adapter reads. */
function lumaDiscoverEntry(overrides: Record<string, unknown> = {}, eventOverrides: Record<string, unknown> = {}) {
  return {
    api_id: 'entry-1',
    event: {
      api_id: 'evt-demoNight01',
      calendar_api_id: 'cal-DemoCal123',
      end_at: '2026-10-29T01:00:00.000Z',
      event_type: 'independent',
      location_type: 'offline',
      name: 'Founders Demo Night',
      recurrence_id: null,
      show_guest_list: true,
      start_at: '2026-10-28T22:00:00.000Z',
      timezone: 'America/New_York',
      url: 'demo-night',
      visibility: 'public',
      waitlist_enabled: true,
      waitlist_status: 'active',
      geo_address_info: {
        mode: 'obfuscated',
        city: 'Cambridge',
        city_state: 'Cambridge, MA',
        country: 'United States',
        region: 'Massachusetts',
        region_short: 'MA',
      },
      coordinate: { latitude: 42.3709, longitude: -71.076 },
      cover_url: 'https://images.lumacdn.com/event-covers/demo.jpg',
      ...eventOverrides,
    },
    cover_image: { colors: ['#060b13'] },
    calendar: {
      access_level: 'public',
      api_id: 'cal-DemoCal123',
      description_short: 'Monthly demos from Boston founders.',
      is_personal: false,
      is_verified: true,
      linkedin_handle: '/company/demo-ventures',
      luma_plan: 'plus',
      name: 'Demo Ventures',
      personal_user_api_id: null,
      slug: 'demoventures',
      website: 'https://example.com',
    },
    start_at: '2026-10-28T22:00:00.000Z',
    hosts: [
      lumaHost('Demo Ventures', { bio_short: 'Seed fund for AI founders', linkedin_handle: '/company/demo-ventures', is_verified: true }),
      lumaHost('Sam Organizer', { bio_short: 'Partner, Demo Ventures' }),
    ],
    guest_count: 182,
    ticket_count: 182,
    ticket_info: {
      price: { cents: 2500, currency: 'usd', is_flexible: false },
      max_price: { cents: 4000, currency: 'usd' },
      is_free: false,
      is_sold_out: true,
      spots_remaining: 0,
      is_near_capacity: false,
      require_approval: true,
    },
    registration_availability: 'sold-out',
    featured_guests: [lumaHost(PRIVATE_GUEST, { bio_short: 'Attendee bio', linkedin_handle: '/in/private-person' })],
    manager_info: null,
    guest_info: null,
    host_info: null,
    waitlist_active: true,
    featured_city: { api_id: 'discplace-1', name: 'Boston', slug: 'boston' },
    ...overrides,
  };
}

test('Luma discover entry carries organizer, hosts, guests, tickets, waitlist and the discover slug', () => {
  const event = normalizeLumaEvent(lumaDiscoverEntry(), { trusted: false, sourceTag: 'discover:ai' })!;
  assert.equal(event.organizerName, 'Demo Ventures');
  assert.equal(event.organizerKind, 'luma_calendar');
  assert.equal(event.organizerUrl, 'https://luma.com/demoventures');
  assert.equal(event.hostName, 'Demo Ventures', 'the organizer fills the stored host name');
  assert.equal(event.seriesKey, 'luma:cal-DemoCal123');
  assert.deepEqual(event.hosts, [
    { name: 'Demo Ventures', bioShort: 'Seed fund for AI founders', linkedin: '/company/demo-ventures', isVerified: true },
    { name: 'Sam Organizer', bioShort: 'Partner, Demo Ventures', linkedin: undefined, isVerified: false },
  ]);
  assert.equal(event.guestCount, 182);
  assert.equal(event.isFree, false);
  assert.equal(event.priceMinCents, 2500);
  assert.equal(event.priceMaxCents, 4000);
  assert.equal(event.priceCurrency, 'USD');
  assert.equal(event.priceAmount, 25, 'dollars for inferAccess');
  assert.equal(event.isSoldOut, true);
  assert.equal(event.spotsRemaining, 0);
  assert.equal(event.requiresApproval, true);
  assert.equal(event.waitlistActive, true);
  assert.deepEqual(event.sourceTags, ['discover:ai']);
  assert.equal(event.signals?.registration, 'sold-out');
  assert.equal(event.signals?.lumaCalendarSlug, 'demoventures');
  assert.equal(event.signals?.lumaCalendarVerified, true);
  assert.equal(event.signals?.coverUrl, 'https://images.lumacdn.com/event-covers/demo.jpg');
  const result = classifyCandidate(event, { now: new Date('2026-10-21T12:00:00Z') });
  assert.equal(result.keep, true);
  if (result.keep) assert.equal(result.event.access, 'paid');
});

test('Luma featured_guests and the personal calendar owner are never kept anywhere', () => {
  const event = normalizeLumaEvent(lumaDiscoverEntry(), { trusted: false })!;
  const serialized = JSON.stringify(event);
  assert.ok(!serialized.includes(PRIVATE_GUEST));
  assert.ok(!serialized.includes('private-person'));
  assert.ok(!serialized.includes('featured_guests'));
  assert.ok(event.raw);
  assert.equal((event.raw as Record<string, unknown>).featured_guests, undefined);

  const personal = normalizeLumaEvent(
    lumaDiscoverEntry({
      calendar: { api_id: 'cal-personal', name: 'Personal', is_personal: true, personal_user: { name: 'Owner Private', email: 'x@example.com' } },
    }),
    { trusted: false },
  )!;
  assert.ok(!JSON.stringify(personal).includes('Owner Private'));
  assert.deepEqual(personal.raw?.calendar, { is_personal: true });
});

test('Luma guest count is unknown when the guest list is hidden, and hosts stop at eight', () => {
  const hidden = normalizeLumaEvent(lumaDiscoverEntry({ guest_count: 0 }, { show_guest_list: false }), { trusted: false })!;
  assert.equal(hidden.guestCount, undefined);
  const many = normalizeLumaEvent(
    lumaDiscoverEntry({ hosts: Array.from({ length: 12 }, (_, i) => lumaHost(`Host Number ${i + 1}`)) }),
    { trusted: false },
  )!;
  assert.equal(many.hosts?.length, 8);
});

test('a personal Luma calendar names its first host as organizer and keys the series by recurrence', () => {
  const event = normalizeLumaEvent(
    lumaDiscoverEntry(
      { calendar: { api_id: 'cal-p', name: 'Personal', slug: null, is_personal: true }, hosts: [lumaHost('Jordan Builder')] },
      { recurrence_id: 'rec-42' },
    ),
    { trusted: false },
  )!;
  assert.equal(event.organizerName, 'Jordan Builder');
  assert.equal(event.organizerKind, 'luma_person');
  assert.equal(event.organizerUrl, undefined);
  assert.equal(event.seriesKey, 'luma-series:rec-42');
  assert.equal(event.signals?.lumaCalendarSlug, undefined);
});

test('a free Luma event reads as free and open', () => {
  const event = normalizeLumaEvent(
    lumaDiscoverEntry({
      ticket_info: { price: null, is_free: true, max_price: null, is_sold_out: false, spots_remaining: 21, is_near_capacity: true, require_approval: false },
      waitlist_active: false,
    }),
    { trusted: false },
  )!;
  assert.equal(event.isFree, true);
  assert.equal(event.priceMinCents, undefined);
  assert.equal(event.priceCurrency, undefined);
  assert.equal(event.spotsRemaining, 21);
  assert.equal(event.signals?.nearCapacity, true);
  const result = classifyCandidate(event, { now: new Date('2026-10-21T12:00:00Z') });
  assert.ok(result.keep);
  if (result.keep) assert.equal(result.event.access, 'open');
});

test('discover copies from two feeds keep both source tags', () => {
  const byId = new Map<string, CandidateEvent>();
  addCandidateBatch(byId, [normalizeLumaEvent(lumaDiscoverEntry(), { trusted: false, sourceTag: 'discover:boston' })!]);
  addCandidateBatch(byId, [normalizeLumaEvent(lumaDiscoverEntry(), { trusted: false, sourceTag: 'discover:ai' })!]);
  assert.equal(byId.size, 1);
  assert.deepEqual([...byId.values()][0].sourceTags, ['discover:ai', 'discover:boston']);
});

// ── ProseMirror ────────────────────────────────────────────────────────────

test('ProseMirror description becomes plain text with paragraph breaks and list lines', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Join us on ' },
          { type: 'text', text: 'October 28', marks: [{ type: 'bold' }] },
          { type: 'text', text: ' for demos.' },
        ],
      },
      { type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Agenda' }] },
      {
        type: 'bullet_list',
        content: [
          { type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: '6:00 doors' }] }] },
          {
            type: 'list_item',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: '6:30 talks' }] },
              {
                type: 'bulletList',
                content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Prof. A. Speaker, MIT' }] }] }],
              },
            ],
          },
        ],
      },
      { type: 'ordered_list', attrs: { order: 1 }, content: [{ type: 'list_item', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'RSVP' }] }] }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Line one' }, { type: 'hard_break' }, { type: 'text', text: 'Line two' }] },
      { type: 'horizontal_rule' },
      { type: 'paragraph' },
      { type: 'image', attrs: { src: 'https://example.com/x.png' } },
    ],
  };
  assert.equal(
    proseMirrorToText(doc),
    [
      'Join us on October 28 for demos.',
      'Agenda',
      '- 6:00 doors\n- 6:30 talks\n  - Prof. A. Speaker, MIT',
      '1. RSVP',
      'Line one\nLine two',
    ].join('\n\n'),
  );
  assert.equal(proseMirrorToText(null), '');
  assert.equal(proseMirrorToText('not a doc'), '');
  assert.equal(proseMirrorToText({ type: 'doc', content: [] }), '');
});

test('Luma event/get detail: description, capacity from ticket types, categories as tags', () => {
  const detail = lumaEventDetail({
    api_id: 'evt-demoNight01',
    event: {
      api_id: 'evt-demoNight01',
      name: 'Founders Demo Night',
      start_at: '2026-10-28T22:00:00.000Z',
      cover_url: 'https://images.lumacdn.com/event-covers/demo-night.jpg',
    },
    description_mirror: {
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'Six startups demo live.' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'Hosted with a university lab.' }] },
      ],
    },
    ticket_types: [{ max_capacity: 120 }, { max_capacity: 30 }],
    categories: [
      { api_id: 'cat-tech', slug: 'tech', name: 'Tech' },
      { api_id: 'cat-ai', name: 'AI' },
    ],
  });
  assert.equal(detail.description, 'Six startups demo live.\n\nHosted with a university lab.');
  assert.equal(detail.capacity, 150);
  assert.deepEqual(detail.sourceTags, ['category:tech', 'category:ai']);
  assert.equal(detail.coverUrl, 'https://images.lumacdn.com/event-covers/demo-night.jpg');
  const uncapped = lumaEventDetail({ ticket_types: [{ max_capacity: 100 }, { max_capacity: null }] });
  assert.equal(uncapped.capacity, undefined, 'an uncapped ticket type means no fixed capacity');
  assert.equal(lumaEventDetail({}).capacity, undefined);
});

test('Luma calendar track record counts past and upcoming starts', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const record = lumaCalendarTrackRecord(
    {
      kind: 'calendar',
      data: { event_start_ats: ['2024-06-01T22:00:00.000Z', '2025-03-01T22:00:00.000Z', '2026-10-20T22:00:00.000Z', '2026-11-03T22:00:00.000Z', 'bad'] },
    },
    now,
  );
  assert.deepEqual(record, { pastCount: 3, upcomingCount: 1 });
  assert.equal(lumaCalendarTrackRecord({ kind: 'event', data: {} }, now), null);
});

// ── Meetup ─────────────────────────────────────────────────────────────────

/** Find page: group is a ref; going count and host edges sit on `rsvps`. */
const MEETUP_FIND_APOLLO = {
  'Event:900001': {
    __typename: 'Event',
    id: '900001',
    title: 'Agents in Production',
    dateTime: '2026-10-28T18:00:00-07:00',
    description: 'Talks on shipping agents. Pizza at 6.',
    eventType: 'PHYSICAL',
    eventUrl: 'https://www.meetup.com/sf-agent-builders/events/900001/',
    maxTickets: 0,
    rsvpState: 'JOIN_OPEN',
    feeSettings: null,
    group: { __ref: 'Group:7001' },
    series: null,
    rsvps: {
      __typename: 'RsvpConnection',
      totalCount: 49,
      edges: [
        { __typename: 'RsvpEdge', node: { __typename: 'Rsvp', isHost: true, member: { __ref: 'Member:11' } } },
        { __typename: 'RsvpEdge', node: { __typename: 'Rsvp', isHost: false, member: { __ref: 'Member:12' } } },
      ],
    },
    venue: { __typename: 'Venue', name: 'Hall 2', address: '150 Spear St', city: 'San Francisco', state: 'CA', country: 'us' },
  },
  'Group:7001': {
    __typename: 'Group',
    id: '7001',
    name: 'SF Agent Builders',
    urlname: 'sf-agent-builders',
    timezone: 'America/Los_Angeles',
    stats: { __typename: 'GroupStats', eventRatings: { __typename: 'GroupStatsEventRatings', average: 4.72, totalRatings: 724 } },
  },
  'Member:11': { __typename: 'Member', id: '11', name: 'Alex Host' },
  'Member:12': { __typename: 'Member', id: '12', name: 'Rafael Attendee' },
};

test('Meetup find page: group, rating, going count and host names; attendees are never kept', () => {
  const [raw] = extractMeetupEventsFromApollo(MEETUP_FIND_APOLLO);
  const event = normalizeMeetupEvent(raw, { cityFallback: 'San Francisco', trusted: false })!;
  assert.equal(event.organizerName, 'SF Agent Builders');
  assert.equal(event.organizerKind, 'meetup_group');
  assert.equal(event.organizerUrl, 'https://www.meetup.com/sf-agent-builders/');
  assert.equal(event.seriesKey, 'meetup:sf-agent-builders');
  assert.equal(event.organizerRating, 4.72);
  assert.equal(event.organizerRatingCount, 724);
  assert.equal(event.guestCount, 49);
  assert.deepEqual(event.hosts, [{ name: 'Alex Host' }]);
  assert.equal(event.rsvpOffsite, false);
  assert.equal(event.isFree, true, 'no fee settings and no off-site funnel');
  assert.equal(event.descriptionSource, 'meetup');
  assert.ok(!JSON.stringify(event).includes('Rafael Attendee'));
  assert.equal((event.raw as Record<string, unknown>).rsvps, undefined);
  assert.equal((event.raw as Record<string, unknown>).going, 49);
});

test('Meetup group page: inline host member ids, member count, total ratings and group topics', () => {
  const apollo = {
    'Event:316751857': {
      __typename: 'Event',
      id: '316751857',
      title: 'Python Over Coffee',
      eventUrl: 'https://www.meetup.com/bostonpython/events/316751857/',
      group: { __ref: 'Group:469457' },
      eventHosts: [{ __typename: 'EventHost', memberId: '4238616' }],
      feeSettings: null,
      venue: { __ref: 'Venue:1' },
      dateTime: '2026-10-25T12:30:00-04:00',
      endTime: '2026-10-25T13:30:00-04:00',
      going: { __typename: 'GoingRsvpConnection', totalCount: 7 },
      eventType: 'PHYSICAL',
      series: { __typename: 'Series', description: 'Every week on Sunday' },
    },
    'Venue:1': { __typename: 'Venue', id: '1', name: 'Cafe', address: '321 Broadway', city: 'Arlington', state: 'MA', country: 'US', lat: 42.41, lon: -71.15 },
    'Group:469457': {
      __typename: 'Group',
      id: '469457',
      name: 'The Boston Python User Group',
      urlname: 'bostonpython',
      stats: { memberCounts: { all: 10203 }, eventRatings: { average: 4.72, total: 4414 } },
      activeTopics: [{ __ref: 'Topic:1' }, { __ref: 'Topic:2' }],
    },
    'Topic:1': { __typename: 'Topic', id: '1', name: 'Open Source Python', urlkey: 'open-source-python' },
    'Topic:2': { __typename: 'Topic', id: '2', name: 'Machine Learning', urlkey: 'machine-learning' },
    'Member:4238616': { __typename: 'Member', id: '4238616', name: 'Morgan Organizer' },
  };
  const [raw] = extractMeetupEventsFromApollo(apollo);
  const event = normalizeMeetupEvent(raw, { cityFallback: 'Boston', trusted: true })!;
  assert.deepEqual(event.hosts, [{ name: 'Morgan Organizer' }]);
  assert.equal(event.guestCount, 7);
  assert.equal(event.organizerMemberCount, 10203);
  assert.equal(event.organizerRatingCount, 4414);
  assert.deepEqual(event.sourceTags, ['topic:open-source-python', 'topic:machine-learning']);
  assert.equal(event.signals?.recurrence, 'Every week on Sunday');
  assert.equal(event.signals?.meetupGroupUrlname, 'bostonpython');
});

test('Meetup off-site RSVP funnels are flagged, and their price stays unknown', () => {
  assert.equal(hasOffsiteRsvp('PAID EVENT RSVP HERE ==> https://tinyurl.com/mixer'), true);
  assert.equal(hasOffsiteRsvp('Tickets: https://www.eventbrite.com/e/ai-mixer-1234567890'), true);
  assert.equal(hasOffsiteRsvp('Register on https://lu.ma/ai-salon too'), true);
  assert.equal(hasOffsiteRsvp('Get your tickets at https://posh.vip/e/party'), true);
  assert.equal(hasOffsiteRsvp('Please fill out this form (https://forms.gle/abc) for building access, even if you registered on Meetup.'), false);
  assert.equal(hasOffsiteRsvp('Sponsored by Vapi (https://vapi.ai/?utm_source=luma).'), false);
  assert.equal(hasOffsiteRsvp(undefined), false);

  const [raw] = extractMeetupEventsFromApollo({
    ...MEETUP_FIND_APOLLO,
    'Event:900001': { ...MEETUP_FIND_APOLLO['Event:900001'], description: 'PAID EVENT RSVP HERE ==> https://tinyurl.com/mixer' },
  });
  const event = normalizeMeetupEvent(raw, { cityFallback: 'San Francisco', trusted: false })!;
  assert.equal(event.rsvpOffsite, true);
  assert.equal(event.isFree, undefined);
});

function meetupEventPageHtml(apollo: Record<string, unknown>): string {
  return `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
    props: { pageProps: { eventId: '316995100', __APOLLO_STATE__: apollo } },
  })}</script></html>`;
}

/** Event page (/producttank-sf/events/316995100/): filtered RSVP counts, EventHost refs, topics. */
const MEETUP_EVENT_PAGE_APOLLO = {
  ROOT_QUERY: { __typename: 'Query', 'event({"id":"316995100"})': { __ref: 'Event:316995100' } },
  'Event:316995100': {
    __typename: 'Event',
    id: '316995100',
    title: 'Building Products For Agents',
    description: 'A panel on pricing for agents.\n\nTHE PANELISTS\n\nA CEO and a product lead.',
    eventUrl: 'https://www.meetup.com/producttank-sf/events/316995100/',
    status: 'ACTIVE',
    eventType: 'PHYSICAL',
    eventHosts: [{ __ref: 'EventHost:1' }, { __ref: 'EventHost:2' }],
    dateTime: '2026-10-28T18:00:00-07:00',
    endTime: '2026-10-28T20:30:00-07:00',
    venue: { __ref: 'Venue:28396428' },
    maxTickets: 0,
    series: null,
    'rsvps({"filter":{"rsvpStatus":["WAITLIST"]}})': { __typename: 'RsvpConnection', totalCount: 3 },
    'rsvps({"filter":{"rsvpStatus":["YES"]}})': { __typename: 'RsvpConnection', totalCount: 49 },
    waitlistMode: 'AUTO',
    topics: {
      __typename: 'TopicsConnection',
      edges: [{ __typename: 'TopicEdge', node: { __ref: 'Topic:488822' } }],
    },
    feeSettings: null,
    speakerDetails: null,
    group: { __ref: 'Group:7564612' },
  },
  'EventHost:1': { __typename: 'EventHost', memberId: '1', name: 'Jamie Host', member: { __typename: 'Member', isSuperOrganizer: false } },
  'EventHost:2': { __typename: 'EventHost', memberId: '2', name: 'Riley Cohost', member: { __typename: 'Member', isSuperOrganizer: false } },
  'Topic:488822': { __typename: 'Topic', id: '488822', name: 'Artificial Intelligence', urlkey: 'artificial-intelligence' },
  'Venue:28396428': { __typename: 'Venue', id: '28396428', name: 'Vapi', address: '150 Spear St, 11th Floor', city: 'San Francisco', state: 'CA', country: 'us', lat: 37.791367, lon: -122.39374 },
  'Group:7564612': {
    __typename: 'Group',
    id: '7564612',
    name: 'ProductTank SF',
    link: 'https://www.meetup.com/producttank-sf',
    urlname: 'producttank-sf',
    stats: { __typename: 'GroupStats', memberCounts: { __typename: 'GroupMemberCounts', all: 7136 } },
  },
};

test('Meetup event page detail: full description, end time, YES and WAITLIST counts, members, hosts', () => {
  const detail = meetupEventPageDetail(meetupEventPageHtml(MEETUP_EVENT_PAGE_APOLLO), '316995100')!;
  assert.ok(detail);
  assert.match(detail.description, /THE PANELISTS/);
  assert.equal(detail.endAt?.toISOString(), '2026-10-29T03:30:00.000Z');
  assert.equal(detail.signals.guestCount, 49);
  assert.equal(detail.signals.signals?.waitlistCount, 3);
  assert.equal(detail.signals.organizerMemberCount, 7136);
  assert.equal(detail.signals.organizerUrl, 'https://www.meetup.com/producttank-sf');
  assert.deepEqual(detail.signals.hosts, [{ name: 'Jamie Host' }, { name: 'Riley Cohost' }]);
  assert.deepEqual(detail.signals.sourceTags, ['topic:artificial-intelligence']);
  assert.equal(meetupEventPageDetail('<html>no data</html>', '316995100'), null);
});

// ── Cross-source merge ─────────────────────────────────────────────────────

function classified(event: CandidateEvent): ClassifiedEvent {
  return {
    ...event,
    metro: 'boston',
    attendance: 'in_person',
    access: 'open',
    accessEvidence: null,
    bucket: 'tech',
    industries: [],
  };
}

test('dedupe takes each signal from the best source: Luma over Meetup, the longest description', () => {
  const luma = normalizeLumaEvent(lumaDiscoverEntry(), { trusted: false, sourceTag: 'discover:boston' })!;
  const [meetupRaw] = extractMeetupEventsFromApollo({
    ...MEETUP_FIND_APOLLO,
    'Event:900001': {
      ...MEETUP_FIND_APOLLO['Event:900001'],
      title: 'Founders Demo Night',
      dateTime: '2026-10-28T18:15:00-04:00',
      description: 'The full Meetup description with an agenda and speakers.',
      rsvps: { totalCount: 108, edges: [] },
    },
  });
  const meetup = normalizeMeetupEvent(meetupRaw, { cityFallback: 'Boston', trusted: false })!;
  const [merged, ...rest] = deduplicate([classified(meetup), classified(luma)]);
  assert.equal(rest.length, 0);
  assert.equal(merged.listings.length, 2);
  assert.equal(merged.guestCount, 182, 'Luma guest count wins over the Meetup cross-post');
  assert.equal(merged.organizerName, 'Demo Ventures');
  assert.equal(merged.organizerKind, 'luma_calendar');
  assert.equal(merged.seriesKey, 'luma:cal-DemoCal123');
  assert.equal(merged.organizerRating, 4.72, 'only Meetup has a rating');
  assert.equal(merged.requiresApproval, true);
  assert.equal(merged.priceMinCents, 2500);
  assert.equal(merged.access, 'paid', 'access is read again from the merged Luma price');
  assert.equal(merged.description, 'The full Meetup description with an agenda and speakers.');
  assert.equal(merged.descriptionSource, 'meetup');
  assert.deepEqual(merged.sourceTags, ['discover:boston']);
  assert.equal(merged.signals?.lumaCalendarSlug, 'demoventures');
  assert.equal(merged.signals?.meetupGroupUrlname, 'sf-agent-builders');
  const byListing = Object.fromEntries(merged.listings.map((l) => [l.source, l.raw]));
  assert.ok(byListing.luma && byListing.meetup, 'each listing keeps its own trimmed payload');
});

// ── Classifier haystack ────────────────────────────────────────────────────

test('the classifier reads organizer and host names, never host bios', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  const base: CandidateEvent = {
    source: 'luma',
    sourceEventId: 'evt-round',
    title: 'Closing Your Round',
    description: '',
    url: 'https://luma.com/closing-round',
    startAt: new Date('2026-10-23T22:00:00Z'),
    city: 'Boston',
    isOnline: false,
    trusted: false,
  };
  const bare = classifyCandidate(base, { now });
  assert.equal(bare.keep, false);
  if (!bare.keep) assert.ok(bare.reject.reasonCodes.includes('icp_mismatch'));

  const byOrganizer = classifyCandidate({ ...base, organizerName: 'Boston AI Week' }, { now });
  assert.equal(byOrganizer.keep, true);

  const byHostName = classifyCandidate({ ...base, hosts: [{ name: 'MassTLC' }] }, { now });
  assert.equal(byHostName.keep, true);
  if (byHostName.keep) assert.equal(byHostName.event.bucket, 'tech');

  // Nearly every Luma host bio says "founder": a bio alone would keep a sound bath.
  const byBio = classifyCandidate(
    { ...base, title: 'Candlelit Yoga and Sound Bath', hosts: [{ name: 'Casey Lee', bioShort: 'Founder building developer tools' }] },
    { now },
  );
  assert.equal(byBio.keep, false);

  const brokerBio = classifyCandidate(
    { ...base, title: 'Founders mixer', hosts: [{ name: 'Drew Kim', bioShort: 'Insurance broker turned founder' }] },
    { now },
  );
  assert.ok(brokerBio.keep);
  if (brokerBio.keep) assert.deepEqual(brokerBio.event.industries, [], 'a bio never invents an industry');
});

// ── Anchors ────────────────────────────────────────────────────────────────

test('conference rows become anchors with metro, local days, url and source', () => {
  const DAY = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
  const rows = [
    { name: 'AIE CODE Summit', date: [DAY(2026, 11, 10), DAY(2026, 11, 12)], hyperlink: 'https://www.ai.engineer/code', city: 'San Francisco, CA', country: 'USA', status: 'open' },
    { name: 'AI DevCon NYC', date: [DAY(2026, 11, 2)], hyperlink: 'https://example.com/ai-devcon', city: 'New York, NY', country: 'USA', status: 'open' },
    { name: 'AI DevCon NYC', date: [DAY(2026, 11, 2)], hyperlink: 'https://example.com/ai-devcon', city: 'New York, NY', country: 'USA', status: 'open' },
    { name: 'Some CFP - CFP (Boston)', date: [DAY(2026, 11, 3)], city: 'Boston, MA', country: 'USA', status: 'open' },
    { name: 'Old Conf', date: [DAY(2025, 1, 3)], city: 'Boston, MA', country: 'USA', status: 'open' },
  ];
  const anchors = conferenceAnchors(rows, 'developers.events', new Date('2026-10-21T12:00:00Z'));
  assert.deepEqual(anchors, [
    { name: 'AIE CODE Summit', metro: 'sf', startsOn: '2026-11-10', endsOn: '2026-11-12', url: 'https://www.ai.engineer/code', source: 'developers.events' },
    { name: 'AI DevCon NYC', metro: 'nyc', startsOn: '2026-11-02', endsOn: null, url: 'https://example.com/ai-devcon', source: 'developers.events' },
  ]);
});
