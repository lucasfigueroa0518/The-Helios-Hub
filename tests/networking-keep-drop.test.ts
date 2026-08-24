import assert from 'node:assert/strict';
import test from 'node:test';

import { inferAccess } from '@/lib/networking/access';
import { metroFromCityName, resolveMetro } from '@/lib/networking/cities';
import { classifyCandidate } from '@/lib/networking/keep-drop';
import { deduplicate, jaccardSimilarity } from '@/lib/networking/dedupe';
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
