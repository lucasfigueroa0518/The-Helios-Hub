// The opener's sound (EX3-11, EX3-12, EX3-24, EX3-102). Deterministic, no model.
//
// When the job drew an opener from the bank (assets/opener.json, EX3-102), frame 1's sound is the
// opener's own (openers/sound.mjs: its stem, and the bed held back until its drop) and the hit
// still lands on the 1→2 cut: the first of CUT_HITS the stem did not play, copied to
// assets/sfx/opener-hit.mp3 (the same hit twice in the first seconds was the reel's most repeated
// sound). A job from before the bank keeps the old pair: a riser builds under
// the series opener and crests exactly on the 1→2 cut; a hit lands on the
// cut. Both are host sounds in audio_meta.json, hung on frame 1 so frame 2 keeps its own looked-up
// cues, and every later audio pass keeps them. Run it after `audio.mjs sync-durations`, when
// frame 1's real length is in STORYBOARD.md.
//
//   node assets/kit/opener-sfx.mjs
//
// The riser file is longer than the opener and peaks at its end, so its last <frame 1 length>
// seconds are cut out (ffmpeg) with a short fade-in, into assets/sfx/opener-riser.mp3.
// Prints JSON { ok, errors[], sfx[] } and exits 1 on any error.

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { projectFrames } from './frames.mjs';
import { chosenOpener, CUT_SWEEP_HZ, hasOpenerStem, placeOpener } from './openers/sound.mjs';

export const OPENER_SFX = {
  riserSource: 'assets/sfx/riser.mp3',
  riser: 'assets/sfx/opener-riser.mp3',
  hit: 'assets/sfx/impact-bass-1.mp3',
  hitSeconds: 2.12,
  riserVolume: 0.45,
  hitVolume: 0.6,
  fadeIn: 0.4,
};

/**
 * The 1→2 cut hits, in order of preference (library files). The cut takes the first one the
 * opener's own stem did not play, so the reel never opens on one hit and lands frame 2 on the
 * same hit again (Lucas, 2026-11-17).
 */
export const CUT_HITS = [
  'pixabay/impact-bass-1.mp3',
  'pixabay/impact-bass-2.mp3',
  'kenney/impact-sounds/Audio/impactPunch_heavy_000.ogg',
  'kenney/impact-sounds/Audio/impactSoft_heavy_002.ogg',
];
/** Where the chosen cut sound is copied in the project. */
export const CUT_HIT_FILE = 'assets/sfx/opener-hit.mp3';

/**
 * The 1→2 cut's sound from the reel's palette (openers/palette.mjs): a whoosh or riser tail that
 * rushes into the cut, never a second hit (Lucas 2026-11-17: hit, hit back to back at the start of
 * every reel). It starts CUT_LEAD seconds (at most, and at most 45% of its length) before the cut.
 */
export const CUT_LEAD = 0.5;
export const CUT_VOLUME = 0.55;

/** The cut hit for a stem that played `stemSounds` (library files). */
export function cutHitFor(stemSounds = []) {
  const used = new Set(stemSounds);
  return CUT_HITS.find((f) => !used.has(f)) ?? CUT_HITS.at(-1);
}

/**
 * The two host entries for an opener of `opener` seconds. `hit` ({ file, seconds, library })
 * replaces the default cut hit.
 */
export function openerEntries(opener, hit = null) {
  if (!(opener > 0)) throw new Error('opener-sfx: frame 1 has no duration');
  const r = (n) => Math.round(n * 1000) / 1000;
  return [
    { frame: 1, file: OPENER_SFX.riser, offset_s: 0, duration_s: r(opener), volume: OPENER_SFX.riserVolume, source: 'host', role: 'opener-riser' },
    hit
      ? { frame: 1, file: hit.file, offset_s: r(opener), duration_s: r(hit.seconds), volume: OPENER_SFX.hitVolume, source: 'host', role: 'opener-hit', library: hit.library }
      : { frame: 1, file: OPENER_SFX.hit, offset_s: r(opener), duration_s: OPENER_SFX.hitSeconds, volume: OPENER_SFX.hitVolume, source: 'host', role: 'opener-hit' },
  ];
}

/**
 * Copy the cut hit the stem did not play into the project (an .ogg is converted to MP3). Falls
 * back to the default hit (with a note) when the library or ffmpeg is unavailable: never fatal.
 */
export function prepareCutHit(root, stemSounds, ffmpeg = 'ffmpeg', paletteCut = null) {
  const library = paletteCut ?? cutHitFor(stemSounds);
  const src = join(root, 'assets', 'sfx-library', library);
  const fallback = { file: OPENER_SFX.hit, seconds: OPENER_SFX.hitSeconds, library: 'pixabay/impact-bass-1.mp3' };
  if (!existsSync(src)) return { hit: fallback, note: `${library} is not in the library; the default hit plays` };
  const out = join(root, CUT_HIT_FILE);
  try {
    if (library.endsWith('.mp3') && !paletteCut) copyFileSync(src, out);
    else {
      // a palette sweep loses its sub-bass: the break is the opening's only low event (sound.mjs)
      const af = paletteCut ? ['-af', `highpass=f=${CUT_SWEEP_HZ},highpass=f=${CUT_SWEEP_HZ}`] : [];
      const r = spawnSync(ffmpeg, ['-v', 'error', '-y', '-i', src, ...af, '-c:a', 'libmp3lame', '-q:a', '2', out], { encoding: 'utf8' });
      if (r.status !== 0) return { hit: fallback, note: `converting ${library} failed; the default hit plays` };
    }
  } catch (e) {
    return { hit: fallback, note: `copying ${library} failed (${e instanceof Error ? e.message : e}); the default hit plays` };
  }
  let seconds = OPENER_SFX.hitSeconds;
  try {
    const catalog = JSON.parse(readFileSync(join(root, 'assets', 'sfx-library', 'catalog.json'), 'utf8'));
    const d = catalog.find((s) => s.file === library)?.duration ?? (paletteCut ? probeSeconds(src) : null);
    if (d > 0) seconds = Math.min(d, 2.6);
  } catch {
    // the default length
  }
  return { hit: { file: CUT_HIT_FILE, seconds, library, sweep: Boolean(paletteCut) }, note: null };
}

/** A file's length in seconds (ffprobe), or null. */
function probeSeconds(file) {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const d = Number(String(r.stdout).trim());
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** True when audio_meta.json already carries the opener's sounds: the bank opener's stem and the
 *  cut's hit, or (before the bank) the riser and the hit. */
export function hasOpenerSfx(meta) {
  const roles = new Set((meta?.sfx ?? []).filter((s) => s?.source === 'host').map((s) => s.role));
  return roles.has('opener-hit') && (roles.has('opener-riser') || hasOpenerStem(meta));
}

/** `meta` with the opener entries in place of any earlier ones. */
export function withOpenerSfx(meta, opener) {
  const others = (meta?.sfx ?? []).filter((s) => !(s?.source === 'host' && /^opener-/.test(s.role ?? '')));
  return { ...meta, sfx: [...openerEntries(opener), ...others] };
}

/** Cut the riser's last `opener` seconds, with a fade-in, so it crests on the cut. */
export function cutRiser(root, opener, ffmpeg = 'ffmpeg') {
  const res = spawnSync(
    ffmpeg,
    [
      '-y', '-loglevel', 'error',
      '-sseof', `-${opener.toFixed(3)}`,
      '-i', OPENER_SFX.riserSource,
      '-af', `afade=t=in:st=0:d=${Math.min(OPENER_SFX.fadeIn, opener / 3).toFixed(3)}`,
      OPENER_SFX.riser,
    ],
    { cwd: root, encoding: 'utf8' },
  );
  if (res.error) throw new Error(`opener-sfx: ffmpeg failed to start: ${res.error.message}`);
  if (res.status !== 0 || !existsSync(join(root, OPENER_SFX.riser))) {
    throw new Error(`opener-sfx: ffmpeg exited ${res.status}: ${(res.stderr || '').trim().slice(-400)}`);
  }
}

/** The bank opener's sound (its stem, the bed's drop) and the hit on the 1→2 cut. */
function placeBankOpener(root, ffmpeg) {
  const placed = placeOpener(root, { ffmpeg });
  if (!placed.ok && !placed.sfx.length) return placed;
  const first = projectFrames(root)[0];
  if (!first || !(first.duration > 0)) return { ...placed, ok: false, errors: [...placed.errors, 'STORYBOARD.md has no frame 1 with a duration'] };
  const errors = [...placed.errors];
  const metaFile = join(root, 'audio_meta.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const stem = (meta.sfx ?? []).find((s) => s?.source === 'host' && s.role === 'opener-stem');
  const { hit: chosen, note } = prepareCutHit(root, stem?.sounds ?? [], ffmpeg, stem?.palette?.cut ?? null);
  if (!existsSync(join(root, chosen.file))) errors.push(`${chosen.file} is missing`);
  let hit = openerEntries(first.duration, chosen).find((e) => e.role === 'opener-hit');
  if (chosen.sweep) {
    // a sweep rushes into the cut: it starts before it, so its rush lands on the cut
    const lead = Math.min(CUT_LEAD, chosen.seconds * 0.45);
    const r = (n) => Math.round(n * 1000) / 1000;
    hit = { ...hit, offset_s: r(Math.max(0, first.duration - lead)), volume: CUT_VOLUME, kind: 'sweep' };
  }
  meta.sfx = [...(meta.sfx ?? []).filter((s) => !(s?.source === 'host' && s.role === 'opener-hit')), hit];
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  return { ...placed, ok: errors.length === 0, errors, sfx: [...placed.sfx, hit], ...(note ? { notes: [note] } : {}) };
}

/** Write the opener sounds into the project at `root`. */
export function placeOpenerSfx(root, { ffmpeg = 'ffmpeg' } = {}) {
  if (chosenOpener(root)) return placeBankOpener(root, ffmpeg);
  const errors = [];
  const first = projectFrames(root)[0];
  if (!first || !(first.duration > 0)) return { ok: false, errors: ['STORYBOARD.md has no frame 1 with a duration'], sfx: [] };
  for (const file of [OPENER_SFX.riserSource, OPENER_SFX.hit]) {
    if (!existsSync(join(root, file))) errors.push(`${file} is missing`);
  }
  if (errors.length) return { ok: false, errors, sfx: [] };
  const metaFile = join(root, 'audio_meta.json');
  const meta = existsSync(metaFile) ? JSON.parse(readFileSync(metaFile, 'utf8')) : { bgm: null, voices: [], sfx: [] };
  try {
    cutRiser(root, first.duration, ffmpeg);
  } catch (e) {
    return { ok: false, errors: [e instanceof Error ? e.message : String(e)], sfx: [] };
  }
  const next = withOpenerSfx(meta, first.duration);
  writeFileSync(metaFile, `${JSON.stringify(next, null, 2)}\n`);
  return { ok: true, errors: [], sfx: openerEntries(first.duration) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = placeOpenerSfx(process.cwd());
  // Write, then exit once stdout has drained: process.exit() right after console.log cut a piped
  // report off at 64 KB, and the job read the cut JSON as "no errors" (2026-11-03).
  process.stdout.write(`${JSON.stringify(result, null, 1)}\n`, () => process.exit(result.ok ? 0 : 1));
}
