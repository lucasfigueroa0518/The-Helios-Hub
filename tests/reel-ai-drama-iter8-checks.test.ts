// Iteration 8, Checks: kit defaults that make a composition error impossible, and the measured findings
// that catch the rest. Pure functions plus jsdom; the findings end to end on tiny fixture frames in a real
// browser when one is installed (skipped otherwise). No model, no live runs.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { JSDOM } from 'jsdom';
import sharp from 'sharp';

import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { findPhrase, phraseLines, pickInk } from '../explainers/reel-ai-drama/kit/components/anchor.js';
import { inkUnseen, isFirstFrame, lowSubject, openingProblems, screenProblems } from '../explainers/reel-ai-drama/kit/screen.mjs';
import { designFindingText, FAST_ITEMS, JUDGE_ITEMS } from '@/lib/reel-ai-drama/checks/design';
import { frameBrief } from '@/lib/reel-ai-drama/checks/design';
import { OPENING_STILL_AT, stillTimes } from '@/lib/reel-ai-drama/render/video';
import type { DirectorPlan, WriterDraft } from '@/lib/reel-ai-drama/types';

const moment = (t: number, o: Record<string, unknown> = {}) => ({ t, cover: 0.5, imgs: [], texts: [], blocks: [], ...o });

// ── Line by line ─────────────────────────────────────────────────────────────────────────────────

const WORDS = {
  id: 'V1', width: 1000, height: 1000,
  regions: { words: [
    { text: 'Apple', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.04 } }, { text: 'Buys', box: { x: 0.32, y: 0.1, w: 0.15, h: 0.04 } },
    { text: 'Virtual', box: { x: 0.1, y: 0.15, w: 0.25, h: 0.04 } }, { text: 'Assistant', box: { x: 0.37, y: 0.15, w: 0.3, h: 0.04 } },
    { text: 'Startup', box: { x: 0.1, y: 0.2, w: 0.25, h: 0.04 } },
  ] },
};

test('phrase: words over several lines come back line by line; one line stays one box', () => {
  const lines = phraseLines(WORDS, 'Buys Virtual Assistant Startup');
  assert.equal(lines.length, 3);
  assert.deepEqual(lines.map((l: { x: number }) => Math.round(l.x * 100)), [32, 10, 10]);
  assert.equal(phraseLines(WORDS, 'Virtual Assistant').length, 1);
  assert.deepEqual(phraseLines(WORDS, 'not there'), []);
  assert.equal(findPhrase(WORDS, 'not there'), null);
  const u = findPhrase(WORDS, 'Buys Virtual');
  assert.ok(u && Math.abs(u.y - 0.1) < 1e-9 && Math.abs(u.y + u.h - 0.19) < 1e-9);
});

// ── Ink ──────────────────────────────────────────────────────────────────────────────────────────

test('ink: a colour lost on its ground gives way; one that reads, by brightness or by hue, stays', () => {
  assert.equal(pickInk('#15110e', [30, 30, 32]), nk.HELIOS.paperLit, 'dark ink on a dark ground');
  assert.equal(pickInk('#FEF9F3', [240, 240, 235]), nk.HELIOS.ink, 'light ink on a light ground');
  assert.equal(pickInk('#E8431A', [245, 245, 245]), '#E8431A', 'orange on paper');
  assert.equal(pickInk('#E8431A', [20, 120, 60]), '#E8431A', 'orange on green reads on hue');
  assert.equal(pickInk('#E8431A', null), '#E8431A', 'unknown ground keeps the colour');
  assert.equal(inkUnseen('rgb(21, 17, 14)', { rgb: [33, 35, 37] }), true);
  assert.equal(inkUnseen('rgb(254, 249, 243)', { rgb: [33, 35, 37] }), false);
  assert.equal(inkUnseen('rgb(232, 67, 26)', { rgb: [20, 120, 60] }), false);
  assert.equal(inkUnseen('rgb(21, 17, 14)', null), false);
});

test('expression marks: a thought stays small over a big face', () => {
  const small = nk.EXPRESSIONS.thought({ x: 300, y: 800, w: 100, h: 120 });
  const big = nk.EXPRESSIONS.thought({ x: 100, y: 700, w: 700, h: 800 });
  const span = (list: { d: string }[]) => {
    const ys = list.flatMap((p) => [...p.d.matchAll(/M[-\d.]+ ([-\d.]+)/g)].map((m) => Number(m[1])));
    return Math.max(...ys) - Math.min(...ys);
  };
  assert.ok(span(big) < 320, 'capped, so it can be brought inside the frame');
  assert.ok(small.length >= 3);
});

// ── Fail soft ────────────────────────────────────────────────────────────────────────────────────

function dom() {
  const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w"></div></body></html>');
  nk.installKit(window.document, { fonts: 'assets/fonts/' });
  return window.document as unknown as Document;
}

test('marks: bad targets never throw at build: skipped, drawing nothing, with the reason reported', () => {
  const d = dom() as unknown as Document & { __markSkips?: string[] };
  const layer = nk.inkLayer(d, d.getElementById('w') as HTMLElement);
  const list = [
    nk.mark(d, { target: '540,950', kind: 'circle' }),
    nk.mark(d, { target: 'face:Nobody', kind: 'circle' }),
    nk.mark(d, { on: nk.photo(d, { media: WORDS, duration: 2 }), target: 'text:"not on it"', kind: 'underline' }),
    nk.mark(d, { on: nk.photo(d, { media: WORDS, duration: 2 }), target: 'face:0', kind: 'arrow' }),
    nk.mark(d, { target: 'el:nothing', kind: 'nonsense' }),
    nk.markerArrow(d, layer, null as unknown as Element, 'el:missing' as unknown as Element),
    nk.markerCross(d, layer, null as unknown as Element),
    nk.highlight(d, layer, undefined as unknown as Element),
  ];
  for (const m of list as Array<{ skipped?: unknown; render?: (t: number) => void; progress?: (p: number) => void }>) {
    assert.ok(m.skipped, 'skipped');
    assert.doesNotThrow(() => { m.render?.(1); m.progress?.(0.5); });
  }
  assert.equal(d.__markSkips?.length, list.length);
  assert.match(d.__markSkips?.[0] ?? '', /a circle mark was skipped/);
  assert.match(d.__markSkips?.[3] ?? '', /an arrow mark was skipped/);
});

test('markers: a target can be named (el:<data-name>) on the layer\'s scene', () => {
  const d = dom();
  const host = d.getElementById('w') as HTMLElement;
  host.className = 'nk';
  const a = d.createElement('div'); a.dataset.name = 'A';
  const b = d.createElement('div'); b.dataset.name = 'B';
  host.append(a, b);
  const arrow = nk.markerArrow(d, nk.inkLayer(d, host), 'el:A' as unknown as Element, 'el:B' as unknown as Element);
  assert.ok(!(arrow as { skipped?: unknown }).skipped);
  assert.equal(b.getAttribute('data-ink-target') !== null, true);
});

// ── Pure findings: a pass and a fail for each ────────────────────────────────────────────────────

test('opening_unformed: a formed first instant passes; missing, faint, partial, arriving or off-centre fails', () => {
  const pic = (o = {}) => ({ label: 'p.jpg', rect: [90, 500, 990, 1200], opacity: 1, inside: 1, bleed: false, cutout: false, ...o });
  assert.deepEqual(openingProblems({ cover: 0.5, main: pic() }, { cover: 0.5, main: pic() }), []);
  assert.deepEqual(openingProblems({ cover: 0.9, main: pic({ bleed: true, rect: [0, 0, 1080, 1920] }) }, { cover: 0.9, main: pic({ bleed: true, rect: [-20, -40, 1100, 1960] }) }), []);
  assert.deepEqual(openingProblems({ cover: 0.4, main: null }, { cover: 0.4, main: null }), [], 'a formed frame of words or graphics');
  assert.match(openingProblems({ cover: 0.02, main: null }, { cover: 0.5, main: null }).join(), /\[opening_unformed\].*almost nothing/);
  assert.match(openingProblems({ cover: 0.5, main: pic({ opacity: 0.3 }) }, { cover: 0.5, main: pic() }).join(), /still fading in/);
  assert.match(openingProblems({ cover: 0.5, main: pic({ inside: 0.5 }) }, { cover: 0.5, main: pic() }).join(), /only 50%/);
  assert.match(openingProblems({ cover: 0.5, main: pic({ rect: [90, 650, 990, 1350] }) }, { cover: 0.5, main: pic() }).join(), /still arriving/);
  assert.match(openingProblems({ cover: 0.3, main: pic({ rect: [430, 880, 1070, 2017] }) }, { cover: 0.3, main: pic({ rect: [430, 880, 1070, 2017] }) }).join(), /opens off-centre at y 1449/);
  assert.match(openingProblems({ cover: 0.3, main: pic({ label: 's.jpg', rect: [400, 700, 700, 1000] }) }, { cover: 0.5, main: pic() }).join(), /main picture "p.jpg" only arrives later/);
  assert.equal(isFirstFrame('01-limp-s-memo'), true);
  assert.equal(isFirstFrame('10-limp'), false);
  assert.equal(isFirstFrame('11-close'), false);
});

test('subject_low: inside the band passes; low, high or running under the platform captions fails; cutouts, full-bleed and tall pages are judged apart', () => {
  const pic = (rect: number[], o = {}) => ({ label: 'p.jpg', rect, bleed: false, cutout: false, ...o });
  assert.equal(lowSubject(pic([90, 620, 990, 1320])), null);
  assert.match(lowSubject(pic([90, 1000, 990, 1500]))!.why, /sits low/);
  assert.match(lowSubject(pic([90, 100, 990, 700]))!.why, /sits high/);
  assert.match(lowSubject(pic([60, 880, 1020, 1520]))!.why, /sits low|runs to y 1520/);
  assert.match(lowSubject(pic([60, 860, 1020, 1510]))!.why, /runs to y 1510|sits low/);
  assert.equal(lowSubject(pic([0, 0, 1080, 1920], { bleed: true })), null);
  assert.equal(lowSubject(pic([100, 700, 900, 2000], { cutout: true })), null);
  assert.equal(lowSubject(null), null);
  // A page too tall to fit: what it marks decides, and a page that starts far down has left the middle empty.
  assert.equal(lowSubject(pic([40, 500, 1040, 2300])), null);
  assert.equal(lowSubject(pic([40, 500, 1040, 2300], { focus: { label: 'text:x', rect: [100, 1000, 500, 1060] } })), null);
  assert.match(lowSubject(pic([40, 500, 1040, 2300], { focus: { label: 'text:x', rect: [100, 1600, 500, 1660] } }))!.why, /under the platform captions/);
  assert.match(lowSubject(pic([40, 950, 1040, 2300]))!.why, /starts low/);
  const held = (rect: number[], n: number) => Array.from({ length: n }, (_, i) => moment(i * 0.2, { main: pic(rect) }));
  assert.match(screenProblems(held([90, 1000, 990, 1500], 6), { duration: 2 }).join(), /\[subject_low\]/);
  assert.doesNotMatch(screenProblems(held([90, 1000, 990, 1500], 3), { duration: 2 }).join(), /\[subject_low\]/);
  assert.doesNotMatch(screenProblems(held([90, 620, 990, 1320], 6), { duration: 2 }).join(), /\[subject_low\]/);
});

test('mark_drift: a stroke that keeps its place on its target passes, however far the target moves; one left behind fails', () => {
  const at = (t: number, dx: number, dy = 0) => moment(t, { marks: [{ label: 'underline on text:a', target: true, content: true, geo: { done: true }, track: { dx, dy, tw: 400, th: 60 } }] });
  const still = [0, 0.2, 0.4, 0.6, 0.8].map((t) => at(t, 0.01));
  assert.doesNotMatch(screenProblems(still, { duration: 1 }).join(), /\[mark_drift\]/);
  const left = [0, 0.2, 0.4, 0.6, 0.8].map((t) => at(t, -t * 0.5));
  assert.match(screenProblems(left, { duration: 1 }).join(), /\[mark_drift\] "underline on text:a" slides \d+px off its target/);
  const missed = [0, 0.2].map((t) => moment(t, { drift: [{ label: '"underline" has 1 stroke over 3 lines of words' }] }));
  assert.match(screenProblems(missed, { duration: 1 }).join(), /\[mark_drift\] "underline" has 1 stroke over 3 lines/);
});

test('mark_offscreen, mark_unseen, label_on_face, edge_gap: the moment lists become findings with their time', () => {
  const m = (o: Record<string, unknown>) => [0, 0.2, 0.4].map((t) => moment(t, o));
  assert.match(screenProblems(m({ offscreen: [{ label: '"thought marks" runs off the frame\'s top edge' }] }), { duration: 1 }).join(), /\[mark_offscreen\] "thought marks" runs off the frame's top edge \(0s–0\.4s\)/);
  assert.match(screenProblems(m({ unseen: [{ label: '"ring" is lost on what is behind it' }] }), { duration: 1 }).join(), /\[mark_unseen\] "ring" is lost/);
  assert.match(screenProblems(m({ labelOnFace: [{ label: '"August 2023" covers the people in V19.jpg' }] }), { duration: 1 }).join(), /\[label_on_face\] "August 2023" covers the people/);
  const gap = { label: 'the ground (rd)', edges: ['left'], px: 80 };
  assert.match(screenProblems(m({ edgeGap: gap }), { duration: 1 }).join(), /\[edge_gap\] the ground \(rd\) stops 80px short of the frame's left edge \(0s–0\.4s\)/);
  assert.doesNotMatch(screenProblems([moment(0, { edgeGap: gap }), moment(0.2), moment(0.4)], { duration: 1 }).join(), /\[edge_gap\]/, 'one sample is a transition passing');
  assert.equal(screenProblems(m({ offscreen: [], unseen: [], labelOnFace: [], edgeGap: null }), { duration: 1 }).length, 0);
});

// ── The review sees the first instant ────────────────────────────────────────────────────────────

test('review: the opening still leads the contact sheet, the judge owns the opening, the split stays even', () => {
  assert.equal(stillTimes([{ number: 1, name: 'a', treatment: 'photo', start: 0, end: 5 }])[0], OPENING_STILL_AT);
  assert.equal(FAST_ITEMS.length, JUDGE_ITEMS.length, 'MD-133: half the items on each model');
  assert.ok((JUDGE_ITEMS as readonly string[]).includes('formed_opening'));
  assert.match(designFindingText({ frame: 1, item: 'formed_opening', what: 'x' }), /a formed opening/);
  assert.match(frameBrief(1, { frames: [] } as unknown as DirectorPlan, { rungs: [] } as unknown as WriterDraft, 3), /Frame 1 of 3/);
  const read = (n: string) => fs.readFileSync(path.join('explainers/reel-ai-drama/prompts', n), 'utf8');
  for (const id of ['opening_unformed', 'mark_drift', 'mark_offscreen', 'mark_unseen', 'label_on_face', 'edge_gap', 'subject_low', 'mark_on_nothing', 'formed_opening']) assert.match(read('fix.md'), new RegExp(`\`${id}\``));
  assert.match(read('design-review.md'), /`formed_opening`/);
});

// ── End to end in a real browser ─────────────────────────────────────────────────────────────────

const frame = (treatment: string, build: string, render = '') => `let P = {}; export default { treatment: '${treatment}', build(root, ctx) { const doc = root.ownerDocument; const nk = ctx.nk; ${build} }, render(t) { ${render} } };`;
const DARK = "const g = doc.createElement('div'); g.className = 'rd'; g.style.cssText += ';background:#141210;'; root.append(g);";
const HAND = (css: string) => `const pic = doc.createElement('img'); pic.src = ctx.media.PHOTO.file; pic.style.cssText = 'position:absolute;${css}'; g.append(pic);`;

function project(frames: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rad-iter8-'));
  fs.mkdirSync(path.join(root, 'assets', 'frames'), { recursive: true });
  fs.mkdirSync(path.join(root, 'assets', 'media'), { recursive: true });
  fs.mkdirSync(path.join(root, '.hyperframes'), { recursive: true });
  fs.symlinkSync(path.resolve('explainers/reel-ai-drama/kit'), path.join(root, 'assets', 'kit'));
  const ids = Object.keys(frames);
  for (const id of ids) fs.writeFileSync(path.join(root, 'assets', 'frames', `${id}.js`), frames[id]!);
  fs.writeFileSync(path.join(root, 'STORYBOARD.md'), ids.map((id, i) => `## Frame ${i + 1} — ${id}\n\n- src: compositions/frames/${id}.html\n- duration: 1.4\n- treatment: photo\n`).join('\n'));
  return root;
}

async function media(root: string): Promise<void> {
  const rows = 300, cols = 400;
  const raw = Buffer.alloc(rows * cols * 3);
  for (let i = 0; i < raw.length; i += 3) { const v = 60 + ((i / 3) % cols) / 3; raw[i] = v; raw[i + 1] = v + (i % 90); raw[i + 2] = 110; }
  await sharp(raw, { raw: { width: cols, height: rows, channels: 3 } }).png().toFile(path.join(root, 'assets', 'media', 'photo.png'));
  const rgba = Buffer.alloc(rows * cols * 4);
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { const k = (y * cols + x) * 4; const on = x > 80 && x < 320 && y > 20; rgba[k] = 170; rgba[k + 1] = 140; rgba[k + 2] = 120; rgba[k + 3] = on ? 255 : 0; }
  await sharp(rgba, { raw: { width: cols, height: rows, channels: 4 } }).png().toFile(path.join(root, 'assets', 'media', 'cut.png'));
  const words = [{ text: 'first line words', box: { x: 0.1, y: 0.2, w: 0.7, h: 0.08 } }, { text: 'second line words', box: { x: 0.1, y: 0.3, w: 0.7, h: 0.08 } }, { text: 'third line words', box: { x: 0.1, y: 0.4, w: 0.7, h: 0.08 } }];
  const assets = [
    { id: 'PHOTO', kind: 'photo', file: 'assets/media/photo.png', width: 400, height: 300, regions: { faces: [{ x: 0.4, y: 0.3, w: 0.2, h: 0.3 }], words: [], photos: [] }, people: ['Ada'] },
    { id: 'CROWD', kind: 'photo', file: 'assets/media/photo.png', width: 400, height: 300, regions: { faces: [], words: [], photos: [] }, people: ['Ada'] },
    { id: 'PAGE', kind: 'page', file: 'assets/media/photo.png', width: 400, height: 300, regions: { faces: [], words, photos: [] }, people: [] },
    { id: 'CUT', kind: 'photo', file: 'assets/media/cut.png', width: 400, height: 300, character_image: true, regions: { faces: [{ x: 0.35, y: 0.1, w: 0.3, h: 0.4 }], words: [], photos: [] }, people: ['Ada'] },
  ];
  fs.writeFileSync(path.join(root, 'assets', 'inventory.json'), JSON.stringify({ assets }));
}

const BAD = {
  // Opening: the only picture sits low on the right. Also holds there long enough for subject_low.
  '01-low-right': frame('photo', `${DARK} ${HAND('left:430px;top:1000px;width:640px;height:480px')}`),
  // A stroke left behind by a target that moves, written the way a hand-made mark would be.
  '02-left-behind': frame('photo', `${DARK} ${HAND('left:90px;top:700px;width:900px;height:675px')}
    const t = doc.createElement('div'); t.setAttribute('data-ink-target', 'x'); t.textContent = 'target words'; t.style.cssText = 'position:absolute;left:200px;top:900px;width:400px;height:60px;color:#fff'; g.append(t); P.t = t;
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '1080'); s.setAttribute('height', '1920'); s.style.cssText = 'position:absolute;left:0;top:0'; const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M200 960 H600'); p.setAttribute('stroke', '#E8431A'); p.setAttribute('stroke-width', '8'); p.setAttribute('fill', 'none'); p.setAttribute('data-ink', 'underline'); p.setAttribute('data-ink-for', 'x'); s.append(p); g.append(s);`, 'P.t.style.transform = `translateY(${-300 * t}px)`;'),
  // One stroke across three lines of words.
  '03-through-words': frame('photo', `${DARK} ${HAND('left:90px;top:700px;width:900px;height:675px')}
    const t = doc.createElement('div'); t.setAttribute('data-ink-target', 'y'); t.setAttribute('data-mark-lines', '3'); t.setAttribute('data-mark-target', 'text:three lines'); t.textContent = 'target words'; t.style.cssText = 'position:absolute;left:200px;top:800px;width:500px;height:180px;color:#fff'; g.append(t);
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '1080'); s.setAttribute('height', '1920'); s.style.cssText = 'position:absolute;left:0;top:0'; const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M200 955 H700'); p.setAttribute('stroke', '#E8431A'); p.setAttribute('stroke-width', '8'); p.setAttribute('fill', 'none'); p.setAttribute('data-ink', 'underline'); p.setAttribute('data-ink-for', 'y'); s.append(p); g.append(s);`),
  // Dark strokes off the top, on a dark ground, in the root and not through the kit.
  '04-thought-off-top': frame('photo', `${DARK} ${HAND('left:90px;top:700px;width:900px;height:675px')}
    const s = doc.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('width', '1080'); s.setAttribute('height', '1920'); s.setAttribute('data-expression', 'thought'); s.style.cssText = 'position:absolute;left:0;top:0;overflow:visible'; const p = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', 'M300 -40 Q500 120 700 -40'); p.setAttribute('stroke', '#15110e'); p.setAttribute('stroke-width', '6'); p.setAttribute('fill', 'none'); s.append(p); g.append(s);`),
  // A hand-placed label over a measured face.
  '05-label-on-face': frame('photo', `${DARK} ${HAND('left:90px;top:700px;width:900px;height:675px')}
    const f = doc.createElement('div'); f.setAttribute('data-face', '0'); f.setAttribute('data-person', 'Ada'); f.style.cssText = 'position:absolute;left:400px;top:900px;width:280px;height:280px'; g.append(f);
    const l = doc.createElement('div'); l.setAttribute('data-treatment', 'label'); l.textContent = 'August 2023'; l.style.cssText = 'position:absolute;left:380px;top:980px;width:320px;height:90px;color:#fff;font-size:50px'; g.append(l);`),
  // The ground slides off the left edge.
  '06-ground-slides': frame('photo', `const g = doc.createElement('div'); g.className = 'rd'; g.style.cssText += ';background:#EFEFEF;transform:translateX(80px)'; root.append(g);`),
  // A mark on words the picture doesn't have.
  '07-no-such-words': frame('photo', `${DARK} P.pic = nk.photo(doc, { media: ctx.media.PAGE, duration: ctx.duration }); root.append(P.pic.el); P.m = nk.mark(doc, { on: P.pic, target: 'text:"no such words"', kind: 'underline', at: 0.5, duration: ctx.duration });`, 'P.pic.render(t); P.m.render(t);'),
};

const GOOD = {
  // The kit's default on frame 1: the lift is skipped, the figure is on from the first instant.
  '01-lift': frame('cutout_lift', `P.s = nk.cutoutLift(doc, { cutout: ctx.media.CUT.file, media: ctx.media.CUT, at: [0.1, 0.7], duration: ctx.duration }); root.append(P.s.el);`, 'P.s.render(t);'),
  // nk.mark on a pushing page: a stroke per line, carried by the page.
  '02-marks-on-push': frame('page', `P.s = nk.page(doc, { media: ctx.media.PAGE, fit: 1000, x: 40, y: 640, tilt: 0, push: { at: [0, ctx.duration], scale: 1.1 }, duration: ctx.duration }); root.append(P.s.el); P.m = nk.mark(doc, { on: P.s, target: 'text:"line words second line words third"', kind: 'underline', at: 0.3, duration: ctx.duration });`, 'P.s.render(t); P.m.render(t);'),
  // A marker on a sliding target stays on it, and a rendered-after-it ring keeps its ink readable.
  '03-marker-tracks': frame('photo', `${DARK} ${HAND('left:90px;top:700px;width:900px;height:675px')}
    const t = doc.createElement('div'); t.textContent = 'target words'; t.style.cssText = 'position:absolute;left:200px;top:900px;width:400px;height:60px;color:#fff'; g.append(t); P.t = t;
    const layer = nk.inkLayer(doc, g, { kind: 'felt' }); P.u = nk.markerUnderline(doc, layer, t);`, 'P.t.style.transform = `translateY(${-300 * t}px)`; P.u.progress(1);'),
  // Thought marks moved out of the picture by a frame, on a dark ground: they come home, in view, in light ink.
  '04-thought': frame('cutout_lift', `P.s = nk.cutoutLift(doc, { cutout: ctx.media.CUT.file, media: ctx.media.CUT, height: 1300, duration: ctx.duration }); P.m = nk.expressionMarks(doc, { kind: 'thought', on: P.s, target: 'face:0', at: 0.1 }); root.append(P.s.el); P.s.el.append(P.m.el);`, 'P.s.render(t); P.m.render(t);'),
  // A label asked to sit on a face finds a free spot; so does one on a picture of people with no measured faces.
  '05-label-free-spot': frame('photo', `P.s = nk.collage(doc, { ground: 'charcoal', layers: [{ media: ctx.media.PHOTO, x: 90, y: 700, w: 900, rot: 0, z: 1 }], move: 'hold', duration: ctx.duration }); root.append(P.s.el); P.l = nk.label(doc, { text: 'August 2023', kind: 'date', at: 0.05, x: 450, y: 1000 }); P.s.el.append(P.l.el);`, 'P.s.render(t); P.l.render(t);'),
  '06-label-people': frame('photo', `P.s = nk.collage(doc, { ground: 'charcoal', layers: [{ media: ctx.media.CROWD, x: 90, y: 700, w: 900, rot: 0, z: 1 }], move: 'hold', duration: ctx.duration }); root.append(P.s.el); P.l = nk.label(doc, { text: 'August 2023', kind: 'date', at: 0.05, x: 96, y: 1100 }); P.s.el.append(P.l.el);`, 'P.s.render(t); P.l.render(t);'),
  // A world bigger than the frame moves freely.
  '07-big-world': frame('photo', `const g = doc.createElement('div'); g.style.cssText = 'position:absolute;left:-300px;top:-300px;width:1680px;height:2520px;background:#20201e'; root.append(g); P.g = g; ${''}`, 'P.g.style.transform = `translateX(${200 * t}px)`;'),
  // A low faint burst and a blurred backdrop aren't the main picture; the centred one is.
  '08-burst-behind': frame('photo', `const g = doc.createElement('div'); g.className = 'rd'; g.style.cssText += ';background:#141210;'; root.append(g);
    const b = doc.createElement('img'); b.src = ctx.media.PHOTO.file; b.style.cssText = 'position:absolute;left:0;top:1300px;width:1080px;height:800px;opacity:.2'; g.append(b);
    const m = doc.createElement('img'); m.src = ctx.media.PHOTO.file; m.style.cssText = 'position:absolute;left:190px;top:700px;width:700px;height:525px'; g.append(m);`),
};

/** The check as the pipeline runs it: plain node (page.evaluate can't ship code a test transform has touched). */
function checkScreen(root: string): { errors: string[]; checked: number; skipped?: string } {
  const kit = path.resolve('explainers/reel-ai-drama/kit/screen.mjs');
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `import(${JSON.stringify(kit)}).then((m) => m.checkScreen(process.cwd())).then((r) => { console.log(JSON.stringify(r)); process.exit(0); });`], { cwd: root, encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '', HELIOS_NODE_MODULES: path.resolve('node_modules') }, timeout: 120_000 });
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}

test('real browser: each finding fires on a fixture that breaks it, and not on the kit\'s way of doing it', async (t) => {
  const bad = project(BAD);
  const good = project(GOOD);
  await media(bad);
  await media(good);
  const b = checkScreen(bad);
  if (b.skipped) { t.skip(b.skipped); return; }
  const g = checkScreen(good);
  const of = (errs: string[], id: string, frameId: string) => errs.filter((e) => e.startsWith(`[${id}] ${frameId}`));
  const fires = [
    ['opening_unformed', '01-low-right'], ['subject_low', '01-low-right'],
    ['mark_drift', '02-left-behind'], ['mark_drift', '03-through-words'],
    ['mark_offscreen', '04-thought-off-top'], ['mark_unseen', '04-thought-off-top'],
    ['label_on_face', '05-label-on-face'], ['edge_gap', '06-ground-slides'],
    ['mark_on_nothing', '07-no-such-words'],
  ] as const;
  for (const [id, frameId] of fires) assert.ok(of(b.errors, id, frameId).length > 0, `${id} on ${frameId}: ${b.errors.filter((e: string) => e.includes(frameId)).join(' | ')}`);
  assert.doesNotMatch(b.errors.join('\n'), /failed to build/, 'a bad mark never kills its frame');
  const none = /^\[(opening_unformed|mark_drift|mark_offscreen|mark_unseen|label_on_face|edge_gap|subject_low|mark_on_nothing)\]/;
  assert.deepEqual(g.errors.filter((e: string) => none.test(e)), []);
  assert.doesNotMatch(g.errors.join('\n'), /failed to build/);
});
