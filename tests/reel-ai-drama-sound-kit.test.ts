import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import {
  BED_VOLUME, cueMusicPlan, DUCK_LIFT, ENV_RATE, envelopeWav, MAX_FACTOR, musicEnvelope, musicPlan, placeMusic, XFADE,
} from '../explainers/reel-ai-drama/kit/music.mjs';
import {
  frameClock, placeSound, readCues, resolveDesigned, STINGER_LIBRARY, SUB_MID_LAYER, yieldToDesign,
} from '../explainers/reel-ai-drama/kit/sound.mjs';

import { soundFixture } from './reel-ai-drama-sound-fixture';

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
const LIB = path.join(process.cwd(), 'explainers', 'design', 'sfx');
const catalog = [
  ...JSON.parse(fs.readFileSync(path.join(LIB, 'catalog.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(LIB, 'ambience-catalog.json'), 'utf8')),
];

/** A sound_cues.json as the production step writes it (anchored, so the kit re-times it). */
const CUES = {
  music: [
    { t: 0, action: 'start', style: 'drone', gain: 0.16, at: { frame: 1, word: null, offset: 0 } },
    { t: 3.8, action: 'swell', style: null, gain: 0.3, at: { frame: 2, word: 2, offset: 0 } },
    { t: 6.2, action: 'change', style: 'reflect', gain: 0.2, at: { frame: 3, word: 0, offset: 0 } },
    { t: 9, action: 'cut', style: null, gain: 0, at: { frame: 4, word: null, offset: 0 } },
  ],
  stingers: [
    { t: 1.2, kind: 'riser', dur: 1, gain: 0.6, id: 'pixabay/riser', at: { frame: 1, word: 3, offset: 0 } },
    { t: 1.2, kind: 'hit', dur: 0, gain: 0.9, id: 'pixabay/impact-bass-1', at: { frame: 1, word: 3, offset: 0 } },
    { t: 5.1, kind: 'silence', dur: 0.8, gain: 0, id: null, at: { frame: 3, word: null, offset: -0.9 } },
    { t: 6.2, kind: 'whoosh', dur: 0.5, gain: 0.5, id: null, at: { frame: 3, word: 0, offset: 0 } },
    { t: 8.6, kind: 'sub', dur: 0, gain: 0.9, id: null, at: { frame: 3, word: 2, offset: 0.2 } },
  ],
  ambience: [
    { start: 0, end: 3, id: 'freesound/ambience/room-tone-641306', gain: 0.3, frames: [1, 1] },
    { start: 3, end: 9, id: 'freesound/ambience/office-108695', gain: 0.2, frames: [2, 3] },
  ],
};
const withCues = () => {
  const root = soundFixture();
  fs.writeFileSync(path.join(root, 'sound_cues.json'), JSON.stringify(CUES));
  return root;
};

test('readCues re-times anchored cues from the current storyboard and timing', () => {
  const root = withCues();
  // Frame 1 grows by 0.5s after a re-pace: every later anchor moves with it.
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), fs.readFileSync(path.join(root, 'STORYBOARD.md'), 'utf8').replace('- duration: 3s', '- duration: 3.5s'));
  const cues = readCues(root)!;
  near(cues.music[2].t, 6.7);
  near(cues.stingers.find((s: { kind: string }) => s.kind === 'silence').t, 5.6);
  near(cues.ambience[1].start, 3.5);
  near(cues.ambience[1].end, 9.5);
  assert.equal(readCues(soundFixture()), null, 'no file → null (today\'s behaviour)');
});

test('cueMusicPlan: sections, crossfaded change, hard cut, styles and swells', () => {
  const { segments, styles, swells } = cueMusicPlan(CUES.music, { total: 11.5, closeStart: 9 });
  assert.deepEqual(styles, ['drone', 'reflect']);
  assert.equal(segments.length, 2);
  near(segments[0].start, 0);
  near(segments[0].end, 6.2 + XFADE / 2);
  near(segments[1].start, 6.2 - XFADE / 2);
  near(segments[1].end, 9);
  assert.equal(segments[1].gain, 0.2);
  assert.ok(segments[1].fadeOut <= 0.15, 'a cut is a hard stop, not a fade');
  assert.deepEqual(swells, [{ t: 3.8, gain: 0.3 }]);
  // Out of order cues are skipped; without cues the storyboard marks still drive music.
  assert.equal(cueMusicPlan([{ t: 1, action: 'drop' }], { total: 5 }).segments.length, 0);
  assert.ok(Array.isArray(musicPlan([])));
});

test('musicEnvelope: ducks under words, lifts in pauses, peaks on a swell, mutes a silence', () => {
  const env = musicEnvelope({
    segments: [{ track: 0, start: 0, end: 10, gain: BED_VOLUME }],
    swells: [{ t: 8, gain: 0.3 }],
    silences: [{ start: 5.1, end: 5.9 }],
    speech: [{ start: 0, end: 2 }, { start: 6, end: 6.5 }],
    total: 10,
  });
  const at = (s: number) => env[Math.round(s * ENV_RATE)];
  near(at(1), 1, 0.01); // under the voice: the section's level
  assert.ok(at(4.5) > 1.4 && at(4.5) <= DUCK_LIFT + 1e-6, `lifted in the pause (${at(4.5)})`);
  assert.equal(at(5.5), 0);
  assert.ok(at(8) > at(7) && at(8) <= MAX_FACTOR + 1e-6, 'the swell peaks on its beat');
  const wav = envelopeWav(env);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.length, 44 + env.length * 4);
});

test('resolveDesigned places every stinger on its exact moment', () => {
  const designed = readCues(withCues())!;
  const speech = [{ start: 1.2, end: 1.6 }];
  const { resolved, missing } = resolveDesigned(catalog, designed, { speech });
  assert.equal(missing.length, 0);
  const of = (k: string) => resolved.filter((r: { kind: string }) => r.kind === `designed:${k}`);
  const riser = of('riser')[0];
  near(riser.start, 0.2); // lands on 1.2 after a 1s build
  near(riser.trim.from, STINGER_LIBRARY.riser[0].land - 1);
  const hit = of('hit')[0];
  near(hit.start, 1.2 - STINGER_LIBRARY.hit[0].land); // its land point on 1.2
  assert.ok(hit.underSpeech, 'the hit lands on a word');
  const subs = of('sub');
  assert.equal(subs.length, 2, 'a sub carries its mid layer');
  assert.ok(subs.some((s: { sound: { id: string } }) => s.sound.id === SUB_MID_LAYER));
  const silence = of('silence')[0];
  assert.match(silence.sound.id, /^bed:room/);
  near(silence.trim.len, 0.8);
  const whoosh = of('whoosh')[0];
  near(whoosh.start + (STINGER_LIBRARY.whoosh[0].land - whoosh.trim.from), 6.2);
  assert.equal(of('ambience').length, 2);
});

test('yieldToDesign: the design leads the frame workers', () => {
  const designed = readCues(withCues())!;
  const { cues, dropped } = yieldToDesign([
    { t: 0, kind: 'ambience', what: 'room' },
    { t: 1.5, kind: 'impact' },
    { t: 5.3, kind: 'foley', what: 'pen' },
    { t: 7.5, kind: 'foley', what: 'pen' },
  ], designed);
  assert.deepEqual(cues.map((c: { t: number }) => c.t), [7.5]);
  assert.equal(dropped.length, 3);
});

test('placeSound mixes the designed cues offline (sound_cues.json fixture)', { skip: !hasFfmpeg && 'no ffmpeg' }, () => {
  const root = withCues();
  const r = placeSound(root);
  assert.ok(r.ok, r.errors.join('; '));
  assert.ok(r.placed >= 7, `placed ${r.placed}`);
  assert.ok(fs.statSync(path.join(root, 'assets', 'sfx', 'events.wav')).size > 1000);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.ok(meta.sfx.some((s: { role: string }) => s.role === 'events'));
  // Frame clock sanity: four frames, the close from 9s.
  assert.deepEqual(frameClock(root).map((f: { start: number }) => f.start), [0, 3, 6, 9]);
});

test('placeMusic lays designed sections and the envelope offline', { skip: !hasFfmpeg && 'no ffmpeg' }, async () => {
  const root = withCues();
  const queries: string[] = [];
  const search = async (q: string) => {
    queries.push(q);
    return [1, 2, 3].map((i) => ({ id: `t${i}-${queries.length}`, name: 'tense bed', audio_url: `sine:${200 + i * 40 + queries.length}`, duration: 16 }));
  };
  const download = async (url: string, dest: string) => {
    const f = Number(url.split(':')[1]);
    const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${f}:duration=16`, '-ac', '2', dest]);
    if (res.status !== 0) throw new Error(String(res.stderr));
  };
  const r = await placeMusic(root, { search, download });
  assert.ok(r.ok, r.errors.join('; '));
  assert.ok(r.choice);
  assert.equal(r.choice.designed, true);
  assert.equal(r.choice.tracks.length, 2);
  assert.deepEqual(r.choice.tracks.map((t: { style: string }) => t.style), ['drone', 'reflect']);
  assert.ok(queries[0].includes('drone'));
  assert.ok(fs.existsSync(path.join(root, 'assets', 'bgm', 'envelope.wav')));
  assert.ok(fs.statSync(path.join(root, 'assets', 'bgm', 'track.mp3')).size > 1000);
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'audio_meta.json'), 'utf8'));
  assert.equal(meta.bgm.volume, BED_VOLUME);
});
