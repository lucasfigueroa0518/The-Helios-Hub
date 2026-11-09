import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { applyNewsKit, readRealCaseMusicHistory, realCaseMusicHistoryPath, recordRealCaseMusicChoice } from '@/lib/real-case/render/workspace';
import type { StoryRow } from '@/lib/real-case/types';
import { CLOSE_FRAME, STING_HOLD, frameGround, isClose, parseFrames, stingAt, writeStingEvents } from '../explainers/real-case/kit/frames.mjs';
import { darkWindows, frameHtml, quietWindows } from '../explainers/real-case/kit/mount.mjs';
import { holdFor, pacedStoryboard } from '../explainers/real-case/kit/pace.mjs';
import { eventsFileProblems, sourceProblems, storyboardProblems } from '../explainers/real-case/kit/try.mjs';
import { MIN_TEXT_PX, coverProblems, textProblems, wallProblems } from '../explainers/real-case/kit/bounds.mjs';
import { css } from '../explainers/real-case/kit/components/style.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rc-engine-'));
const KIT = path.join(process.cwd(), 'explainers', 'real-case', 'kit');

function storyboard(grounds: string[], { closeVoice = '' } = {}): string {
  const frames = grounds.map((g, i) => {
    const n = i + 1;
    const close = n === 8;
    return [
      `## Frame ${n} — F${n}`,
      '',
      `- duration: ${close ? 2.5 : 4}s`,
      ...(n === 1 ? ['- voice_end: 2.8s'] : []),
      `- src: compositions/frames/0${n}-f.html`,
      `- ground: ${g}`,
      ...(close && !closeVoice ? [] : [`- voiceover: "${close ? closeVoice : `line ${n}`}"`]),
      '',
    ].join('\n');
  });
  return `---\nformat: 1080x1920\n---\n\n${frames.join('\n')}`;
}
const GROUNDS = ['board', 'newspaper', 'board', 'whiteboard', 'newspaper', 'board', 'whiteboard', 'board'];

test('frames: grounds, the close, the sting from the voice end', () => {
  const frames = parseFrames(storyboard(GROUNDS));
  assert.equal(frames.length, 8);
  assert.equal(frameGround(frames[3]), 'whiteboard');
  assert.equal(frameGround({ fields: {} }), 'board');
  assert.ok(isClose(frames[CLOSE_FRAME - 1]));
  assert.ok(!isClose(parseFrames(storyboard(GROUNDS, { closeVoice: 'follow for more' }))[7]), 'a voiced frame 8 is not the close');
  assert.equal(stingAt(frames[0]), 2.8);
  assert.equal(holdFor(1), STING_HOLD);
  assert.equal(holdFor(3, 0.5), 0.15);
});

test('pace: frame 1 keeps the sting hold; the close is 2.5s, all hold', () => {
  const { paced } = pacedStoryboard(storyboard(GROUNDS), [{ frame: 1, duration_s: 3 }, { frame: 2, duration_s: 4 }]);
  assert.deepEqual(paced.find((p: { frame: number }) => p.frame === 1), { frame: 1, voice: 3, hold: STING_HOLD, duration: 3 + STING_HOLD });
  assert.deepEqual(paced.find((p: { frame: number }) => p.frame === 8), { frame: 8, voice: 0, hold: 2.5, duration: 2.5 });
});

test('mount: captions turn light on the cork, step aside for the sting and the close', () => {
  const frames = parseFrames(storyboard(GROUNDS));
  // Frames 1 board, 2 newspaper, 3 board: dark windows are the board frames only (not the close).
  assert.deepEqual(darkWindows(frames).slice(0, 2), [[0, 4], [8, 12]]);
  assert.ok(!darkWindows(frames).some(([a]: number[]) => a >= 28), 'the close is never a dark window');
  assert.deepEqual(quietWindows(frames), [[2.8, 4], [28, 30.5]]);
  const f1 = frameHtml('01-f', 4, { ground: 'board', sting: { at: 2.8 } as never });
  assert.ok(f1.includes("import { buildSting } from './assets/kit/sting.js';"));
  assert.ok(!frameHtml('02-f', 4, { ground: 'newspaper' }).includes('buildSting'));
  assert.throws(() => frameHtml('03-f', 4, { ground: 'iso' }), /ground "iso"/);
});

test('sting events are appended to frame 1, replaced on every run, and keep the worker’s own', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'assets', 'frames'), { recursive: true });
  const file = path.join(root, 'assets', 'frames', '01-f.events.json');
  fs.writeFileSync(file, JSON.stringify([{ t: 0, kind: 'foley', what: 'paper drop' }, { t: 3.5, kind: 'foley', what: 'too late' }]));
  const f = { id: '01-f', number: 1, duration: 4, fields: { voice_end: '2.8s' } };
  writeStingEvents(root, f);
  writeStingEvents(root, f);
  const list = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(list.filter((e: { what: string }) => e.what === 'paper drop').length, 1);
  assert.ok(!list.some((e: { what: string }) => e.what === 'too late'), 'worker sounds inside the sting are dropped');
  const sting = list.filter((e: { sting?: boolean }) => e.sting);
  assert.ok(sting.length >= 2 && sting.every((e: { t: number }) => e.t >= 2.8));
  assert.equal(new Set(sting.map((e: { t: number; what: string }) => `${e.t}${e.what}`)).size, sting.length, 'no duplicates after two runs');
});

test('try: purity, fasteners of the live render, and the storyboard shape', () => {
  assert.deepEqual(sourceProblems("export default { ground: 'board', build() {}, render() {} };"), []);
  const bad: string[] = sourceProblems("import x from 'gsap';\nexport default {};\nel.style.visibility = 'visible';\nel.style.filter = 'url(#nk-felt)';\nMath.random();");
  assert.ok(bad.some((p: string) => p.includes('imports gsap')));
  assert.ok(bad.some((p: string) => p.includes('visibility to visible')));
  assert.ok(bad.some((p: string) => p.includes('SVG filter')));
  assert.ok(bad.some((p: string) => p.includes('Math.random')));
  assert.deepEqual(storyboardProblems(parseFrames(storyboard(GROUNDS))), []);
  const noPaper = storyboardProblems(parseFrames(storyboard(GROUNDS.map((g) => (g === 'newspaper' ? 'board' : g)))));
  assert.ok(noPaper.some((p: string) => p.includes('newspaper')));
  assert.ok(eventsFileProblems([{ t: 0.2, kind: 'whoosh' }], 4).some((p: string) => p.includes('decorative')));
  assert.deepEqual(eventsFileProblems(null, 4), ['has no events file (every visible action has its sound)']);
});

test('bounds: caption band, frame edge, and the minimum readable size', () => {
  const ok = textProblems([{ label: 'a', rect: [100, 700, 900, 760], paper: null, px: 40 }]);
  assert.deepEqual(ok, []);
  const why = textProblems([
    { label: 'band', rect: [100, 300, 900, 360], paper: null, px: 40 },
    { label: 'tiny', rect: [100, 900, 300, 920], paper: null, px: MIN_TEXT_PX - 4 },
  ]).map((p: { label: string; why: string }) => `${p.label}: ${p.why}`);
  assert.ok(why.some((w: string) => w.startsWith('band: sits under the captions')));
  assert.ok(why.some((w: string) => w.startsWith('tiny: is too small')));
});

test('bounds: pins, magnets, tape and cords never cover a photo; its edge is allowed (RC-50)', () => {
  const photos = [{ rect: [100, 100, 500, 600] }];
  assert.deepEqual(coverProblems({ photos, fasteners: [{ kind: 'push pin', rect: [280, 90, 320, 130] }] }), [], 'a pin on the top edge');
  assert.deepEqual(coverProblems({ photos, fasteners: [{ kind: 'magnet', rect: [600, 300, 690, 390] }], cords: [{ points: [[600, 50], [900, 900]] }] }), []);
  const bad = coverProblems({ photos, fasteners: [{ kind: 'magnet', rect: [250, 250, 340, 340] }], cords: [{ points: [[0, 0], [300, 350], [900, 900]] }] });
  assert.deepEqual(bad.map((p: { label: string }) => p.label), ['magnet', 'cord']);
});

test('bounds: the whiteboard holds only the artifact and logos on magnets (RC-49)', () => {
  assert.deepEqual(wallProblems('whiteboard', ['printout', 'logo', 'magnet']), []);
  assert.deepEqual(wallProblems('board', ['photo cutout', 'push pin', 'cord']), []);
  assert.deepEqual(wallProblems('whiteboard', ['photo cutout', 'push pin', 'magnet']).map((p: { label: string }) => p.label), ['photo cutout', 'push pin']);
});

test('the kit never gives a live element an SVG filter or forces visibility (HyperFrames shows both through hidden frames)', () => {
  const sheet = css('assets/kit/textures/');
  assert.ok(!/filter\s*:\s*url\(/.test(sheet));
  for (const f of ['cork.png', 'paper.png', 'grain.png', 'ink.png', 'dryerase.png']) assert.ok(fs.existsSync(path.join(KIT, 'textures', f)), f);
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const file of walk(KIT).filter((f) => /\.(js|mjs)$/.test(f))) {
    assert.ok(!/visibility\s*=\s*[^;]*'visible'/.test(fs.readFileSync(file, 'utf8')), `${path.relative(KIT, file)} forces visibility`);
  }
});

test('the story’s banked art lands in assets/bank with credits; a private person never does', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'assets', 'sfx'), { recursive: true });
  const story = {
    story: {
      cast: [
        { name: 'OpenAI', kind: 'organization', role: 'made the model' },
        { name: 'Sam Altman', kind: 'public_figure', role: 'CEO' },
        { name: 'a rider', kind: 'private_person', role: 'followed it' },
      ],
    },
  } as unknown as StoryRow;
  applyNewsKit(root, story, { buildFrame: () => {}, musicHistory: { used: 2, recent: ['a', 'b'] } });
  const credits = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'bank', 'credits.json'), 'utf8'));
  assert.deepEqual(credits.map((c: { player: string; kind: string }) => `${c.player}:${c.kind}`).sort(), ['OpenAI:logo', 'Sam Altman:cutout']);
  for (const c of credits) {
    assert.ok(fs.existsSync(path.join(root, c.file)), c.file);
    assert.ok(c.credit);
  }
  assert.ok(fs.existsSync(path.join(root, 'assets', 'kit', 'textures', 'cork.png')));
  assert.ok(!fs.existsSync(path.join(root, 'assets', 'kit', 'bake-textures.mjs')));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'music-avoid.json'), 'utf8')), { used: 2, recent: ['a', 'b'] });
});

test('music rotation: this format’s own history, never the Explainer one', () => {
  const root = tmp();
  const jobsRoot = path.join(root, 'jobs');
  const project = path.join(root, 'project');
  fs.mkdirSync(path.join(project, 'assets', 'bgm'), { recursive: true });
  assert.deepEqual(readRealCaseMusicHistory(jobsRoot), { used: 0, recent: [] });
  fs.writeFileSync(path.join(project, 'assets', 'bgm', 'choice.json'), JSON.stringify({ id: 'bed-1' }));
  assert.equal(recordRealCaseMusicChoice(jobsRoot, project), 'bed-1');
  assert.deepEqual(readRealCaseMusicHistory(jobsRoot), { used: 1, recent: ['bed-1'] });
  assert.ok(realCaseMusicHistoryPath(jobsRoot).endsWith('real-case-music-history.json'));
  assert.ok(!fs.existsSync(path.join(root, 'music-history.json')));
});
