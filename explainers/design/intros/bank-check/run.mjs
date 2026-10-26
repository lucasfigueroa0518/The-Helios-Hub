#!/usr/bin/env node
// End-to-end check of the opener bank (EX3-102) on the agent-loop reel. No model, no network beyond
// the CDN scripts the frames load.
//
//   node explainers/design/intros/bank-check/run.mjs [key …]      (default: every opener)
//
// It runs frame 1 the way a job does, through the real code: assets/opener.json names the opener;
// pace's leadVoice puts the opener's wait before the line; frames.mjs writeOpener writes
// 01-opener.js over the hook (01-hook.js here, as a worker would write it); try.mjs checks the
// frame; it is mounted, assembled and rendered silent; openers/sound.mjs mixes the stem and drops
// the bed; the voice, the bed and the stem are mixed as the reel would play them, and muxed.
// Out: planning/Explainer Reels/intros/bank/<key>.mp4 and bank-all.mp4.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..', '..');
const explainers = join(repo, 'explainers');
const cli = join(explainers, 'runtime', 'node_modules', '.bin', 'hyperframes');
const script = (name) => join(explainers, 'hyperframes-skills', 'faceless-explainer', 'scripts', name);
const REEL = join(repo, '.explainers-local', 'jobs', '1eb1a924-e532-49b4-976e-3e8b933444e5', 'project');
const project = join(here, '..', '.out', 'proj');
const OUT = join(repo, 'planning', 'Explainer Reels', 'intros', 'bank');
const env = { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };

function run(label, cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: opts.cwd ?? project, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0 && !opts.allowFail) {
    console.error(`✗ ${label} failed:\n${`${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n')}`);
    process.exit(1);
  }
  return res;
}

if (!existsSync(join(project, 'hyperframes.json'))) {
  console.error('run explainers/design/intros/run-intros.mjs once first (it makes the HyperFrames project)');
  process.exit(1);
}
// The kit (with the bank), the reel's world, its line, its bed, the sound library.
rmSync(join(project, 'assets', 'kit'), { recursive: true, force: true });
cpSync(join(explainers, 'world-kit'), join(project, 'assets', 'kit'), { recursive: true });
cpSync(join(REEL, 'assets', 'world'), join(project, 'assets', 'world'), { recursive: true });
rmSync(join(project, 'assets', 'frames'), { recursive: true, force: true });
mkdirSync(join(project, 'assets', 'frames'), { recursive: true });
cpSync(join(here, '01-hook.js'), join(project, 'assets', 'frames', '01-hook.js'));
mkdirSync(join(project, 'assets', 'voice'), { recursive: true });
mkdirSync(join(project, 'assets', 'bgm'), { recursive: true });
mkdirSync(join(project, 'assets', 'sfx'), { recursive: true });
cpSync(join(REEL, 'assets', 'bgm', 'track.mp3'), join(project, 'assets', 'bgm', 'track.mp3'));
if (!existsSync(join(project, 'assets', 'sfx-library'))) symlinkSync(join(explainers, 'design', 'sfx'), join(project, 'assets', 'sfx-library'), 'dir');
const reelMeta = JSON.parse(readFileSync(join(REEL, 'audio_meta.json'), 'utf8'));
const reelVoice = reelMeta.voices.find((v) => Number(v.frame) === 1);
const term = /^term:\s*(.+)$/m.exec(readFileSync(join(REEL, 'STORYBOARD.md'), 'utf8'))?.[1]?.trim() ?? '';

await import(pathToFileURL(join(project, 'assets', 'kit', 'try.mjs')).href);
const { OPENER_KEYS, openerTiming, openerByKey } = await import(pathToFileURL(join(project, 'assets', 'kit', 'openers', 'bank.js')).href);
const { leadVoice } = await import(pathToFileURL(join(project, 'assets', 'kit', 'pace.mjs')).href);
const { writeOpener } = await import(pathToFileURL(join(project, 'assets', 'kit', 'frames.mjs')).href);
const { placeOpener } = await import(pathToFileURL(join(project, 'assets', 'kit', 'openers', 'sound.mjs')).href);

mkdirSync(OUT, { recursive: true });
const keys = process.argv.slice(2).length ? process.argv.slice(2) : OPENER_KEYS;
const made = [];
for (const key of keys) {
  writeFileSync(join(project, 'assets', 'opener.json'), `${JSON.stringify({ key })}\n`);
  // a fresh line every time, then the opener's lead in front of it (pace.mjs)
  cpSync(join(REEL, 'assets', 'voice', '01.wav'), join(project, 'assets', 'voice', '01.wav'));
  const voice = { frame: 1, path: 'assets/voice/01.wav', duration_s: reelVoice.duration_s, words: reelVoice.words, lead_s: 0 };
  const leadErr = leadVoice(project, voice, openerByKey(key).voiceAt);
  if (leadErr) throw new Error(leadErr);
  const meta = { bgm: { path: 'assets/bgm/track.mp3', volume: reelMeta.bgm?.volume ?? 0.16 }, voices: [voice], sfx: [] };
  writeFileSync(join(project, 'audio_meta.json'), `${JSON.stringify(meta, null, 1)}\n`);
  const M = openerTiming(key, reelVoice.duration_s, reelVoice.words);
  writeFileSync(join(project, 'STORYBOARD.md'), [
    '---', 'format: 1080x1920', `duration: ${M.duration}s`, `term: ${term}`, 'music: none', '---', '',
    '## Frame 1 — Series opener', '', `- duration: ${M.duration}s`, '- hold: 0.15s', '- transition_in: cut', '- status: animated',
    '- src: compositions/frames/01-opener.html', '- ground: paper', '- type: hook', '',
  ].join('\n'));
  if (writeOpener(project, { number: 1, id: '01-opener' }) !== key) throw new Error(`writeOpener did not write ${key}`);
  const tried = run('try', 'node', ['assets/kit/try.mjs', 'frame', '01-opener'], { allowFail: true });
  if (tried.status !== 0) {
    console.error(`✗ ${key}: try.mjs\n${tried.stdout}`);
    process.exit(1);
  }
  run('mount', 'node', ['assets/kit/mount.mjs']);
  run('assemble', 'node', [script('assemble-index.mjs'), '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  run('render', cli, ['render', '--quality', 'high', '--output', `renders/bank-${key}.mp4`]);
  const placed = placeOpener(project);
  if (!placed.ok) throw new Error(`${key}: ${placed.errors.join('; ')}`);
  // the reel's own mix of frame 1: the led line, the bed (silent until the drop), the stem
  const after = JSON.parse(readFileSync(join(project, 'audio_meta.json'), 'utf8'));
  const wav = join(project, 'renders', `bank-${key}.wav`);
  run('mix', 'ffmpeg', ['-v', 'error', '-y', '-i', join(project, voice.path), '-i', join(project, after.bgm.path), '-i', join(project, 'assets', 'sfx', 'opener-stem.wav'),
    '-filter_complex', `[0:a]aformat=sample_rates=48000:channel_layouts=stereo[v];[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=${after.bgm.volume}[b];[2:a]aformat=sample_rates=48000:channel_layouts=stereo[s];[v][b][s]amix=inputs=3:normalize=0:duration=longest,atrim=0:${M.duration},alimiter=limit=0.95[out]`,
    '-map', '[out]', wav]);
  const out = join(OUT, `${key}.mp4`);
  run('mux', 'ffmpeg', ['-v', 'error', '-y', '-i', join(project, 'renders', `bank-${key}.mp4`), '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]);
  made.push(out);
  console.log(`✓ ${key} (${M.duration}s, voice at ${M.voiceAt}s, bed at ${placed.bedAt}s)`);
}
if (made.length > 1) {
  const inputs = made.flatMap((f) => ['-i', f]);
  const chain = made.map((_, i) => `[${i}:v]fps=30,format=yuv420p,setsar=1[v${i}];[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`).join(';');
  const cat = `${made.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${made.length}:v=1:a=1[v][a]`;
  run('concat', 'ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${chain};${cat}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', join(OUT, 'bank-all.mp4')]);
  console.log('✓ bank-all.mp4');
}
