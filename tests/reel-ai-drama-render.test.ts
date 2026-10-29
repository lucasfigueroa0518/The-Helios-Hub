import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { Workspace } from '@/lib/explainers/render/workspace';
import {
  KIT_GUIDE, assembleProject, captionPages, captionTranscript, contactSheet, frameSpans, prepareWorkspace, readMusicHistory, recordMusicChoice,
  renderVideo, repace, runVoice, sameVoices, stillTimes, type Runner, type RunResult,
} from '@/lib/reel-ai-drama/render';
import { TREATMENTS } from '../explainers/reel-ai-drama/kit/frames.mjs';

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
  for (const d of ['assets/kit', 'assets/world', 'assets/sfx', '.claude/skills/helios-explainer-director', '.claude/skills/faceless-explainer/sub-agents']) fs.mkdirSync(path.join(projectDir, d), { recursive: true });
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
  const prompts = tmp();
  fs.writeFileSync(path.join(prompts, 'build-workflow.md'), '# our build workflow');
  const frames: string[] = [];
  const ws = await prepareWorkspace({ jobsRoot, jobId: 'job-1' }, { base: fakeBase as never, buildFrame: (p, presetDir) => { frames.push(presetDir); fs.writeFileSync(path.join(p, 'frame.md'), 'x'); }, promptsDir: prompts });
  assert.equal(ws.jobDir, path.join(path.resolve(jobsRoot), 'job-1'));
  assert.equal(ws.projectDir, path.join(ws.jobDir, 'render', 'project'));
  assert.ok(ws.tmpDir.endsWith('hx-job1'), 'a temp dir of its own, not the shared hx-render');
  assert.equal(fs.readFileSync(path.join(ws.jobDir, 'media', 'V1.jpg'), 'utf8'), 'harvested', 'the harvest survives');
  const p = (...s: string[]) => path.join(ws.projectDir, ...s);
  for (const f of ['assets/kit/try.mjs', 'assets/kit/FRAME.md', 'assets/kit/components/treatments.js', 'assets/kit/project-files.mjs', 'assets/fonts/Tinos-Regular.ttf', 'assets/Helios-mark.png', 'assets/media', 'assets/frames']) assert.ok(fs.existsSync(p(...f.split('/'))), f);
  for (const f of ['assets/kit/world.js', 'assets/kit/gallery.html', 'assets/kit/maps', 'assets/kit/fonts', 'assets/world', 'assets/opener.json', 'assets/sfx/riser.mp3', '.claude/skills/helios-explainer-director']) assert.ok(!fs.existsSync(p(...f.split('/'))), `${f} is gone`);
  assert.match(fs.readFileSync(p('CLAUDE.md'), 'utf8'), /assets\/kit\/FRAME\.md/);
  assert.equal(fs.readFileSync(p('.claude', 'skills', 'faceless-explainer', 'SKILL.md'), 'utf8'), '# our build workflow');
  assert.deepEqual(JSON.parse(fs.readFileSync(p('music-avoid.json'), 'utf8')), { used: 2, recent: ['t1'] });
  assert.ok(frames[0].endsWith(path.join('reel-ai-drama', 'presets')));
});

test('workspace: build-frame runs through the runner and its failure is an error', async () => {
  const jobsRoot = path.join(tmp(), 'jobs');
  const { run, calls } = recorder(() => ({ status: 1, stdout: '', stderr: 'no preset' }));
  await assert.rejects(prepareWorkspace({ jobsRoot, jobId: 'j' }, { base: fakeBase as never, run, promptsDir: tmp() }), /build-frame \(reel-ai-drama\) failed: no preset/);
  assert.ok(calls[0].args.includes('--preset') && calls[0].args.includes('reel-ai-drama'));
});

test('voice: audio.mjs, restore-spelling, sync-durations, then pace; the key and voice reach the env; a failure names its step', async () => {
  const project = tmp();
  const { run, calls } = recorder();
  await runVoice(project, { voiceId: 'v-1', heygenApiKey: 'k-1' }, { run });
  assert.equal(calls.length, 4);
  assert.ok(calls[0].args[0].endsWith('audio.mjs') && calls[0].args.includes('--voice') && calls[0].args.includes('v-1'));
  assert.deepEqual(calls[1].args, ['assets/kit/pronounce.mjs', 'restore']);
  assert.equal(calls[2].args[1], 'sync-durations');
  assert.deepEqual(calls[3].args, ['assets/kit/pace.mjs']);
  assert.equal(calls[0].env?.HEYGEN_API_KEY, 'k-1');
  assert.equal(calls[0].env?.HELIOS_VOICE_ID, 'v-1');
  assert.ok(calls.every((c) => c.cwd === project));
  const failing = recorder((_c, args) => (args[1] === 'sync-durations' ? { status: 1, stdout: '', stderr: 'boom' } : ok()));
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

test('contact sheet: the hook at 1.0s and one still per frame, tiled; the caption transcript beside it', async () => {
  const project = tmp();
  fs.writeFileSync(path.join(project, 'STORYBOARD.md'), STORYBOARD);
  fs.writeFileSync(path.join(project, 'caption_groups.json'), JSON.stringify({ groups: [{ start: 0.1, text: 'he put the money in.' }, { start: 4.3, text: 'it began at a dinner.' }] }));
  assert.deepEqual(frameSpans(STORYBOARD).map((s) => [s.treatment, s.start, s.end]), [['photo', 0, 4], ['map', 4, 10], ['close', 10, 12.5]]);
  assert.deepEqual(stillTimes(frameSpans(STORYBOARD)), [1, 2.4, 7.6, 11.5]);
  const { run, calls } = recorder();
  const png = await contactSheet(project, '/v.mp4', { run, cols: 3 });
  assert.equal(png, path.join(project, 'renders', 'contact-sheet.png'));
  assert.equal(calls.length, 6 + 1, 'two rows of three (two padded), then the tile');
  assert.ok(calls[0].args.includes('1') && calls[0].args.includes('/v.mp4'));
  assert.ok(calls[5].args.includes('lavfi'), 'the grid is padded');
  assert.ok(calls[6].args.some((a) => a.startsWith('tile=3x2')));
  const txt = fs.readFileSync(path.join(project, 'renders', 'contact-sheet.txt'), 'utf8');
  assert.match(txt, /Frame 2 \(map\): Dinner/);
  assert.match(txt, /\[0:04\.3\] it began at a dinner\./);
  assert.match(txt, /still 1: 0:01\.0/);
  assert.equal(captionTranscript(project), txt.slice(0, captionTranscript(project).length));
  const w = (text: string, start: number) => ({ text, start, end: start + 0.25 });
  assert.deepEqual(captionPages([
    { start: 0, text: 'he put', frame: 1, words: [w('he', 0), w('put', 0.3)] },
    { start: 0.6, text: 'the money in.', frame: 1, words: [w('the', 0.6), w('money', 0.9), w('in.', 1.2)] },
    { start: 1.6, text: 'it began', frame: 1, words: [w('it', 1.6), w('began', 1.9)] },
    { start: 2.4, text: 'here', frame: 2, words: [w('here', 2.4)] },
  ]), [{ start: 0, text: 'he put the money in.' }, { start: 1.6, text: 'it began' }, { start: 2.4, text: 'here' }], 'pages break at sentence ends and frames, like the skin');
});

test('music history: this format\'s own rotation, every track of the reel counted', () => {
  const jobsRoot = path.join(tmp(), 'jobs');
  const project = tmp();
  fs.mkdirSync(path.join(project, 'assets', 'bgm'), { recursive: true });
  fs.writeFileSync(path.join(project, 'assets', 'bgm', 'choice.json'), JSON.stringify({ id: 'a', ids: ['a', 'b'] }));
  assert.deepEqual(readMusicHistory(jobsRoot), { used: 0, recent: [] });
  assert.deepEqual(recordMusicChoice(jobsRoot, project), ['a', 'b']);
  assert.deepEqual(readMusicHistory(jobsRoot), { used: 1, recent: ['a', 'b'] });
});

test('KIT_GUIDE: the kit guide names every treatment, the music cues and the sound rules', () => {
  for (const t of TREATMENTS) assert.ok(KIT_GUIDE.includes(`\`${t}\``), t);
  for (const w of ['ambience', 'D-48', 'shown', 'start', 'change', 'drop', 'whoosh', 'render(t)', 'ctx.media', 'MD-41']) assert.ok(KIT_GUIDE.includes(w), w);
});
