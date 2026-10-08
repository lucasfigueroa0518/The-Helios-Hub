#!/usr/bin/env node
// Zero-cost smoke test for Explainer Reels (BUILD_PLAN §10, M4).
//
// Builds a two-frame fixture project with the Helios preset and runs the real
// HyperFrames pipeline: build-frame → assemble-index → transitions → lint →
// check → snapshot → render. No model, no HeyGen, no audio. Reports render
// wall time, peak memory (/usr/bin/time), and the MP4's size and bitrate.
//
//   node explainers/smoke/run-smoke.mjs [--out <dir>]
//
// Needs: `npm install` in explainers/runtime (pinned hyperframes CLI), ffprobe,
// and network access for the GSAP CDN script the frames load.

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const explainers = resolve(here, '..');
const skills = join(explainers, 'hyperframes-skills');
const script = (name) => join(skills, 'faceless-explainer', 'scripts', name);
const cli = join(explainers, 'runtime', 'node_modules', '.bin', 'hyperframes');

const outFlag = process.argv.indexOf('--out');
const workDir = resolve(outFlag > 0 ? process.argv[outFlag + 1] : join(explainers, 'smoke', '.out'));
const project = join(workDir, 'proj');

// Never let HyperFrames touch global skills, phone home, or nag about updates.
const env = {
  ...process.env,
  HYPERFRAMES_SKIP_SKILLS: '1',
  HYPERFRAMES_NO_TELEMETRY: '1',
  DO_NOT_TRACK: '1',
  HYPERFRAMES_NO_UPDATE_CHECK: '1',
};

function run(label, cmd, args, opts = {}) {
  const started = Date.now();
  const res = spawnSync(cmd, args, { cwd: opts.cwd ?? project, env, encoding: 'utf8' });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  console.log(`\n── ${label} (${secs}s, exit ${res.status})`);
  console.log(out.trim().split('\n').slice(-25).join('\n'));
  if (res.status !== 0 && !opts.allowFail) {
    console.error(`✗ smoke: ${label} failed`);
    process.exit(1);
  }
  return { ...res, out, secs: Number(secs) };
}

if (!existsSync(cli)) {
  console.error('✗ smoke: run `npm install` in explainers/runtime first');
  process.exit(1);
}

// 1. Fresh project (init refuses a non-empty directory).
rmSync(workDir, { recursive: true, force: true });
mkdirSync(workDir, { recursive: true });
run('init', cli, ['init', 'proj', '--non-interactive', '--example=blank'], { cwd: workDir });

// 2. Helios assets: fonts, logo, icons. tokens.json names no colors and no fonts,
//    so build-frame keeps the Helios preset as authored (its remix would collapse
//    Pragmatica + Roboto into one face). The preset carries its own @font-face block.
cpSync(join(explainers, 'design', 'fonts'), join(project, 'assets', 'fonts'), {
  recursive: true,
  filter: (src) => !/\.(md|txt)$/.test(src),
});
cpSync(join(explainers, 'design', 'helios-design-system', 'assets', 'Helios-logo.png'), join(project, 'assets', 'Helios-logo.png'));
cpSync(join(explainers, 'frame-presets', 'helios', 'icons'), join(project, 'assets', 'icons'), { recursive: true });
mkdirSync(join(project, 'capture', 'extracted'), { recursive: true });
writeFileSync(
  join(project, 'capture', 'extracted', 'tokens.json'),
  JSON.stringify({ title: 'Smoke test', description: 'Fixture', colors: [], fonts: [] }, null, 2),
);

// 3. Design system from the Helios preset.
run('build-frame', 'node', [
  script('build-frame.mjs'),
  '--preset', 'helios',
  '--preset-dir', join(explainers, 'frame-presets'),
  '--hyperframes', '.',
]);
const frameMd = readFileSync(join(project, 'frame.md'), 'utf8');
const faces = /## Font loading[\s\S]*?```html\n<style>\n([\s\S]*?)\n<\/style>\n```/.exec(frameMd)?.[1];
if (!faces) {
  console.error('✗ smoke: frame.md has no @font-face block');
  process.exit(1);
}
console.log(`  @font-face rules: ${faces.split('\n').length}`);

// 4. Fixture storyboard + frames, with fonts and icons injected the way a worker would.
cpSync(join(here, 'fixture'), project, { recursive: true });
const framesDir = join(project, 'compositions', 'frames');
for (const file of readdirSync(framesDir)) {
  const path = join(framesDir, file);
  let html = readFileSync(path, 'utf8').replace('/* FONT_FACES */', faces);
  html = html.replace(/<!-- ICON:([a-z0-9-]+) -->/g, (_, name) =>
    readFileSync(join(project, 'assets', 'icons', `${name}.svg`), 'utf8').replace(/<!--[\s\S]*?-->\s*/, ''),
  );
  writeFileSync(path, html);
}

// 5. Assemble, transitions, gates.
run('assemble-index', 'node', [script('assemble-index.mjs'), '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
run('transitions inject', 'node', [script('transitions.mjs'), 'inject', '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
run('transitions verify', 'node', [script('transitions.mjs'), 'verify', '--storyboard', './STORYBOARD.md', '--index', './index.html']);
const lint = run('lint', cli, ['lint'], { allowFail: true });
const check = run('check', cli, ['check'], { allowFail: true });
run('snapshot', cli, ['snapshot', '--at', '1.5,4.5'], { allowFail: true });

// 6. Render under /usr/bin/time for wall time and peak RSS.
const timeArgs = process.platform === 'darwin' ? ['-l'] : ['-v'];
const render = run('render', '/usr/bin/time', [
  ...timeArgs, cli, 'render', '--quality', 'high', '--output', 'renders/video.mp4',
]);
const rss = process.platform === 'darwin'
  ? Number(/(\d+)\s+maximum resident set size/.exec(render.out)?.[1] ?? NaN) / 1024 / 1024
  : Number(/Maximum resident set size \(kbytes\): (\d+)/.exec(render.out)?.[1] ?? NaN) / 1024;

const mp4 = join(project, 'renders', 'video.mp4');
if (!existsSync(mp4)) {
  console.error('✗ smoke: no MP4 was written');
  process.exit(1);
}
const probe = spawnSync('ffprobe', [
  '-v', 'error', '-show_entries', 'format=duration,bit_rate:stream=codec_name,width,height,r_frame_rate',
  '-of', 'json', mp4,
], { encoding: 'utf8' });

console.log('\n══ smoke summary');
console.log(`  lint:   exit ${lint.status}`);
console.log(`  check:  exit ${check.status}`);
console.log(`  render: ${render.secs}s wall, peak RSS of the render process tree root ${rss.toFixed(0)} MB`);
console.log(`  mp4:    ${(statSync(mp4).size / 1e6).toFixed(2)} MB at ${mp4}`);
console.log(`  probe:  ${probe.stdout.replace(/\s+/g, ' ').trim()}`);
console.log(`  contact sheet: ${join(project, 'snapshots')}`);
