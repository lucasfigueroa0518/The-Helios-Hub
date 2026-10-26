#!/usr/bin/env node
// Render the experimental openers for review (2026-10-19). No model, no network beyond the CDN
// scripts the frames load.
//
//   node explainers/design/intros/run-intros.mjs [01 02 …] [--cat batch-2.mp4]
//
// One HyperFrames project (like the smoke test) holds the agent-loop reel's world, its opener voice
// and its music bed. Each opener is mounted as that project's only frame and rendered silent; its
// sound (the voice, the bed, library sounds and a few synthesized breaks, scores.mjs) is mixed with
// ffmpeg and muxed in. Out: planning/Explainer Reels/intros/NN-name.mp4 and all-openers.mp4.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SCORES, mixArgs } from './scores.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '..', '..', '..');
const explainers = join(repo, 'explainers');
const cli = join(explainers, 'runtime', 'node_modules', '.bin', 'hyperframes');
const script = (name) => join(explainers, 'hyperframes-skills', 'faceless-explainer', 'scripts', name);
const REEL = join(repo, '.explainers-local', 'jobs', '1eb1a924-e532-49b4-976e-3e8b933444e5', 'project');
const work = join(here, '.out');
const project = join(work, 'proj');
const OUT = join(repo, 'planning', 'Explainer Reels', 'intros');
const env = { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };

function run(label, cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: opts.cwd ?? project, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (res.status !== 0 && !opts.allowFail) {
    console.error(`✗ ${label} failed:\n${`${res.stdout ?? ''}${res.stderr ?? ''}`.trim().split('\n').slice(-30).join('\n')}`);
    process.exit(1);
  }
  return res;
}

// 1. The project, once.
if (!existsSync(join(project, 'index.html')) && !existsSync(join(project, 'hyperframes.json'))) {
  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });
  run('init', cli, ['init', 'proj', '--non-interactive', '--example=blank'], { cwd: work });
  cpSync(join(explainers, 'design', 'fonts'), join(project, 'assets', 'fonts'), { recursive: true, filter: (s) => !/\.(md|txt)$/.test(s) });
  mkdirSync(join(project, 'capture', 'extracted'), { recursive: true });
  writeFileSync(join(project, 'capture', 'extracted', 'tokens.json'), JSON.stringify({ title: 'Openers', description: 'review', colors: [], fonts: [] }));
  run('build-frame', 'node', [script('build-frame.mjs'), '--preset', 'helios', '--preset-dir', join(explainers, 'frame-presets'), '--hyperframes', '.']);
}
// The kit and the reel's world (fresh every run).
cpSync(join(explainers, 'world-kit'), join(project, 'assets', 'kit'), { recursive: true });
cpSync(join(REEL, 'assets', 'world'), join(project, 'assets', 'world'), { recursive: true });
mkdirSync(join(project, 'assets', 'frames'), { recursive: true });
writeFileSync(join(project, 'audio_meta.json'), `${JSON.stringify({ bgm: null, voices: [], sfx: [] })}\n`);
// Node can load frame modules once try.mjs's hooks stub the CDN ink.
await import(pathToFileURL(join(project, 'assets', 'kit', 'try.mjs')).href);

mkdirSync(OUT, { recursive: true });
const argv = process.argv.slice(2);
const catAt = argv.indexOf('--cat');
const catName = catAt >= 0 ? argv[catAt + 1] : null;
const only = argv.filter((a, i) => i !== catAt && i !== catAt + 1);
const names = readdirSync(here).filter((f) => /^\d\d-[a-z]+\.js$/.test(f) && (!only.length || only.includes(f.slice(0, 2)))).sort();
const made = [];
for (const file of names) {
  const key = file.replace(/\.js$/, '');
  cpSync(join(here, 'shared.js'), join(project, 'assets', 'frames', 'shared.js'));
  cpSync(join(here, file), join(project, 'assets', 'frames', '01-opener.js'));
  const { META } = await import(`${pathToFileURL(join(project, 'assets', 'frames', '01-opener.js')).href}?${key}-${Date.now()}`);
  writeFileSync(join(project, 'STORYBOARD.md'), [
    '---', 'format: 1080x1920', `duration: ${META.duration}s`, 'music: none', '---', '',
    '## Frame 1 — Opener', '', `- duration: ${META.duration}s`, '- hold: 0s', '- transition_in: cut', '- status: animated',
    '- src: compositions/frames/01-opener.html', '- ground: paper', '- type: hook', '',
  ].join('\n'));
  writeFileSync(join(project, 'assets', 'frames', '01-opener.events.json'), '[]\n');
  run('mount', 'node', ['assets/kit/mount.mjs']);
  run('assemble', 'node', [script('assemble-index.mjs'), '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
  const silent = join(project, 'renders', `${key}.mp4`);
  run('render', cli, ['render', '--quality', 'high', '--output', `renders/${key}.mp4`]);
  // the sound, mixed and muxed
  const score = SCORES[key]?.(META);
  if (!score) throw new Error(`no score for ${key}`);
  const wav = join(project, 'renders', `${key}.wav`);
  run('mix', 'ffmpeg', mixArgs(score, META.duration, wav, { sfx: join(explainers, 'design', 'sfx'), voice: join(REEL, 'assets', 'voice', '01.wav'), music: join(REEL, 'assets', 'bgm', 'track.mp3') }));
  const out = join(OUT, `${key}.mp4`);
  run('mux', 'ffmpeg', ['-v', 'error', '-y', '-i', silent, '-i', wav, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', out]);
  made.push(out);
  console.log(`✓ ${key} (${META.duration}s)`);
}

/** A one-second title slate between openers ("01 · PAPER RIP"), drawn in the headless browser. */
const TITLES = { '01-rip': 'Paper Rip', '02-freeze': 'Record Scratch Freeze', '03-stamp': 'Stamp Slam', '04-type': 'Typewriter', '05-glitch': 'Paper Glitch', '06-bang': 'Big Bang', '07-knock': 'Knock Knock', '08-flap': 'Split-Flap Board', '09-rewind': 'Spoiler Rewind', '10-lights': 'Lights Out', '11-fog': 'Fog Wipe', '12-eye': 'Eye Zoom-Out', '13-sketch': 'Speed Sketch', '14-balloon': 'Balloon Pop', '15-blocks': 'Block Drop', '16-popup': 'Pop-Up Book', '17-box': 'Unboxing', '18-eraser': 'Eraser', '19-plane': 'Paper Plane', '20-scissors': 'Scissors Cut-Out' };
let browser = null;
async function slateImage(key, png) {
  if (!browser) {
    const { findChrome } = await import(pathToFileURL(join(project, 'assets', 'kit', 'bounds.mjs')).href);
    const { createRequire } = await import('node:module');
    const pptr = createRequire(join(explainers, 'runtime', 'node_modules', 'x.js'))('puppeteer-core');
    browser = await pptr.launch({ executablePath: findChrome(), headless: true });
  }
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1920 });
  const font = pathToFileURL(join(explainers, 'design', 'fonts', 'PragmaticaExtended-Bold.otf')).href;
  await page.setContent(`<html><head><style>@font-face{font-family:P;src:url("${font}")}body{margin:0;width:1080px;height:1920px;background:#F3F0EA;display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:P;color:#171717}div{font-size:220px;color:#FF5E1A}p{font-size:76px;margin:0 60px;text-align:center}</style></head><body><div>${key.slice(0, 2)}</div><p>${TITLES[key] ?? key}</p></body></html>`, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: png });
  await page.close();
}

// 2. All of them back to back (or the ones asked for, with --cat name.mp4), each after a slate.
if (!only.length || catName) {
  const list = [];
  for (const out of made) {
    const key = out.split('/').pop().replace(/\.mp4$/, '');
    const slate = join(project, 'renders', `slate-${key}.mp4`);
    const png = join(project, 'renders', `slate-${key}.png`);
    await slateImage(key, png);
    run('slate', 'ffmpeg', ['-v', 'error', '-y', '-loop', '1', '-t', '1', '-framerate', '30', '-i', png, '-f', 'lavfi', '-t', '1', '-i', 'anullsrc=r=48000:cl=stereo',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', slate]);
    list.push(slate, out);
  }
  const inputs = list.flatMap((f) => ['-i', f]);
  const chain = list.map((_, i) => `[${i}:v]fps=30,format=yuv420p,setsar=1[v${i}];[${i}:a]aformat=sample_rates=48000:channel_layouts=stereo[a${i}]`).join(';');
  const cat = `${list.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${list.length}:v=1:a=1[v][a]`;
  run('concat', 'ffmpeg', ['-v', 'error', '-y', ...inputs, '-filter_complex', `${chain};${cat}`, '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', join(OUT, catName ?? 'all-openers.mp4')]);
  console.log(`✓ ${catName ?? 'all-openers.mp4'}`);
}
if (browser) await browser.close();
