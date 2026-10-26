import assert from 'node:assert/strict';
import test from 'node:test';

import { toPickedEvent } from '@/lib/ai-events/run';
import { resolveListingCover } from '@/lib/networking/covers';
import { httpImageUrl, lumaPosterUrl, meetupPosterUrl } from '@/lib/networking/poster';
import type { StoredNetworkingEvent } from '@/lib/networking/types';

test('poster helpers keep only http(s) image URLs', () => {
  assert.equal(httpImageUrl('https://images.lumacdn.com/a.jpg'), 'https://images.lumacdn.com/a.jpg');
  assert.equal(httpImageUrl('javascript:alert(1)'), null);
  assert.equal(httpImageUrl('not-a-url'), null);
  assert.equal(lumaPosterUrl({ cover_url: 'https://images.lumacdn.com/event-covers/x.jpg' }), 'https://images.lumacdn.com/event-covers/x.jpg');
  assert.equal(lumaPosterUrl({ cover_url: '' }), null);
  assert.equal(
    meetupPosterUrl({ featuredEventPhoto: { highResUrl: 'https://secure-content.meetupstatic.com/images/event/1.jpg' } }),
    'https://secure-content.meetupstatic.com/images/event/1.jpg',
  );
  assert.equal(meetupPosterUrl({ imageUrl: 'https://secure-content.meetupstatic.com/images/event/find.jpg' }), 'https://secure-content.meetupstatic.com/images/event/find.jpg');
});

test('toPickedEvent copies the stored cover onto the rank slide', () => {
  const base: StoredNetworkingEvent = {
    id: '00000000-0000-4000-8000-000000000001',
    fingerprint: 'fp-1',
    title: 'Boston AI Mixer',
    description: '',
    canonicalUrl: 'https://luma.com/boston-ai-mixer',
    listingUrls: [],
    startAt: '2026-10-27T22:00:00.000Z',
    endAt: null,
    timezone: 'America/New_York',
    venueName: 'CIC',
    address: null,
    city: 'Boston',
    metro: 'boston',
    lat: null,
    lng: null,
    attendance: 'in_person',
    access: 'open',
    accessEvidence: null,
    bucket: 'tech',
    industries: [],
    hostName: 'Boston AI',
    status: 'scheduled',
    listings: [{ source: 'luma', sourceEventId: 'evt-1', url: 'https://luma.com/boston-ai-mixer' }],
    firstSeenAt: '2026-10-20T00:00:00.000Z',
    lastSeenAt: '2026-10-20T00:00:00.000Z',
    organizerName: 'Boston AI',
    organizerKind: 'luma_calendar',
    organizerUrl: null,
    hosts: [],
    guestCount: 20,
    capacity: null,
    spotsRemaining: null,
    isSoldOut: null,
    waitlistActive: null,
    requiresApproval: null,
    isFree: true,
    priceMinCents: 0,
    priceMaxCents: 0,
    priceCurrency: 'USD',
    organizerEventCount: null,
    organizerMemberCount: null,
    organizerRating: null,
    organizerRatingCount: null,
    seriesKey: null,
    sourceTags: [],
    rsvpOffsite: null,
    signals: {},
    descriptionSource: null,
    detailsFetchedAt: null,
  };
  assert.equal(toPickedEvent(base)?.image, null);
  assert.equal(
    toPickedEvent({ ...base, signals: { coverUrl: 'https://images.lumacdn.com/event-covers/mixer.jpg' } })?.image,
    'https://images.lumacdn.com/event-covers/mixer.jpg',
  );
});

test('resolveListingCover reads Luma event/get cover_url', async () => {
  const fetchJson = async <T,>() => ({
    ok: true,
    status: 200,
    json: {
      event: { api_id: 'evt-1', name: 'x', start_at: '2026-10-28T22:00:00.000Z', cover_url: 'https://images.lumacdn.com/event-covers/x.jpg' },
    } as T,
    text: '',
  });
  const url = await resolveListingCover(
    { source: 'luma', sourceEventId: 'evt-1', url: 'https://luma.com/x' },
    { fetchJson: fetchJson as never },
  );
  assert.equal(url, 'https://images.lumacdn.com/event-covers/x.jpg');
});
