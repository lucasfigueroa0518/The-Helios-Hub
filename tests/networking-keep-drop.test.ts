import assert from 'node:assert/strict';
import test from 'node:test';

import { inferAccess } from '@/lib/networking/access';
import { isAllowlistedHost, isAllowlistedUrl } from '@/lib/networking/allowlists';
import { METRO_PROFILES, metroFromCityName, normalizeSegment, resolveMetro } from '@/lib/networking/cities';
import { classifyCandidate } from '@/lib/networking/keep-drop';
import { deduplicate, jaccardSimilarity } from '@/lib/networking/dedupe';
import { INTERNAL_METROS, METROS } from '@/lib/networking/types';
import type { CandidateEvent, ClassifiedEvent } from '@/lib/networking/types';

const NOW = new Date('2026-08-24T16:00:00Z');
const IN_WINDOW = new Date('2026-09-15T22:00:00Z');

function candidate(overrides: Partial<CandidateEvent> & Pick<CandidateEvent, 'title' | 'sourceEventId'>): CandidateEvent {
  return {
    source: 'luma',
    description: '',
    url: 'https://luma.com/example',
    startAt: IN_WINDOW,
    isOnline: false,
    trusted: false,
    ...overrides,
  };
}

function asClassified(overrides: Partial<ClassifiedEvent>): ClassifiedEvent {
  const base = candidate({
    title: overrides.title || 'Event',
    sourceEventId: overrides.sourceEventId || '1',
    city: 'Boston',
  });
  const result = classifyCandidate(base, { now: NOW });
  if (!result.keep) throw new Error(`fixture dropped: ${result.reject.reasonCodes.join(',')}`);
  return { ...result.event, ...overrides };
}

test('city aliases map Cambridge to Boston and Coral Gables to Miami', () => {
  assert.equal(metroFromCityName('Cambridge, MA'), 'boston');
  assert.equal(metroFromCityName('Coral Gables'), 'miami');
  assert.equal(metroFromCityName('Tampa'), null);
});

test('coords inside 30 miles resolve metro', () => {
  assert.equal(resolveMetro({ lat: 42.3736, lng: -71.1097 }), 'boston'); // Cambridge
  assert.equal(resolveMetro({ lat: 26.1224, lng: -80.1373 }), 'miami'); // Fort Lauderdale
  assert.equal(resolveMetro({ lat: 27.9506, lng: -82.4572 }), null); // Tampa
});

test('metros: four public metros, two internal, each with a timezone', () => {
  assert.deepEqual([...METROS], ['boston', 'miami', 'nyc', 'sf']);
  assert.deepEqual([...INTERNAL_METROS], ['boston', 'miami']);
  assert.equal(METRO_PROFILES.nyc.radiusMiles, 30);
  assert.equal(METRO_PROFILES.sf.radiusMiles, 45);
  assert.equal(METRO_PROFILES.sf.label, 'SF Bay Area');
  assert.equal(METRO_PROFILES.sf.timezone, 'America/Los_Angeles');
  for (const metro of ['boston', 'miami', 'nyc'] as const) {
    assert.equal(METRO_PROFILES[metro].timezone, 'America/New_York');
  }
});

test('no alias belongs to two metros, and every alias resolves to its own metro', () => {
  const owner = new Map<string, string>();
  for (const profile of Object.values(METRO_PROFILES)) {
    for (const alias of profile.aliases) {
      const key = normalizeSegment(alias);
      const previous = owner.get(key);
      assert.ok(!previous || previous === profile.id, `alias "${alias}" is claimed by ${previous} and ${profile.id}`);
      owner.set(key, profile.id);
      assert.equal(metroFromCityName(alias), profile.id, `alias "${alias}"`);
    }
  }
});

test('NYC aliases resolve', () => {
  for (const place of ['Brooklyn', 'Jersey City', 'Hoboken', 'Kings County', 'NYC', 'Manhattan', 'Brooklyn, NY 11201']) {
    assert.equal(metroFromCityName(place), 'nyc', place);
  }
  assert.equal(metroFromCityName('New York', 'New York'), 'nyc');
  assert.equal(metroFromCityName('West New York, NJ'), 'nyc');
});

test('Bay Area aliases resolve', () => {
  for (const place of [
    'San Francisco, CA',
    'SF',
    'Mountain View',
    'San Jose',
    'Oakland',
    'MOFFETT FIELD',
    'Silicon Valley',
    '691 Market St, San Francisco, CA 94105, USA',
    'Frontier Tower @ Spaceship 995 Market Street, San Francisco',
  ]) {
    assert.equal(metroFromCityName(place), 'sf', place);
  }
});

test('collisions: state hints and whole-segment matching keep places in the right metro', () => {
  assert.equal(metroFromCityName('Chelsea Market, 75 9th Ave, New York, NY'), 'nyc');
  assert.equal(metroFromCityName('Belmont, CA'), null);
  assert.equal(metroFromCityName('Belmont'), 'boston');
  assert.equal(metroFromCityName('Edgewater', 'NJ'), null);
  assert.equal(metroFromCityName('Edgewater', 'FL'), 'miami');
  assert.equal(metroFromCityName('Chelsea', 'NY'), null);
  assert.equal(metroFromCityName('Midtown'), null);
  assert.equal(metroFromCityName('Downtown'), null);
  assert.equal(metroFromCityName('Mansfield'), null);
  assert.equal(metroFromCityName('Kendall', 'FL'), 'miami');
  assert.equal(metroFromCityName('Kendall'), 'miami');
  assert.equal(metroFromCityName('Kendall Square'), 'boston');
  assert.equal(metroFromCityName('Cambridge, ON'), null);
  assert.equal(metroFromCityName('Cambridge', 'England'), null);
  assert.equal(metroFromCityName('Oakland Park', 'FL'), null);
  assert.equal(metroFromCityName('Arlington, VA'), null);
  assert.equal(metroFromCityName('Lexington, KY'), null);
  assert.equal(metroFromCityName('Medford, NY'), null);
  assert.equal(metroFromCityName('Birmingham', 'West Midlands'), null);
  assert.equal(metroFromCityName('Lexington Ave'), null);
  assert.equal(metroFromCityName('Brighton Beach'), null);
  // Neighborhood aliases never match as a suffix of another place's name.
  assert.equal(metroFromCityName('South Street Seaport'), null);
  assert.equal(metroFromCityName('West Hollywood'), null);
  assert.equal(metroFromCityName('West Chelsea'), null);
  assert.equal(metroFromCityName('Seaport'), 'boston');
  assert.equal(metroFromCityName('Hollywood', 'FL'), 'miami');
});

test('the state hint is read off the last segment, so a floor number never hints Florida', () => {
  assert.equal(metroFromCityName('CIC, 50 Milk St, 2nd Fl, Boston'), 'boston');
  assert.equal(metroFromCityName('CIC, 1 Broadway, Cambridge, MA 02142'), 'boston');
  assert.equal(metroFromCityName('Somerville MA'), 'boston');
  assert.equal(metroFromCityName('Ft. Lauderdale, FL 33301'), 'miami');
  assert.equal(metroFromCityName('WeWork Boston'), 'boston');
});

test('coordinates resolve the new metros and are authoritative over names', () => {
  assert.equal(resolveMetro({ lat: 40.6782, lng: -73.9442 }), 'nyc'); // Brooklyn
  assert.equal(resolveMetro({ lat: 37.3382, lng: -121.8863 }), 'sf'); // San Jose
  assert.equal(resolveMetro({ lat: 40.3573, lng: -74.6672 }), null); // Princeton
  assert.equal(resolveMetro({ lat: 36.9741, lng: -122.0308 }), null); // Santa Cruz
  assert.equal(resolveMetro({ city: 'Cambridge', lat: 52.2053, lng: 0.1218 }), null); // Cambridge, UK
  assert.equal(resolveMetro({ city: 'Cambridge', lat: 0, lng: 0 }), 'boston'); // (0,0) is no location
  assert.equal(resolveMetro({ city: 'Jersey City', region: 'NJ' }), 'nyc');
});

test('London-located event named Cambridge is dropped as outside metro', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Cambridge AI mixer',
      sourceEventId: 'cam-uk',
      city: 'Cambridge',
      lat: 51.5072,
      lng: -0.1276,
    }),
    { now: NOW },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('outside_metro'));
});

test('NYC AI mixer is kept as nyc tech with the metro timezone', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Brooklyn AI founders mixer',
      sourceEventId: 'nyc-ai',
      source: 'meetup',
      city: 'Brooklyn',
      region: 'NY',
      description: 'Founders and engineers building with LLMs',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, true);
  if (result.keep) {
    assert.equal(result.event.metro, 'nyc');
    assert.equal(result.event.bucket, 'tech');
    assert.equal(result.event.timezone, 'America/New_York');
  }
});

test('region from the source rules out a same-name place in another state', () => {
  const result = classifyCandidate(
    candidate({ title: 'Belmont AI meetup', sourceEventId: 'belmont-ca', city: 'Belmont', region: 'CA' }),
    { now: NOW },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('outside_metro'));
});

test('a source timezone is kept; a missing one falls back to the metro zone', () => {
  const withZone = classifyCandidate(
    candidate({ title: 'SF AI mixer', sourceEventId: 'sf-1', city: 'San Francisco', timezone: 'America/Los_Angeles' }),
    { now: NOW },
  );
  const withoutZone = classifyCandidate(
    candidate({ title: 'SF AI mixer', sourceEventId: 'sf-2', source: 'meetup', city: 'San Francisco' }),
    { now: NOW },
  );
  assert.ok(withZone.keep && withoutZone.keep);
  if (withZone.keep) assert.equal(withZone.event.timezone, 'America/Los_Angeles');
  if (withoutZone.keep) assert.equal(withoutZone.event.timezone, 'America/Los_Angeles');
});

test('allowlisted host needs an exact name or slug: fal is not Buffalo', () => {
  assert.equal(isAllowlistedHost('fal'), true);
  assert.equal(isAllowlistedHost('FAL'), true);
  assert.equal(isAllowlistedHost('localhost:nyc'), true);
  assert.equal(isAllowlistedHost('MassTLC'), true);
  assert.equal(isAllowlistedHost('Hackers/Founders'), true);
  assert.equal(isAllowlistedHost('Buffalo AI Meetup'), false);
  assert.equal(isAllowlistedHost('Falmouth Founders'), false);
  assert.equal(isAllowlistedHost('MassTLC Boston chapter friends'), false);
  assert.equal(isAllowlistedHost(''), false);
  assert.equal(isAllowlistedHost(undefined), false);
});

test('allowlisted URL needs the calendar or group as the first path segment', () => {
  assert.equal(isAllowlistedUrl('https://luma.com/fal'), true);
  assert.equal(isAllowlistedUrl('https://lu.ma/frontiertower'), true);
  assert.equal(isAllowlistedUrl('https://www.meetup.com/hackerdojo/events/312345678/'), true);
  assert.equal(isAllowlistedUrl('https://www.meetup.com/bostonpython/events/316751857/'), true);
  assert.equal(isAllowlistedUrl('https://luma.com/fall-ai-mixer'), false);
  assert.equal(isAllowlistedUrl('https://www.eventbrite.com/e/fal-summit-12345678901'), false);
  assert.equal(isAllowlistedUrl('https://www.meetup.com/aws-nyc-builders/events/1/'), false);
  assert.equal(isAllowlistedUrl('not a url'), false);
});

test('Buffalo-hosted event is not trusted and still needs ICP keywords', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Thursday Gathering',
      sourceEventId: 'buffalo',
      city: 'Boston',
      hostName: 'Buffalo Wild Wings Boston',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('icp_mismatch'));
});

test('online events are dropped', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Boston AI webinar',
      sourceEventId: 'online',
      isOnline: true,
      city: 'Boston',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('online_only'));
});

test('Cambridge AI mixer is kept as Boston tech', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Cambridge AI mixer',
      sourceEventId: 'cam-ai',
      city: 'Cambridge',
      description: 'Founders and engineers',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, true);
  if (result.keep) {
    assert.equal(result.event.metro, 'boston');
    assert.equal(result.event.bucket, 'tech');
  }
});

test('Miami dental association mixer is kept as vertical healthcare', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Miami dental association mixer',
      sourceEventId: 'dental',
      city: 'Miami',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, true);
  if (result.keep) {
    assert.equal(result.event.metro, 'miami');
    assert.equal(result.event.bucket, 'vertical');
    assert.ok(result.event.industries.includes('healthcare_practices'));
  }
});

test('Tampa event is dropped as outside metro', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Tampa AI mixer',
      sourceEventId: 'tampa',
      city: 'Tampa',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('outside_metro'));
});

test('concerts are dropped', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Boston summer concert',
      sourceEventId: 'concert',
      city: 'Boston',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('format_mismatch'));
});

test('fal.ai Barcelona hackathon is rejected outside_metro even if trusted', () => {
  const result = classifyCandidate(
    candidate({
      title: 'fal hackathon',
      sourceEventId: 'fal-bcn',
      city: 'Barcelona',
      trusted: true,
      hostName: 'fal',
    }),
    { now: NOW },
  );
  assert.equal(result.keep, false);
  if (!result.keep) assert.ok(result.reject.reasonCodes.includes('outside_metro'));
});

test('allowlisted host skips ICP keywords but still needs a local venue', () => {
  const result = classifyCandidate(
    candidate({
      title: 'Thursday Gathering',
      sourceEventId: 'vc',
      city: 'Cambridge',
      hostName: 'MassTLC',
      trusted: true,
    }),
    { now: NOW },
  );
  assert.equal(result.keep, true);
});

test('access inference covers free, paid, and invite-only', () => {
  assert.equal(
    inferAccess(candidate({ title: 'Free meetup', sourceEventId: 'a', isFree: true })).access,
    'open',
  );
  assert.equal(
    inferAccess(candidate({ title: 'Tickets', sourceEventId: 'b', priceAmount: 45 })).access,
    'paid',
  );
  assert.equal(
    inferAccess(
      candidate({
        title: 'Invite-only dinner',
        sourceEventId: 'c',
        description: 'Request an invite',
      }),
    ).access,
    'invite_only',
  );
});

test('dedupe merges the same mixer across Luma and Eventbrite within 2 hours', () => {
  const luma = asClassified({
    source: 'luma',
    sourceEventId: 'l1',
    title: 'Boston AI Founder Mixer',
    url: 'https://luma.com/abc',
    startAt: IN_WINDOW,
    metro: 'boston',
  });
  const eb = asClassified({
    source: 'eventbrite',
    sourceEventId: 'e1',
    title: 'Boston AI Founder Mixer',
    url: 'https://www.eventbrite.com/e/boston-ai-founder-mixer-12345678901',
    startAt: new Date(IN_WINDOW.getTime() + 30 * 60 * 1000),
    metro: 'boston',
  });
  const unique = deduplicate([luma, eb]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].listings.length, 2);
});

test('different events the same night are not merged', () => {
  const a = asClassified({
    source: 'luma',
    sourceEventId: 'a',
    title: 'Boston AI Founder Mixer',
    startAt: IN_WINDOW,
    metro: 'boston',
  });
  const b = asClassified({
    source: 'luma',
    sourceEventId: 'b',
    title: 'Miami Dental Association Dinner',
    city: 'Miami',
    startAt: IN_WINDOW,
    metro: 'miami',
  });
  assert.ok(jaccardSimilarity(a.title, b.title) < 0.85);
  const unique = deduplicate([a, b]);
  assert.equal(unique.length, 2);
});

test('dedupe uses the metro timezone, so a 6 PM PT Meetup copy meets its Luma twin', () => {
  // 6:00 PM PDT on 2026-09-15 is 01:00 UTC on 2026-09-16.
  const start = new Date('2026-09-16T01:00:00Z');
  const luma = asClassified({
    source: 'luma',
    sourceEventId: 'sf-l1',
    title: 'SF AI Builders Night',
    url: 'https://luma.com/sf-ai-builders',
    startAt: start,
    metro: 'sf',
    timezone: 'America/Los_Angeles',
  });
  const meetup = asClassified({
    source: 'meetup',
    sourceEventId: 'sf-m1',
    title: 'SF AI Builders Night',
    url: 'https://www.meetup.com/sf-ai/events/1/',
    startAt: new Date(start.getTime() + 15 * 60 * 1000),
    metro: 'sf',
    timezone: undefined,
  });
  const unique = deduplicate([luma, meetup]);
  assert.equal(unique.length, 1);
  assert.equal(unique[0].listings.length, 2);
});
