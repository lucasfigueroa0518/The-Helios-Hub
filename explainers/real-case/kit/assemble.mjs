// The assembly after the frame workers (N4c-2), in this format's order: pace (when the frames are
// unpaced), mount every frame (the sting and the close included), music, sound, captions, then
// index.html and the transitions. The job's repair step and the fixture smoke run share it.
//
//   node assets/kit/assemble.mjs [--no-music]     (run from the project root)

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { mountFrames } from './mount.mjs';
import { pace } from './pace.mjs';
import { placeSound } from './sound.mjs';

function runNode(root, script, args) {
  const res = spawnSync('node', [script, ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return res.status === 0 ? null : `${script.split('/').pop()} failed: ${(res.stderr || res.stdout || '').trim().slice(-400)}`;
}

export async function assemble(root, { music = true, placeMusic = null } = {}) {
  const done = [];
  const errors = [];
  const metaFile = join(root, 'audio_meta.json');
  const scripts = join(root, '.claude', 'skills', 'faceless-explainer', 'scripts');
  if (!existsSync(metaFile)) return { ok: false, done, errors: ['audio_meta.json is missing'] };

  if (!existsSync(join(root, 'assets', 'timing'))) {
    const paced = pace(root);
    if (!paced.ok) return { ok: false, done, errors: paced.errors.map((e) => `pace: ${e}`) };
    done.push(`paced the frames (${paced.total}s)`);
  }
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
