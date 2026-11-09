import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  analyseBands, BED_VOLUME, chooseTracks, cueMusicPlan, GAIN_RANGE, isDense, loudness, measureTrack, modulationDepth, placeMusic, recentIds, sectionFit, STYLE_KEYS, styleKey, SWELL_MAX, trackScore, withReel,
} from '@/explainers/reel-ai-drama/kit/music.mjs';
import { eventProblems, foleyQuery, HEAVY_SPACING, tagCounts } from '@/explainers/reel-ai-drama/kit/sound.mjs';
import { lookVerdict, type Look } from '@/lib/reel-ai-drama/harvest/filters';
import { parseLooks } from '@/lib/reel-ai-drama/harvest/look';
import { planWants } from '@/lib/reel-ai-drama/harvest/plan';
import { boxesInCrop, captureProblem, cropRect } from '@/lib/reel-ai-drama/harvest/screens';
import { logoSource } from '@/lib/reel-ai-drama/harvest/sources/logos';
import { serperTbs } from '@/lib/reel-ai-drama/harvest/sources/serper';
import { headNoun, wishCount, wishWants } from '@/lib/reel-ai-drama/harvest/wishes';
import type { HarvestDeps, SourceRun, Want } from '@/lib/reel-ai-drama/harvest/types';
import { musicHistoryPath, readMusicHistory } from '@/lib/reel-ai-drama/render/workspace';
import { MUSIC_GAP_MAX, musicGaps, soundLibrary, soundUserText, validateCues } from '@/lib/reel-ai-drama/render/sound-design';
import { applyWishes } from '@/lib/reel-ai-drama/render/wishes';
import type { DirectorPlan, Pitch, ShotWish, WriterDraft } from '@/lib/reel-ai-drama/types';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'iter8-sh-'));
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const wish = (over: Partial<ShotWish>): ShotWish => ({ id: 'W1', person: null, want: 'x', frame_ns: [1], fallback: 'V1', ...over });

// ── Harvest: wishes (MD-139) ──────────────────────────────────────────────

test('an old wish keeps its head noun however many adjectives lead it', () => {
  const want = 'A real brick or stone residential fireplace with a mantel, front view, cut out';
  assert.equal(headNoun(want), 'fireplace');
  const wants = wishWants(wish({ want, cut_out: true }));
  assert.ok(wants.every((w) => /\bfireplace\b/.test(w.terms)), wants.map((w) => w.terms).join(' | '));
  assert.equal(headNoun("An exterior photo of Google's headquarters in Mountain View", ['Google', 'Mountain View']), 'headquarters');
});

test('a wish with a query searches it first, as written, then a retry', () => {
  const a = wishWants(wish({ want: 'whatever the director wrote at length', query: 'stone hearth', as: 'object' }));
  assert.deepEqual(a.map((w) => [w.sources[0], w.terms]), [['serper', 'stone hearth'], ['serper', 'stone hearth photo'], ['commons', 'stone hearth']]);
  assert.equal(a[0].kind, 'object');
  const b = wishWants(wish({ want: 'x', query: 'vintage red rotary telephone', as: 'product' }));
  assert.equal(b[0].terms, 'vintage red rotary telephone');
  assert.equal(b[1].terms, 'rotary telephone', 'wider');
  assert.equal(b[0].kind, 'product');
  const named = wishWants(wish({ want: 'x', query: 'Acme Widget smart speaker', as: 'product' }));
  assert.equal(named[1].terms, 'Acme Widget speaker', 'the names stay in a wider retry');
  const person = wishWants(wish({ person: 'Ada Lane', want: 'Ada Lane on stage', query: 'Ada Lane keynote' }));
  assert.equal(person[0].terms, 'Ada Lane keynote');
  assert.equal(person[0].kind, 'person_photo');
});

test('as: a logo goes to the logo source; a place, product or object carries no date filter on a news story', () => {
  const logo = wishWants(wish({ want: 'the mark', query: 'Acme logo', as: 'logo' }));
  assert.deepEqual(logo.map((w) => [w.kind, w.sources[0], w.terms]), [['logo', 'logo', 'Acme logo']]);
  const news = { isNews: true, eventDate: '2026-10-01', now: new Date('2026-10-10') };
  for (const kind of ['logo', 'product', 'object', 'place_photo'] as const) assert.equal(serperTbs(news, { kind }), null, kind);
  assert.match(String(serperTbs(news, { kind: 'event_photo' })), /^cdr:1/);
  assert.equal(wishWants(wish({ want: 'x', query: 'old stone bridge', as: 'place' }))[0].kind, 'place_photo');
});

test('count: clamped, and render expands the wish everywhere a frame lists it', () => {
  assert.deepEqual([wishCount({}), wishCount({ count: 4 }), wishCount({ count: 99 }), wishCount({ count: 0 })], [1, 4, 10, 1]);
  const plan = {
    frames: [{ n: 1, asset_ids: ['W1', 'V9'], motion: 'burst W1', marks: '', shows: [{ asset_id: 'W1' }], shots: [{ at: 'a', shows: 'b', asset_ids: ['W1'], introduces: null }] }],
    makes: [],
    wishes: [wish({ count: 3 })],
    lines_back: [],
  } as unknown as DirectorPlan;
  const out = applyWishes(plan, new Map([['W1', ['V20', 'V21', 'V22']]]));
  assert.deepEqual(out.frames[0].asset_ids, ['V20', 'V21', 'V22', 'V9']);
  assert.deepEqual(out.frames[0].shots![0].asset_ids, ['V20', 'V21', 'V22']);
  assert.equal(out.frames[0].shows![0].asset_id, 'V20');
  assert.equal(out.frames[0].motion, 'burst V20, V21, V22');
  assert.equal(out.wishes, undefined);
});

// ── Harvest: products, logos ──────────────────────────────────────────────

test('a product gets a logo want and a product photo; a company still gets its logo and no product photo', () => {
  const pitch = { title: 't', event_date: null, cast: [{ name: 'Widget', role: 'assistant', kind: 'product', player_id: null }, { name: 'Acme', role: 'maker', kind: 'company', player_id: null }], expected_visuals: [], sources: [], brief: 'A thing.' } as unknown as Pitch;
  const wants = planWants(pitch, null, { isNews: true, cutouts: [] });
  assert.deepEqual(wants.filter((w) => w.terms === 'Widget').map((w) => [w.kind, w.sources[0]]), [['logo', 'logo'], ['product', 'serper']]);
  assert.ok(!wants.some((w) => w.id === 'company-place:widget'), 'a product has no headquarters');
  assert.ok(wants.some((w) => w.id === 'company:acme' && w.kind === 'logo'));
});

test('a name the logo bank lacks falls back to Google Images', async () => {
  const bodies: { q: string; tbs?: string }[] = [];
  const http = (async (_u: string, init: { body: string }) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ images: [{ imageUrl: 'https://x.test/a.png', title: 'Nobody Labs logo' }] }));
  }) as unknown as HarvestDeps['http'];
  const run = { deps: { serperKey: 'k', http }, notes: [], isNews: true, eventDate: '2026-10-01', now: new Date('2026-10-10'), spend: { serperQueries: 0, serperUsd: 0, lookUsd: 0 } } as unknown as SourceRun;
  const got = await logoSource({ id: 'company:n', kind: 'logo', what: '', terms: 'Nobody Labs', people: [], qids: [], playerId: null, key_moment: false, sources: ['logo'] } as Want, run);
  assert.deepEqual(bodies, [{ q: 'Nobody Labs logo', num: 20 }], 'no date filter');
  assert.equal(got[0].kind, 'logo');
  assert.ok(got[0].flags.includes('logo') && got[0].flags.includes('from_search'));
});

// ── Harvest: failed captures (MD-141) ─────────────────────────────────────

test('a failed capture is rejected, made or found; a whole one passes', () => {
  const look = (over: Partial<Look>): Look => ({ shows: '', watermark: false, tv_logo: false, ai_generated: false, faces: 0, text_heavy: true, about_story: true, key_moment: false, ...over });
  assert.equal(lookVerdict({ made: true }, look({ broken: true })), 'broken_capture');
  assert.equal(lookVerdict({ made: false }, look({ broken: true })), 'broken_capture');
  assert.equal(lookVerdict({ made: true }, look({ watermark: true })), null, 'a capture keeps its branding exemption');
  assert.equal(parseLooks({ tiles: [{ tile: 1, broken: true }] }, 1).get(0)?.broken, true);
  assert.equal(captureProblem({ status: 404, title: 'x', text: 'long' }), 'HTTP 404');
  assert.match(String(captureProblem({ status: 200, title: 'Just a moment...', text: 'Checking your browser' })), /just a moment/i);
  assert.equal(captureProblem({ status: 200, title: 'Why 404 pages matter', text: 'word '.repeat(600) }), null, 'an article about errors is not one');
});

test('crop: the headline block, its boxes moved; nothing when a crop would not help', () => {
  const clip = cropRect({ x: 20, y: 100, w: 400, h: 200 })!;
  assert.deepEqual(clip, { x: 0, y: 84, w: 540, h: 232 });
  assert.equal(cropRect({ x: 0, y: 0, w: 540, h: 900 }), null);
  assert.equal(cropRect({ x: 0, y: 40, w: 540, h: 30 }), null);
  assert.equal(cropRect(null), null);
  const moved = boxesInCrop([{ text: 'a', x: 10, y: 200, w: 50, h: 20 }, { text: 'gone', x: 10, y: 1000, w: 50, h: 20 }], clip);
  assert.deepEqual(moved, [{ text: 'a', x: 10, y: 32, w: 50, h: 20 }]);
});

// ── Sound: drone, levels, spacing ─────────────────────────────────────────

test('drone can no longer be picked, and old plans play it as real music', () => {
  assert.ok(!STYLE_KEYS.includes('drone'));
  assert.equal(styleKey('drone'), 'dread');
  assert.equal(styleKey('nope'), null);
  const { styles } = cueMusicPlan([{ t: 0, action: 'start', style: 'drone', gain: 0.16 }], { total: 10 });
  assert.deepEqual(styles, ['dread']);
});

test('the prompt states the levels and spacing code enforces, and no retired style', () => {
  const text = fs.readFileSync(path.join('explainers', 'reel-ai-drama', 'prompts', 'sound-designer.md'), 'utf8');
  assert.equal(BED_VOLUME, 0.31);
  for (const n of [GAIN_RANGE[0], GAIN_RANGE[1], BED_VOLUME, SWELL_MAX]) assert.ok(text.includes(String(n)), `gain ${n}`);
  assert.ok(text.includes(`within ${HEAVY_SPACING} seconds`));
  assert.ok(text.includes(`over ${MUSIC_GAP_MAX} seconds`));
  assert.ok(!/drone|fireplace|\$/i.test(text), 'no retired style or example from the notes');
  assert.ok(!/never pushes|Fewer, better/.test(text));
});

// ── Sound: the music gap check (MD-142) ───────────────────────────────────

const REEL = (closeStart: number | null = 40) => ({
  clock: [0, 10, 20, 30, 40].map((start, i) => ({ number: i + 1, id: `f${i + 1}`, name: `F${i + 1}`, start, duration: 10, fields: {}, words: [] })),
  total: 50,
  closeStart,
  hookFrame: 1,
  peakFrames: [],
  landingFrames: [],
});
const LIB = { stingers: {}, ambience: [] } as never;

test('musicGaps: a long stop is found, a short one and the close are not', () => {
  assert.deepEqual(musicGaps([{ t: 0, action: 'start' }, { t: 10, action: 'drop' }, { t: 25, action: 'resume' }], [], 40), [{ start: 10, end: 25 }]);
  assert.deepEqual(musicGaps([{ t: 0, action: 'start' }, { t: 10, action: 'drop' }, { t: 15, action: 'resume' }], [], 40), []);
  assert.deepEqual(musicGaps([{ t: 0, action: 'start' }], [], 40), []);
  assert.deepEqual(musicGaps([{ t: 12, action: 'start' }], [], 40), [{ start: 0, end: 12 }]);
  assert.deepEqual(musicGaps([{ t: 0, action: 'start' }, { t: 10, action: 'drop' }, { t: 17.5, action: 'resume' }], [{ t: 17.5, dur: 1 }], 40), [{ start: 10, end: 18.5 }], 'a silence extends the stop');
});

test('validateCues: music starts on the first instant, comes back within the limit and plays into the close', () => {
  const late = validateCues({ music: [{ action: 'start', frame: 2, word: null, offset: 0, why: 'late' }] }, REEL(), LIB);
  assert.equal(late.cues.music[0].t, 0);
  assert.ok(late.problems.some((p) => p.includes('no music bed from frame 1')));

  const long = validateCues({ music: [
    { action: 'start', frame: 1, word: null, offset: 0, why: 'open' },
    { action: 'drop', frame: 2, word: null, offset: 0, why: 'the line lands alone' },
    { action: 'resume', frame: 4, word: null, offset: 0, why: 'back' },
  ] }, REEL(), LIB);
  const back = long.cues.music.find((m) => m.action === 'resume')!;
  assert.ok(back.t > 10 && back.t <= 18, `back at ${back.t}`);
  assert.deepEqual(musicGaps(long.cues.music, [], 40), []);
  assert.ok(long.problems.some((p) => p.includes('without music')));

  const ending = validateCues({ music: [
    { action: 'start', frame: 1, word: null, offset: 0, why: 'open' },
    { action: 'cut', frame: 4, word: null, offset: 6, why: 'a stop before the end' },
  ] }, REEL(), LIB);
  const last = ending.cues.music.at(-1)!;
  assert.deepEqual([last.action, last.t], ['resume', 40], 'the score resolves on the close');

  const inClose = validateCues({ music: [
    { action: 'start', frame: 1, word: null, offset: 0, why: 'open' },
    { action: 'cut', frame: 5, word: null, offset: 1, why: 'end' },
  ] }, REEL(), LIB);
  assert.ok(!inClose.cues.music.some((m) => m.action === 'cut'));
});

test('stopping the music needs a stated reason; a section\'s gain stays in the range', () => {
  const r = validateCues({ music: [
    { action: 'start', frame: 1, word: null, offset: 0, gain: 0.01, why: 'open' },
    { action: 'drop', frame: 2, word: null, offset: 0, why: ' ' },
  ], stingers: [{ kind: 'silence', frame: 3, word: null, offset: 0, dur: 0.5, why: '' }] }, REEL(), LIB);
  assert.deepEqual(r.cues.music.map((m) => m.action), ['start']);
  assert.equal(r.cues.music[0].gain, GAIN_RANGE[0]);
  assert.equal(r.cues.stingers.length, 0);
  assert.equal(r.problems.filter((p) => p.includes('stated reason')).length, 2);
});

test('the designer reads each frame\'s motion, shots and own sounds', () => {
  const plan = { frames: [{ name: 'F1', motion: 'a chart draws', sound: '', shots: [{ at: 'the words', shows: 'a chart', asset_ids: [], introduces: 'Acme' }] }], lines_back: [] } as unknown as DirectorPlan;
  const text = soundUserText(REEL() as never, { title: 't', hook: { on_screen: 'h', line_id: 'L1' } } as unknown as WriterDraft, plan, new Map([[1, 'whoosh @1.2']]));
  assert.match(text, /motion: a chart draws/);
  assert.match(text, /shot from "the words": a chart \(introduces Acme\)/);
  assert.match(text, /own sounds \(reel seconds\): whoosh @1\.2/);
});

test('a kit move may carry a whoosh or a shutter; a frame worker still may not imply an event', () => {
  assert.deepEqual(eventProblems([{ t: 1, kind: 'whoosh', kit: true }, { t: 1, kind: 'foley', what: 'camera shutter', kit: true }], 5), []);
  assert.equal(eventProblems([{ t: 1, kind: 'foley', what: 'camera shutter' }], 5).length, 1);
  const catalog = JSON.parse(fs.readFileSync(path.join('explainers', 'design', 'sfx', 'catalog.json'), 'utf8'));
  const counts = tagCounts(catalog);
  for (const what of ['camera shutter', 'notification', 'mouse click']) assert.ok(foleyQuery(what, counts), what);
});

// ── Music: measuring tracks (MD-144) ──────────────────────────────────────

test('modulationDepth: a steady band reads 0, a syllable rate reads high', () => {
  const steady = Array.from({ length: 250 }, () => 0.5);
  const pulsing = Array.from({ length: 250 }, (_, i) => 0.5 + 0.4 * Math.sin((2 * Math.PI * 4 * i) / 50));
  assert.equal(modulationDepth(steady, 50), 0);
  assert.ok(modulationDepth(pulsing, 50) > 0.5);
});

test('score: thresholds from real tracks rank a bass-only bed and a fading tail under one that sits well', () => {
  const sitsWell = { speech: -6, busy: 0.09, phone: -2.8, level: -18 };
  const bassOnly = { speech: -39.8, busy: 0.06, phone: -30, level: -14 };
  const mostlyBass = { speech: -18, busy: 0.19, phone: -14.6, level: -16 };
  const movingDense = { speech: -1.3, busy: 0.22, phone: -0.5, level: -16 };
  const tail = { speech: -2.6, busy: 0.08, phone: -1.2, level: -42 };
  const s = (fit: { speech: number; busy: number; phone: number; level: number }) => trackScore({ relevance: 0.5, fit });
  assert.equal(s(sitsWell), 0.5);
  assert.ok(s(bassOnly) < s(mostlyBass) && s(mostlyBass) < s(movingDense) && s(movingDense) < s(sitsWell));
  assert.ok(s(tail) < s(sitsWell));
  assert.equal(isDense(movingDense), true);
  assert.equal(isDense(sitsWell), false);
  assert.equal(trackScore({ relevance: 0.9, fit: null }), 0.9, 'unmeasured: the catalog\'s order decides');
});

test('measureTrack caches per track, and a later section measures only what is new', () => {
  const cache = {};
  const calls: [number, number][] = [];
  const decode = (_src: string, at: number, len: number) => {
    calls.push([at, len]);
    return new Float32Array(16000 * len * 3).map((_, i) => (i % 3 === 0 ? 0.2 : 0.05) * Math.sin(i / 7));
  };
  const lead = () => 1;
  const a = measureTrack('t', 'file', [0, 10], { cache, decode, lead });
  const b = measureTrack('t', 'file', [0, 10], { cache, decode, lead });
  measureTrack('t', 'file', [5, 20], { cache, decode, lead });
  assert.deepEqual(a, b);
  assert.deepEqual(calls, [[1, 10], [11, 10]], 'the lead offsets the decode; blocks already held are not decoded again');
  assert.equal(measureTrack('x', 'file', [0, 5], { cache: {}, decode: () => { throw new Error('no'); }, lead }), null, 'fails open');
  assert.equal(sectionFit([]), null);
  assert.equal(analyseBands(new Float32Array(0)).length, 0);
});

test('bands measured with ffmpeg: bass-only reads as unplayable on a phone, midrange as dense', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const dir = tmp();
  const make = (name: string, f: number) => {
    const out = path.join(dir, name);
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=12`, out]).status, 0);
    return out;
  };
  const bass = measureTrack('bass', make('bass.wav', 60), [0, 10], {})!;
  const mid = measureTrack('mid', make('mid.wav', 1000), [0, 10], {})!;
  assert.ok(bass.phone < -20, `bass phone ${bass.phone}`);
  assert.ok(mid.speech > -1 && isDense(mid), `mid speech ${mid.speech}`);
});

test('loudness measures the section it is given', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const out = path.join(tmp(), 'two.wav');
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=500:duration=20', '-af', "volume='if(lt(t,10),0.02,0.5)':eval=frame", out]).status, 0);
  const quiet = loudness(out, [1, 9])!;
  const loud = loudness(out, [11, 19])!;
  assert.ok(loud - quiet > 20, `${quiet} vs ${loud}`);
});

// ── Music: rotation (MD-144) ──────────────────────────────────────────────

const cand = (id: string, score: number) => ({ id, score });

test('rotation: a 1 or 2 song reel repeats nothing from the last 4 reels, even a stronger song', () => {
  const acts = [{ candidates: [cand('old', 0.9), cand('new1', 0.5)] }, { candidates: [cand('new2', 0.4), cand('old2', 0.9)] }];
  const { picks } = chooseTracks(acts, { recent: ['old', 'old2'] });
  assert.deepEqual(picks.map((p) => p.id), ['new1', 'new2']);
});

test('rotation: a 3 song reel may repeat one when it beats the best fresh option, the strongest gain taking the slot', () => {
  const acts = [
    { candidates: [cand('a-old', 0.7), cand('a-new', 0.6)] },
    { candidates: [cand('b-old', 0.9), cand('b-new', 0.3)] },
    { candidates: [cand('c-new', 0.5)] },
  ];
  const { picks, notes } = chooseTracks(acts, { recent: ['a-old', 'b-old'] });
  assert.deepEqual(picks.map((p) => p.id), ['a-new', 'b-old', 'c-new'], 'a second repeat is refused');
  assert.equal(picks[1].repeat, true);
  assert.equal(picks.filter((p) => p.repeat).length, 1);
  assert.deepEqual(notes, []);
});

test('rotation: no repeat when fresh is at least as strong', () => {
  const { picks } = chooseTracks([{ candidates: [cand('old', 0.5), cand('new', 0.5)] }, { candidates: [cand('n2', 1)] }, { candidates: [cand('n3', 1)] }], { recent: ['old'] });
  assert.deepEqual(picks.map((p) => p.id), ['new', 'n2', 'n3']);
});

test('rotation: a song from the fifth reel back is free again', () => {
  let h = { used: 0, recent: [] as string[], reels: [] as { job: string | null; ids: string[] }[] };
  for (const [job, ids] of [['j1', ['fifth']], ['j2', ['b']], ['j3', ['c']], ['j4', ['d']], ['j5', ['e']]] as const) h = withReel(h, job, [...ids]);
  assert.deepEqual(recentIds(h), ['b', 'c', 'd', 'e']);
  assert.equal(h.used, 5);
  const { picks } = chooseTracks([{ candidates: [cand('fifth', 0.9), cand('other', 0.2)] }], { recent: recentIds(h) });
  assert.equal(picks[0].id, 'fifth');
  assert.ok(!picks[0].repeat);
});

test('rotation: when the pool truly runs out the least recently used plays and nothing fails', () => {
  const { picks, notes } = chooseTracks([{ candidates: [cand('newest', 0.9), cand('oldest', 0.1)] }], { recent: ['oldest', 'middle', 'newest'] });
  assert.equal(picks[0].id, 'oldest');
  assert.match(notes[0], /least recently used/);
  const three = chooseTracks([{ candidates: [cand('x', 1)] }, { candidates: [cand('y', 1), cand('x', 2)] }, { candidates: [cand('z', 1), cand('y', 2)] }], { recent: ['x', 'y', 'z'] });
  assert.equal(new Set(three.picks.map((p) => p.id)).size, 3, 'a reel never uses one track twice while another is left');
});

test('a job re-placing its music neither counts twice nor avoids its own tracks', () => {
  let h = withReel({ used: 0, recent: [], reels: [] }, 'j1', ['a']);
  h = withReel(h, 'j1', ['b']);
  assert.equal(h.used, 1);
  assert.deepEqual(recentIds(h), ['b']);
  assert.deepEqual(recentIds(h, 'j1'), []);
});

test('history flows from one job to the next, through the workspace file and the kit, without measuring', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const base = tmp();
  const jobsRoot = path.join(base, 'jobs');
  const project = (job: string) => {
    const root = path.join(jobsRoot, job, 'render', 'project');
    fs.mkdirSync(root, { recursive: true });
    fs.writeFileSync(path.join(root, 'STORYBOARD.md'), '# Storyboard\n\n## Frame 1 — one\n- duration: 12\n- music: start\n');
    fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ voices: [], sfx: [] }));
    fs.writeFileSync(path.join(root, 'music-avoid.json'), JSON.stringify({ ...readMusicHistory(jobsRoot), ledger: musicHistoryPath(jobsRoot), job }));
    return root;
  };
  const search = async () => ['t1', 't2', 't3'].map((id) => ({ id, name: 'tense bed', audio_url: `sine:${id}`, duration: 30 }));
  const download = async (_u: string, dest: string) => {
    assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=30', '-ac', '2', dest]).status, 0);
  };
  const measure = async () => null;
  const first = await placeMusic(project('job-a'), { search, download, measure });
  assert.ok(first.ok, first.errors.join(';'));
  assert.deepEqual(first.choice!.ids, ['t1']);
  assert.deepEqual(readMusicHistory(jobsRoot).reels, [{ job: 'job-a', ids: ['t1'] }], 'written the moment it chose');
  const second = await placeMusic(project('job-b'), { search, download, measure });
  assert.deepEqual(second.choice!.ids, ['t2'], 'the next job sees it');
  // A second run started before job-a chose still sees its pick: the ledger is read at pick time.
  const stale = project('job-c');
  fs.writeFileSync(path.join(stale, 'music-avoid.json'), JSON.stringify({ used: 0, recent: [], ledger: musicHistoryPath(jobsRoot), job: 'job-c' }));
  const third = await placeMusic(stale, { search, download, measure });
  assert.deepEqual(third.choice!.ids, ['t3']);
  assert.ok(!fs.existsSync(`${musicHistoryPath(jobsRoot)}.lock`));
  // Same job again: its own track stays open to it, and the reel still counts once.
  fs.rmSync(path.join(stale, 'assets'), { recursive: true });
  const again = await placeMusic(stale, { search, download, measure });
  assert.deepEqual(again.choice!.ids, ['t3']);
  assert.equal(readMusicHistory(jobsRoot).used, 3);
});

test('a fresh history file is seeded from past jobs, so old reels count', () => {
  const jobsRoot = path.join(tmp(), 'jobs');
  const bgm = path.join(jobsRoot, 'old-job', 'render', 'project', 'assets', 'bgm');
  fs.mkdirSync(bgm, { recursive: true });
  fs.writeFileSync(path.join(bgm, 'choice.json'), JSON.stringify({ ids: ['p', 'q'] }));
  assert.deepEqual(readMusicHistory(jobsRoot).reels, [{ job: 'old-job', ids: ['p', 'q'] }]);
});

test('sound library helper still builds from the repo catalogs', () => {
  const lib = soundLibrary(tmp());
  assert.ok(lib.stingers.hit.length && lib.ambience.length);
});
