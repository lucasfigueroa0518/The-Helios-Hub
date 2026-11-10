/** AI Trivia music: beat grid, window placement on the sting hit, and the catalog pick (all offline, no HeyGen). */
import assert from 'node:assert/strict';
import test from 'node:test';

import { acceptableTracks, pickTriviaMusic, placeWindow, rankTracks, RECENT_SETS, type CatalogTrack } from '@/lib/stories/trivia/music';
import { beatGrid, snapBeat } from '@/lib/stories/trivia/render/beats';
import { CLIP_MS, FPS, HIT_MS } from '@/lib/stories/trivia/render/timeline';

const RATE = 48_000;

/** A click track: a decaying noise-and-thump burst on every beat, over low noise. Deterministic. */
function clickTrack(bpm: number, firstBeatS: number, seconds: number): { pcm: Float32Array; beats: number[] } {
  const pcm = new Float32Array(Math.round(seconds * RATE));
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
  for (let i = 0; i < pcm.length; i++) pcm[i] = rnd() * 0.01;
  const beats: number[] = [];
  for (let t = firstBeatS; t < seconds - 0.1; t += 60 / bpm) {
    beats.push(t * 1000);
    const s = Math.round(t * RATE);
    for (let k = 0; k < 0.06 * RATE && s + k < pcm.length; k++) {
      const env = Math.exp(-k / (0.012 * RATE));
      pcm[s + k]! += env * (0.6 * Math.sin((2 * Math.PI * 70 * k) / RATE) + 0.3 * rnd());
    }
  }
  return { pcm, beats };
}

test('beatGrid finds the tempo and lays its beats within a frame of the true ones', () => {
  const { pcm, beats } = clickTrack(96, 0.37, 30);
  const grid = beatGrid(pcm, RATE);
  assert.ok(Math.abs(grid.bpm - 96) < 0.5, `bpm ${grid.bpm}`);
  const frameMs = 1000 / FPS;
  const inner = beats.filter((b) => b > 2000 && b < 28000);
  for (const b of inner) {
    const near = Math.min(...grid.beatsMs.map((g) => Math.abs(g - b)));
    assert.ok(near <= frameMs / 2, `beat ${b} ms is ${near.toFixed(1)} ms from the grid`);
  }
  // Snapping a slightly-off beat moves it back onto the onset.
  const snapped = snapBeat(pcm, RATE, inner[10]! + 15);
  assert.ok(Math.abs(snapped - inner[10]!) < 12, `snapped to ${snapped}, beat ${inner[10]}`);
});

test('placeWindow puts a beat exactly on clip 2 + 0.6 s and keeps both clips inside the track', () => {
  const beats = Array.from({ length: 100 }, (_, k) => 300 + k * 600);
  const { startMs, hitMs } = placeWindow(beats, 60_000);
  assert.equal(hitMs, startMs + CLIP_MS + HIT_MS);
  assert.ok(beats.includes(hitMs));
  assert.ok(startMs >= 0 && startMs + 2 * CLIP_MS <= 60_000);
  assert.throws(() => placeWindow([1000, 2000], 9000), /no beat leaves room/);
});

const T = (id: string, extra: Partial<CatalogTrack> = {}): CatalogTrack => ({ id, name: `Track ${id}`, audio_url: `https://cdn.test/${id}.mp3`, duration: 120, ...extra });

test('rankTracks: banned words and short tracks out, fresh first, then the least recently used', () => {
  const results = [T('a', { name: 'Epic trailer rise' }), T('b'), T('c'), T('d', { duration: 12 }), T('e'), T('f', { description: 'with vocals' })];
  assert.deepEqual(acceptableTracks(results).map((t) => t.id), ['b', 'c', 'e']);
  assert.deepEqual(rankTracks(results, ['b']).map((t) => t.id), ['c', 'e', 'b']);
  // All recent: the one used longest ago comes first.
  assert.deepEqual(rankTracks(results, ['c', 'e', 'b']).map((t) => t.id), ['b', 'e', 'c']);
  assert.equal(RECENT_SETS, 10);
});

test('pickTriviaMusic picks a fresh track, skips one that fails, and lands a listed beat on the hit', async () => {
  const fetched: string[] = [];
  const beats = Array.from({ length: 200 }, (_, k) => 250 + k * 625); // 96 BPM
  const music = await pickTriviaMusic({
    recentTrackIds: async () => ['b'],
    search: async () => [T('b'), T('broken'), T('c')],
    download: async (url) => {
      fetched.push(url);
      if (url.includes('broken')) throw new Error('HTTP 403');
    },
    analyze: async () => ({ bpm: 96, beatsMs: beats, durationMs: 120_000 }),
  });
  assert.equal(music.trackId, 'c');
  assert.deepEqual(fetched, ['https://cdn.test/broken.mp3', 'https://cdn.test/c.mp3']);
  assert.equal(music.bpm, 96);
  assert.ok(music.beatMs.includes(music.startMs + CLIP_MS + HIT_MS), 'a beat sits on the sting hit');
  assert.ok(music.beatMs.every((b) => b >= music.startMs - 1000 && b <= music.startMs + 2 * CLIP_MS + 1000));
});

test('pickTriviaMusic never fails the set over rotation: all recent plays the least recently used', async () => {
  const music = await pickTriviaMusic({
    recentTrackIds: async () => ['x', 'y'],
    search: async () => [T('x'), T('y')],
    download: async () => undefined,
    analyze: async () => ({ bpm: 100, beatsMs: Array.from({ length: 150 }, (_, k) => k * 600), durationMs: 90_000 }),
  });
  assert.equal(music.trackId, 'y');
});
