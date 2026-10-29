import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

import { CLOSE, CLOSE_EVENTS } from '../explainers/reel-ai-drama/kit/close-timing.js';
import * as frames from '../explainers/reel-ai-drama/kit/frames.mjs';
import { darkWindows, frameHtml, quietWindows } from '../explainers/reel-ai-drama/kit/mount.mjs';
import { CLOSE_DURATION, CLOSE_TAIL, closeLength, holdFor, lineSpans, pacedStoryboard } from '../explainers/reel-ai-drama/kit/pace.mjs';
import { eventsFileProblems, sourceProblems, storyboardProblems, storyboardWarnings } from '../explainers/reel-ai-drama/kit/try.mjs';
import { musicPlan, mixMusicArgs, XFADE } from '../explainers/reel-ai-drama/kit/music.mjs';
import { bedFor, eventProblems, eventsToCues, mixArgs, resolveCues } from '../explainers/reel-ai-drama/kit/sound.mjs';
import * as tg from '../explainers/reel-ai-drama/kit/treatment-geometry.js';
import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import closeModule, { BLOCK } from '../explainers/reel-ai-drama/kit/close.js';
import { planFrames, projectProblems, writeProjectFiles, normalizeBoxes, slug } from '../explainers/reel-ai-drama/kit/project-files.mjs';
import { mapPage, marksHtml, STYLE_URL } from '../explainers/reel-ai-drama/kit/maps/render-map.mjs';
import { parseStoryboard } from '../explainers/hyperframes-skills/faceless-explainer/scripts/lib/storyboard.mjs';
import type { DirectorPlan, VisualsInventory, WriterDraft } from '@/lib/reel-ai-drama/types';

const KIT = path.join(process.cwd(), 'explainers', 'reel-ai-drama', 'kit');
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'rd-kit-'));
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

type F = { treatment: string; voice?: string; music?: string; dur?: number; pause?: number };
function storyboard(list: F[]): string {
  return `---\nformat: 1080x1920\nmusic: none\n---\n\n${list.map((f, i) => [
    `## Frame ${i + 1} — F${i + 1}`, '',
    `- duration: ${f.dur ?? 4}s`,
    `- src: compositions/frames/${String(i + 1).padStart(2, '0')}-f.html`,
    `- treatment: ${f.treatment}`,
    ...(f.music ? [`- music: ${f.music}`] : []),
    ...(f.pause ? [`- pause_after: ${f.pause}s`] : []),
    ...(f.voice === '' ? [] : [`- voiceover: "${f.voice ?? `line ${i + 1}`}"`]),
    '',
  ].join('\n')).join('\n')}`;
}
const TWELVE: F[] = [
  ...['photo', 'cutout_lift', 'page', 'map', 'collision', 'document', 'post', 'headline', 'number', 'whiteboard', 'newspaper'].map((t) => ({ treatment: t })),
  { treatment: 'close', voice: 'would you have taken the deal?', dur: 2.5 },
];

// ── The fork's invariants ──────────────────────────────────────────────────────────────────

test('frames: any number of frames, no sting, the close is the last frame by treatment', () => {
  const fr = frames.parseFrames(storyboard(TWELVE));
  assert.equal(fr.length, 12);
  assert.ok(frames.isClose(fr[11]) && !frames.isClose(fr[0]));
  assert.equal(frames.frameTreatment({ fields: {} }), 'photo');
  assert.deepEqual(storyboardProblems(fr), []);
  assert.deepEqual(storyboardProblems(frames.parseFrames(storyboard([{ treatment: 'photo' }, { treatment: 'close', voice: 'why?' }]))), [], 'two frames are enough');
  assert.ok(!('STING_FRAME' in frames) && !('CLOSE_FRAME' in frames), 'no sting and no fixed close number');
  assert.ok(!fs.existsSync(path.join(KIT, 'sting.js')));
  assert.ok(!/sting/i.test(frameHtml('01-a', 4, { treatment: 'photo' })));
});

test('try: the close must be last, voiced, and the only one; treatments are the kit\'s', () => {
  const noClose = storyboardProblems(frames.parseFrames(storyboard([{ treatment: 'photo' }, { treatment: 'map' }])));
  assert.ok(noClose.some((p: string) => /exactly one/.test(p)));
  const early = storyboardProblems(frames.parseFrames(storyboard([{ treatment: 'close', voice: 'q?' }, { treatment: 'photo' }])));
  assert.ok(early.some((p: string) => /must be the last frame/.test(p)));
  const silent = storyboardProblems(frames.parseFrames(storyboard([{ treatment: 'photo' }, { treatment: 'close', voice: '' }])));
  assert.ok(silent.some((p: string) => /comment question/.test(p)));
  const odd = storyboardProblems(frames.parseFrames(storyboard([{ treatment: 'hologram' }, { treatment: 'close', voice: 'q?' }])));
  assert.ok(odd.some((p: string) => /hologram/.test(p)));
  const warn = storyboardWarnings(frames.parseFrames(storyboard([{ treatment: 'photo', dur: 9.5 }, { treatment: 'close', voice: 'q?', dur: 3.1 }])));
  assert.ok(warn.some((w: string) => /every 8s/.test(w)) && warn.some((w: string) => /too long for the 2.5s close/.test(w)) && warn.some((w: string) => /about 60s/.test(w)));
});

test('pace: no sting hold; the close is always 2.5s, never stretched; a pause_after is a silent beat after the voice', () => {
  assert.equal(holdFor(undefined), 0.13);
  assert.equal(holdFor(0.5), 0.13);
  near(closeLength(), CLOSE_DURATION);
  assert.ok(CLOSE.maxQuestion + CLOSE_TAIL <= CLOSE_DURATION + 1e-9, 'the longest question plus its tail fits the close');
  const sb = storyboard([{ treatment: 'photo' }, { treatment: 'photo', voice: '', dur: 1.2 }, { treatment: 'map', pause: 0.6 }, { treatment: 'close', voice: 'q?' }]);
  const { paced, storyboard: out } = pacedStoryboard(sb, [{ frame: 1, duration_s: 3 }, { frame: 3, duration_s: 4 }, { frame: 4, duration_s: 1.6 }]);
  const by = (n: number) => paced.find((p: { frame: number }) => p.frame === n)!;
  assert.deepEqual(by(1), { frame: 1, voice: 3, hold: 0.13, duration: 3.13 });
  assert.equal(by(2).duration, 1.2, 'a silent beat keeps its planned length');
  assert.deepEqual(by(3), { frame: 3, voice: 4, hold: 0.73, duration: 4.73 }, 'the pause is held after the voice');
  assert.equal(by(4).duration, CLOSE_DURATION);
  assert.equal(by(4).voice, 1.6);
  assert.match(out, /- voice_end: 1\.6s/);
  // A question voiced past the close never stretches it (the run flags it instead).
  const long = pacedStoryboard(storyboard([{ treatment: 'photo' }, { treatment: 'close', voice: 'q?' }]), [{ frame: 1, duration_s: 3 }, { frame: 2, duration_s: 2.9 }]);
  assert.equal(long.paced.find((p: { frame: number }) => p.frame === 2)!.duration, CLOSE_DURATION);
});

test('pace: line spans split the voice by the lines\' word counts, scaled when the voice differs', () => {
  const words = Array.from({ length: 10 }, (_, i) => ({ text: `w${i}`, start: i, end: i + 0.5 }));
  assert.deepEqual(lineSpans([{ id: 'L1', words: 4, label: '$4M' }, { id: 'L2', words: 6, label: null }], words), [
    { id: 'L1', start: 0, end: 3.5, label: '$4M' },
    { id: 'L2', start: 4, end: 9.5, label: null },
  ]);
  const scaled = lineSpans([{ id: 'L1', words: 2, label: 'a' }, { id: 'L2', words: 3, label: 'b' }], words);
  assert.deepEqual(scaled.map((l: { start: number; end: number }) => [l.start, l.end]), [[0, 3.5], [4, 9.5]]);
  assert.deepEqual(lineSpans([], words), []);
});

test('mount: captions are light on every dark ground (all but the whiteboard), never quiet', () => {
  const fr = frames.parseFrames(storyboard([{ treatment: 'photo' }, { treatment: 'whiteboard' }, { treatment: 'newspaper' }, { treatment: 'close', voice: 'q?', dur: 2.5 }]));
  assert.deepEqual(darkWindows(fr), [[0, 4], [8, 14.5]]);
  assert.deepEqual(quietWindows(), []);
  assert.throws(() => frameHtml('01-a', 4, { treatment: 'hologram' }), /treatment/);
  const html = frameHtml('01-a', 4, { treatment: 'page', media: { V1: { file: 'assets/media/V1.png' } } });
  assert.match(html, /"treatment":"page"/);
  assert.match(html, /assets\/media\/V1\.png/);
});

test('music: changes, drops and restarts at the marked frames; fades out across the close', () => {
  const fr = frames.parseFrames(storyboard([
    { treatment: 'photo', dur: 5 }, { treatment: 'photo', dur: 6 }, { treatment: 'map', music: 'change', dur: 6 },
    { treatment: 'page', music: 'drop', dur: 4 }, { treatment: 'photo', music: 'start', dur: 5 }, { treatment: 'close', voice: 'q?', dur: 2.5 },
  ]));
  const plan = musicPlan(fr);
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((s: { track: number }) => s.track), [0, 1, 1], 'a change moves to the next track; a start after a drop brings it back');
  near(plan[0].end - plan[1].start, XFADE, 1e-6);
  near(plan[1].end, 17);
  near(plan[2].start, 21);
  near(plan[2].end, 28.5);
  near(plan[2].fadeOut, 2.5);
  assert.equal(musicPlan(frames.parseFrames(storyboard([{ treatment: 'photo', music: 'drop' }, { treatment: 'close', voice: 'q?' }]))).length, 0, 'a cold open may start in silence');
  const args = mixMusicArgs(plan, ['a.mp3', 'b.mp3'], 28.5, 'out.mp3');
  assert.equal(args.filter((a: string) => a === '-i').length, 3);
  assert.ok(args.includes('b.mp3'));
});

test('sound: ambience beds (D-47), the record rule (D-48), no decorative kinds', () => {
  assert.deepEqual(eventProblems([{ t: 0, kind: 'ambience', what: 'office room tone', dur: 4 }], 5), []);
  assert.ok(eventProblems([{ t: 0, kind: 'ambience', what: 'office' }], 5)[0].includes('dur'));
  assert.ok(eventProblems([{ t: 1, kind: 'foley', what: 'crowd applause' }], 5)[0].includes('D-48'));
  assert.deepEqual(eventProblems([{ t: 1, kind: 'foley', what: 'crowd applause', shown: 'V2' }], 5, { assets: new Set(['V2']) }), []);
  assert.ok(eventProblems([{ t: 1, kind: 'foley', what: 'applause', shown: 'V9' }], 5, { assets: new Set(['V2']) })[0].includes('not in the inventory'));
  assert.ok(eventsFileProblems([{ t: 0, kind: 'whoosh' }], 5).some((p: string) => /decorative/.test(p)));
  assert.ok(eventsFileProblems(null, 5)[0].includes('ambience'));
  assert.equal(bedFor('a quiet office'), 'office');
  assert.equal(bedFor('servers humming in a data center'), 'machines');
  assert.equal(bedFor('something unknown'), 'room');
  const { cues } = eventsToCues([{ id: 'a', start: 2 }], { a: [{ t: 0.5, kind: 'ambience', what: 'city street', dur: 3 }] }, [{ id: 'x', tags: ['paper'], duration: 1, group: 'x' }]);
  const { resolved } = resolveCues([], cues, { speech: [{ start: 0, end: 10 }] });
  assert.equal(resolved[0].sound.id, 'bed:street');
  assert.equal(resolved[0].underSpeech, false, 'a bed is not ducked again under speech');
  const args = mixArgs(resolved, 6, 'out.wav', '/lib');
  assert.ok(args.includes('lavfi') && args.some((a: string) => a.startsWith('anoisesrc')));
});

// ── Treatments: geometry, marks, determinism, DOM builds ─────────────────────────────────────

test('ken burns: every move keeps the frame covered and moves; push grows, pull shrinks, hold drifts', () => {
  for (const move of tg.MOVES) {
    for (const dir of tg.PAN_DIRS) {
      let prev = null as null | { s: number; tx: number; ty: number };
      for (let i = 0; i <= 10; i++) {
        const k = tg.kenBurns(move, i / 10, { at: [300, 500], amount: 0.12, dir });
        assert.ok(k.s >= 1 && k.tx <= 1e-9 && k.ty <= 1e-9, `${move}: no gap at the top-left`);
        assert.ok(k.tx + 1080 * k.s >= 1080 - 1e-6 && k.ty + 1920 * k.s >= 1920 - 1e-6, `${move}: no gap at the bottom-right`);
        prev = k;
      }
      const a = tg.kenBurns(move, 0, { at: [300, 500], dir }), b = tg.kenBurns(move, 1, { at: [300, 500], dir });
      assert.ok(a.s !== b.s || a.tx !== b.tx || a.ty !== b.ty, `${move} never sits dead`);
      assert.ok(prev);
    }
  }
  assert.ok(tg.kenBurns('push', 1).s > tg.kenBurns('push', 0).s);
  assert.ok(tg.kenBurns('pull', 1).s < tg.kenBurns('pull', 0).s);
  const fit = tg.coverFit(2000, 1000, [0.9, 0.5]);
  assert.ok(fit.x <= 0 && fit.x + fit.w >= 1080 && fit.h === 1920);
  assert.equal(tg.countUp('$38M', 1), '$38M');
  assert.equal(tg.countUp('1,200', 1), '1,200');
  assert.equal(tg.countUp('$38M', 0), '$0M');
  assert.equal(tg.countUp('n/a', 0.5), 'n/a');
});

test('page marks land on the measured box (MD-43): circles around it, underlines under it, highlights across it', () => {
  const box = { x: 23.31, y: 26, w: 606.44, h: 56 };
  const k = 1300 / 1520;
  const b = tg.scaleBox(box, k);
  const circle = tg.markShape('circle', b);
  const core = { x: b.x + b.w * 0.075, y: b.y + b.h * 0.15, w: b.w * 0.85, h: b.h * 0.7 };
  for (const [x, y] of circle.pts) assert.ok(!(x > core.x && x < core.x + core.w && y > core.y && y < core.y + core.h), 'the loop never crosses the words');
  const xs = circle.pts.map((p: number[]) => p[0]), ys = circle.pts.map((p: number[]) => p[1]);
  assert.ok(Math.min(...xs) < b.x && Math.max(...xs) > b.x + b.w && Math.min(...ys) < b.y && Math.max(...ys) > b.y + b.h, 'it surrounds the box');
  near((Math.min(...xs) + Math.max(...xs)) / 2, b.x + b.w / 2, 3);
  const under = tg.markShape('underline', b);
  for (const [x, y] of under.pts) assert.ok(y > b.y + b.h * 0.8 && y < b.y + b.h + 16 && x > b.x - 12 && x < b.x + b.w + 12);
  const hl = tg.markShape('highlight', b);
  assert.ok(hl.pts.every(([, y]: number[]) => y > b.y && y < b.y + b.h));
  const w = tg.markWindow('circle', circle.length, 3);
  assert.equal(w.end, 3);
  assert.ok(w.end - w.start >= 0.45 && w.end - w.start <= 0.7);
  assert.equal(tg.findBox([{ text: 'Attention Is All You Need' }], 'all you need')?.text, 'Attention Is All You Need');
  assert.equal(tg.findBox([{ text: 'a' }], 3), null);
});

function dom() {
  const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w"></div></body></html>');
  nk.installKit(window.document, { fonts: 'assets/fonts/' });
  return window.document;
}
const MEDIA = {
  photo: { file: 'assets/media/V1.jpg', width: 3000, height: 4000, credit: 'Photo: X' },
  page: { file: 'assets/media/V5.png', width: 1520, height: 1044, boxes: [{ text: 'Attention Is All You Need', x: 23.31, y: 26, w: 606.44, h: 56 }] },
  map: { file: 'assets/media/V6.jpg', width: 1620, height: 2880, map: { plain: 'assets/media/V6.plain.jpg', width: 1620, height: 2880, pin: { x: 810, y: 1440 }, label: 'A place', sublabel: 'A town' } },
};
const BUILD: Record<string, (doc: Document) => { el: Element | null; render: (t: number) => void }> = {
  photo: (d) => nk.photo(d, { media: MEDIA.photo, focus: [0.5, 0.3], move: 'push', duration: 6, credit: 'c', parallax: { fg: 'assets/media/V1.fg.png' } }),
  'photo-pan': (d) => nk.photo(d, { media: MEDIA.photo, move: 'pan', dir: 'up', grade: 'archival', duration: 6 }),
  cutout_lift: (d) => nk.cutoutLift(d, { cutout: 'c.png', backdrop: 'b.jpg', name: 'N', role: 'R', duration: 6 }),
  collision: (d) => nk.collision(d, { left: { src: 'l.png' }, right: { src: 'r.png' }, center: { src: 'logo.png', light: true } }),
  page: (d) => nk.page(d, { media: MEDIA.page, marks: [{ box: 0, kind: 'circle', at: 2 }, { box: 'Attention', kind: 'underline', at: 3 }], duration: 6, arrive: 0.2 }),
  document: (d) => nk.documentSheet(d, { media: MEDIA.page, marks: [{ box: 0, kind: 'box', at: 2 }], duration: 6 }),
  'document-recreated': (d) => nk.documentSheet(d, { text: 'We will not.', speaker: 'Co', credit: 'a filing' }),
  post: (d) => nk.post(d, { media: MEDIA.page, marks: [{ box: 0, kind: 'highlight', at: 1 }], backdrop: 'b.jpg' }),
  'post-recreated': (d) => nk.post(d, { text: 'Hello [[world]]', speaker: 'Someone', date: 'today' }),
  map: (d) => nk.map(d, { media: MEDIA.map, at: 0.5, duration: 6 }),
  headline: (d) => nk.headline(d, { text: 'Board [[removes]] chief', publication: 'P', date: 'D', over: { media: MEDIA.photo } }),
  'headline-shot': (d) => nk.headline(d, { media: MEDIA.page, marks: [{ box: 0, at: 1 }] }),
  lower_third: (d) => nk.lowerThird(d, { name: 'N', role: 'R', at: 0.4 }),
  number: (d) => nk.number(d, { value: '$38M', label: 'then he sued.', countUp: true, at: 0.3 }),
  board: (d) => nk.scene(d, 'board'),
  whiteboard: (d) => nk.scene(d, 'whiteboard'),
  newspaper: (d) => nk.scene(d, 'newspaper', { masthead: 'M' }),
};

test('every treatment builds in a DOM and renders deterministically', () => {
  for (const [name, build] of Object.entries(BUILD)) {
    const doc = dom();
    const host = doc.getElementById('w')!;
    const r = build(doc as unknown as Document);
    assert.ok(r.el, `${name}: has an element`);
    host.append(r.el as Node);
    const snap = (t: number) => { r.render(t); return host.innerHTML; };
    for (let t = 0; t <= 6; t += 0.5) snap(t);
    for (const t of [0, 1.7, 3, 5.9]) {
      const a = snap(t);
      snap(6);
      snap(0.05);
      assert.equal(snap(t), a, `${name}: render(${t}) depends on what was drawn before`);
    }
  }
  for (const name of frames.TREATMENTS.filter((t: string) => t !== 'close')) assert.ok((nk.TREATMENT_BUILDERS as Record<string, unknown>)[name], `${name} has a builder`);
});

test('page marks are drawn from the measured boxes, scaled to the page on screen', () => {
  const doc = dom();
  const p = nk.page(doc as unknown as Document, { media: MEDIA.page, marks: [{ box: 0, kind: 'circle', at: 2 }] });
  const k = 1300 / 1520;
  assert.equal(p.scale, k);
  const b = tg.scaleBox(MEDIA.page.boxes[0], k);
  const xs = p.marks[0].shape.pts.map((q: number[]) => q[0]);
  assert.ok(Math.min(...xs) < b.x && Math.max(...xs) > b.x + b.w);
  p.render(0);
  assert.equal(p.marks[0].el.style.opacity, '0', 'not drawn before its window');
  p.render(2);
  assert.equal(p.marks[0].el.style.strokeDashoffset, '0', 'closed on its cue word');
});

test('the close: built by code, deterministic, below the caption band, with its sound', () => {
  const doc = dom();
  const host = doc.getElementById('w')!;
  closeModule.build(host as unknown as HTMLElement, { nk, assets: 'assets/' });
  assert.equal(closeModule.treatment, 'close');
  const a = (() => { closeModule.render(1); return host.innerHTML; })();
  closeModule.render(2.4);
  closeModule.render(0);
  closeModule.render(1);
  assert.equal(host.innerHTML, a);
  assert.ok(host.querySelector('[data-role="logo"]'));
  assert.ok(BLOCK.y > tg.CAPTION_BAND.bottom, 'the brand block sits below the captioned question');
  assert.ok(CLOSE.duration === 2.5 && CLOSE.maxQuestion < CLOSE.duration);
  assert.ok(CLOSE_EVENTS.every((e: { t: number }) => e.t <= CLOSE.duration));
});

test('kit sources: no network, clock, randomness or CSS animation in what frames load', () => {
  const files = ['geometry.js', 'treatment-geometry.js', 'close.js', 'close-timing.js', ...fs.readdirSync(path.join(KIT, 'components')).map((f) => `components/${f}`)];
  for (const f of files) {
    const src = fs.readFileSync(path.join(KIT, f), 'utf8');
    assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(src), `${f}: no URLs`);
    assert.ok(!/Date\.now|new Date\(|Math\.random|performance\.now/.test(src), `${f}: deterministic`);
    assert.ok(!/@keyframes|animation:|transition:/.test(src), `${f}: no CSS animation`);
  }
  assert.deepEqual(sourceProblems("import x from '../kit/components/index.js';\nexport default { treatment: 'photo' };"), []);
  assert.ok(sourceProblems("import x from 'gsap';\nexport default {}").some((p: string) => /only \.\.\/kit\//.test(p)));
});

// ── Project files ─────────────────────────────────────────────────────────────────────────────

const DRAFT: WriterDraft = {
  title: 'The dinner', engine: 'mystery', hook: { on_screen: '$38M', line_id: 'L1' },
  rungs: [
    { id: 'R1', purpose: 'hook', lines: [{ id: 'L1', text: 'He put thirty-eight million dollars in.', on_screen: '$38M', fact_ids: ['F1'], must_show: 'V1' }] },
    { id: 'R2', purpose: 'ladder', lines: [
      { id: 'L2', text: 'It started at a dinner.', on_screen: null, fact_ids: ['F2'], must_show: null },
      { id: 'L3', text: 'Five people at one table.', on_screen: null, fact_ids: ['F2', 'F3'], must_show: 'V6' },
    ] },
  ],
  turn_rung_id: 'R2', landing_rung_id: 'R2', close_question: 'Would you have taken the deal?', word_count: 16,
};
const PLAN: DirectorPlan = {
  frames: [
    { n: 1, name: 'The money', line_ids: ['L1'], treatment: 'photo', asset_ids: ['V1'], purpose: 'hook', motion: 'push in', marks: '', sound: 'room tone', music: 'start', on_screen: '$38M' },
    { n: 2, name: 'The dinner, Menlo Park!', line_ids: ['L2', 'L3'], treatment: 'map', asset_ids: ['V6'], purpose: 'where', motion: 'push to pin', marks: 'pin', sound: 'restaurant', music: 'change', on_screen: null },
  ],
  lines_back: [],
};

function fixtureJob() {
  const job = tmp();
  const project = path.join(job, 'render', 'project');
  fs.mkdirSync(path.join(job, 'media'), { recursive: true });
  fs.mkdirSync(project, { recursive: true });
  fs.writeFileSync(path.join(job, 'media', 'V1.jpg'), 'jpg');
  fs.writeFileSync(path.join(job, 'media', 'V6.png'), 'png');
  fs.writeFileSync(path.join(job, 'media', 'V6.plain.png'), 'png');
  fs.writeFileSync(path.join(job, 'media', 'V6.map.json'), JSON.stringify({ width: 1620, height: 2880, pin: { x: 810, y: 1440 }, label: 'Rosewood', plain: 'V6.plain.png' }));
  fs.writeFileSync(path.join(job, 'media', 'V1.boxes.json'), JSON.stringify({ image: 'media/V1.jpg', width: 1000, height: 500, boxes: [{ text: 'a', x: 10, y: 20, w: 100, h: 30 }] }));
  const asset = (id: string, file: string, width: number) => ({ id, kind: 'person_photo', file, url: null, source_page: null, credit: `credit ${id}`, license: null, shows: 'x', people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width, height: 100, phash: null, character_image: false, made: false, upscaled: false, flags: [] });
  const inventory = { assets: [asset('V1', 'media/V1.jpg', 2000), asset('V6', 'media/V6.png', 1620)], usable_count: 2, counts: {}, kill: null, usd: 0 } as unknown as VisualsInventory;
  return { job, project, inventory };
}

test('project files: SCRIPT.md and STORYBOARD.md in the formats audio.mjs, pace, mount and captions read', () => {
  const { project, inventory } = fixtureJob();
  const out = writeProjectFiles(project, { draft: DRAFT, plan: PLAN, inventory });
  assert.deepEqual(out.problems, []);
  assert.deepEqual(out.frames.map((f: { treatment: string }) => f.treatment), ['photo', 'map', 'close'], 'the close is added last');
  // SCRIPT.md: audio.mjs's own reading (## … (Frame N), indented text only).
  const script = fs.readFileSync(path.join(project, 'SCRIPT.md'), 'utf8');
  const voiced: { frame: number; text: string }[] = [];
  let cur: { frame: number; text: string } | null = null;
  for (const line of script.split('\n')) {
    const h = /^#{2,3}\s+.*?\(frame\s+(\d+)\)/i.exec(line);
    if (h) { cur = { frame: Number(h[1]), text: '' }; voiced.push(cur); continue; }
    if (cur && /^(?: {4,}|\t)(.+)$/.test(line)) cur.text += line.trim();
  }
  assert.deepEqual(voiced, [
    { frame: 1, text: 'He put thirty-eight million dollars in.' },
    { frame: 2, text: 'It started at a dinner. Five people at one table.' },
    { frame: 3, text: 'Would you have taken the deal?' },
  ]);
  // STORYBOARD.md: the faceless parser and the kit's.
  const sb = fs.readFileSync(path.join(project, 'STORYBOARD.md'), 'utf8');
  const parsed = parseStoryboard(sb) as unknown as { globals: { extra: Record<string, string> }; frames: { src?: string; voiceover?: string }[] };
  assert.equal(parsed.globals.extra.music, 'none', 'audio.mjs fetches no bed; music.mjs places it');
  assert.equal(parsed.frames.length, 3);
  assert.equal(parsed.frames[1].src, 'compositions/frames/02-the-dinner-menlo-park.html');
  assert.equal(parsed.frames[2].voiceover, 'Would you have taken the deal?');
  const kit = frames.parseFrames(sb);
  assert.deepEqual(kit.map((f: { id: string }) => f.id), ['01-the-money', '02-the-dinner-menlo-park', '03-close']);
  assert.equal(frames.musicCue(kit[1]), 'change');
  assert.ok(frames.isClose(kit[2]) && kit[2].duration === CLOSE.duration);
  assert.deepEqual(storyboardProblems(kit), []);
  assert.equal(kit[1].fields.assets, 'V6');
  // pace reads it.
  const { paced } = pacedStoryboard(sb, [{ frame: 1, duration_s: 2 }, { frame: 2, duration_s: 3 }, { frame: 3, duration_s: 1.5 }]);
  assert.equal(paced.length, 3);
});

test('project files: media and sidecars copied; boxes rescaled; inventory points at assets/media', () => {
  const { project, inventory } = fixtureJob();
  writeProjectFiles(project, { draft: DRAFT, plan: PLAN, inventory });
  for (const f of ['V1.jpg', 'V1.boxes.json', 'V6.png', 'V6.plain.png', 'V6.map.json']) assert.ok(fs.existsSync(path.join(project, 'assets', 'media', f)), f);
  const inv = JSON.parse(fs.readFileSync(path.join(project, 'assets', 'inventory.json'), 'utf8'));
  const v1 = inv.assets.find((a: { id: string }) => a.id === 'V1');
  assert.equal(v1.file, 'assets/media/V1.jpg');
  assert.deepEqual(v1.boxes, [{ text: 'a', x: 20, y: 40, w: 200, h: 60 }], 'measured at 1000px wide, the image is 2000px');
  const v6 = inv.assets.find((a: { id: string }) => a.id === 'V6');
  assert.equal(v6.map.plain, 'assets/media/V6.plain.png');
  assert.equal(frames.projectMedia(project).V6.map.pin.x, 810);
  assert.deepEqual(normalizeBoxes([{ text: 'x', x: 1, y: 2, w: 0, h: 3 }], 10), [], 'empty boxes are dropped');
});

test('project files: bad ids are problems, not crashes', () => {
  const { project, inventory } = fixtureJob();
  const plan = { ...PLAN, frames: [{ ...PLAN.frames[0], line_ids: ['L1', 'L9'], asset_ids: ['V99'] }] };
  const out = writeProjectFiles(project, { draft: DRAFT, plan, inventory: { ...inventory, assets: [...inventory.assets, { ...inventory.assets[0], id: 'V7', file: 'media/none.jpg' }] } });
  for (const want of [/L9 is not in the draft/, /V99 is not in the inventory/, /L2 is in no frame/, /V7: its file is missing/]) assert.ok(out.problems.some((p: string) => want.test(p)), String(want));
  assert.equal(slug('  Hello, World! '), 'hello-world');
  assert.equal(slug('***'), 'frame');
  const fr = planFrames({ frames: [], lines_back: [] }, DRAFT);
  assert.equal(fr.length, 1);
  assert.ok(projectProblems(DRAFT, fr, inventory).some((p: string) => /L1 is in no frame/.test(p)));
});

test('render-map: the printed page uses OpenFreeMap liberty, hides clutter, labels in Helios type (no network in tests)', () => {
  const page = mapPage({ lat: 37.42, lon: -122.2, zoom: 14 });
  assert.ok(page.includes(STYLE_URL) && page.includes('-122.2') && /poi\|transit/.test(page) && page.includes('sepia'));
  const marks = marksHtml({ label: 'Rosewood <Sand> Hill', sublabel: 'Menlo Park' });
  assert.ok(marks.includes('#FF5E1A') && marks.includes('Rosewood &lt;Sand&gt; Hill') && marks.includes('Pragmatica Extended'));
});
