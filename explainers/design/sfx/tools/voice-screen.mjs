// Screen sounds and music for voices (voice-screen.mjs explains why). macOS only: it builds
// voice-screen.swift (Apple's offline SoundAnalysis classifier) once into tools/.bin/.
//
//   node explainers/design/sfx/tools/voice-screen.mjs           screen library sounds not yet screened
//   node explainers/design/sfx/tools/voice-screen.mjs --all     re-screen every library sound
//   node explainers/design/sfx/tools/voice-screen.mjs --music   screen the catalog tracks the three music
//                                                               pickers' queries return (HeyGen search +
//                                                               download; no paid generation)
//
// Writes voice-screen.json (commit it; the render VM reads it). A sound or track the screen has not
// measured never plays, so run this after every drop and whenever a pick reports unscreened tracks.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { MUSIC_VOICE_MAX, VOICE_MAX, VOICE_SCREEN_FILE, soundVoiceFree } from '../voice-screen.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SFX = join(HERE, '..');
const REPO = join(SFX, '..', '..', '..');
const AUDIO = /\.(mp3|wav|ogg|flac|m4a|aiff?)$/i;
/** The catalog depth the screen covers per query (the pickers search 10 or 20). */
const MUSIC_LIMIT = 20;

/** Build the meter if needed; returns its path. */
export function meter() {
  if (process.platform !== 'darwin') throw new Error('the voice screen runs on a Mac (Apple SoundAnalysis); new sounds and tracks stay out of reels until it does');
  const src = join(HERE, 'voice-screen.swift');
  const bin = join(HERE, '.bin', 'voice-screen');
  if (!existsSync(bin) || statSync(bin).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(dirname(bin), { recursive: true });
    const r = spawnSync('swiftc', ['-O', '-o', bin, src], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`swiftc failed: ${String(r.stderr).slice(-400)}`);
  }
  return bin;
}

/** Score `files` (absolute paths) → Map(path → score), 40 files per call, 8 calls at a time. */
export function measure(files) {
  const bin = meter();
  const out = new Map();
  const chunks = [];
  for (let i = 0; i < files.length; i += 40) chunks.push(files.slice(i, i + 40));
  for (let i = 0; i < chunks.length; i += 8) {
    // spawnSync keeps this simple; eight meters run as one shell pipeline
    const batch = chunks.slice(i, i + 8);
    const script = batch.map((c) => `"${bin}" ${c.map((f) => `'${f.replace(/'/g, "'\\''")}'`).join(' ')} &`).join('\n') + '\nwait';
    const r = spawnSync('/bin/sh', ['-c', script], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    for (const line of String(r.stdout).split('\n')) {
      const [score, file] = line.split('\t');
      if (file && score !== 'ERR') out.set(file, Math.round(Number(score) * 1000) / 1000);
    }
  }
  return out;
}

const readScreen = () => {
  const file = join(SFX, VOICE_SCREEN_FILE);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { sounds: {}, music: {} };
};
const writeScreen = (screen) => {
  const sorted = (o) => Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => a.localeCompare(b)));
  const method = 'macOS SoundAnalysis built-in classifier (version1): the highest confidence of any speech, singing, whispering or shouting label over 1 s windows (0.5 overlap). Written by tools/voice-screen.mjs.';
  writeFileSync(join(SFX, VOICE_SCREEN_FILE), `${JSON.stringify({ method, screened_at: new Date().toISOString().slice(0, 10), sounds: sorted(screen.sounds), music: sorted(screen.music) }, null, 1)}\n`);
};

/** Every audio file of the library (the drop-ins link followed; inbox originals skipped). */
function libraryFiles(dir = SFX, base = SFX) {
  const out = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith('.') || (dir === base && (name === 'inbox' || name === 'tools'))) continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) out.push(...libraryFiles(abs, base));
    else if (AUDIO.test(name)) out.push(relative(base, abs));
  }
  return out;
}

export function screenSounds({ all = false } = {}) {
  const screen = readScreen();
  const todo = libraryFiles().filter((f) => all || typeof screen.sounds?.[f] !== 'number');
  const scores = measure(todo.map((f) => join(SFX, f)));
  const flagged = [];
  for (const f of todo) {
    const v = scores.get(join(SFX, f));
    if (typeof v !== 'number') continue;
    screen.sounds[f] = v;
    if (!soundVoiceFree(screen, f)) flagged.push(`${f} (${v})`);
  }
  writeScreen(screen);
  return { screened: scores.size, of: todo.length, voiced: flagged, threshold: VOICE_MAX };
}

export async function screenMusic() {
  const kits = ['explainers/world-kit/music.mjs', 'explainers/reel-ai-drama/kit/music.mjs', 'explainers/real-case/kit/music.mjs'];
  const queries = new Set();
  for (const k of kits) {
    const m = await import(pathToFileURL(join(REPO, k)).href);
    for (const s of [...(m.STYLES ?? []), ...(m.MOOD_STYLES ?? [])]) queries.add(s.query);
  }
  const h = await import(pathToFileURL(join(REPO, 'explainers', 'runtime', 'node_modules', 'hyperframes', 'dist', 'skills', 'media-use', 'audio', 'scripts', 'lib', 'heygen.mjs')).href);
  const headers = h.heygenAuthHeaders();
  const screen = readScreen();
  screen.music ??= {};
  const fresh = new Map();
  for (const q of queries) {
    for (const t of await h.searchSounds(q, 'music', headers, { limit: MUSIC_LIMIT })) {
      const id = String(t.id ?? t.audio_id ?? '');
      if (id && t.audio_url && !screen.music[id] && !fresh.has(id)) fresh.set(id, t);
    }
  }
  const tmp = mkdtempSync(join(tmpdir(), 'voice-screen-'));
  try {
    const wavs = new Map();
    for (const [id, t] of fresh) {
      const raw = join(tmp, `${id}.src`);
      const wav = join(tmp, `${id}.wav`);
      try {
        await h.downloadTo(t.audio_url, raw);
        if (spawnSync('ffmpeg', ['-v', 'error', '-y', '-i', raw, '-ac', '1', '-ar', '48000', wav]).status === 0) wavs.set(wav, id);
      } catch {
        // a track that will not download stays unscreened (and so never plays)
      }
    }
    const scores = measure([...wavs.keys()]);
    const flagged = [];
    for (const [wav, id] of wavs) {
      const v = scores.get(wav);
      if (typeof v !== 'number') continue;
      screen.music[id] = { voice: v, description: fresh.get(id).description ?? null };
      if (v >= MUSIC_VOICE_MAX) flagged.push(`${id} (${v}) ${fresh.get(id).description ?? ''}`);
    }
    writeScreen(screen);
    return { queries: queries.size, newTracks: fresh.size, screened: scores.size, voiced: flagged, threshold: MUSIC_VOICE_MAX };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const run = args.includes('--music') ? screenMusic() : Promise.resolve(screenSounds({ all: args.includes('--all') }));
  run.then(
    (r) => process.stdout.write(`${JSON.stringify(r, null, 1)}\n`),
    (e) => {
      process.stderr.write(`${e instanceof Error ? e.message : e}\n`);
      process.exitCode = 1;
    },
  );
}
