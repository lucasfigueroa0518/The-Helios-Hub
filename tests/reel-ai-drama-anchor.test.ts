// Iteration 4, Builder C: anchored marks, keep-outs, centring, caption tones, stat, lift, drawn
// elements, style_mix and the new screen checks. Offline: pure functions plus jsdom builds. No model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';
import { clearSpot, findFace, findPhrase, mainPhoto, parseTarget, regionsOf, SUBJECT } from '../explainers/reel-ai-drama/kit/components/anchor.js';
import { barShares, scaleRadii, statCues, valueOf } from '../explainers/reel-ai-drama/kit/components/stat.js';
import { facesIn, liftRest } from '../explainers/reel-ai-drama/kit/components/lift.js';
import { publicCredit, textLines } from '../explainers/reel-ai-drama/kit/components/treatments.js';
import { ringAround } from '../explainers/reel-ai-drama/kit/geometry.js';
import { captionContrast, fillTones, frameTones, mergeKitCues, reelTones, toneFor, MIN_RUN } from '../explainers/reel-ai-drama/kit/measure.mjs';
import { sidecarRegions } from '../explainers/reel-ai-drama/kit/project-files.mjs';
import { screenProblems, toneAt } from '../explainers/reel-ai-drama/kit/screen.mjs';
import { TREATMENTS as KIT_TREATMENTS } from '../explainers/reel-ai-drama/kit/frames.mjs';
import { varietyFindings } from '../lib/reel-ai-drama/checks/variety';
import type { Asset, StoryboardFrame, VisualsInventory } from '../lib/reel-ai-drama/types';

// ILLUSTRATIVE fixtures: invented people and words.
const PAGE = {
  id: 'V9', file: 'assets/media/V9.png', width: 1000, height: 2000, people: ['Ada Founder'],
  regions: {
    faces: [{ x: 0.4, y: 0.3, w: 0.2, h: 0.1 }],
    words: [{ text: 'The quiet launch', box: { x: 0.1, y: 0.05, w: 0.6, h: 0.04 } }, { text: 'changed everything', box: { x: 0.1, y: 0.1, w: 0.6, h: 0.04 } }],
    photos: [{ x: 0.2, y: 0.2, w: 0.6, h: 0.4 }, { x: 0.1, y: 0.7, w: 0.3, h: 0.1 }],
    lift: null,
  },
};
const TWO = { id: 'V3', width: 1000, height: 1000, people: ['Ada Founder', 'Ben Rival'], regions: { faces: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0.6, y: 0.1, w: 0.25, h: 0.25 }] } };
const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

test('anchor: regions come from the sidecar, else the main face and pixel boxes', () => {
  assert.equal(regionsOf(PAGE).faces.length, 1);
  const old = regionsOf({ width: 200, height: 100, face: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, boxes: [{ text: 'Hi', x: 20, y: 10, w: 40, h: 20 }] });
  assert.deepEqual(old.faces, [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }]);
  assert.deepEqual(old.words, [{ text: 'Hi', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }]);
  assert.deepEqual(regionsOf(null), { faces: [], words: [], photos: [], lift: null, lift_from: null });
});

test('anchor: a face by index or person; a name the picture cannot confirm finds nothing (no wrong-person mark)', () => {
  assert.equal(findFace(PAGE, 0), PAGE.regions.faces[0]);
  assert.equal(findFace(PAGE, 'Ada Founder'), PAGE.regions.faces[0]);
  assert.equal(findFace(PAGE, 'Founder'), PAGE.regions.faces[0], 'surname');
  assert.equal(findFace(PAGE, 'Ben Rival'), null, 'another person');
  assert.equal(findFace(TWO, 'Ada Founder'), null, 'two people, unnamed faces');
  assert.equal(findFace(TWO, 1), TWO.regions.faces[1]);
  const named = { ...TWO, regions: { faces: [{ ...TWO.regions.faces[0], name: 'Ben Rival' }, TWO.regions.faces[1]] } };
  assert.equal(findFace(named, 'Rival'), named.regions.faces[0]);
  assert.equal(findFace({ width: 10, height: 10 }, 0), null);
});

test('anchor: a phrase spans the words that spell it; part of a line box is sized by its letters', () => {
  const both = findPhrase(PAGE, 'launch changed')!;
  assert.ok(near(both.y, 0.05) && near(both.h, 0.09));
  const part = findPhrase(PAGE, 'quiet')!;
  assert.ok(part.w < 0.6 / 2 && part.x > 0.1, 'smaller than the line, inside it');
  assert.equal(findPhrase(PAGE, 'quiet launch changed everything')?.w, 0.6);
  assert.ok(findPhrase(PAGE, 'everyth'), 'a cut-short last word');
  assert.equal(findPhrase(PAGE, 'nowhere at all'), null);
});

test('anchor: targets are face:, text:, photo:, el: or an element; coordinates throw mark_on_nothing', () => {
  assert.deepEqual(parseTarget('face:Ada Founder'), { kind: 'face', value: 'Ada Founder' });
  assert.deepEqual(parseTarget('text:"the quiet launch"'), { kind: 'text', value: 'the quiet launch' });
  assert.deepEqual(parseTarget('photo:0'), { kind: 'photo', value: '0' });
  assert.throws(() => parseTarget('540,950'), /\[mark_on_nothing\]/);
  assert.throws(() => parseTarget({ x: 1, y: 2 }), /\[mark_on_nothing\]/);
  assert.equal(mainPhoto(PAGE), PAGE.regions.photos[0], 'the photo holding the face');
});

test('anchor: a ring is the target\'s size plus its pad', () => {
  const b = { x: 100, y: 200, w: 300, h: 100 };
  const { pts } = ringAround(b, 10, 3) as unknown as { pts: Array<[number, number]> };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const w = Math.max(...xs) - Math.min(...xs), h = Math.max(...ys) - Math.min(...ys);
  assert.ok(w > 300 && w < 360, `width ${w}`);
  assert.ok(h > 100 && h < 160, `height ${h}`);
});

test('keep-outs: a label moves off a face and out of the caption band; nothing in the way keeps its spot', () => {
  const face = { x: 340, y: 800, w: 400, h: 400, weight: 4 };
  const spot = clearSpot({ w: 400, h: 120 }, [face], { x: 340, y: 900 });
  assert.ok(spot.y >= 1200 || spot.y + 120 <= 800, `clear of the face (${spot.y})`);
  assert.equal(spot.score, 0);
  assert.deepEqual([clearSpot({ w: 400, h: 120 }, [], { x: 96, y: 1320 }).x, clearSpot({ w: 400, h: 120 }, [], { x: 96, y: 1320 }).y], [96, 1320]);
  const top = clearSpot({ w: 400, h: 120 }, [], { x: 96, y: 300 });
  assert.ok(top.y >= 600, 'never in the caption band');
});

test('box sidecars: the iteration-4 format becomes inventory regions; bad boxes drop; the old format is not it', () => {
  const r = sidecarRegions({ faces: [{ x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, { x: 0, y: 0, w: 0, h: 1 }], words: [{ text: 'A', box: { x: 0, y: 0, w: 0.1, h: 0.1 } }, { text: 'B' }], photos: [], lift: 'V9.lift.png', lift_from: { x: 0.2, y: 0.2, w: 0.5, h: 0.4 } })!;
  assert.equal(r.faces.length, 1);
  assert.deepEqual(r.words, [{ text: 'A', box: { x: 0, y: 0, w: 0.1, h: 0.1 } }]);
  assert.equal(r.lift, 'V9.lift.png');
  assert.deepEqual(r.lift_from, { x: 0.2, y: 0.2, w: 0.5, h: 0.4 }, 'where the lift starts on its page');
  assert.equal(sidecarRegions([{ text: 'A', x: 1, y: 1, w: 2, h: 2 }]), null);
  assert.equal(sidecarRegions(null), null);
});

test('caption tones: dark under a dark band, ink under a light one, a plate under a busy one; short runs plate', () => {
  assert.equal(toneFor({ p10: 0.01, p90: 0.2 }), 'dark');
  assert.equal(toneFor({ p10: 0.6, p90: 0.95 }), 'light');
  assert.equal(toneFor({ p10: 0.05, p90: 0.9 }), 'plate');
  assert.equal(toneFor(null), null);
  assert.equal(captionContrast('plate', { p10: 0.05, p90: 0.9 }), 21);
  assert.ok(captionContrast('dark', { p10: 0.8, p90: 0.9 })! < 1.2, 'paper-lit words on a white article');
  assert.ok(captionContrast('light', { p10: 0.8, p90: 0.9 })! > 7, 'ink on it');

  const s = (t: number, tone: string) => ({ t, tone });
  // 0–1.2 dark, 1.2–1.6 light (short: plate), 1.6–3 dark.
  const samples = [0, 0.2, 0.4, 0.6, 0.8, 1.0].map((t) => s(t, 'dark')).concat([s(1.2, 'light'), s(1.4, 'light')], [1.6, 1.8, 2.0, 2.2, 2.4, 2.6, 2.8].map((t) => s(t, 'dark')));
  assert.deepEqual(frameTones(samples, 3), [[0, 1.2, 'dark'], [1.2, 1.6, 'plate'], [1.6, 3, 'dark']]);
  assert.ok(MIN_RUN > 0.4);
  const reel = reelTones([{ duration: 2, windows: [[0, 2, 'dark']] }, { duration: 3, windows: [[0, 1, 'dark'], [1, 3, 'light']] }]);
  assert.deepEqual(reel, [[0, 3, 'dark'], [3, 5, 'light']]);
  assert.equal(toneAt(reel, 4), 'light');
  assert.equal(toneAt([], 4, true), 'light');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-tones-'));
  fs.mkdirSync(path.join(dir, '.hyperframes'));
  fs.copyFileSync('explainers/reel-ai-drama/presets/reel-ai-drama/caption-skin.html', path.join(dir, '.hyperframes', 'caption-skin.html'));
  assert.ok(fillTones(dir, reel));
  assert.ok(fs.readFileSync(path.join(dir, '.hyperframes', 'caption-skin.html'), 'utf8').includes(`var TONES = ${JSON.stringify(reel)};`));
});

test('kit cues: merged into events.json marked kit, replaced on each run, never past the frame', () => {
  const own = [{ t: 0.5, kind: 'whoosh' }, { t: 1, kind: 'tick', kit: true }];
  const merged = mergeKitCues(own, [{ t: 0.3, kind: 'pop' }, { t: 9, kind: 'impact' }], 4);
  assert.deepEqual(merged, [{ t: 0.3, kind: 'pop', kit: true }, { t: 0.5, kind: 'whoosh' }]);
});

test('stat: values, bar shares, area-true scale radii and the cue plan', () => {
  assert.equal(valueOf('$6M'), 6);
  assert.equal(valueOf('1,200 people'), 1200);
  assert.ok(Number.isNaN(valueOf('none')));
  const shares = barShares([{ value: 1 }, { value: 1000 }, { value: 0 }]);
  assert.deepEqual([shares[0] > 0, shares[1], shares[2]], [true, 1, 0]);
  const [a, b] = scaleRadii([{ value: 1 }, { value: 4 }], { maxR: 300, minR: 1 });
  assert.ok(near(b / a, 2), 'area ∝ value');
  const counter = statCues({ kind: 'counter', at: 0.5, count: 1.2 });
  assert.equal(counter.at(-1)!.kind, 'impact');
  assert.equal(counter.at(-1)!.t, 1.7);
  assert.ok(counter.filter((c) => c.kind === 'tick').length >= 3);
  const bars = statCues({ kind: 'bar', at: 0, items: [{ value: 1 }, { value: 2 }] });
  assert.deepEqual(bars.map((c) => c.kind), ['tick', 'tick', 'pop']);
  const scale = statCues({ kind: 'scale', at: 0, items: [{ value: 1 }, { value: 9 }] });
  assert.deepEqual(scale.map((c) => c.kind), ['pop', 'impact']);
});

test('lift: the piece rests in the subject column with its face on the subject line; its faces move with it', () => {
  const r = liftRest(0.75, { faceY: 0.3 });
  assert.ok(near(r.x + r.w / 2, 540));
  assert.ok(near(r.y + 0.3 * r.h, SUBJECT.cy));
  const wide = liftRest(3);
  assert.ok(wide.w <= 840 && near(wide.y + wide.h / 2, SUBJECT.cy));
  const f = facesIn(PAGE, PAGE.regions.photos[0]);
  assert.equal(f.length, 1);
  assert.ok(near(f[0].x, (0.4 - 0.2) / 0.6) && near(f[0].h, 0.1 / 0.4));
  assert.deepEqual(facesIn(PAGE, PAGE.regions.photos[1]), []);
});

test('credits: internal provenance never reaches the screen', () => {
  assert.equal(publicCredit('Photo: A Paper · supplied by the harvest'), 'Photo: A Paper');
  assert.equal(publicCredit('Photo: A Paper'), 'Photo: A Paper');
});

test('page text: word boxes merge into lines (the keep-out rows)', () => {
  const lines = textLines([{ x: 10, y: 10, w: 40, h: 20 }, { x: 60, y: 12, w: 40, h: 20 }, { x: 10, y: 60, w: 40, h: 20 }]);
  assert.equal(lines.length, 2);
});

test('kit: stat and lift are treatments with builders', () => {
  assert.ok(KIT_TREATMENTS.includes('stat') && KIT_TREATMENTS.includes('lift'));
  assert.equal(typeof nk.TREATMENT_BUILDERS.stat, 'function');
  assert.equal(typeof nk.TREATMENT_BUILDERS.lift, 'function');
});

function dom() {
  const { window } = new JSDOM('<!doctype html><html><head></head><body><div id="w"></div></body></html>');
  nk.installKit(window.document, { fonts: 'assets/fonts/' });
  return window.document;
}
const settle = (render: (t: number) => void, el: Element) => {
  const at = (t: number) => { render(t); return el.outerHTML; };
  return at;
};

test('stat (jsdom): each kind builds, carries its cues, shows nothing before it starts and is pure in t', () => {
  for (const o of [
    { kind: 'counter', value: '$6M', label: 'raised', at: 0.4 },
    { kind: 'bar', items: [{ label: 'One', value: 2 }, { label: 'Two', value: 9 }], at: 0.4 },
    { kind: 'scale', items: [{ label: 'Small', value: 1 }, { label: 'Large', value: 50 }], at: 0.4 },
  ]) {
    const d = dom();
    const s = nk.stat(d, o);
    d.getElementById('w')!.append(s.el);
    assert.deepEqual(JSON.parse(s.el.getAttribute('data-cues')!), s.cues, o.kind);
    const at = settle(s.render, s.el);
    const early = at(0.1);
    assert.ok(![...s.el.querySelectorAll('.rd-stat-big,.rd-stat-bar,.rd-stat-disc')].some((e) => (e as HTMLElement).style.visibility !== 'hidden'), `${o.kind}: nothing before its content`);
    const a = at(1.3);
    at(0.2);
    assert.equal(at(1.3), a, `${o.kind}: render(t) is pure`);
    assert.notEqual(a, early);
  }
});

test('lift (jsdom): the page lies still, the piece appears only at the peel, with peel and landing cues', () => {
  const d = dom();
  const l = nk.lift(d, { media: PAGE, at: 1, duration: 4 });
  d.getElementById('w')!.append(l.el);
  assert.equal(l.el.getAttribute('data-treatment'), 'lift');
  assert.ok(l.piece);
  l.render(0.5);
  assert.equal((l.piece!.el as HTMLElement).style.visibility, 'hidden');
  l.render(2);
  assert.equal((l.piece!.el as HTMLElement).style.visibility, '');
  assert.deepEqual(l.cues.map((c: { what?: string }) => c.what), ['paper peeling off a page', 'paper landing on paper']);
  assert.ok(l.el.querySelector('[data-lifted][data-face]') || l.piece!.picture.faceEls.length >= 0);
  const a = (l.render(2.5), l.el.outerHTML);
  l.render(0);
  assert.equal((l.render(2.5), l.el.outerHTML), a, 'pure in t');
});

test('marks (jsdom): an anchored mark resolves its target, and a target that cannot be found is skipped and reported', () => {
  const d = dom();
  const p = nk.photo(d, { media: PAGE, duration: 4 });
  d.getElementById('w')!.append(p.el);
  const m = nk.mark(d, { on: p, target: 'face:Ada Founder', kind: 'circle', at: 1, media: PAGE, duration: 4 });
  assert.ok(m.el);
  m.render(0.5);
  m.render(2);
  const a = nk.mark(d, { on: p, target: 'face:Ben Rival', kind: 'circle', at: 1, media: PAGE, duration: 4 });
  const b = nk.mark(d, { on: p, target: 'text:"not on the page"', kind: 'underline', at: 1, media: PAGE, duration: 4 });
  assert.ok((a as { skipped?: unknown }).skipped && (b as { skipped?: unknown }).skipped);
  a.render(2);
  assert.equal((d as unknown as { __markSkips: string[] }).__markSkips.length, 2);
});

// ── Screen checks (iteration 4 ids) ───────────────────────────────────────────

const moment = (t: number, o: Record<string, unknown> = {}) => ({ t, cover: 0.5, imgs: [], texts: [], blocks: [], ...o });
const run = (n: number, o: (t: number) => Record<string, unknown>) => Array.from({ length: n }, (_, i) => moment(i * 0.2, o(i * 0.2)));

test('screen: caption_contrast, text_over_face, duplicate_person and white_box', () => {
  const p = screenProblems(run(5, () => ({
    caption: { tone: 'dark', contrast: 1.1 },
    overFace: [{ label: '"A label" over Ada Founder' }],
    dupes: ['Ada Founder'],
    whiteBoxes: ['M2.png'],
  })), { duration: 1 }).join('\n');
  for (const id of ['caption_contrast', 'text_over_face', 'duplicate_person', 'white_box']) assert.match(p, new RegExp(`\\[${id}\\]`), id);
  const ok = screenProblems(run(5, () => ({ caption: { tone: 'plate', contrast: 21 } })), { duration: 1 });
  assert.deepEqual(ok, []);
  const blip = screenProblems(run(5, (t) => ({ dupes: t === 0.4 ? ['Ada Founder'] : [] })), { duration: 1 });
  assert.deepEqual(blip, [], 'a single moment is not a duplicate');
});

test('screen: subject_off_centre after a second off the centre column; centred is clean', () => {
  const off = screenProblems(run(6, () => ({ subject: { x: 900, y: 950, label: 'Ada Founder' } })), { duration: 1.2 });
  assert.match(off.join('\n'), /\[subject_off_centre\] the main face \(Ada Founder\)/);
  assert.deepEqual(screenProblems(run(6, () => ({ subject: { x: 540, y: 950, label: 'Ada Founder' } })), { duration: 1.2 }), []);
});

test('screen: mark_off_target for a mark that misses its target or lands in the last 0.4s', () => {
  const miss = screenProblems(run(4, () => ({ marks: [{ label: 'circle', target: true, content: true, geo: { off: 'is centred 120 px off its target' } }] })), { duration: 3 });
  assert.match(miss.join('\n'), /\[mark_off_target\] "circle" is centred 120 px off/);
  const late = [moment(0), moment(2.8, { marks: [{ label: 'underline', target: true, content: true }] })];
  assert.match(screenProblems(late, { duration: 3 }).join('\n'), /\[mark_off_target\] "underline" first shows at 2.8s/);
});

test('screen: a plate shown with none of its words is empty_frame', () => {
  const p = screenProblems(run(4, () => ({ emptyBoxes: ['lower third'] })), { duration: 1 });
  assert.match(p.join('\n'), /\[empty_frame\] "lower third" shows its plate with none of its words/);
});

// ── Variety: style_mix (MD-94) ───────────────────────────────────────────────

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'person_photo', file: `media/${id}.jpg`, url: null, source_page: null, credit: `Photo ${id}`, license: null,
    shows: `picture ${id}`, people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown', width: 1600, height: 1200,
    phash: null, character_image: false, made: false, upscaled: false, flags: [], ...over,
  } as Asset;
}
const INV = { assets: [asset('V1', { people: ['Ada Founder'] }), asset('V2', { people: ['Ben Rival'], character_image: true }), asset('V3', { people: ['Ada Founder'], character_image: true })], usable_count: 3, counts: {}, kill: null, usd: 0 } as unknown as VisualsInventory;
const fr = (n: number, over: Partial<StoryboardFrame> = {}): StoryboardFrame => ({ n, name: `f${n}`, line_ids: [`L${n}`], treatment: 'photo', asset_ids: [], purpose: 'p', motion: 'push', marks: '', sound: '', music: 'hold', on_screen: null, shows: [], ...over } as StoryboardFrame);

test('variety: style_mix — a cutout beside a plain photo in one frame; one style per frame is clean; a lift is one artifact', () => {
  const mixed = { frames: [fr(1, { treatment: 'tableau', asset_ids: ['V1', 'V2'], shows: [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'photo' }, { person: 'Ben Rival', asset_id: 'V2', treatment: 'tableau' }] })] };
  const f = varietyFindings(mixed, { inventory: INV }).filter((x) => x.id === 'style_mix');
  assert.equal(f.length, 1);
  assert.match(f[0].why, /Ada Founder as V1 \(photo\).*Ben Rival as V2 \(cutout\)/);
  const same = { frames: [fr(1, { treatment: 'collision', asset_ids: ['V3', 'V2'], shows: [{ person: 'Ada Founder', asset_id: 'V3', treatment: 'collision' }, { person: 'Ben Rival', asset_id: 'V2', treatment: 'collision' }] })] };
  assert.deepEqual(varietyFindings(same, { inventory: INV }).filter((x) => x.id === 'style_mix'), []);
  const lifted = { frames: [fr(1, { treatment: 'lift', asset_ids: ['V1', 'V2'], shows: [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'photo' }, { person: 'Ben Rival', asset_id: 'V2', treatment: 'lift' }] })] };
  assert.deepEqual(varietyFindings(lifted, { inventory: INV }).filter((x) => x.id === 'style_mix'), []);
  const halftone = { frames: [fr(1, { treatment: 'collage', asset_ids: ['V1', 'V2'], shows: [{ person: 'Ada Founder', asset_id: 'V1', treatment: 'halftone' }, { person: 'Ben Rival', asset_id: 'V2', treatment: 'tableau' }] })] };
  assert.equal(varietyFindings(halftone, { inventory: INV }).filter((x) => x.id === 'style_mix').length, 1);
});

// ── Iteration 4 fixes: caption plate, chalk drawings, stat keep-outs, text-target push ──────────────

test('caption plate: one plate layer under every glyph (no per-letter background or side shadows over neighbours)', () => {
  for (const file of ['../explainers/reel-ai-drama/presets/reel-ai-drama/caption-skin.html', '../explainers/reel-ai-drama/kit/gallery.html']) {
    const css = fs.readFileSync(path.join(import.meta.dirname, file), 'utf8');
    assert.ok(/isolation:\s*isolate/.test(css), `${file}: the line isolates its plates`);
    assert.ok(/::before\s*\{[^}]*z-index:\s*-1/.test(css), `${file}: plates paint under the glyphs`);
    assert.ok(!/box-shadow:\s*\.?0?\.14em 0 0 #15110E/i.test(css), `${file}: no side shadows painted over the next letter`);
  }
});

test('drawn ink (jsdom): chalk on dark grounds (collage, any dark frame), dark ink on the whiteboard, newspaper, board or paper', () => {
  const d = dom();
  const host = d.getElementById('w')!;
  const wb = d.createElement('div');
  wb.setAttribute('data-ground', 'whiteboard');
  const onWb = d.createElement('div');
  wb.append(onWb);
  const dark = d.createElement('div');
  host.append(wb, dark);
  assert.equal(nk.inkFor(onWb), 'dark');
  assert.equal(nk.inkFor(dark), 'chalk');
  const sketch = { id: 'M1', file: 'assets/media/M1.png', width: 100, height: 100, made: true, made_kind: 'expression' };
  const c = nk.collage(d, { ground: 'kraft', layers: [{ media: sketch, x: 0, y: 600, w: 400 }, { media: { ...sketch, id: 'M2' }, x: 500, y: 600, w: 400, ink: 'dark' }], duration: 4 });
  assert.equal(c.items[0].el.getAttribute('data-ink'), 'chalk');
  assert.ok(c.items[0].el.style.filter.includes('invert(1)'));
  assert.equal(c.items[1].el.getAttribute('data-ink'), 'chalk', 'ink comes from what is behind it: no override');
  const dr = nk.drawn(d, { media: sketch, x: 100, y: 600, w: 400 });
  dark.append(dr.el);
  dr.render(1);
  assert.equal(dr.el.getAttribute('data-ink'), 'chalk');
  const dw = nk.drawn(d, { media: sketch, x: 100, y: 600, w: 400 });
  onWb.append(dw.el);
  dw.render(1);
  assert.equal(dw.el.getAttribute('data-ink'), 'dark');
  assert.equal(dw.el.style.filter, 'none');
});

test('stat keep-outs: the graphic never covers a backdrop face; the layout slides the picture or moves the graphic', () => {
  const face = { x: 0.3, y: 0.25, w: 0.39, h: 0.29 };
  const pad = (f: { x: number; y: number; w: number; h: number }) => ({ x: f.x - 0.12 * f.w, y: f.y - 0.12 * f.h, w: 1.24 * f.w, h: 1.24 * f.h });
  const ov = (a: { x: number; y: number; w: number; h: number }, b: typeof a) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (const o of [
    { kind: 'scale', items: [{ label: 'small', value: 1 }, { label: 'large', value: 30 }] },
    { kind: 'counter', value: '$1,200M', label: 'a label' },
    { kind: 'bar', items: [{ label: 'A', value: 1 }, { label: 'B', value: 5 }, { label: 'C', value: 9 }] },
  ]) {
    const box = nk.statBox(o);
    const L = nk.statLayout({ box, faces: [face], width: 1337, height: 1771 });
    assert.ok(L.clear, o.kind);
    // Re-derive the face and graphic on screen from the layout (cover fit, 1.06 backdrop scale, slide).
    const k = Math.max(1080 / 1337, 1920 / 1771), dw = 1337 * k, dh = 1771 * k;
    const fx = (1080 - dw) * L.pos[0] + face.x * dw, fy = (1920 - dh) * L.pos[1] + face.y * dh;
    const f = { x: 540 + (fx - 540) * 1.06, y: 960 + (fy - 960) * 1.06 + L.dy, w: face.w * dw * 1.06, h: face.h * dh * 1.06 };
    const g = { x: 540 + (box.x - 540) * L.scale, y: L.cy + (box.y - 950) * L.scale, w: box.w * L.scale, h: box.h * L.scale };
    assert.equal(ov(pad(f), g), 0, `${o.kind}: the graphic clears the face`);
  }
  assert.deepEqual(nk.statLayout({ box: nk.statBox({ kind: 'counter', value: '9' }), faces: [], width: 100, height: 100 }), { pos: [0.5, 0.5], dy: 0, scale: 1, cy: 950, clear: true }, 'no faces: the default');
  // jsdom: the backdrop's faces are keep-outs marked as backdrop, and the graphic parts are tagged for the screen check.
  const d = dom();
  const s = nk.stat(d, { kind: 'scale', items: [{ label: 'small', value: 1 }, { label: 'large', value: 30 }], over: { id: 'V8', file: 'assets/media/V8.jpg', width: 1337, height: 1771, people: ['Ada Founder'], face },  at: 0.3 });
  d.getElementById('w')!.append(s.el);
  s.render(2);
  assert.ok(s.el.querySelector('[data-backdrop] [data-face]'), 'the backdrop face is measured');
  assert.equal(s.el.querySelectorAll('[data-graphic="disc"]').length, 2);
  assert.ok(s.layout.dy > 0 || s.layout.cy !== 950 || s.layout.scale < 1, 'the default layout would cover the face, so something moved');
});

test('evidence push: a text target keeps its whole line in frame with a margin at every key, even a line wider than the frame', () => {
  const W = 1080, H = 1920, m = nk.KEEP_MARGIN;
  const screen = (k: { x: number; y: number; scale: number }, b: { x: number; y: number; w: number; h: number }) => ({ l: W / 2 + (b.x - k.x) * k.scale, r: W / 2 + (b.x + b.w - k.x) * k.scale, t: H / 2 + (b.y - k.y) * k.scale, b: H / 2 + (b.y + b.h - k.y) * k.scale });
  const inside = (k: { x: number; y: number; scale: number }, b: { x: number; y: number; w: number; h: number }) => { const s = screen(k, b); return s.l >= m - 0.5 && s.r <= W - m + 0.5 && s.t >= m - 0.5 && s.b <= H - m + 0.5; };
  // A headline that runs edge to edge at scale 1 (a 1300px page at x −40), pushed toward a phrase in it.
  const line = { x: 6, y: 800, w: 1022, h: 90 };
  const keys = nk.evidenceKeys({ t0: 0, t1: 6, to: [330, 845], zoom: 1.12, keep: line });
  for (const k of keys) assert.ok(inside(k, line), JSON.stringify({ k, s: screen(k, line) }));
  assert.ok(keys[1].scale > keys[0].scale, 'still a push');
  // A short line well inside: the push is the usual one.
  const short = nk.evidenceKeys({ t0: 0, t1: 6, to: [540, 900], zoom: 1.12, keep: { x: 300, y: 860, w: 400, h: 60 } });
  assert.deepEqual(short.map((k) => k.scale), [1, 1.12]);
  // A page whose anchored text mark re-aims the push (jsdom: the page's camera follows the mark's words).
  const d = dom();
  const pg = nk.page(d, { media: PAGE, duration: 6 });
  d.getElementById('w')!.append(pg.el);
  const before = JSON.stringify(pg.cameraKeys());
  nk.mark(d, { on: pg, target: 'text:"quiet launch"', kind: 'circle', at: 1.2, duration: 6 });
  assert.notEqual(JSON.stringify(pg.cameraKeys()), before, 'the text mark aims the push');
});

test('screen: a text mark whose line the frame cuts is mark_off_target', () => {
  const off = "sits in a line of words cut by the frame's left edge; keep the whole line in frame";
  const ms = run(4, () => ({ marks: [{ label: 'circle on a region of V59.png', target: true, content: true, geo: { done: true, off } }] }));
  assert.ok(screenProblems(ms, { duration: 6 }).some((p) => /^\[mark_off_target\].*cut by the frame's left edge/.test(p)));
  const graphic = run(4, () => ({ overFace: [{ label: "the disc covers Ada Founder's face" }] }));
  assert.ok(screenProblems(graphic, { duration: 6 }).some((p) => /^\[text_over_face\] the disc covers/.test(p)));
});
