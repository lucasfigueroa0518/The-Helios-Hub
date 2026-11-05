import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Workspace } from '@/lib/explainers/render/workspace';
import { stillTimes } from '@/lib/reel-ai-drama/render/video';
import {
  KIT_GUIDE, assembleProject, captionPages, captionTranscript, contactSheet, frameSpans, prepareWorkspace, readMusicHistory,
  renderVideo, repace, runVoice, sameVoices, type Runner, type RunResult,
} from '@/lib/reel-ai-drama/render';
import { cutPoints, frameStarts, scaleWords, scriptFrames, splitTake, takeGroups } from '@/lib/reel-ai-drama/render/voice';
import { DEFAULT_SETTINGS } from '@/lib/reel-ai-drama/settings';
import { TREATMENTS } from '../explainers/reel-ai-drama/kit/frames.mjs';

const near = (a: number, b: number, eps = 0.002) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rd-render-'));
const ok = (stdout = ''): RunResult => ({ status: 0, stdout, stderr: '' });

/** A stub runner that records every call and answers from a list of handlers. */
function recorder(answer: (cmd: string, args: string[]) => RunResult = () => ok()) {
  const calls: { cmd: string; args: string[]; cwd: string; env?: NodeJS.ProcessEnv }[] = [];
  const run: Runner = (cmd, args, opts) => {
    calls.push({ cmd, args, cwd: opts.cwd, env: opts.env });
    return answer(cmd, args);
  };
  return { run, calls };
}

/** The Explainer prepare, stubbed: the folders and files the overlay replaces or removes. */
function fakeBase(input: { jobsRoot: string; jobId: string }): Workspace {
  const jobDir = path.join(input.jobsRoot, input.jobId);
  fs.rmSync(jobDir, { recursive: true, force: true });
  const projectDir = path.join(jobDir, 'project');
  for (const d of ['assets/kit', 'assets/world', 'assets/sfx', '.claude/skills/helios-explainer-director', '.claude/skills/faceless-explainer/sub-agents', '.claude/skills/faceless-explainer/references']) fs.mkdirSync(path.join(projectDir, d), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'kit', 'world.js'), '');
  fs.writeFileSync(path.join(projectDir, 'assets', 'opener.json'), '{}');
  fs.writeFileSync(path.join(projectDir, 'assets', 'sfx', 'riser.mp3'), '');
  fs.writeFileSync(path.join(projectDir, '.claude', 'skills', 'faceless-explainer', 'SKILL.md'), 'explainer workflow');
  fs.mkdirSync(path.join(jobDir, 'home'), { recursive: true });
  return { jobDir, projectDir, homeDir: path.join(jobDir, 'home'), tmpDir: path.join(os.tmpdir(), 'hx-render') };
}

test('workspace: the Explainer prepare one level down, our kit and preset laid over it, harvest media kept', async () => {
  const jobsRoot = path.join(tmp(), 'jobs');
  fs.mkdirSync(path.join(jobsRoot, 'job-1', 'media'), { recursive: true });
  fs.writeFileSync(path.join(jobsRoot, 'job-1', 'media', 'V1.jpg'), 'harvested');
  fs.writeFileSync(path.join(path.dirname(jobsRoot), 'reel-ai-drama-music-history.json'), JSON.stringify({ used: 2, recent: ['t1'] }));
  const frames: string[] = [];
  const ws = await prepareWorkspace({ jobsRoot, jobId: 'job-1' }, { base: fakeBase as never, buildFrame: (p, presetDir) => { frames.push(presetDir); fs.writeFileSync(path.join(p, 'frame.md'), 'x'); } });
  assert.equal(ws.jobDir, path.join(path.resolve(jobsRoot), 'job-1'));
  assert.equal(ws.projectDir, path.join(ws.jobDir, 'render', 'project'));
  assert.ok(ws.tmpDir.endsWith('hx-job1'), 'a temp dir of its own, not the shared hx-render');
  assert.equal(fs.readFileSync(path.join(ws.jobDir, 'media', 'V1.jpg'), 'utf8'), 'harvested', 'the harvest survives');
  const p = (...s: string[]) => path.join(ws.projectDir, ...s);
  for (const f of ['assets/kit/try.mjs', 'assets/kit/FRAME.md', 'assets/kit/components/treatments.js', 'assets/kit/project-files.mjs', 'assets/fonts/Tinos-Regular.ttf', 'assets/Helios-mark.png', 'assets/media', 'assets/frames']) assert.ok(fs.existsSync(p(...f.split('/'))), f);
  for (const f of ['assets/kit/world.js', 'assets/kit/gallery.html', 'assets/kit/maps', 'assets/kit/fonts', 'assets/world', 'assets/opener.json', 'assets/sfx/riser.mp3', '.claude/skills/helios-explainer-director', '.claude/skills/faceless-explainer/references']) assert.ok(!fs.existsSync(p(...f.split('/'))), `${f} is gone`);
  assert.match(fs.readFileSync(p('CLAUDE.md'), 'utf8'), /assets\/kit\/FRAME\.md/);
  assert.deepEqual(JSON.parse(fs.readFileSync(p('music-avoid.json'), 'utf8')), { used: 2, recent: ['t1'], ledger: path.join(path.dirname(jobsRoot), 'reel-ai-drama-music-history.json'), job: 'job-1' });
  assert.ok(frames[0].endsWith(path.join('reel-ai-drama', 'presets')));
});

test('workspace: build-frame runs through the runner and its failure is an error', async () => {
  const jobsRoot = path.join(tmp(), 'jobs');
  const { run, calls } = recorder(() => ({ status: 1, stdout: '', stderr: 'no preset' }));
  await assert.rejects(prepareWorkspace({ jobsRoot, jobId: 'j' }, { base: fakeBase as never, run }), /build-frame \(reel-ai-drama\) failed: no preset/);
  assert.ok(calls[0].args.includes('--preset') && calls[0].args.includes('reel-ai-drama'));
});

const SCRIPT = `# SCRIPT

## L1 — Musk (Frame 1)

**Lines:** L1

    Elon Musk wanted Google's researcher.

## L2 — The call (Frame 2)

    So he called ILL-yuh at home.

## Closing question (Frame 3)

    Would you go?
`;

/** HeyGen's words for SCRIPT as one take (before the tempo): "ILL-yuh" comes back as two words. */
const TAKE_WORDS = [
  ['Elon', 0, 0.3], ['Musk', 0.35, 0.6], ['wanted', 0.65, 0.9], ["Google's", 0.95, 1.3], ['researcher.', 1.35, 1.9],
  ['So', 2.4, 2.5], ['he', 2.55, 2.65], ['called', 2.7, 3.0], ['ILL', 3.05, 3.2], ['yuh', 3.2, 3.35], ['at', 3.4, 3.5], ['home.', 3.55, 3.9],
  ['Would', 4.5, 4.7], ['you', 4.75, 4.85], ['go?', 4.9, 5.3],
].map(([text, start, end], i) => ({ id: `w${i}`, text: text as string, start: start as number, end: end as number }));

/** A stub HeyGen + ffmpeg: the take's words (unless `words` is false), a 5s sped-up take, one silence between frames 1 and 2. */
function voiceRunner(project: string, { words = true }: { words?: boolean } = {}) {
  const write = (rel: string) => {
    fs.mkdirSync(path.dirname(path.join(project, rel)), { recursive: true });
    fs.writeFileSync(path.join(project, rel), 'wav');
  };
  return recorder((cmd, args) => {
    if (args[0]?.endsWith('heygen-tts.mjs')) {
      write(args[args.indexOf('-o') + 1]!);
      if (words) fs.writeFileSync(path.join(project, args[args.indexOf('--words') + 1]!), JSON.stringify(TAKE_WORDS));
      return ok('✓ take');
    }
    if (args[0]?.endsWith('audio.mjs') && !args.includes('sync-durations')) {
      write('assets/voice/01.wav');
      fs.writeFileSync(path.join(project, 'audio_meta.json'), JSON.stringify({ bgm: null, voices: [{ frame: 1, path: 'assets/voice/01.wav', duration_s: 2.24, words: [{ id: 'w0', text: 'Elon', start: 0, end: 1.12 }] }], sfx: [] }));
      return ok();
    }
    if (cmd === 'ffprobe') return ok('5.000\n');
    if (cmd === 'ffmpeg' && args.some((a) => a.startsWith('silencedetect'))) {
      return { status: 0, stdout: '', stderr: '[silencedetect @ 0x1] silence_start: 1.72\n[silencedetect @ 0x1] silence_end: 2.12 | silence_duration: 0.4\n' };
    }
    if (cmd === 'ffmpeg') write(path.relative(project, path.resolve(project, args[args.length - 1]!)));
    return ok();
  });
}

test('voice (MD-93): the script frames, grouped into takes, aligned to the spoken words and cut at the silences', () => {
  const frames = scriptFrames(SCRIPT);
  assert.deepEqual(frames.map((f) => f.frame), [1, 2, 3]);
  assert.equal(frames[1]!.text, 'So he called ILL-yuh at home.');
  assert.deepEqual(takeGroups(frames).map((g) => g.length), [3]);
  assert.deepEqual(takeGroups(frames, 45).map((g) => g.map((f) => f.frame)), [[1], [2, 3]], 'a long script splits at frame boundaries');
  // A split respelling ("ILL", "yuh") still lines up.
  assert.deepEqual(frameStarts(frames, TAKE_WORDS), [0, 5, 12]);
  assert.equal(frameStarts(frames, TAKE_WORDS.slice(0, 12)), null, 'a frame with no spoken word fails the split');
  const words = scaleWords(TAKE_WORDS, 1.12);
  near(words[5]!.start, 2.4 / 1.12);
  // Frame 1 → 2 cuts mid-silence; frame 2 → 3 has no measured silence, so halfway across the gap.
  const cuts = cutPoints(words, [0, 5, 12], [[1.72, 2.12]], 5);
  assert.deepEqual(cuts.slice(0, 2), [0, 1.92]);
  near(cuts[2]!, (3.9 / 1.12 + 4.5 / 1.12) / 2);
  assert.equal(cuts[3], 5);
  const parts = splitTake(words, [0, 5, 12], cuts);
  assert.deepEqual(parts.map((p) => p.words.length), [5, 7, 3]);
  assert.equal(parts[1]!.words[0]!.id, 'w0');
  near(parts[1]!.words[0]!.start, 2.4 / 1.12 - 1.92);
  assert.ok(parts.every((p) => p.words.every((w) => w.start >= 0 && w.end <= p.end - p.start + 1e-9)));
});

test('voice: one HeyGen take, sped up by voice_tempo, split per frame into the frame-keyed audio_meta.json; then restore-spelling, sync-durations, pace', async () => {
  const project = tmp();
  fs.writeFileSync(path.join(project, 'SCRIPT.md'), SCRIPT);
  fs.mkdirSync(path.join(project, 'assets', 'voice', 'orig'), { recursive: true });
  fs.writeFileSync(path.join(project, 'assets', 'voice', 'orig', '01.wav'), 'stale');
  fs.mkdirSync(path.join(project, 'assets', 'sfx'), { recursive: true });
  fs.writeFileSync(path.join(project, 'assets', 'sfx', 'events.wav'), 'x');
  const host = { frame: 1, file: 'assets/sfx/events.wav', offset_s: 0, duration_s: 9, volume: 0.9, source: 'host' };
  fs.writeFileSync(path.join(project, 'audio_meta.json'), JSON.stringify({ bgm: null, voices: [{ frame: 9 }], sfx: [host] }));
  const { run, calls } = voiceRunner(project);
  const result = await runVoice(project, { voiceId: 'v-1', heygenApiKey: 'k-1', tempo: 1.12, silentBeatMax: 0.8 }, { run });
  assert.deepEqual(result, { take: 'one', takes: 1, notes: [] });
  const take = calls.find((c) => c.args[0]?.endsWith('heygen-tts.mjs'))!;
  assert.ok(take.args.includes('--voice') && take.args.includes('v-1') && take.args.includes('--words'));
  assert.equal(take.env?.HEYGEN_API_KEY, 'k-1');
  assert.equal(fs.readFileSync(path.join(project, take.args[1]!), 'utf8').trim(), "Elon Musk wanted Google's researcher. So he called ILL-yuh at home. Would you go?");
  assert.ok(calls.some((c) => c.cmd === 'ffmpeg' && c.args.includes('atempo=1.12')));
  assert.ok(!calls.some((c) => c.args[0]?.endsWith('audio.mjs') && !c.args.includes('sync-durations')), 'no per-frame clips');
  assert.deepEqual(calls.slice(-3).map((c) => c.args[1] === 'sync-durations' ? 'sync' : c.args.join(' ')), ['assets/kit/pronounce.mjs restore', 'sync', 'assets/kit/pace.mjs']);
  assert.ok(calls.every((c) => c.cwd === project));

  const meta = JSON.parse(fs.readFileSync(path.join(project, 'audio_meta.json'), 'utf8'));
  assert.deepEqual(meta.voices.map((v: { frame: number; path: string }) => [v.frame, v.path]), [[1, 'assets/voice/01.wav'], [2, 'assets/voice/02.wav'], [3, 'assets/voice/03.wav']]);
  near(meta.voices.reduce((n: number, v: { duration_s: number }) => n + v.duration_s, 0), 5);
  assert.deepEqual(meta.voices[1].words.map((w: { text: string }) => w.text), ['So', 'he', 'called', 'ILL', 'yuh', 'at', 'home.']);
  assert.deepEqual(meta.sfx, [host], "the host's sounds are kept");
  assert.equal(meta.bgm, null);
  assert.ok(!fs.existsSync(path.join(project, 'assets', 'voice', 'orig')), "pace never starts from the old voice's originals");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(project, 'pace.json'), 'utf8')), { silent_beat_max: 0.8 });
  assert.ok(fs.existsSync(path.join(project, 'assets', 'voice', 'take', 'take.json')));
});

test('voice: a take without word timestamps falls back to per-frame clips (sped up too); a failing step is named', async () => {
  const project = tmp();
  fs.writeFileSync(path.join(project, 'SCRIPT.md'), SCRIPT);
  const { run, calls } = voiceRunner(project, { words: false });
  const result = await runVoice(project, { voiceId: 'v-1', heygenApiKey: 'k-1' }, { run });
  assert.equal(result.take, 'per_frame');
  assert.match(result.notes.join(), /without word timestamps.*voiced one by one/);
  const clips = calls.find((c) => c.args[0]?.endsWith('audio.mjs') && !c.args.includes('sync-durations'))!;
  assert.ok(clips.args.includes('--voice') && clips.args.includes('v-1'));
  assert.ok(calls.some((c) => c.cmd === 'ffmpeg' && c.args.includes(`atempo=${DEFAULT_SETTINGS.voice_tempo}`)), 'the default tempo');
  const meta = JSON.parse(fs.readFileSync(path.join(project, 'audio_meta.json'), 'utf8'));
  assert.equal(meta.voices[0].duration_s, 5, 'the sped-up clip is measured again');
  near(meta.voices[0].words[0].end, 1);

  const failing = recorder((_c, args) => (args[1] === 'sync-durations' ? { status: 1, stdout: '', stderr: 'boom' } : voiceRunner(project).run(_c, args, { cwd: project })));
  await assert.rejects(runVoice(project, { voiceId: 'v', heygenApiKey: 'k' }, { run: failing.run }), /sync-durations failed: boom/);
  const again = recorder();
  await repace(project, { run: again.run });
  assert.deepEqual(again.calls[0].args, ['assets/kit/pace.mjs']);
});

test('voice: a rewritten storyboard that speaks the same words only needs repace', () => {
  const sb = (q: string) => `## Frame 1 — A\n\n- duration: 3s\n- voiceover: "one"\n\n## Frame 2 — Close\n\n- treatment: close\n- voiceover: "${q}"\n`;
  assert.ok(sameVoices(sb('why?'), sb('why?').replace('- duration: 3s', '- duration: 4s\n- treatment: map')));
  assert.ok(!sameVoices(sb('why?'), sb('how?')));
});

test('assemble: assemble, try, bounds and screen; breakage comes back as problems, never thrown', async () => {
  const answers: Record<string, RunResult> = {
    'assets/kit/assemble.mjs': { status: 1, stdout: JSON.stringify({ ok: false, errors: ['music: no track passed'] }), stderr: '' },
    'assets/kit/try.mjs': { status: 1, stdout: JSON.stringify({ ok: false, errors: ['01-a: render threw: x'], warnings: ['the reel runs 40.0s; aim for about 60s, at most 75s'] }), stderr: '' },
    'assets/kit/bounds.mjs': ok(JSON.stringify({ ok: true, errors: [], checked: 0, skipped: 'no browser' })),
    'assets/kit/screen.mjs': ok(JSON.stringify({ ok: true, errors: [], checked: 0, skipped: 'no browser' })),
  };
  const { run, calls } = recorder((_c, args) => answers[args[0]]);
  const r = await assembleProject(tmp(), { heygenApiKey: 'k', music: false }, { run });
  assert.deepEqual(calls.map((c) => c.args[0]), ['assets/kit/assemble.mjs', 'assets/kit/try.mjs', 'assets/kit/bounds.mjs', 'assets/kit/screen.mjs']);
  assert.ok(calls[0].args.includes('--no-music'));
  assert.equal(r.ok, false);
  assert.deepEqual(r.problems, ['assemble: music: no track passed', 'try: 01-a: render threw: x']);
  assert.ok(r.warnings.some((w) => /about 60s/.test(w)) && r.warnings.some((w) => /bounds skipped/.test(w)));
  const broken = recorder((_c, args) => { if (args[0].includes('try')) throw new Error('spawn failed'); return { status: 2, stdout: 'not json', stderr: 'crash' }; });
  const r2 = await assembleProject(tmp(), {}, { run: broken.run });
  assert.equal(r2.ok, false);
  assert.ok(r2.problems.some((p) => /assemble failed: crash/.test(p)) && r2.problems.some((p) => /try: spawn failed/.test(p)));
  const clean = recorder(() => ok(JSON.stringify({ ok: true, errors: [] })));
  assert.deepEqual(await assembleProject(tmp(), {}, { run: clean.run }), { ok: true, problems: [], warnings: [] });
});

test('render: HyperFrames writes renders/video.mp4; a failed render throws', async () => {
  const project = tmp();
  const { run, calls } = recorder(() => {
    fs.writeFileSync(path.join(project, 'renders', 'video.mp4'), 'mp4');
    return ok();
  });
  assert.equal(await renderVideo(project, { run, bin: 'hf' }), path.join(project, 'renders', 'video.mp4'));
  assert.deepEqual(calls[0].args.slice(0, 1), ['render']);
  assert.ok(calls[1].args.some((a) => a.startsWith('loudnorm=I=-14:TP=-1')), 'the audio is mastered to Reels loudness');
  const bad = recorder(() => ({ status: 1, stdout: '', stderr: 'chrome died' }));
  await assert.rejects(renderVideo(tmp(), { run: bad.run, bin: 'hf' }), /chrome died/);
});

const STORYBOARD = `---\nformat: 1080x1920\n---\n\n## Frame 1 — Money\n\n- duration: 4s\n- treatment: photo\n\n## Frame 2 — Dinner\n\n- duration: 6s\n- treatment: map\n\n## Frame 3 — Close\n\n- duration: 2.5s\n- treatment: close\n`;

test('contact sheet: the first instant, the hook at 1.0s and one still per frame, tiled; the caption transcript beside it', async () => {
  const project = tmp();
  fs.writeFileSync(path.join(project, 'STORYBOARD.md'), STORYBOARD);
  fs.writeFileSync(path.join(project, 'caption_groups.json'), JSON.stringify({ groups: [{ start: 0.1, text: 'he put the money in.' }, { start: 4.3, text: 'it began at a dinner.' }] }));
  assert.deepEqual(frameSpans(STORYBOARD).map((s) => [s.treatment, s.start, s.end]), [['photo', 0, 4], ['map', 4, 10], ['close', 10, 12.5]]);
  assert.deepEqual(stillTimes(frameSpans(STORYBOARD)), [0.1, 1, 2.4, 7.6, 11.5]);
  const { run, calls } = recorder();
  const png = await contactSheet(project, '/v.mp4', { run, cols: 3 });
  assert.equal(png, path.join(project, 'renders', 'contact-sheet.png'));
  assert.equal(calls.length, 6 + 1, 'two rows of three (one padded), then the tile');
  assert.ok(calls[0].args.includes('0.1') && calls[0].args.includes('/v.mp4'));
  assert.ok(calls[1].args.includes('1'));
  assert.ok(calls[5].args.includes('lavfi'), 'the grid is padded');
  assert.ok(calls[6].args.some((a) => a.startsWith('tile=3x2')));
  const txt = fs.readFileSync(path.join(project, 'renders', 'contact-sheet.txt'), 'utf8');
  assert.match(txt, /Frame 2 \(map\): Dinner/);
  assert.match(txt, /\[0:04\.3\] it began at a dinner\./);
  assert.match(txt, /still 1: 0:00\.1/);
  assert.match(txt, /still 2: 0:01\.0/);
  assert.equal(captionTranscript(project), txt.slice(0, captionTranscript(project).length));
  const w = (text: string, start: number) => ({ text, start, end: start + 0.25 });
  assert.deepEqual(captionPages([
    { start: 0, text: 'he put', frame: 1, words: [w('he', 0), w('put', 0.3)] },
    { start: 0.6, text: 'the money in.', frame: 1, words: [w('the', 0.6), w('money', 0.9), w('in.', 1.2)] },
    { start: 1.6, text: 'it began', frame: 1, words: [w('it', 1.6), w('began', 1.9)] },
    { start: 2.4, text: 'here', frame: 2, words: [w('here', 2.4)] },
  ]), [{ start: 0, text: 'he put the money in.' }, { start: 1.6, text: 'it began' }, { start: 2.4, text: 'here' }], 'pages break at sentence ends and frames, like the skin');
});

test('music history: this format\'s own rotation; with no history file, past jobs\' tracks seed it', () => {
  const jobsRoot = path.join(tmp(), 'jobs');
  assert.deepEqual(readMusicHistory(jobsRoot), { used: 0, recent: [] });
  const bgm = path.join(jobsRoot, 'job-a', 'render', 'project', 'assets', 'bgm');
  fs.mkdirSync(bgm, { recursive: true });
  fs.writeFileSync(path.join(bgm, 'choice.json'), JSON.stringify({ id: 'a', ids: ['a', 'b'] }));
  assert.deepEqual(readMusicHistory(jobsRoot), { used: 1, recent: ['a', 'b'], reels: [{ job: 'job-a', ids: ['a', 'b'] }] });
});

test('KIT_GUIDE: the kit guide names every treatment, the music cues and the sound rules', () => {
  for (const t of TREATMENTS) assert.ok(KIT_GUIDE.includes(`\`${t}\``), t);
  for (const w of ['ambience', 'D-48', 'shown', 'start', 'change', 'drop', 'whoosh', 'render(t)', 'ctx.media', 'MD-41']) assert.ok(KIT_GUIDE.includes(w), w);
});
