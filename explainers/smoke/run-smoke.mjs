#!/usr/bin/env node
// Zero-cost smoke test for Explainer Reels (BUILD_PLAN §10, M4; Explainers 3.3, EX3-50 to EX3-98).
//
// Builds a three-frame fixture project with the Helios preset and the world kit, and runs the
// real pipeline: build-frame → synthetic voice timings → pace → [music] → opener sounds → mount →
// try → bounds → sound design → captions → assemble-index → transitions → lint → check → snapshot →
// render. No model, no voice audio, and no HeyGen unless --music asks for the real music search
// (then run it with the HeyGen key: node --env-file=.env.local …). Reports render wall time, peak
// memory (/usr/bin/time), and the MP4's size and bitrate.
//
//   node explainers/smoke/run-smoke.mjs [--out <dir>] [--music]
//
// Needs: `npm install` in explainers/runtime (pinned hyperframes CLI), ffmpeg and ffprobe, and
// network access for the GSAP and perfect-freehand CDN scripts the frames load.

import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
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

// 2. Helios assets: fonts, logo, the world kit, the opener sounds. tokens.json names no colors
//    and no fonts, so build-frame keeps the Helios preset as authored.
cpSync(join(explainers, 'design', 'fonts'), join(project, 'assets', 'fonts'), {
  recursive: true,
  filter: (src) => !/\.(md|txt)$/.test(src),
});
cpSync(join(explainers, 'design', 'helios-design-system', 'assets', 'Helios-logo.png'), join(project, 'assets', 'Helios-logo.png'));
cpSync(join(explainers, 'world-kit'), join(project, 'assets', 'kit'), { recursive: true });
mkdirSync(join(project, 'assets', 'sfx'), { recursive: true });
for (const f of ['riser.mp3', 'impact-bass-1.mp3']) cpSync(join(explainers, 'design', 'sfx', f), join(project, 'assets', 'sfx', f));
symlinkSync(join(explainers, 'design', 'sfx'), join(project, 'assets', 'sfx-library'), 'dir');
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

// 4. Fixture storyboard, world and scene modules, and synthetic voice timings (no audio files).
//    Then the deterministic kit steps the orchestrator runs in a real job.
cpSync(join(here, 'fixture'), project, { recursive: true });
const words = (frame, line, from, step) => {
  const list = line.split(' ').map((text, i) => ({ text, start: from + i * step, end: from + i * step + step * 0.8 }));
  return { frame, duration_s: Number((list[list.length - 1].end + 0.06).toFixed(3)), words: list };
};
writeFileSync(join(project, 'audio_meta.json'), `${JSON.stringify({ bgm: null, voices: [
  words(1, 'In the next 30 seconds, this busy writer will teach you an AI concept.', 0.15, 0.25),
  words(2, 'Picture a pen copying the same long instructions onto every sheet, one costly line at a time.', 0.2, 0.36),
  words(3, 'Prompt caching is when a model provider saves the repeated start of your prompt, so later requests reuse it instead of reading it again.', 0.2, 0.33),
], sfx: [] }, null, 2)}\n`);
run('pace', 'node', ['assets/kit/pace.mjs']);
if (process.argv.includes('--music')) {
  // music.mjs reaches HeyGen through the pinned CLI's library, as in a job's project.
  if (!existsSync(join(project, 'node_modules'))) symlinkSync(join(explainers, 'runtime', 'node_modules'), join(project, 'node_modules'), 'dir');
  run('music', 'node', ['assets/kit/music.mjs']);
}
run('opener sounds', 'node', ['assets/kit/opener-sfx.mjs']);
run('kit mount', 'node', ['assets/kit/mount.mjs']);
run('kit try', 'node', ['assets/kit/try.mjs', 'all']);
run('kit bounds', 'node', ['assets/kit/bounds.mjs', 'all']);
run('sound design', 'node', ['assets/kit/sound.mjs']);
run('captions', 'node', [script('captions.mjs'), 'build', '--storyboard', './STORYBOARD.md', '--audio-meta', './audio_meta.json', '--hyperframes', '.', '--out', './caption_groups.json']);

// 5. Assemble, transitions, gates.
run('assemble-index', 'node', [script('assemble-index.mjs'), '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
run('transitions inject', 'node', [script('transitions.mjs'), 'inject', '--storyboard', './STORYBOARD.md', '--hyperframes', '.']);
run('transitions verify', 'node', [script('transitions.mjs'), 'verify', '--storyboard', './STORYBOARD.md', '--index', './index.html']);
const lint = run('lint', cli, ['lint'], { allowFail: true });
const check = run('check', cli, ['check'], { allowFail: true });
run('snapshot', cli, ['snapshot', '--at', '0.1,0.5,1.6,3.3,4.6,8.0,11.5,15.0,17.8,18.6,19.4,20.4'], { allowFail: true });

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
