/**
 * The reveal payoff (RA-26): AI always shows its prompt, with no model call; a real photo gets the effort line when the
 * effort gap is large, else the camera card. The effort line fails open (Lucas, 2026-11-15: "We shouldn't be dropping
 * photos because of the reveal line"): each retry sees the earlier line and what to cut; after the last try the best
 * line is kept, cleaned and flagged. Claude is a stub; PGlite runs the cost rows.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import sharp from 'sharp';

import { openLocalStoriesDb } from '@/lib/stories/local-db';
import { cleanLine, REVEAL_TRIES, revisionNotes, writeReveal } from '@/lib/stories/roa/reveal';
import { DEFAULT_SETTINGS } from '@/lib/stories/settings';

import { stubWriter } from './stories-harness';

const LONG = 'one two three four five six seven eight nine ten eleven';
const jpeg = () => sharp({ create: { width: 64, height: 96, channels: 3, background: '#556677' } }).jpeg().toBuffer();
const real = { kind: 'commons' as const, url: 'https://commons.test/f', licence: 'CC BY-SA 4.0', credit: 'A / Wikimedia Commons' };

test('a retry sees the earlier line and exactly what to cut', () => {
  const notes = revisionNotes(LONG, ['line: 11 words (max 10)', 'line: exclamation mark']);
  assert.match(notes[0]!, /earlier line was: "one two/);
  assert.match(notes[0]!, /11 words/);
  assert.ok(notes.some((n) => /at most 10 words/.test(n)));
  assert.ok(notes.includes('line: exclamation mark'));
});

test('a line that never fits fails open: kept, cleaned and flagged', async () => {
  const { db } = await openLocalStoriesDb();
  const write = stubWriter({ submit_reveal: () => ({ effort: 'large' as const, line: `${LONG}!` }) });
  const rv = await writeReveal({ db, write, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'real', provenance: real });
  assert.equal(write.calls.length, REVEAL_TRIES);
  assert.ok(rv.ok);
  if (rv.ok) {
    assert.equal(rv.line, `${LONG}.`);
    assert.match((rv.flags ?? []).join(), /11 words/);
  }
  const second = JSON.stringify(write.calls[1]!.messages);
  assert.match(second, /earlier line was/);
});

test('the best attempt wins when the last one is worse', async () => {
  const { db } = await openLocalStoriesDb();
  const lines = [LONG, 'one two three four five six seven eight nine ten eleven twelve thirteen', ''];
  const write = stubWriter({ submit_reveal: (_p, n) => ({ effort: 'large' as const, line: lines[n - 1] }) });
  const rv = await writeReveal({ db, write, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'real', provenance: real });
  assert.ok(rv.ok && rv.line === LONG);
});

test('a clean retry clears the flags', async () => {
  const { db } = await openLocalStoriesDb();
  const write = stubWriter({ submit_reveal: (_p, n) => ({ effort: 'large' as const, line: n === 1 ? LONG : 'Wind over the ridge stacks these clouds' }) });
  const rv = await writeReveal({ db, write, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'real', provenance: real });
  assert.ok(rv.ok && !rv.flags && write.calls.length === 2);
});

test('cleanLine drops emoji and exclamation marks only', () => {
  assert.equal(cleanLine('Real clouds 🌥 over the ridge!'), 'Real clouds over the ridge.');
});

const gen = { kind: 'generated' as const, model: 'gpt-image-2', prompt: 'Phone photo of a parked bike in the rain', createdAt: '2026-11-16T00:00:00Z' };

test('RA-26: AI always shows its prompt, with no model call', async () => {
  const { db } = await openLocalStoriesDb();
  const write = stubWriter({});
  const rv = await writeReveal({ db, write, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'ai', provenance: gen });
  assert.deepEqual(rv, { ok: true, payoff: 'prompt', line: '' });
  assert.equal(write.calls.length, 0);
});

test('RA-27: an AI image with no prompt to show goes by the effort gap: a line when large, else the origin card', async () => {
  const { db } = await openLocalStoriesDb();
  const imported = { kind: 'dataset' as const, dataset: 'Example set', id: '1', model: 'some-model' };
  const large = stubWriter({ submit_reveal: () => ({ effort: 'large', line: 'A real shot would need a drone over the crater' }) });
  assert.deepEqual(await writeReveal({ db, write: large, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'ai', provenance: imported }), {
    ok: true, payoff: 'effort', line: 'A real shot would need a drone over the crater',
  });
  // The model is told it is an AI image, with what made it and where it came from; no archive material.
  const sent = JSON.stringify(large.calls[0]!.messages);
  assert.match(sent, /AI image/);
  assert.match(sent, /Example set dataset/);
  assert.doesNotMatch(sent, /photo archive/);
  const low = stubWriter({ submit_reveal: () => ({ effort: 'low', line: '' }) });
  assert.deepEqual(await writeReveal({ db, write: low, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'ai', provenance: { kind: 'viral', url: 'https://x.test/p' } }), {
    ok: true, payoff: 'origin', line: '',
  });
  // Our own image whose prompt is unusable takes the same path instead of being dropped.
  const unclear = stubWriter({ submit_reveal: () => ({ effort: 'unclear', line: '' }) });
  const rv = await writeReveal({ db, write: unclear, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'ai', provenance: { ...gen, prompt: ' ' } });
  assert.deepEqual(rv, { ok: true, payoff: 'origin', line: '' });
});

test('RA-26: a low or unclear effort gap shows the camera card; flagged only when the card would be empty', async () => {
  const { db } = await openLocalStoriesDb();
  const deps = (effort: string) => ({ db, write: stubWriter({ submit_reveal: () => ({ effort, line: 'Ignored when the gap is not large' }) }), settings: DEFAULT_SETTINGS });
  const withCam = { ...real, year: '2022', camera: { body: 'Nikon D7200', iso: 100 } };
  assert.deepEqual(await writeReveal(deps('low'), { jpeg: await jpeg(), truth: 'real', provenance: withCam }), { ok: true, payoff: 'camera', line: '' });
  assert.deepEqual(await writeReveal(deps('unclear'), { jpeg: await jpeg(), truth: 'real', provenance: real }), {
    ok: true, payoff: 'camera', line: '', flags: ['camera card: no camera details, date or place'],
  });
});

test('RA-26: a large gap with no line after every try falls back to the camera card, flagged', async () => {
  const { db } = await openLocalStoriesDb();
  const write = stubWriter({ submit_reveal: () => ({ effort: 'large', line: '' }) });
  const rv = await writeReveal({ db, write, settings: DEFAULT_SETTINGS }, { jpeg: await jpeg(), truth: 'real', provenance: { ...real, year: '2019' } });
  assert.deepEqual(rv, { ok: true, payoff: 'camera', line: '', flags: ['effort line: empty after every try'] });
  assert.equal(write.calls.length, REVEAL_TRIES);
});
