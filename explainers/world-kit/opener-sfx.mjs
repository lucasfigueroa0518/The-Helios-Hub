// The opener's sound (EX3-11, EX3-12, EX3-24, EX3-102). Deterministic, no model.
//
// When the job drew an opener from the bank (assets/opener.json, EX3-102), frame 1's sound is the
// opener's own (openers/sound.mjs: its stem, and the bed held back until its drop) and the hit
// still lands on the 1→2 cut. A job from before the bank keeps the old pair: a riser builds under
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { projectFrames } from './frames.mjs';
import { chosenOpener, hasOpenerStem, placeOpener } from './openers/sound.mjs';

export const OPENER_SFX = {
  riserSource: 'assets/sfx/riser.mp3',
  riser: 'assets/sfx/opener-riser.mp3',
  hit: 'assets/sfx/impact-bass-1.mp3',
  hitSeconds: 2.12,
  riserVolume: 0.45,
  hitVolume: 0.6,
  fadeIn: 0.4,
};

/** The two host entries for an opener of `opener` seconds. */
export function openerEntries(opener) {
  if (!(opener > 0)) throw new Error('opener-sfx: frame 1 has no duration');
  const r = (n) => Math.round(n * 1000) / 1000;
  return [
    { frame: 1, file: OPENER_SFX.riser, offset_s: 0, duration_s: r(opener), volume: OPENER_SFX.riserVolume, source: 'host', role: 'opener-riser' },
    { frame: 1, file: OPENER_SFX.hit, offset_s: r(opener), duration_s: OPENER_SFX.hitSeconds, volume: OPENER_SFX.hitVolume, source: 'host', role: 'opener-hit' },
  ];
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
  if (!existsSync(join(root, OPENER_SFX.hit))) errors.push(`${OPENER_SFX.hit} is missing`);
  const metaFile = join(root, 'audio_meta.json');
  const meta = JSON.parse(readFileSync(metaFile, 'utf8'));
  const hit = openerEntries(first.duration).find((e) => e.role === 'opener-hit');
  meta.sfx = [...(meta.sfx ?? []).filter((s) => !(s?.source === 'host' && s.role === 'opener-hit')), hit];
  writeFileSync(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  return { ...placed, ok: errors.length === 0, errors, sfx: [...placed.sfx, hit] };
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
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.ok ? 0 : 1);
}
