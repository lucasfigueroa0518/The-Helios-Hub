/**
 * Explainers 3.0/3.1 world kit (EX3-50 to EX3-53, EX3-60 to EX3-75), offline. The kit's core is
 * DOM-free math (ported from Explainer 2.0's tests); the frame, pace, mount, try, sound and
 * opener-sound tools run on a scratch project. No model, no HeyGen, no browser.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as HX from '../explainers/world-kit/core.js';
import { parseFrames, seconds } from '../explainers/world-kit/frames.mjs';
import { HERSHEY_SANS } from '../explainers/world-kit/hershey-sans.js';
import { darkWindows, fillCaptionGrounds, frameHtml, mountFrames, quietWindows } from '../explainers/world-kit/mount.mjs';
import { hasOpenerSfx, OPENER_SFX, openerEntries, placeOpenerSfx, withOpenerSfx } from '../explainers/world-kit/opener-sfx.mjs';
import {
  CLOSE_DURATION,
  END_HOLD,
  OPENER_LEAD,
  OPENER_TEMPO,
  HOLD,
  TAIL,
  detectSilences,
  holdFor,
  keepFilter,
  lostSound,
  pace,
  pacedStoryboard,
  parseSilences,
  shiftWords,
  silenceCuts,
  speechRuns,
  tightenVoices,
} from '../explainers/world-kit/pace.mjs';
import {
  KINDS,
  MAX_DUR,
  OUT as EVENTS_TRACK,
  eventProblems,
  eventsToCues,
  findSfx,
  foleyQuery,
  mixArgs,
  placeSound,
  resolveCues,
  tagCounts,
  withEventsTrack,
} from '../explainers/world-kit/sound.mjs';

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;
const KIT = path.join(process.cwd(), 'explainers', 'world-kit');
const FIXTURE = path.join(process.cwd(), 'explainers', 'smoke', 'fixture');
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;

const SFX = path.join(process.cwd(), 'explainers', 'design', 'sfx');
const CATALOG = JSON.parse(fs.readFileSync(path.join(SFX, 'catalog.json'), 'utf8')) as { id: string; file: string; tags: string[]; duration: number; pack: string; group: string; peakDb: number }[];

/**
 * A scratch project as a job gets it: the kit, the opener sounds, the sound library linked, and
 * the smoke fixture (storyboard, world, three frames with their events).
 */
function project(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-kit-'));
  fs.cpSync(KIT, path.join(root, 'assets', 'kit'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'sfx'), { recursive: true });
  for (const file of ['riser.mp3', 'impact-bass-1.mp3']) fs.copyFileSync(path.join(SFX, file), path.join(root, 'assets', 'sfx', file));
  fs.symlinkSync(SFX, path.join(root, 'assets', 'sfx-library'), 'dir');
  fs.cpSync(FIXTURE, root, { recursive: true });
  return root;
}

// ── Core math (from Explainer 2.0) ──────────────────────────────────────────

test('every polarity starts at 0; all but reverse end at 1 (V-8)', () => {
  for (const name of Object.keys(HX.POLARITY)) {
    const f = HX.polarity(name);
    assert.ok(near(f(0), 0), `${name}(0)`);
    assert.ok(near(f(1), name === 'reverse' ? 0 : 1, 1e-9), `${name}(1)`);
  }
  assert.ok(HX.polarity('slam')(0.2) > 0.75);
  assert.ok(HX.polarity('ramp-up')(0.5) < 0.2);
  assert.throws(() => HX.polarity('bouncy'), /unknown polarity "bouncy"/);
});

test('the calm camera refuses big zooms, roll past 3°, and tilt (V-7)', () => {
  assert.throws(() => HX.validateLegs([{ at: 0, dur: 1, to: { rot: 4 }, polarity: 'slam' }], 2), /roll stays within 3/);
  assert.throws(() => HX.validateLegs([{ at: 0, dur: 1, to: { tilt: 5 }, polarity: 'slam' }], 2), /no perspective tilt/);
  assert.throws(() => HX.validateLegs([{ at: 0, dur: 1, to: { zoom: 1.5 }, polarity: 'glide' }], 2), /within 1.2/);
});

test('colors are palette tokens; the grounds are paper, night, forest, and white for the close', () => {
  assert.equal(HX.tok('paper'), '#F3F0EA');
  assert.throws(() => HX.mix('orange', '#00FF00', 0.5), /unknown token/);
  assert.deepEqual(Object.keys(HX.GROUNDS), ['paper', 'night', 'forest', 'white']);
  assert.equal(HX.GROUNDS.white.fill, '#FFFFFF');
});

test('kit code draws only in palette colors (V-T1, V-16)', () => {
  const allowed = new Set([...Object.values(HX.TOKENS), ...Object.values(HX.GROUNDS).map((x: { fill: string }) => x.fill)].map((c: string) => c.toUpperCase()));
  for (const f of fs.readdirSync(KIT).filter((x) => x.endsWith('.js') && x !== 'core.js')) {
    const hexes = fs.readFileSync(path.join(KIT, f), 'utf8').match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
    for (const h of hexes) assert.ok(allowed.has(h.toUpperCase()), `${f} uses ${h}, which is not a palette token`);
  }
});

test('the isometric projection and the stop-motion clock (V-2, V-15)', () => {
  const P = HX.iso(500, 400, 2);
  assert.deepEqual(P(0, 0, 0), [500, 400]);
  assert.deepEqual(P(0, 0, 10), [500, 380]);
  assert.equal(HX.onTwos(0.066), 0, 'a pose holds for two 30 fps frames');
  assert.equal(HX.boilSeed(0.05), HX.boilSeed(0.65), 'six drawings, then it repeats');
});

test('frame.md carries the kit palette, and the recipe copy matches the preset', () => {
  const frame = fs.readFileSync(path.join(process.cwd(), 'explainers', 'frame-presets', 'helios', 'FRAME.md'), 'utf8');
  for (const [name, hex] of Object.entries(HX.TOKENS)) assert.ok(frame.includes(`${name}: "${hex}"`), `FRAME.md lacks ${name}`);
  const recipe = fs.readFileSync(path.join(process.cwd(), 'explainers', 'recipe', 'frame.md'), 'utf8');
  assert.equal(recipe, frame, 'the recipe copy of frame.md is the preset');
});

// ── Frames, mount, captions ─────────────────────────────────────────────────

test('frames: ids, durations, and fields come from STORYBOARD.md', () => {
  const frames = parseFrames(fs.readFileSync(path.join(FIXTURE, 'STORYBOARD.md'), 'utf8'));
  assert.deepEqual(frames.map((f) => [f.number, f.id, f.duration, f.fields.ground, f.fields.hold]), [
    [1, '01-opener', 3.496, 'paper', '0.15s'],
    [2, '02-scene', 6.458, 'night', '0.15s'],
    [3, '03-define', 8.264, 'paper', '0.15s'],
    [8, '08-close', 2.5, 'white', undefined],
  ]);
  assert.equal(seconds('4.2 s'), 4.2);
  assert.ok(Number.isNaN(seconds('soon')));
});

test('mount: one clock, the storyboard ground on a clip layer, ids that never start with a digit', () => {
  const html = frameHtml('04-analogy', 9, 'night');
  assert.match(html, /data-composition-id="04-analogy"/);
  assert.match(html, /data-duration="9"/);
  assert.match(html, /<div id="f04_analogy-ground" class="clip" data-start="0" data-duration="9" data-track-index="0"><\/div>/);
  assert.match(html, /import scene from '\.\/assets\/frames\/04-analogy\.js';/);
  assert.match(html, /underlay\('uf04_analogy-', 'night'\)/);
  assert.match(html, /tl\.fromTo\(clock, \{ t: 0 \}, \{ t: 9, duration: 9, ease: 'none'/);
  assert.match(html, /window\.__timelines\['04-analogy'\] = tl;/);
  assert.throws(() => frameHtml('04-analogy', 9, 'blue'), /ground "blue"/);
  assert.throws(() => frameHtml('Bad Id', 9), /lowercase/);
});

test('mount writes every frame with a module and fills the caption skin with the dark windows', () => {
  const root = project();
  const storyboard = path.join(root, 'STORYBOARD.md');
  fs.writeFileSync(storyboard, fs.readFileSync(storyboard, 'utf8').replace('- src: compositions/frames/01-opener.html\n- ground: paper', '- src: compositions/frames/01-opener.html\n- ground: night'));
  fs.mkdirSync(path.join(root, '.hyperframes'), { recursive: true });
  fs.copyFileSync(path.join(process.cwd(), 'explainers', 'frame-presets', 'helios', 'caption-skin.html'), path.join(root, '.hyperframes', 'caption-skin.html'));
  const result = mountFrames(root);
  assert.deepEqual(result, { mounted: ['01-opener', '02-scene', '03-define', '08-close'], skipped: [], errors: [], darkWindows: [[0, 9.954]] });
  assert.ok(fs.existsSync(path.join(root, 'compositions', 'frames', '01-opener.html')));
  const skin = fs.readFileSync(path.join(root, '.hyperframes', 'caption-skin.html'), 'utf8');
  assert.match(skin, /^\s+var DARK = \[\[0,9\.954\]\];$/m);
  // Captions step aside for the title card (all of frame 1), the dictionary card (frame 3), and the close.
  assert.match(skin, /^\s+var QUIET = \[\[0,3\.496\],\[9\.954,18\.218\],\[18\.218,20\.718\]\];$/m);
  assert.match(skin, /`var DARK = \[\];` \(the\s+dark-ground windows\)/, 'the comment is left alone');
  assert.match(skin, /`var QUIET = \[\];` \(the title card/, 'the comment is left alone');
  assert.deepEqual(fillCaptionGrounds(fs.mkdtempSync(path.join(os.tmpdir(), 'no-skin-'))), null);
});

test('dark windows merge back-to-back dark frames', () => {
  const f = (duration: number, ground: string) => ({ duration, fields: { ground } });
  assert.deepEqual(darkWindows([f(4, 'paper'), f(5, 'night'), f(5, 'forest'), f(9, 'paper'), f(3, 'white')] as never), [[4, 14]]);
});

// ── try ─────────────────────────────────────────────────────────────────────

test('try runs the world and every frame module in Node and reports problems by frame', () => {
  const root = project();
  const tryAll = () => spawnSync(process.execPath, ['assets/kit/try.mjs', 'all'], { cwd: root, encoding: 'utf8' });
  const ok = tryAll();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout), { ok: true, errors: [] });

  fs.writeFileSync(
    path.join(root, 'assets', 'frames', '02-scene.js'),
    "export default { ground: 'paper', draw(t) { return '<rect width=\"' + (t > 1 ? undefined : 1) + '\"/>'; } };",
  );
  fs.writeFileSync(path.join(root, 'assets', 'frames', '03-define.events.json'), JSON.stringify([{ t: 99, kind: 'foley', what: 'stamp' }, { t: 1, kind: 'thud' }, { t: 2, kind: 'foley' }]));
  fs.rmSync(path.join(root, 'assets', 'frames', '01-opener.events.json'));
  const bad = tryAll();
  assert.equal(bad.status, 1);
  const errors = JSON.parse(bad.stdout).errors as string[];
  const has = (re: RegExp) => assert.ok(errors.some((e) => re.test(e)), `${re}\n${errors.join('\n')}`);
  has(/^02-scene:.*does not match the storyboard's ground "night"/);
  has(/^01-opener:.*events/);
  has(/^03-define: event 0: t must be a number from 0 to 8\.264/);
  has(/^03-define: event 1: kind "thud"/);
  has(/^03-define: event 2: a foley event needs "what"/);
});

test('try: the opener draws the title card, frame 3 the dictionary card, and long scene frames cut between shots', () => {
  const root = project();
  const tryAll = () => spawnSync(process.execPath, ['assets/kit/try.mjs', 'all'], { cwd: root, encoding: 'utf8' });
  const opener = path.join(root, 'assets', 'frames', '01-opener.js');
  fs.writeFileSync(opener, fs.readFileSync(opener, 'utf8').replace('+ titleCard(t,', "+ ((..._a) => '')(t,"));
  const define = path.join(root, 'assets', 'frames', '03-define.js');
  fs.writeFileSync(define, fs.readFileSync(define, 'utf8').replace('+ dictionaryCard(t,', "+ ((..._a) => ({ svg: '' }))(t,"));
  const scene = path.join(root, 'assets', 'frames', '02-scene.js');
  fs.writeFileSync(scene, fs.readFileSync(scene, 'utf8').replace('  ground: GROUND,\n  shots,\n', '  ground: GROUND,\n'));
  const errors = JSON.parse(tryAll().stdout).errors as string[];
  assert.ok(errors.some((e) => /^01-opener:.*title card/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /^03-define:.*dictionary card/.test(e)), errors.join('\n'));
  assert.ok(errors.some((e) => /^02-scene: export `shots`/.test(e)), errors.join('\n'));
});

// ── Handwriting (EX3-61) ────────────────────────────────────────────────────

test('handwrite draws Hershey Sans strokes that reveal in order and measure their width', async () => {
  // draw.js imports perfect-freehand from the CDN; try.mjs stubs it for Node.
  await import('../explainers/world-kit/try.mjs');
  const { handwrite, handwriteWidth, scope } = await import('../explainers/world-kit/draw.js');
  scope('t-', 'paper');
  assert.ok(Object.keys(HERSHEY_SANS).length >= 90, 'printable ASCII');
  assert.equal(handwrite('hello', 100, 500, 60, 0), '<g data-k="text" data-text="hello" filter="url(#t-wobble)"></g>', 'tagged for bounds.mjs (EX3-92)');
  const half = handwrite('hello', 100, 500, 60, 0.5, { role: 'title' });
  const full = handwrite('hello', 100, 500, 60, 1, { role: 'title' });
  assert.match(full, /data-role="title"/);
  assert.ok((full.match(/<path/g) ?? []).length > (half.match(/<path/g) ?? []).length);
  assert.ok(!/NaN|undefined/.test(full));
  const w = handwriteWidth('prompt caching', 74);
  assert.ok(w > 400 && w < 900, `${w}`);
  assert.equal(handwriteWidth('', 74), 0);
});

// ── Pacing (EX3-60, EX3-79) ─────────────────────────────────────────────────

test('holds: 0.15s after each line (0.2s of silence with the tail), at most that; a legacy voiced close keeps 1s', () => {
  assert.equal(TAIL + HOLD, 0.2);
  assert.equal(holdFor(1, NaN), HOLD);
  assert.equal(holdFor(2, 1.8), HOLD);
  assert.equal(holdFor(4, 0.1), 0.1);
  assert.equal(holdFor(8, 0.1), END_HOLD);
  assert.equal(holdFor(9, NaN), HOLD);
});

test('silences are read from silencedetect, clicks between two silences merged, speech runs between them', () => {
  const log = [
    '[silencedetect @ 0x1] silence_start: 0',
    '[silencedetect @ 0x1] silence_end: 0.09 | silence_duration: 0.09',
    '[silencedetect @ 0x1] silence_start: 1.2',
    '[silencedetect @ 0x1] silence_end: 1.6 | silence_duration: 0.4',
    '[silencedetect @ 0x1] silence_start: 1.61', // a 10 ms click: one silence
    '[silencedetect @ 0x1] silence_end: 1.8 | silence_duration: 0.19',
    '[silencedetect @ 0x1] silence_start: 2.9',
  ].join('\n');
  const silences = parseSilences(log, 3.1);
  assert.deepEqual(silences, [[0, 0.09], [1.2, 1.8], [2.9, 3.1]]);
  assert.deepEqual(speechRuns(silences, 3.1), [[0.09, 1.2], [1.8, 2.9]]);
});

test('tightening cuts only measured silence: inner 0.15s, 0.2s at a sentence end, the tail to 0.05s; the lead-in stays', () => {
  const words = [
    { text: 'a', start: 0.1, end: 0.3 },
    { text: 'b.', start: 0.4, end: 0.6 },
    { text: 'c', start: 1.1, end: 1.4 },
    { text: 'd', start: 2.0, end: 2.2 },
  ];
  // The timestamps show gaps after "a" (0.1s), "b." (0.5s) and "c" (0.6s), but the waveform is
  // silent only after "b." and "c" and at the ends.
  const silences = [[0, 0.08], [0.62, 1.12], [1.43, 1.98], [2.25, 2.5]];
  const cuts = silenceCuts(words, 2.5, silences);
  assert.deepEqual(cuts, [[0.72, 1.02], [1.505, 1.905], [2.3, 2.5]]);
  for (const [from, to] of cuts) assert.ok(silences.some(([s, e]) => from >= s && to <= e), `${from}-${to} is inside a silence`);
  // A gap the timestamps show but the audio does not have is never cut.
  assert.deepEqual(silenceCuts(words, 2.5, []), []);
  // Words shift with the cuts, and a start inside a silence snaps to the real onset.
  const late = [{ text: 'x', start: 0.3, end: 0.6 }, { text: 'y.', start: 1.0, end: 1.2 }];
  const shifted = shiftWords(late, [[0.6, 0.9]], [[0.5, 1.1]]);
  assert.deepEqual(shifted, [{ text: 'x', start: 0.3, end: 0.5 }, { text: 'y.', start: 0.8, end: 0.9 }]);
  const { filter, kept } = keepFilter(cuts, 2.5);
  assert.equal(kept, 1.6);
  assert.match(filter, /atrim=start=0\.0000:end=0\.7200/);
  assert.match(filter, /concat=n=3:v=0:a=1\[out\]$/);
});

test('the guard: a tightened voice must keep every stretch of speech, one for one', () => {
  assert.equal(lostSound([[0.1, 1], [1.4, 2]], [[0.1, 1], [1.25, 1.85]]), null);
  assert.match(lostSound([[0.1, 1], [1.4, 2]], [[0.1, 1.7]]) ?? '', /2 stretches of speech became 1/);
  assert.match(lostSound([[0.1, 1], [1.4, 2]], [[0.1, 0.9], [1.3, 1.9]]) ?? '', /speech 1 ran 0\.900s and now 0\.800s/);
});

test('a real voice with wrong timestamps loses no sound when tightened', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-pace-'));
  fs.mkdirSync(path.join(root, 'assets', 'voice'), { recursive: true });
  // Four "words" (tones) with real silences of 0.6s, 0.05s (too short to touch) and 0.45s.
  const wav = path.join(root, 'assets', 'voice', '01.wav');
  const parts = [['tone', 0.5], ['gap', 0.6], ['tone', 0.4], ['gap', 0.05], ['tone', 0.5], ['gap', 0.45], ['tone', 0.3], ['gap', 0.4]] as const;
  const inputs = parts.flatMap(([kind, d]) => ['-f', 'lavfi', '-t', String(d), '-i', kind === 'tone' ? 'sine=frequency=330:sample_rate=44100' : 'anullsrc=r=44100:cl=mono']);
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${parts.map((_, i) => `[${i}:a]aformat=channel_layouts=mono[a${i}]`).join(';')};${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1[o]`, '-map', '[o]', wav]);
  assert.equal(r.status, 0, String(r.stderr));
  // Timestamps run off: "one." late, "two" early (inside the silence before it), and a gap is
  // claimed inside the third tone, where a timestamp-placed cut would clip it.
  const words = [
    { text: 'one.', start: 0.12, end: 0.62 },
    { text: 'two', start: 1.0, end: 1.4 },
    { text: 'three', start: 1.7, end: 2.12 },
    { text: 'four.', start: 2.62, end: 2.92 },
  ];
  const meta = { voices: [{ frame: 2, path: 'assets/voice/01.wav', duration_s: 3.2, words }] }; // not the opener
  const result = tightenVoices(root, meta);
  assert.deepEqual(result.errors, []);
  assert.equal((result.removed[0] as { fallback?: string }).fallback, undefined);
  const after = detectSilences(wav, meta.voices[0].duration_s);
  const runs = speechRuns(after, meta.voices[0].duration_s).map(([a, b]) => Math.round((b - a) * 100) / 100);
  // Every tone is whole, and the 0.05s gap is untouched.
  assert.deepEqual(runs, [0.5, 0.4, 0.5, 0.3]);
  // The two long silences were cut to 0.2 (after "one.") and 0.15, the tail to 0.05.
  assert.ok(Math.abs(meta.voices[0].duration_s - (0.5 + 0.2 + 0.4 + 0.05 + 0.5 + 0.15 + 0.3 + 0.05)) < 0.02, String(meta.voices[0].duration_s));
  // "two" snapped from 1.0 to its real onset (1.1), then moved 0.4s earlier with the cut.
  assert.ok(Math.abs(meta.voices[0].words[1].start - 0.7) < 0.02, JSON.stringify(meta.voices[0].words[1]));
});

test('the opener starts on frame 0, 20% faster, pitch kept (EX3-99)', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'explainers-opener-'));
  fs.mkdirSync(path.join(root, 'assets', 'voice'), { recursive: true });
  const wav = path.join(root, 'assets', 'voice', '01.wav');
  // A 0.3s lead-in, then 1.2s of "speech", then 0.3s of tail.
  const parts = [['gap', 0.3], ['tone', 1.2], ['gap', 0.3]] as const;
  const inputs = parts.flatMap(([kind, d]) => ['-f', 'lavfi', '-t', String(d), '-i', kind === 'tone' ? 'sine=frequency=330:sample_rate=44100' : 'anullsrc=r=44100:cl=mono']);
  assert.equal(spawnSync('ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${parts.map((_, i) => `[${i}:a]aformat=channel_layouts=mono[a${i}]`).join(';')};${parts.map((_, i) => `[a${i}]`).join('')}concat=n=${parts.length}:v=0:a=1[o]`, '-map', '[o]', wav]).status, 0);
  const meta = { voices: [{ frame: 1, path: 'assets/voice/01.wav', duration_s: 1.8, words: [{ text: 'In', start: 0.3, end: 0.5 }, { text: 'concept.', start: 1.2, end: 1.5 }] }] };
  const result = tightenVoices(root, meta);
  assert.deepEqual(result.errors, []);
  assert.equal((result.removed[0] as { tempo?: number }).tempo, OPENER_TEMPO);
  const v = meta.voices[0];
  // The speech starts on frame 0 (a 0.02s lead-in kept), and the line runs 20% faster.
  const first = detectSilences(wav, v.duration_s);
  assert.ok(!first.length || first[0][0] > 0.01 || first[0][1] <= OPENER_LEAD + 0.03, JSON.stringify(first));
  assert.ok(Math.abs(v.duration_s - (OPENER_LEAD + 1.2 + TAIL) / OPENER_TEMPO) < 0.03, String(v.duration_s));
  assert.ok(Math.abs(v.words[0].start - OPENER_LEAD / OPENER_TEMPO) < 0.01, JSON.stringify(v.words[0]));
});

test('pace makes each frame its voice plus its hold, idempotently, and writes the timing files', () => {
  const storyboard = fs.readFileSync(path.join(FIXTURE, 'STORYBOARD.md'), 'utf8');
  const voices = [{ frame: 1, duration_s: 3.5 }, { frame: 2, duration_s: 5 }, { frame: 3, duration_s: 6.2 }];
  const once = pacedStoryboard(storyboard, voices);
  assert.deepEqual(once.paced, [
    { frame: 1, voice: 3.5, hold: 0.15, duration: 3.65 },
    { frame: 2, voice: 5, hold: 0.15, duration: 5.15 },
    { frame: 3, voice: 6.2, hold: 0.15, duration: 6.35 },
    { frame: 8, voice: 0, hold: 2.5, duration: 2.5 }, // the voiceless close (EX3-95)
  ]);
  assert.match(once.storyboard, /- duration: 3\.65s\n- voice_end: 3\.5s/);
  assert.equal(pacedStoryboard(once.storyboard, voices).storyboard, once.storyboard, 'idempotent');
  assert.equal((once.storyboard.match(/voice_end:/g) ?? []).length, 3, 'the close has none');

  const root = project();
  fs.writeFileSync(
    path.join(root, 'audio_meta.json'),
    JSON.stringify({ voices: voices.map((v) => ({ ...v, words: [{ text: 'in', start: 0.1, end: 0.3 }, { text: ' ', start: 0.3, end: 0.3 }] })), sfx: [] }),
  );
  const result = pace(root, { tighten: false });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.total, 17.65);
  const timing = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'timing', '02-scene.json'), 'utf8'));
  assert.deepEqual(timing, { frame: 2, id: '02-scene', duration: 5.15, voice_end: 5, hold: 0.15, words: [{ text: 'in', start: 0.1, end: 0.3 }] });
});

test('quiet windows: all of frame 1 (the title card), all of frame 3, and the close', () => {
  const f = (number: number, duration: number) => ({ number, duration, fields: {} });
  assert.deepEqual(quietWindows([f(1, 3.5), f(2, 6), f(3, 7), f(4, 12)] as never), [[0, 3.5], [9.5, 16.5]]);
  assert.deepEqual(quietWindows([f(2, 6)] as never), []);
  // The voiceless close is quiet too (EX3-95); a legacy voiced frame 8 is not.
  assert.deepEqual(quietWindows([f(7, 6), { number: 8, duration: 2.5, fields: {} }] as never), [[6, 8.5]]);
  assert.deepEqual(quietWindows([f(7, 6), { number: 8, duration: 4, fields: { voiceover: '"A line."' } }] as never), []);
});

test('the caption skin pages up to 7 words, types each word letter by letter across its spoken span, and has the quiet hole (EX3-45, EX3-98)', () => {
  const skin = fs.readFileSync(path.join(process.cwd(), 'explainers', 'frame-presets', 'helios', 'caption-skin.html'), 'utf8');
  assert.match(skin, /MAX_WORDS = 7/);
  assert.match(skin, /HOLD_AFTER = 1\.2/);
  assert.match(skin, /MIN_CHAR = 0\.025/);
  assert.match(skin, /c\.className = "caption-char"/);
  assert.match(skin, /tl\.set\(el, \{ opacity: 1 \}, at \+ \(span \* k\) \/ letters\.length\)/);
  assert.doesNotMatch(skin, /FADE/);
  assert.match(skin, /^\s+var QUIET = \[\];$/m);
  assert.match(skin, /\.caption-stage\.is-quiet\s*\{\s*visibility:\s*hidden/);
});

// ── Sound design (EX3-63, EX3-75) ───────────────────────────────────────────

test('the sound library: every catalog file exists, and the paper and pen set is tagged and credited', () => {
  const missing = CATALOG.filter((s) => !fs.existsSync(path.join(SFX, s.file)));
  assert.deepEqual(missing.map((s) => s.file), []);
  const paper = CATALOG.filter((s) => s.pack === 'freesound');
  assert.ok(paper.length >= 600, `${paper.length} paper and pen sounds`);
  assert.ok(paper.every((s) => s.tags.includes('freesound') && (s.tags.includes('sustain') || s.tags.includes('oneshot'))));
  for (const word of ['pencil', 'pen', 'marker', 'chalk', 'eraser', 'paper', 'page', 'crumple', 'tear', 'scissors', 'stapler', 'stamp', 'typewriter']) {
    assert.ok(paper.some((s) => s.tags.includes(word)), word);
  }
  assert.ok(paper.filter((s) => s.tags.includes('sustain')).length >= 40, 'continuous beds');
  const credits = fs.readFileSync(path.join(SFX, 'freesound', 'CREDITS.md'), 'utf8');
  assert.match(credits, /Creative Commons 0/);
  const sources = new Set(paper.map((s) => (s as { source?: string }).source));
  assert.ok(sources.size >= 200, `${sources.size} source recordings`);
  for (const source of sources) assert.ok(credits.includes(`(${source})`), `${source} is credited`);
});

test('foley words find the right family; stopwords and the other kinds stay out of it', () => {
  const counts = tagCounts(CATALOG);
  const pick = (what: string, extra: Record<string, unknown> = {}) => {
    const q = foleyQuery(what, counts)!;
    return findSfx(CATALOG, { ...q, not: ['sustain'], maxDur: 3.5, ...extra })?.group;
  };
  assert.equal(foleyQuery('the of and', counts), null);
  assert.equal(foleyQuery('zzqx', counts), null);
  assert.equal(pick('pen click'), 'freesound/pen-click');
  assert.equal(pick('rubber stamp'), 'freesound/stamp');
  assert.equal(pick('paper slide'), 'freesound/paper-slide');
  assert.equal(pick('sheet of paper lands on the desk'), 'freesound/paper-drop');
  assert.equal(pick('coins'), 'rpg-audio/handleCoins');
  assert.match(pick('footstep') ?? '', /footstep/);
  const bed = findSfx(CATALOG, { ...foleyQuery('pencil writing', counts)!, any: [...foleyQuery('pencil writing', counts)!.any, 'sustain'], minDur: 2 });
  assert.ok(bed?.tags.includes('sustain') && bed.duration >= 2, bed?.id);
  // The non-foley kinds never pick a paper or pen sound.
  for (const kind of ['impact', 'whoosh', 'tick', 'click', 'pop', 'sting'] as const) {
    const k = KINDS[kind];
    assert.ok(!findSfx(CATALOG, { all: k.all, any: k.any, not: k.not })?.tags.includes('freesound'), kind);
  }
});

test('events: checked, put on the reel clock, thinned, resolved, and sustained ones trimmed', () => {
  assert.deepEqual(eventProblems([{ t: 1, kind: 'foley', what: 'pen writing', dur: 1.2 }], 5), []);
  assert.match(eventProblems([{ t: 1, kind: 'pop', dur: 1 }], 5)[0], /"dur" is only for foley/);
  assert.match(eventProblems([{ t: 1, kind: 'foley', what: 'pen', dur: MAX_DUR + 1 }], 5)[0], /0\.2 to 8/);
  assert.match(eventProblems({} as never, 5)[0], /not a JSON array/);

  const frames = [{ id: 'a', start: 0 }, { id: 'b', start: 5 }];
  const { cues, dropped } = eventsToCues(
    frames,
    {
      a: [{ t: 1, kind: 'impact' }, { t: 1.2, kind: 'impact' }, { t: 2, kind: 'foley', what: 'zzqx' }],
      b: [{ t: 0.5, kind: 'foley', what: 'pencil writing', dur: 1.5 }, ...Array.from({ length: 8 }, (_, i) => ({ t: 2 + i * 0.1, kind: 'tick' }))],
    },
    CATALOG,
  );
  assert.deepEqual(dropped.map((d) => d.why), ['no library sound matches "zzqx"', 'within 0.4s of another impact', 'more than 6 small sounds in one second', 'more than 6 small sounds in one second']);
  assert.equal(cues.find((c) => c.kind === 'foley')?.t, 5.5);

  const { resolved, missing } = resolveCues(CATALOG, cues, { speech: [{ start: 5, end: 6 }] });
  assert.deepEqual(missing, []);
  const writing = resolved.find((r) => r.kind === 'foley')!;
  assert.ok(writing.sound.tags.includes('sustain'), writing.sound.id);
  assert.equal(writing.trim.len, 1.5);
  assert.ok(writing.trim.from >= 0 && writing.trim.from + 1.5 <= writing.sound.duration + 1e-9);
  assert.equal(writing.underSpeech, true);
  const args = mixArgs(resolved, 10, 'out.wav', '/lib').join(' ');
  assert.match(args, /atrim=start=[\d.]+:duration=1\.5,asetpts=PTS-STARTPTS/);
  assert.match(args, /amix=inputs=\d+:normalize=0/);

  const meta = withEventsTrack({ voices: [], sfx: [{ source: 'host', role: 'events', file: 'old' }, { source: 'host', role: 'opener-hit' }] }, 22);
  assert.deepEqual(meta.sfx.map((s: { role: string }) => s.role), ['opener-hit', 'events']);
  assert.deepEqual(meta.sfx[1], { frame: 1, file: EVENTS_TRACK, offset_s: 0, duration_s: 22, volume: 0.9, source: 'host', role: 'events' });
});

test('placing the sound mixes every frame\'s events into one track', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ voices: [], sfx: [] }));
  const result = placeSound(root);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(result.events, 32, 'the fixture frames and the close');
  assert.equal(result.placed, 32);
  assert.deepEqual(result.dropped, []);
  assert.ok(fs.existsSync(path.join(root, EVENTS_TRACK)));
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.equal(meta.sfx.at(-1).role, 'events');
});

// ── The opener's sound (EX3-24, EX3-53) ─────────────────────────────────────

test("the opener's riser ends on the cut and the hit lands on it", () => {
  const [riser, hit] = openerEntries(3.84);
  assert.deepEqual(riser, { frame: 1, file: OPENER_SFX.riser, offset_s: 0, duration_s: 3.84, volume: 0.45, source: 'host', role: 'opener-riser' });
  assert.deepEqual(hit, { frame: 1, file: OPENER_SFX.hit, offset_s: 3.84, duration_s: 2.12, volume: 0.6, source: 'host', role: 'opener-hit' });
  const meta = withOpenerSfx({ voices: [], sfx: [{ frame: 4, file: 'assets/sfx/x.mp3' }, { frame: 1, file: 'old', source: 'host', role: 'opener-riser' }] }, 4);
  assert.equal(meta.sfx.length, 3, 'an earlier opener entry is replaced, other cues kept');
  assert.ok(hasOpenerSfx(meta));
  assert.ok(!hasOpenerSfx({ sfx: [riser] }));
  assert.throws(() => openerEntries(0), /no duration/);
});

test('placing the opener sounds cuts the riser to the opener and writes audio_meta.json', { skip: !hasFfmpeg && 'ffmpeg is not installed' }, () => {
  const root = project();
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ voices: [{ frame: 1, words: [] }], sfx: [] }));
  const result = placeOpenerSfx(root);
  assert.equal(result.ok, true, result.errors.join('; '));
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.ok(hasOpenerSfx(meta));
  assert.deepEqual(meta.voices, [{ frame: 1, words: [] }]);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path.join(root, OPENER_SFX.riser)], { encoding: 'utf8' });
  assert.ok(Math.abs(Number(probe.stdout) - 3.496) < 0.1, `riser is ${probe.stdout.trim()}s`);
});

// ── Explainers 3.2: cards, shots, cast, props, music (EX3-77 to EX3-83) ─────

test('typeset breaks lines from measured widths; the cards carry their roles and the term', async () => {
  await import('../explainers/world-kit/try.mjs');
  const { scope } = await import('../explainers/world-kit/draw.js');
  const { textWidth, typeset, dictionaryCard, titleCard } = await import('../explainers/world-kit/cards.js');
  scope('c-', 'paper');
  assert.ok(textWidth('WWW', 40) > textWidth('iii', 40), 'real widths, not a per-letter guess');
  const words = 'An agent loop is the cycle an AI agent repeats until its goal is met.'.split(' ');
  const lines = typeset(words, { width: 400, size: 40 });
  assert.ok(lines.length >= 2);
  for (const l of lines) assert.ok(l.width <= 400 || l.words.length === 1, `line of ${l.width}px`);
  assert.deepEqual(lines.flatMap((l) => l.words), words.map((_, i) => i), 'every word once, in order');
  const card = dictionaryCard(9, { headword: 'agent loop', words: words.map((text, i) => ({ text, start: 0.2 + i * 0.3 })) });
  assert.match(card.svg, /data-role="definition"/);
  assert.match(card.svg, />agent loop</);
  assert.ok(card.bottom > 400 && card.bottom < 1000, `${card.bottom}`);
  // From the first frame (EX3-93): sliding in at once, landed by 0.25s, even when a worker asks for 0.6s.
  assert.equal(titleCard(0, { term: 'agent loop', to: 3 }), '', 'the first frame is its starting point');
  const early = titleCard(0.1, { term: 'agent loop', from: 0.6, to: 3 });
  assert.match(early, /data-role="title"/, 'already moving at 0.1s');
  assert.match(titleCard(0.3, { term: 'agent loop', to: 3 }), /opacity="1\.000"/, 'landed by 0.25s');
  const title = titleCard(3, { term: 'agent loop', from: 0.6, to: 3 });
  assert.match(title, /data-role="title"/);
  assert.ok(!/NaN|undefined/.test(title));
});

test('textBox sizes its shape around the measured text, wraps long text, and tags both for bounds.mjs (EX3-92)', async () => {
  await import('../explainers/world-kit/try.mjs');
  const { scope, handwriteWidth } = await import('../explainers/world-kit/draw.js');
  const { textBox, BOX_KINDS } = await import('../explainers/world-kit/cards.js');
  scope('b-', 'paper');
  assert.deepEqual(BOX_KINDS, ['speech', 'chat', 'note', 'sign', 'screen']);
  const short = textBox('happy to help!', 518, 1180, { kind: 'chat', size: 30 });
  assert.match(short.svg, /data-k="textbox"/);
  assert.match(short.svg, /data-k="shape"/);
  assert.match(short.svg, /data-text="happy to help!"/);
  // The box is centred on (x, y) and wider than the text by its padding on both sides.
  assert.ok(Math.abs(short.box.x + short.box.w / 2 - 518) < 0.01 && Math.abs(short.box.y + short.box.h / 2 - 1180) < 0.01);
  assert.ok(short.box.w >= handwriteWidth('happy to help!', 30) + 56 - 0.01, `${short.box.w}`);
  // Long text wraps (at most two lines) or shrinks, never wider than maxW.
  const long = textBox('your order ships tomorrow morning from our main warehouse', 540, 900, { kind: 'speech', size: 34, maxW: 420 });
  assert.ok(long.box.w <= 420 + 0.01, `${long.box.w}`);
  assert.equal((long.svg.match(/data-k="text"/g) ?? []).length, 2, 'two lines');
  const typed = textBox('refund policy?', 540, 900, { kind: 'screen', hand: false });
  assert.match(typed.svg, /<text data-k="text"[^>]*text-anchor="middle"[^>]*>refund policy\?<\/text>/);
  assert.throws(() => textBox('x', 0, 0, { kind: 'cloud' }), /textBox kind "cloud"/);
  for (const b of [short, long, typed]) assert.ok(!/NaN|undefined/.test(b.svg));
});

test('the close: the logo and AI BRAIN BREAK centred together, the words writing, fixed sounds, 2.5s (EX3-95)', async () => {
  await import('../explainers/world-kit/try.mjs');
  const close = (await import('../explainers/world-kit/close.js')).default;
  const { LOGO, WORDMARK, WORD_BASELINE } = await import('../explainers/world-kit/close.js');
  const { CLOSE, CLOSE_EVENTS } = await import('../explainers/world-kit/close-timing.js');
  assert.equal(CLOSE.duration, CLOSE_DURATION);
  assert.equal(close.ground, 'white');
  // The logo and the words, top of the logo to the words' baseline, are centred together.
  assert.equal(LOGO.cx, 540);
  assert.ok(Math.abs((LOGO.cy - LOGO.w / 2 + WORD_BASELINE) / 2 - 960) < 6, 'centred (to the visible circle and ink)');
  assert.ok(LOGO.cy < 960, 'the logo sits above the centre');
  assert.equal(WORDMARK, 'AI BRAIN BREAK');
  const start = close.draw(0.02);
  assert.match(start, /data-role="logo"/);
  assert.match(close.draw(1.0), /data-text="AI BRAIN BREAK"/);
  const end = close.draw(2.4);
  assert.match(end, new RegExp(`href="assets/Helios-logo\\.png" x="320" y="${LOGO.cy - LOGO.w / 2}" width="440" height="440"`));
  assert.ok((end.match(/<path/g) ?? []).length > (close.draw(1.0).match(/<path/g) ?? []).length, 'the words write on');
  assert.equal(end, close.draw(CLOSE.write[1] + 0.01), 'still after the writing ends');
  assert.deepEqual(CLOSE_EVENTS.map((e) => e.kind), ['whoosh', 'sting', 'foley', 'foley']);
  const pencil = CLOSE_EVENTS.find((e) => e.what === 'pencil writing');
  assert.equal(pencil?.t, CLOSE.write[0]);
  assert.ok(Math.abs((pencil?.dur ?? 0) - (CLOSE.write[1] - CLOSE.write[0])) < 1e-9, 'the pencil sounds exactly as long as the strokes');
  assert.deepEqual(eventProblems(CLOSE_EVENTS, CLOSE.duration), []);
});

test('pace makes the voiceless close 2.5s and writes its module and sounds', () => {
  const root = project();
  const sb = fs.readFileSync(path.join(root, 'STORYBOARD.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), `${sb}\n## Frame 8 — Close\n\n- duration: 2.5s\n- transition_in: cut\n- src: compositions/frames/08-close.html\n- type: branding\n- ground: white\n`);
  const voices = [1, 2, 3].map((frame) => ({ frame, duration_s: 3, words: [{ text: 'in', start: 0.1, end: 0.3 }] }));
  fs.writeFileSync(path.join(root, 'audio_meta.json'), JSON.stringify({ voices, sfx: [] }));
  const result = pace(root, { tighten: false });
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.deepEqual(result.frames.find((f: { frame: number }) => f.frame === 8), { frame: 8, voice: 0, hold: CLOSE_DURATION, duration: CLOSE_DURATION });
  assert.match(fs.readFileSync(path.join(root, 'STORYBOARD.md'), 'utf8'), /## Frame 8 — Close\n\n- duration: 2\.5s\n/);
  assert.match(fs.readFileSync(path.join(root, 'assets', 'frames', '08-close.js'), 'utf8'), /export \{ default \} from '\.\.\/kit\/close\.js'/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'assets', 'frames', '08-close.events.json'), 'utf8')).length, 4);
});

test('the bed is brought to one loudness every reel (EX3-94)', async () => {
  const { BED_LUFS, bedGain, FADE_OUT } = await import('../explainers/world-kit/music.mjs');
  assert.equal(BED_LUFS, -16.5);
  assert.equal(bedGain(-11.1), -5.4, 'the training bed: 5.4 dB down');
  assert.equal(bedGain(-16.6), 0.1);
  assert.equal(bedGain(-40), 6, 'a quiet track is raised at most 6 dB');
  assert.equal(bedGain(NaN), 0);
  assert.equal(FADE_OUT, CLOSE_DURATION, 'it fades out across the close');
});

test('bounds: text cut off by the frame edge, outside its box, or in a keep-out (EX3-92)', async () => {
  const { textProblems, summarize } = await import('../explainers/world-kit/bounds.mjs');
  const at = (rect: number[], extra: Record<string, unknown> = {}) => textProblems([{ label: 'happy to help!', role: null, rect, box: null, ...extra }]);
  assert.deepEqual(at([300, 900, 600, 960]), []);
  assert.deepEqual(at([-40, 900, 120, 960]), ['"happy to help!" is cut off by the frame edge']);
  assert.deepEqual(at([-400, 900, -100, 960]), [], 'out of the camera view entirely');
  assert.deepEqual(at([300, 900, 600, 960], { box: [320, 880, 640, 980] }), ['"happy to help!" runs outside its box (use textBox(); never place text in a shape by hand)']);
  assert.deepEqual(at([400, 192, 500, 237]), ['"happy to help!" is in the caption band (y < 570)']);
  assert.deepEqual(at([400, 192, 500, 237], { role: 'title' }), [], 'the title card lives there');
  assert.deepEqual(at([883, 865, 952, 985]), [], 'a glyph grazing the right keep-out');
  assert.deepEqual(at([692, 657, 1041, 741]), ['"happy to help!" is in the right keep-out (x > 940)']);
  assert.deepEqual(summarize([{ t: 4, problems: ['x'] }, { t: 4.2, problems: ['x'] }, { t: 5, problems: ['y'] }]), ['x at 4.0–4.2s', 'y at 5.0s']);
});

test('shots: the active shot, its camera centring the subject, and the rules', async () => {
  await import('../explainers/world-kit/try.mjs');
  const { shotAt, shotCamera, validateShots, SHOT_KINDS, SUBJECT_AT } = await import('../explainers/world-kit/shots.js');
  const shots = [{ at: 0, kind: 'wide', on: [500, 1100] }, { at: 3, kind: 'close', on: [700, 1000] }];
  assert.equal(shotAt(1, shots).i, 0);
  assert.equal(shotAt(3.2, shots).i, 1);
  const c = shotCamera(shots[1], 0);
  assert.equal(c.zoom, SHOT_KINDS.close.zoom);
  // cameraTransform maps p to 540 + zoom·(p − 540 − x): the subject lands on SUBJECT_AT.
  assert.ok(Math.abs(540 + c.zoom * (700 - 540 - c.x) - SUBJECT_AT[0]) < 1e-6);
  assert.deepEqual(validateShots(shots, 6.5), []);
  assert.ok(validateShots([{ at: 0, kind: 'wide' }], 7).some((e) => /at least 2 shots/.test(e)));
  assert.ok(validateShots([{ at: 0, kind: 'wide' }, { at: 5, kind: 'close' }], 7).some((e) => /cut by 4\.5s/.test(e)));
  assert.ok(validateShots([{ at: 0, kind: 'close', on: [1, 1] }, { at: 3, kind: 'close', on: [1, 1] }], 6).some((e) => /same picture/.test(e)));
  assert.ok(validateShots([{ at: 0, kind: 'dolly' }], 3).some((e) => /unknown kind/.test(e)));
  // A shot is only a camera (EX3-90): no over-the-shoulder, no reverse, no loose insert, no foreground layer.
  assert.deepEqual(Object.keys(SHOT_KINDS), ['wide', 'medium', 'close', 'insert', 'reaction']);
  assert.ok(validateShots([{ at: 0, kind: 'ots' }], 3).some((e) => /over-the-shoulder was removed in 3\.3: it draws a second copy of a critter/.test(e)));
  assert.ok(validateShots([{ at: 0, kind: 'reverse' }], 3).some((e) => /reverse was removed/.test(e)));
  assert.ok(validateShots([{ at: 0, kind: 'insert', zoom: 1.6 }], 3).some((e) => /an insert is a tight camera/.test(e)));
  assert.deepEqual(validateShots([{ at: 0, kind: 'insert' }], 3), []);
  const { shotFrame } = await import('../explainers/world-kit/shots.js');
  const { scope } = await import('../explainers/world-kit/draw.js');
  scope('s-', 'paper');
  assert.throws(() => shotFrame(1, [{ at: 0, kind: 'medium' }], () => ({ world: '<g></g>', front: '<g></g>' }) as never), /a shot never adds a foreground layer/);
  assert.ok(shotCamera({ at: 0, kind: 'ots' } as never, 0).zoom > 0, 'a removed kind still frames (validateShots names it)');
});

test('the cast check: a critter drawn twice at once, or vanishing mid-frame, is an error (EX3-90)', async () => {
  const { castProblems } = await import('../explainers/world-kit/try.mjs');
  const { critter } = await import('../explainers/world-kit/cast.js');
  assert.match(critter(0, 0, { who: 'hire' }), /^<g data-who="hire"/);
  const hire = '<g data-who="hire"></g>';
  const customer = '<g data-who="customer"></g>';
  const at = (t: number, svg: string) => ({ t, svg });
  assert.deepEqual(castProblems([at(0, hire + customer), at(0.1, hire + customer)]), []);
  // The 3.2 RAG over-the-shoulder shot: a second hire in the corner.
  assert.match(castProblems([at(3.4, hire + hire + customer)])[0], /"hire" is drawn 2 times at 3\.40s/);
  // The 3.2 RAG insert: the critters gone from 7.5s to 9.7s while the scene stayed.
  const vanished = castProblems([at(7.4, hire + customer), at(7.5, ''), at(9.6, ''), at(9.7, hire + customer)]);
  assert.equal(vanished.length, 2);
  assert.match(vanished[0], /"hire" vanishes at 7\.50s and comes back at 9\.70s/);
  // A one-sample blink, a critter that leaves for good, or one that arrives late is fine.
  assert.deepEqual(castProblems([at(1, hire), at(1.1, ''), at(1.2, hire)]), []);
  assert.deepEqual(castProblems([at(1, hire), at(2, ''), at(3, '')]), []);
  assert.deepEqual(castProblems([at(1, ''), at(2, hire)]), []);
});

test('critters: poses, moods, accessories, and hands that hold props', async () => {
  await import('../explainers/world-kit/try.mjs');
  const { scope } = await import('../explainers/world-kit/draw.js');
  const { critter, handAt, walk, ARM_POSES, MOODS, WEAR } = await import('../explainers/world-kit/cast.js');
  scope('k-', 'paper');
  for (const arms of Object.keys(ARM_POSES)) assert.ok(!/NaN|undefined/.test(critter(0, 0, { arms })), arms);
  for (const mood of Object.keys(MOODS)) assert.ok(!/NaN|undefined/.test(critter(0, 0, { mood })), mood);
  assert.ok(!/NaN|undefined/.test(critter(0, 0, { wear: WEAR })));
  const h = handAt(100, 500, { arms: 'reach', s: 2 });
  assert.deepEqual(h.r, [100 + 156 * 2, 500 - 98 * 2]);
  assert.deepEqual(handAt(100, 500, { arms: 'reach', s: 2, flip: true }).r, [100 - 156 * 2, 500 - 98 * 2]);
  const w = walk(0.2);
  assert.ok(w.legs.l === -w.legs.r && w.steps[0] > 0);
});

test('the prop library: every prop draws in every state, focal or not, with its name', async () => {
  await import('../explainers/world-kit/try.mjs');
  const { scope } = await import('../explainers/world-kit/draw.js');
  const { PROPS, prop, propNames } = await import('../explainers/world-kit/props.js');
  scope('p-', 'paper');
  assert.ok(propNames().length >= 45, `${propNames().length} props`);
  for (const name of propNames()) {
    for (const state of (PROPS as Record<string, { states: string[] }>)[name].states) {
      for (const focal of [false, true]) {
        const svg = prop(name, 500, 900, { state, focal });
        assert.ok(!/NaN|undefined/.test(svg), `${name} ${state}`);
        assert.match(svg, new RegExp(`data-prop="${name}"`));
      }
    }
  }
  assert.throws(() => prop('hand', 0, 0), /no prop "hand"/);
  assert.throws(() => prop('light switch', 0, 0, { state: 'dim' }), /has states off, on/);
});

test('music: banned moods and repeats are dropped, a long track wins, a short one loops', async () => {
  const { pickTrack, styleOrder, STYLES, BANNED } = await import('../explainers/world-kit/music.mjs');
  const t = (id: string, duration: number, description: string) => ({ id, duration, description, audio_url: `u/${id}` });
  const results = [t('a', 90, 'calm corporate piano'), t('b', 30, 'groovy funk bass'), t('c', 70, 'upbeat electronic synth'), t('d', 75, 'driving funk groove'), t('e', 80, 'funky groove')];
  assert.deepEqual(pickTrack(results, { total: 60 }), { track: results[3], loop: false });
  assert.deepEqual(pickTrack(results, { total: 60, avoid: ['d', 'e'] as never[] }), { track: results[1], loop: true });
  assert.equal(pickTrack([t('x', 15, 'funk')], { total: 60 }), null);
  assert.ok(BANNED.test('upbeat electronic instrumental') && !BANNED.test('energetic upbeat rock instrumental'));
  assert.deepEqual(styleOrder(4).map((s: { key: string }) => s.key), ['indie', 'hiphop', 'funk']);
  assert.ok(STYLES.every((s: { query: string }) => /105-128 BPM/.test(s.query)));
});
