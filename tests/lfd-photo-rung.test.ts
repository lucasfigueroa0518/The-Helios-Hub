/**
 * The LFD photo rung (lib/lfd/run.ts lfdPhotoRung), shared by the run and the Social Hub's photo swap. Offline: the
 * page read and findStoryPhoto are stubs; no harvest is wired (a non-builder story).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import type { Candidate, PhotoResult, PhotoStory } from '@/lib/news-photos';
import { EMPTY_LEDGER } from '@/lib/photos/used';
import { lfdPhotoRung } from '@/lib/lfd/run';
import type { Pick } from '@/lib/lfd/types';
import type { PageRead } from '@/lib/social/reporter/read-page';

const pick = { key: 'a', refs: [], origin: 'reels', headline: 'H', sourceName: 'The Verge', url: 'https://s.com/a', body: 'Article text.', publishedAt: null, net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, builder: null, eventDate: null, lane: 'rundown' } satisfies Pick;
const LEAD = 'https://s.com/lead.jpg';
const page: PageRead = { ok: true, url: pick.url, resolvedUrl: pick.url, title: 'T', byline: null, publishedTime: null, text: 'x', truncated: false, photos: [{ src: LEAD, caption: null, credit: 'Reuters', alt: null, from: 'figure', width: 1400 }] };

function finder(pickSrc: string | null) {
  const calls: Array<{ s: PhotoStory; extra: Candidate[]; used: (src: string) => Promise<string | null> }> = [];
  const findPhoto = async (s: PhotoStory, o: { extra: Candidate[]; usedReason: (src: string) => Promise<string | null> }): Promise<PhotoResult> => {
    calls.push({ s, extra: o.extra, used: o.usedReason });
    const graded = pickSrc ? { src: pickSrc, source: 'extra' as const, credit: 'Reuters', tier: 'good' as const, clarity: 8, jpeg: Buffer.alloc(0), width: 1, height: 1 } : null;
    return { id: s.id, tier: graded ? 'good' : 'none', pick: graded, brief: null, costUsd: 0.01, log: ['stub'] };
  };
  return { findPhoto, calls };
}

test('the lead image and a revision\'s extra candidates go to findStoryPhoto; a lead pick is labelled lead', async () => {
  const f = finder(LEAD);
  const hint: Candidate = { src: 'https://img.test/hint.jpg', source: 'extra', credit: '' };
  const r = await lfdPhotoRung(pick, { readPage: async () => page, findPhoto: f.findPhoto, taken: new Set(['https://img.test/taken.jpg']), ledger: EMPTY_LEDGER, extra: [hint], duplicateUrls: ['https://dup.test/a'] });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.calls[0]!.extra.map((c) => c.src), [LEAD, hint.src]);
  assert.deepEqual(f.calls[0]!.s, { id: 'a', headline: 'H', text: 'Article text.', url: pick.url, duplicateUrls: ['https://dup.test/a'] });
  assert.equal(await f.calls[0]!.used('https://img.test/taken.jpg'), 'already on this post or published recently');
  assert.equal(await f.calls[0]!.used('https://img.test/free.jpg'), null);
  assert.equal(r.source, 'lead');
  assert.deepEqual(r.photo, { src: LEAD, credit: 'Reuters', kind: 'scene' });
  assert.equal(r.harvestFound, undefined, 'no harvest for a non-builder story');
  assert.ok(r.trace.includes('photo: stub'));
});

test('nothing picked: no photo, the result kept for its cost; a finder error is a trace line, never a throw', async () => {
  const none = await lfdPhotoRung(pick, { readPage: async () => page, findPhoto: finder(null).findPhoto, taken: new Set(), ledger: EMPTY_LEDGER });
  assert.equal(none.photo, undefined);
  assert.equal(none.result?.costUsd, 0.01);
  const boom = await lfdPhotoRung(pick, { readPage: async () => page, findPhoto: async () => { throw new Error('jev down'); }, taken: new Set(), ledger: EMPTY_LEDGER });
  assert.equal(boom.result, null);
  assert.match(boom.trace.at(-1)!, /photo: failed: jev down/);
});
