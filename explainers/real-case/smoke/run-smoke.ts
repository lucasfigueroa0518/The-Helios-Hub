// Zero-cost smoke test for the AI News Explained render engine (N4c-2).
//
// Builds a real job workspace with prepareRealCaseWorkspace (the news kit, the ai-news frame.md, no
// opener), drops in the eight-frame Harbor City Transit fixture and synthetic voices (a tone per word,
// real gaps, one long pause to exercise the pause cap), then runs the real pipeline: assemble (pace →
// mount → sound → captions → index → transitions) → try → bounds → transitions verify → lint →
// snapshot → render. No model, no HeyGen (no music), no network.
//
//   npx tsx explainers/real-case/smoke/run-smoke.ts [--out <dir>] [--no-render]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { HYPERFRAMES_BIN } from '@/lib/explainers/render/workspace';
import { prepareRealCaseWorkspace } from '@/lib/real-case/render/workspace';
import type { StoryRow } from '@/lib/real-case/types';

const repo = process.cwd();
const here = path.join(repo, 'explainers', 'real-case', 'smoke');
const outFlag = process.argv.indexOf('--out');
const jobsRoot = path.resolve(outFlag > 0 ? process.argv[outFlag + 1] : path.join(repo, '.explainers-local', 'real-case', 'smoke-jobs'));
const env = { ...process.env, HYPERFRAMES_SKIP_SKILLS: '1', HYPERFRAMES_NO_TELEMETRY: '1', DO_NOT_TRACK: '1', HYPERFRAMES_NO_UPDATE_CHECK: '1' };

const story = {
  id: 'smoke',
  term: 'knowledge cutoff',
  title: 'The Trip Assistant That Sent Riders to a Closed Station',
  summary: 'A transit assistant sent riders to a closed station because its model only knew routes from before the closure.',
  story: { cast: [{ name: 'Harbor City Transit', kind: 'organization', role: 'ran the trip assistant' }] },
  claims: [],
} as unknown as StoryRow;

/** Voice lines and, per frame, the word after which the speaker pauses long (the pace caps it). */
const LINES: [number, string, number | null][] = [
  [1, 'On the first weekend, about 2,300 riders went to a station that was closed.', 3],
  [2, 'Harbor City Transit had launched an AI trip assistant in its app, to cut calls to its help line.', 11],
  [3, 'The assistant told riders to use Pier Street station. That station had closed in March.', 8],
  [4, 'Its station list was learned before the closure. It never saw the change.', 7],
  [5, 'The agency said: we are pausing the trip assistant while we fix its station list.', 2],
  [6, 'Two days later, the assistant was paused.', null],
  [7, 'So if an AI tells you where to go, check that the place is still open.', 8],
];
const STEP = 0.3;
const LONG_GAP = 0.7;

function run(label: string, cmd: string, args: string[], cwd: string, allowFail = false) {
  const started = Date.now();
  const res = spawnSync(cmd, args, { cwd, env, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  const out = `${res.stdout ?? ''}${res.stderr ?? ''}`;
  console.log(`\n── ${label} (${((Date.now() - started) / 1000).toFixed(1)}s, exit ${res.status})`);
  console.log(out.trim().split('\n').slice(-30).join('\n'));
  if (res.status !== 0 && !allowFail) {
    console.error(`✗ smoke: ${label} failed`);
    process.exit(1);
  }
  return res;
}

fs.rmSync(path.join(jobsRoot, 'smoke'), { recursive: true, force: true });
fs.mkdirSync(jobsRoot, { recursive: true });
const ws = prepareRealCaseWorkspace({ jobsRoot, jobId: 'smoke', story });
const project = ws.projectDir;
fs.cpSync(path.join(here, 'fixture'), project, { recursive: true });

// Synthetic voices: a 220 Hz tone per word, silence between, a trailing tail the pace trims.
const voices = LINES.map(([frame, line, pauseAfter]) => {
  let at = 0.25;
  const words = line.split(' ').map((text, i) => {
    const w = { text, start: +at.toFixed(3), end: +(at + STEP * 0.8).toFixed(3) };
    at += STEP + (pauseAfter === i ? LONG_GAP : 0);
    return w;
  });
  const duration = +(words[words.length - 1].end + 0.45).toFixed(3);
  const rel = `assets/voice/frame-${String(frame).padStart(2, '0')}.wav`;
  fs.mkdirSync(path.join(project, 'assets', 'voice'), { recursive: true });
  const gate = words.map((w) => `between(t\\,${w.start}\\,${w.end})`).join('+');
  const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc=0.25*sin(2*PI*220*t)*(${gate}):s=44100:d=${duration}`, '-ac', '1', path.join(project, rel)], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffmpeg voice ${frame}: ${res.stderr}`);
  return { frame, path: rel, duration_s: duration, words };
});
fs.writeFileSync(path.join(project, 'audio_meta.json'), `${JSON.stringify({ bgm: null, voices, sfx: [] }, null, 2)}\n`);

run('assemble (pace, mount, sound, captions, index, transitions)', 'node', ['assets/kit/assemble.mjs', '--no-music'], project);
run('kit try', 'node', ['assets/kit/try.mjs'], project);
run('kit bounds', 'node', ['assets/kit/bounds.mjs'], project, true);
const scripts = path.join(project, '.claude', 'skills', 'faceless-explainer', 'scripts');
run('transitions verify', 'node', [path.join(scripts, 'transitions.mjs'), 'verify', '--storyboard', './STORYBOARD.md', '--index', './index.html'], project, true);
run('hyperframes lint', HYPERFRAMES_BIN, ['lint'], project, true);
// The tones exist only so pace's silencedetect finds the words; the video gets silent voices.
for (const v of JSON.parse(fs.readFileSync(path.join(project, 'audio_meta.json'), 'utf8')).voices as { frame: number; path: string }[]) {
  const wav = path.join(project, v.path);
  const len = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }).stdout.trim();
  const res = spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', len, wav], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffmpeg silence ${v.frame}: ${res.stderr}`);
}
if (!process.argv.includes('--no-render')) {
  run('snapshot', HYPERFRAMES_BIN, ['snapshot', '--at', '0.3,2.2,3.6,4.6,7.5,12,17,21,26,29,31.5,34'], project, true);
  run('render', HYPERFRAMES_BIN, ['render', '--quality', 'high', '--output', 'renders/video.mp4'], project);
  const mp4 = path.join(project, 'renders', 'video.mp4');
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height', '-of', 'json', mp4], { encoding: 'utf8' });
  console.log(`\n══ smoke: ${(fs.statSync(mp4).size / 1e6).toFixed(2)} MB at ${mp4}\n${probe.stdout.replace(/\s+/g, ' ').trim()}`);
}
console.log(`  project: ${project}`);
