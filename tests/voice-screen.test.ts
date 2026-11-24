// The voice screen (2026-11-19): no voice but our narrator ever reaches a reel. The 2026-11-18
// Explainers reel carried a stray "This is…" under the narration; these tests keep every outside
// sound (library effects, ambience beds, opener sounds, catalog music) screened and voice-free.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { FILES, loadAmbience, loadLibrary, SFX_DIR } from '../explainers/design/sfx/library.mjs';
import { loadVoiceScreen, mentionsVoice, MUSIC_VOICE_MAX, soundVoiceFree, trackVoiceFree, VOICE_MAX } from '../explainers/design/sfx/voice-screen.mjs';

const screen = loadVoiceScreen(SFX_DIR)!;
const readList = (file: string) => JSON.parse(fs.readFileSync(path.join(SFX_DIR, file), 'utf8')) as { file: string }[];

test('the committed screen measured every sound in every catalog', () => {
  assert.ok(screen, 'explainers/design/sfx/voice-screen.json is missing');
  const files = [FILES.bank, FILES.dropins, FILES.ambience].flatMap((f) => readList(f).map((s) => s.file));
  const unscreened = files.filter((f) => typeof screen.sounds[f] !== 'number');
  assert.deepEqual(unscreened.slice(0, 20), [], `${unscreened.length} catalog sounds were never screened: run node explainers/design/sfx/tools/voice-screen.mjs on a Mac`);
});

test('the library and the ambience beds never hand out a voiced sound', () => {
  for (const s of [...loadLibrary(SFX_DIR), ...loadAmbience(SFX_DIR)]) {
    assert.ok(screen.sounds[s.file] < VOICE_MAX, `${s.file} measured ${screen.sounds[s.file]}`);
    assert.ok(soundVoiceFree(screen, s.file), s.file);
  }
  // what the screen caught: crowds, kids, a café and a newsroom bed, a TV with a voice
  for (const f of ['dropins/big-city-sound-fx/city-crowd-talking.mp3', 'freesound/ambience/newsroom-579568.mp3', 'freesound/ambience/cafe-28204.mp3', 'dropins/retro-vintage-sound-fx/radio-jitter-talks.mp3']) {
    if (f in screen.sounds) assert.equal(soundVoiceFree(screen, f), false, f);
  }
  // an unscreened drop-in stays out until a Mac measures it
  assert.equal(soundVoiceFree(screen, 'dropins/new-pack/never-heard.mp3'), false);
});

test("every opener's fixed sound is screened and voice-free", () => {
  const dir = path.join(process.cwd(), 'explainers', 'world-kit');
  const sources = [path.join(dir, 'opener-sfx.mjs'), ...fs.readdirSync(path.join(dir, 'openers')).filter((f) => f.endsWith('.mjs')).map((f) => path.join(dir, 'openers', f))];
  const named = new Set<string>();
  for (const file of sources) {
    for (const m of fs.readFileSync(file, 'utf8').matchAll(/['"`]((?:freesound|kenney|pixabay|dropins)\/[^'"`$]+\.(?:mp3|ogg|wav))['"`]/g)) named.add(m[1]);
  }
  for (const f of ['riser.mp3', 'impact-bass-1.mp3']) named.add(f);
  for (const f of named) assert.ok(soundVoiceFree(screen, f), `${f} is ${f in screen.sounds ? `voiced (${screen.sounds[f]})` : 'unscreened'}`);
});

test('catalog music plays only when screened voice-free and its text names no voice', () => {
  assert.equal(mentionsVoice('energetic upbeat rock instrumental, electric guitars, no vocals, low volume'), false);
  assert.equal(mentionsVoice('hard boom bap hip hop beat, 808 bass, no vocals'), false);
  assert.equal(mentionsVoice('upbeat pop with female vocals'), true);
  assert.equal(mentionsVoice('driving rock, vocal chops, big chorus'), true);
  assert.equal(mentionsVoice('punchy rap beat with spoken intro'), true);
  const track = (id: string, description = 'driving instrumental') => ({ id, description, audio_url: `u/${id}` });
  assert.equal(trackVoiceFree(track('never-screened'), screen), false);
  assert.equal(trackVoiceFree(track('x'), { sounds: {}, music: { x: { voice: MUSIC_VOICE_MAX } } }), false);
  assert.equal(trackVoiceFree(track('x'), { sounds: {}, music: { x: { voice: 0.1 } } }), true);
  assert.equal(trackVoiceFree(track('x', 'rock with vocals'), { sounds: {}, music: { x: { voice: 0.1 } } }), false);
  // the indie track the screen flagged on 2026-11-19 (the likely bed of the 2026-11-18 reel)
  assert.equal(trackVoiceFree(track('9626fdb984594912b2d0732d1da8ba57', 'upbeat punchy instrumental, light rock driving beat, garage energy'), screen), false);
  // every rotation style still has a cleared track to play
  const cleared = Object.entries(screen.music).filter(([, v]) => (v as { voice: number }).voice < MUSIC_VOICE_MAX);
  assert.ok(cleared.length >= 10, `only ${cleared.length} catalog tracks are cleared`);
});
