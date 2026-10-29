// Zero-cost smoke test for the Reel AI Drama render engine (CONTRACT.md § B4).
//
// Builds a real job workspace with prepareWorkspace (the Explainer workspace one level down, our kit and
// the reel-ai-drama preset), writes the project from the fixture draft, plan and inventory with
// writeProjectFiles (banked cutouts and source photos, a logo, a saved page screenshot with its measured
// text box, a pre-rendered printed map), drops in the fixture frame modules, then runs the real pipeline:
// synthetic voices (a tone per word, so pace finds the words) → pace → music (two local stand-in beds
// through music.mjs's injectable search/download, so the change / drop / start cues are heard) →
// assembleProject (assemble, try, bounds) → silent voices → renderVideo → contactSheet.
// No model, no HeyGen, no network.
//
//   npx tsx explainers/reel-ai-drama/smoke/run-smoke.ts [--out <jobsRoot>] [--no-render]

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { assembleProject, contactSheet, prepareWorkspace, renderVideo, repace, writeProjectFiles } from '@/lib/reel-ai-drama/render';

const repo = process.cwd();
const here = path.join(repo, 'explainers', 'reel-ai-drama', 'smoke');
const fixture = path.join(here, 'fixture');
const outFlag = process.argv.indexOf('--out');
const jobsRoot = path.resolve(outFlag > 0 ? process.argv[outFlag + 1] : path.join(repo, '.explainers-local', 'reel-ai-drama', 'smoke-jobs'));
const JOB = 'smoke';

/** The fixture's media: [asset file under the job's media/, source in the repo]. */
const MEDIA: [string, string][] = [
  ['V1.jpg', 'explainers/real-case/bank/source/elon-musk.jpg'],
  ['V2.png', 'explainers/real-case/bank/cutouts/sam-altman.png'],
  ['V3.png', 'explainers/real-case/bank/cutouts/elon-musk.png'],
  ['V4.png', 'lib/social/render/assets/logos/openai.png'],
  ['V5.png', 'explainers/reel-ai-drama/smoke/fixture/media/V5.png'],
  ['V5.boxes.json', 'explainers/reel-ai-drama/smoke/fixture/media/V5.boxes.json'],
  ['V6.jpg', 'explainers/reel-ai-drama/smoke/fixture/media/V6.jpg'],
  ['V6.plain.jpg', 'explainers/reel-ai-drama/smoke/fixture/media/V6.plain.jpg'],
  ['V6.map.json', 'explainers/reel-ai-drama/smoke/fixture/media/V6.map.json'],
  ['V7.jpg', 'explainers/real-case/bank/source/jensen-huang.jpg'],
  ['V8.jpg', 'explainers/real-case/bank/source/demis-hassabis.jpg'],
];

function ff(args: string[]) {
  const res = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (res.status !== 0) throw new Error(`ffmpeg ${args.slice(-1)[0]}: ${res.stderr}`);
}
const step = (label: string, started: number) => console.log(`── ${label} (${((Date.now() - started) / 1000).toFixed(1)}s)`);

async function main() {
  let t0 = Date.now();
  fs.rmSync(path.join(jobsRoot, JOB), { recursive: true, force: true });
  const media = path.join(jobsRoot, JOB, 'media');
  fs.mkdirSync(media, { recursive: true });
  for (const [name, src] of MEDIA) fs.copyFileSync(path.join(repo, src), path.join(media, name));
  const ws = await prepareWorkspace({ jobsRoot, jobId: JOB });
  const project = ws.projectDir;
  step('workspace', t0);

  const read = (f: string) => JSON.parse(fs.readFileSync(path.join(fixture, f), 'utf8'));
  const written = writeProjectFiles(project, { draft: read('draft.json'), plan: read('plan.json'), inventory: read('inventory.json') });
  if (written.problems.length) throw new Error(`project files: ${written.problems.join('; ')}`);
  for (const f of fs.readdirSync(path.join(fixture, 'frames'))) fs.copyFileSync(path.join(fixture, 'frames', f), path.join(project, 'assets', 'frames', f));
  console.log(`   frames: ${written.frames.map((f: { id: string }) => f.id).join(', ')}`);

  // Synthetic voices: a 220 Hz tone per word, silence between, a tail the pace trims.
  t0 = Date.now();
  const script = fs.readFileSync(path.join(project, 'SCRIPT.md'), 'utf8');
  const lines = [...script.matchAll(/^##\s+.*\(Frame (\d+)\)\s*\n(?:\*\*.*\n)*\n?(?: {4})(.+)$/gm)].map((m) => [Number(m[1]), m[2].trim()] as const);
  const STEP = 0.32;
  const voices = lines.map(([frame, text]) => {
    let at = 0.2;
    const words = text.split(/\s+/).map((w) => {
      const word = { text: w, start: +at.toFixed(3), end: +(at + STEP * 0.8).toFixed(3) };
      at += STEP;
      return word;
    });
    const duration = +(words[words.length - 1].end + 0.4).toFixed(3);
    const rel = `assets/voice/frame-${String(frame).padStart(2, '0')}.wav`;
    fs.mkdirSync(path.join(project, 'assets', 'voice'), { recursive: true });
    const gate = words.map((w) => `between(t\\,${w.start}\\,${w.end})`).join('+');
    ff(['-f', 'lavfi', '-i', `aevalsrc=0.25*sin(2*PI*220*t)*(${gate}):s=44100:d=${duration}`, '-ac', '1', path.join(project, rel)]);
    return { frame, path: rel, duration_s: duration, words };
  });
  fs.writeFileSync(path.join(project, 'audio_meta.json'), `${JSON.stringify({ bgm: null, voices, sfx: [] }, null, 2)}\n`);
  await repace(project);
  step(`voice stand-in (${voices.length} lines) + pace`, t0);

  // Music: two local stand-in beds (a low drone and a darker pulse) through music.mjs's own pipeline.
  t0 = Date.now();
  const beds = path.join(path.dirname(project), 'beds');
  fs.mkdirSync(beds, { recursive: true });
  ff(['-f', 'lavfi', '-i', 'aevalsrc=0.2*sin(2*PI*55*t)*(0.6+0.4*sin(2*PI*0.5*t))+0.08*sin(2*PI*110*t):s=44100:d=90', '-ac', '2', path.join(beds, 'drone.mp3')]);
  ff(['-f', 'lavfi', '-i', 'aevalsrc=0.25*sin(2*PI*41*t)*(gt(mod(t\\,0.75)\\,0.6))+0.06*sin(2*PI*82*t):s=44100:d=90', '-ac', '2', path.join(beds, 'pulse.mp3')]);
  const music = await import(path.join(project, 'assets', 'kit', 'music.mjs'));
  let n = 0;
  const placed = await music.placeMusic(project, {
    search: async () => [{ id: `stand-in-${n}`, name: 'stand-in bed', audio_url: path.join(beds, n++ % 2 ? 'pulse.mp3' : 'drone.mp3'), duration: 90 }],
    download: async (url: string, dest: string) => fs.copyFileSync(url, dest),
  });
  if (!placed.ok) throw new Error(`music: ${placed.errors.join('; ')}`);
  console.log(`   music segments: ${placed.choice?.segments.map((s: { track: number; start: number; end: number }) => `track ${s.track} ${s.start}–${s.end}s`).join(', ')}`);
  step('music', t0);

  t0 = Date.now();
  const assembled = await assembleProject(project, { music: false });
  step('assemble + try + bounds', t0);
  console.log(`   ok: ${assembled.ok}`);
  for (const p of assembled.problems) console.log(`   problem: ${p}`);
  for (const w of assembled.warnings) console.log(`   warning: ${w}`);

  // The tones exist only so pace finds the words; the video gets silent stand-in voices.
  for (const v of JSON.parse(fs.readFileSync(path.join(project, 'audio_meta.json'), 'utf8')).voices as { path: string }[]) {
    const wav = path.join(project, v.path);
    const len = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }).stdout.trim();
    ff(['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', len, wav]);
  }
  if (process.argv.includes('--no-render')) {
    console.log(`project: ${project}`);
    return;
  }
  t0 = Date.now();
  const mp4 = await renderVideo(project);
  step('render', t0);
  const probe = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp4], { encoding: 'utf8' }).stdout.trim();
  const sheet = await contactSheet(project, mp4);
  console.log(`\n══ smoke: ${mp4}\n   ${(fs.statSync(mp4).size / 1e6).toFixed(2)} MB, ${Number(probe).toFixed(2)}s\n   contact sheet: ${sheet}\n   transcript: ${sheet.replace(/\.png$/, '.txt')}`);
}

main().catch((e) => {
  console.error(`✗ smoke: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
