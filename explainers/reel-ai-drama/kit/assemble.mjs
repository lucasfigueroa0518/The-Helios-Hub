// The assembly after the frame workers (forked from the news kit's), in this format's order: pace (when
// the frames are unpaced), mount every frame (the close included), music (changing at the marked
// frames), sound (foley and ambience), captions, then index.html and the transitions. The job's repair
// step and the fixture smoke run share it.
//
//   node assets/kit/assemble.mjs [--no-music]     (run from the project root)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { isClose, parseFrames } from './frames.mjs';
import { mountFrames } from './mount.mjs';
import { pace } from './pace.mjs';
import { placeSound } from './sound.mjs';

function runNode(root, script, args) {
  const res = spawnSync('node', [script, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return res.status === 0 ? null : `${script.split('/').pop()} failed: ${(res.stderr || res.stdout || '').trim().slice(-400)}`;
}

/** Frames shorter than the voice they carry (MD-58): `[voice_cut]` lines, empty when every voice fits. */
export function voiceCuts(root) {
  const meta = JSON.parse(readFileSync(join(root, 'audio_meta.json'), 'utf8'));
  const frames = parseFrames(readFileSync(join(root, 'STORYBOARD.md'), 'utf8'));
  const out = [];
  for (const v of meta.voices ?? []) {
    const f = frames.find((x) => x.number === Number(v.frame));
    if (f && !isClose(f) && v.duration_s > 0 && f.duration + 0.02 < v.duration_s) {
      out.push(`[voice_cut] frame ${f.number} (${f.id}) is ${f.duration}s but its voice runs ${v.duration_s}s: the line would be cut off`);
    }
  }
  return out;
}

export async function assemble(root, { music = true, placeMusic = null } = {}) {
  const done = [];
  const errors = [];
  const metaFile = join(root, 'audio_meta.json');
  const scripts = join(root, '.claude', 'skills', 'faceless-explainer', 'scripts');
  if (!existsSync(metaFile)) return { ok: false, done, errors: ['audio_meta.json is missing'] };

  // Always pace (it is idempotent, computed from the original voice): any rewrite of STORYBOARD.md
  // since the voice (a director fix) would otherwise leave frames shorter than their voice (MD-58).
  const paced = pace(root);
  if (!paced.ok) return { ok: false, done, errors: paced.errors.map((e) => `pace: ${e}`) };
  done.push(`paced the frames (${paced.total}s)`);
  errors.push(...voiceCuts(root));
  const mounted = mountFrames(root);
  errors.push(...mounted.errors.map((e) => `mount: ${e}`));
  if (mounted.skipped.length) errors.push(`mount: no module for ${mounted.skipped.join(', ')}`);
  done.push(`mounted ${mounted.mounted.join(', ')}`);

  if (music && !JSON.parse(readFileSync(metaFile, 'utf8')).bgm) {
    const place = placeMusic ?? (await import('./music.mjs')).placeMusic;
    const result = await place(root).catch((e) => ({ ok: false, errors: [e instanceof Error ? e.message : String(e)] }));
    if (result.ok) done.push('placed the music');
    else errors.push(...result.errors.map((e) => `music: ${e}`));
  }

  const sound = placeSound(root);
  errors.push(...sound.errors.map((e) => `sound: ${e}`));
  done.push(`placed ${sound.placed} of ${sound.events} sound events`);

  const captions = runNode(root, join(scripts, 'captions.mjs'), ['build', '--storyboard', './STORYBOARD.md', '--audio-meta', './audio_meta.json', '--hyperframes', '.', '--out', './caption_groups.json']);
  if (captions) errors.push(captions);
  else done.push('built the captions');
  const assembled = runNode(root, join(scripts, 'assemble-index.mjs'), ['--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  if (assembled) return { ok: false, done, errors: [...errors, assembled] };
  done.push('assembled index.html');
  const injected = runNode(root, join(scripts, 'transitions.mjs'), ['inject', '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  if (injected) errors.push(injected);
  else done.push('injected the transitions');
  return { ok: errors.length === 0, done, errors, dropped: sound.dropped };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  assemble(process.cwd(), { music: !process.argv.includes('--no-music') }).then((result) => {
    console.log(JSON.stringify(result, null, 1));
    process.exit(result.ok ? 0 : 1);
  });
}
