// Iteration 10 round 2: the rules behind the visual findings, one property each. Nothing here names a reel.
import assert from 'node:assert/strict';
import test from 'node:test';

import { autoSlide, backdropBand, bareSheets, boxInFrame, crowdLead, crowdSlots, edgeCutCrop, headlinePhrase, lensRoom, LIMITS, phraseLines, preparePiece, solveTimeline, STAGE } from '../explainers/reel-ai-drama/kit/stage-layout.js';
import { phraseLines as anchorPhrase, pickInk, strokeRect } from '../explainers/reel-ai-drama/kit/components/anchor.js';
import { repeatsSpoken } from '../explainers/reel-ai-drama/kit/components/compiled.js';
import { heldCount, STAT_HOLD } from '../explainers/reel-ai-drama/kit/components/stat.js';
import { readWordsHard } from '../lib/reel-ai-drama/harvest/boxes';
import { edgeCutOf, inkChroma, pictureFocus, sharpOf, sharpWidth } from '../lib/reel-ai-drama/harvest/regions';
import { backgroundPalette, CUT_FRINGE_REJECT, CUT_FRINGE_ROUGH, gradeCut, headFromShape, labOf, removeFringe } from '../lib/reel-ai-drama/harvest/transparent';

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any

// ── The cut's clean-up ─────────────────────────────────────────────────────────

const OLD = [40, 110, 200] as const;
const HAIR = [60, 50, 45] as const;
/** A round head of hair with a rim of the old background round it. */
function rimmed(w: number, h: number, rim: number) {
  const keep = new Uint8Array(w * h);
  const lab = new Float32Array(w * h * 3);
  const cx = w / 2, cy = h / 2, R = w * 0.3;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > R) continue;
      keep[y * w + x] = 1;
      const c = d > R - rim ? OLD : HAIR;
      lab.set(labOf(c[0], c[1], c[2]), (y * w + x) * 3);
    }
  }
  return { keep, lab };
}
const countOf = (a: Uint8Array) => a.reduce((n, v) => n + v, 0);

test('fringe: the old background along a cut\'s edge goes, what is near it in colour only inside stays', () => {
  const w = 120, h = 120;
  const { keep, lab } = rimmed(w, h, 4);
  const palette = [labOf(OLD[0], OLD[1], OLD[2])] as Any;
  const out = removeFringe(keep, lab, w, h, 60, palette);
  assert.ok(out.removed > 0, 'something came off');
  assert.ok(out.fringe < CUT_FRINGE_ROUGH, `left ${out.fringe}`);
  assert.equal(out.keep[(h / 2) * w + w / 2], 1, 'the middle stays');
});

test('fringe: with nothing of the old background near the edge, nothing moves', () => {
  const w = 120, h = 120;
  const { keep, lab } = rimmed(w, h, 0);
  const out = removeFringe(keep, lab, w, h, 60, [labOf(OLD[0], OLD[1], OLD[2])] as Any);
  assert.equal(out.removed, 0);
  assert.equal(countOf(out.keep), countOf(keep));
});

test('fringe: the grade drops when it can\'t be removed; a clean cut stays clean', () => {
  const base = { edge_softness: 0, islands: 0, straight_cuts: 0, sharpness: 1 };
  assert.equal(gradeCut({ ...base, fringe: 0 }, true), 'clean');
  assert.equal(gradeCut({ ...base, fringe: CUT_FRINGE_ROUGH }, true), 'rough');
  assert.equal(gradeCut({ ...base, fringe: CUT_FRINGE_REJECT }, true), 'rejected');
});

test('the old background is read from the photo\'s border, however the cut is registered', () => {
  const w = 40, h = 40;
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < w * h; i++) data.set(OLD, i * 3);
  const palette = backgroundPalette({ data, channels: 3, width: w, height: h } as Any, [labOf(HAIR[0], HAIR[1], HAIR[2])] as Any);
  assert.ok(palette.length >= 1);
  const [L, a, b] = labOf(OLD[0], OLD[1], OLD[2]);
  assert.ok(palette.some((c) => Math.hypot(c[0] - L, c[1] - a, c[2] - b) < 10));
});

test('a cut with no measured face has a head from its own shape', () => {
  const w = 60, h = 90;
  const keep = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const half = y < 30 ? 10 : 26;
    for (let x = 30 - half; x < 30 + half; x++) keep[y * w + x] = 1;
  }
  const head = headFromShape(keep, w, h)!;
  assert.ok(head);
  assert.ok(head.y < 0.1 && head.h < 0.6, JSON.stringify(head));
});

// ── What the harvest measures ──────────────────────────────────────────────────

test('focus: the blob that stands out; what runs off the edge is background; a flat picture has none', () => {
  const w = 96, h = 72;
  const flat = new Uint8Array(w * h * 3).fill(90);
  assert.equal(pictureFocus(flat, w, h), null);
  const rgb = flat.slice();
  // A bright horizon off both edges and a subject in the middle.
  for (let x = 0; x < w; x++) for (let y = 4; y < 8; y++) rgb.set([250, 250, 250], (y * w + x) * 3);
  for (let x = 40; x < 56; x++) for (let y = 40; y < 52; y++) rgb.set([250, 240, 200], (y * w + x) * 3);
  const f = pictureFocus(rgb, w, h)!;
  assert.ok(f, 'found');
  assert.ok(f.y > 0.4, `not the horizon: ${JSON.stringify(f)}`);
  assert.ok(f.x < 48 / w && f.x + f.w > 48 / w, JSON.stringify(f));
});

test('a logo\'s ink: black is no colour, a red one is', () => {
  const px = (r: number, g: number, b: number) => Uint8Array.from([r, g, b, 255, r, g, b, 255]);
  assert.ok(inkChroma(px(10, 10, 10), 2, 1) < 0.06);
  assert.ok(inkChroma(px(220, 30, 30), 2, 1) > 0.5);
});

test('an upscaled picture stays sharp only as far as its first pixels did', () => {
  assert.equal(sharpOf(5000, { flags: [], width: 1200 } as Any), sharpWidth(5000));
  assert.equal(sharpOf(5000, { flags: ['upscaled:1.2x'], width: 1200 } as Any), sharpWidth(1000));
});

test('a block of words the picture\'s edge cuts: letters running off over a line right under it', () => {
  const w = 100, h = 100;
  const grey = new Uint8Array(w * h).fill(20);
  const words = [{ box: { x: 0.3, y: 0.05, w: 0.4, h: 0.05 } }];
  assert.equal(edgeCutOf(grey, w, h, words), null, 'no letters at the edge');
  for (let x = 30; x < 70; x += 4) grey[x] = 240;
  const cut = edgeCutOf(grey, w, h, words)!;
  assert.ok(cut.top! > 0.1, JSON.stringify(cut));
  // Far from the edge, ink there is something else.
  assert.equal(edgeCutOf(grey, w, h, [{ box: { x: 0.3, y: 0.4, w: 0.4, h: 0.05 } }]), null);
  const media = { width: 1000, height: 500, kind: 'article_image', regions: { words: [{ text: 'x', box: words[0]!.box }], edge_cut: cut } };
  const crop = edgeCutCrop(media)!;
  assert.equal(crop.y, cut.top);
  assert.equal(preparePiece({ id: 'a', media, at: 0 } as Any).crop.y, cut.top);
});

test('OCR tries harder until it has the words; boxes stay in the picture\'s frame', async () => {
  // No such file: each variant fails, and what the first read found stands.
  const first = [{ text: 'other', conf: 90, left: 10, top: 10, width: 30, height: 10 }];
  const got = await readWordsHard('/nonexistent.png', 100, 100, async () => first as Any, () => false);
  assert.equal(got.length, 1);
  assert.equal(got[0]!.box.x, 0.1);
  let calls = 0;
  await readWordsHard('/nonexistent.png', 100, 100, async () => { calls += 1; return first as Any; }, () => true);
  assert.equal(calls, 1, 'enough at once: no more reads');
});

test('a phrase is found however OCR confused its letters, in the layout and on the mark', () => {
  const media = { width: 100, height: 100, regions: { words: ['Director', 'of', 'Al', 'Research'].map((text, i) => ({ text, box: { x: i * 0.2, y: 0.5, w: 0.18, h: 0.05 } })) } };
  for (const find of [phraseLines, anchorPhrase]) assert.equal(find(media, 'Director of AI Research').length, 1);
  assert.equal(phraseLines(media, 'Director of Art Research').length, 0);
});

test('a mark whose words aren\'t there goes to the tallest line the picture shows', () => {
  const media = { width: 100, height: 100, regions: { words: [{ text: 'small', box: { x: 0.1, y: 0.8, w: 0.1, h: 0.02 } }, { text: 'Big', box: { x: 0.1, y: 0.1, w: 0.2, h: 0.08 } }, { text: 'line', box: { x: 0.35, y: 0.1, w: 0.2, h: 0.08 } }] } };
  assert.equal(headlinePhrase(media), 'Big line');
  assert.equal(headlinePhrase({ width: 1, height: 1 }), null);
});

// ── Backdrops, lens, date, count ───────────────────────────────────────────────

test('a backdrop shows what of a picture has no words; a picture of words is flagged for the heavier look', () => {
  const lines = (ys: number[]) => ({ width: 100, height: 100, regions: { words: ys.map((y) => ({ text: 'word', box: { x: 0.1, y, w: 0.3, h: 0.04 } })) } });
  const b = backdropBand(lines([0.05, 0.12, 0.2]));
  assert.ok(!b.words && b.y >= 0.24, JSON.stringify(b));
  for (const w of lines([0.05, 0.12, 0.2]).regions.words) assert.ok(w.box.y + w.box.h <= b.y || w.box.y >= b.y + b.h);
  assert.equal(backdropBand(lines([0.1, 0.25, 0.4, 0.55, 0.7, 0.85])).words, true);
  assert.deepEqual(backdropBand({ width: 1, height: 1 }), { y: 0, h: 1, words: false });
});

test('a stat\'s own lens stays on screen and off the subject', () => {
  const base = { x: 300, y: 700, w: 480, h: 360 };
  const open = lensRoom(base);
  assert.ok(open >= 1.7, `${open}`);
  assert.ok(880 - 180 * open >= STAGE.top - 40 - 1e-6, 'off the caption band');
  const near = lensRoom({ x: 700, y: 700, w: 300, h: 300 });
  assert.ok(700 + 150 + 150 * near <= STAGE.W - 30 + 1e-6);
  const keep = { x: 200, y: 1100, w: 700, h: 200 };
  const s = lensRoom(base, [keep]);
  assert.ok(880 + 180 * s <= 1100 + 1e-6, `${s}`);
  assert.equal(lensRoom({ x: 0, y: 0, w: STAGE.W, h: 300 }), 1);
});

test('a counted figure holds its last value: the count gives way, not the hold', () => {
  assert.equal(heldCount(1.2, Infinity), 1.2);
  assert.equal(heldCount(1.2, 10), 1.2);
  const c = heldCount(1.2, 2.2);
  assert.ok(2.2 - c >= STAT_HOLD - 1e-9, `${c}`);
  assert.equal(heldCount(1.2, 0.5), 0.3);
});

test('a date spoken as it shows repeats the caption; one the voice doesn\'t say stands', () => {
  const words = ['on', 'December', '22nd', '2016', 'they'].map((text, i) => ({ text, start: 0.2 + i * 0.3 }));
  assert.equal(repeatsSpoken('22 December 2016', words, 0), true);
  assert.equal(repeatsSpoken('6 March 2015', words, 0), false);
  assert.equal(repeatsSpoken('22 December 2016', words, 30), false, 'said long before it shows');
});

// ── Layout ─────────────────────────────────────────────────────────────────────

const personMedia = (id: string, head = 0.3) => ({
  id, kind: 'person_cutout', width: 1000, height: 1400, people: [id], flags: ['cutout'], made: false,
  regions: {
    visible: { x: 0.3, y: 0.05, w: 0.4, h: 0.95 },
    faces: [{ x: 0.42, y: 0.1, w: 0.16, h: head * 0.5, score: 1, trusted: true, name: id }],
    open_edges: { left: false, right: false, top: false, bottom: true },
    cut: { grade: 'clean', edge_softness: 0, islands: 0, straight_cuts: 0, sharpness: 1 },
    sharp_width_px: 4000,
  },
});
const photo = (id: string, w = 1000, h = 700, extra: Any = {}) => ({ id, kind: 'event_photo', width: w, height: h, people: [], flags: [], regions: { sharp_width_px: 4000, ...extra } });

test('a crowd has someone it is about: the plan\'s lead, then the speaker, the marked, the first in', () => {
  const p = (id: string, at = 0, role?: string) => ({ id, at, role });
  assert.equal(crowdLead([p('a'), p('b')] as Any, {}), null, 'two is not a crowd');
  assert.equal(crowdLead([p('a'), p('b', 0, 'lead'), p('c')] as Any, {}).id, 'b');
  assert.equal(crowdLead([p('a'), p('b'), p('c')] as Any, { speech: [{ on: 'c' }] }).id, 'c');
  assert.equal(crowdLead([p('a'), p('b'), p('c')] as Any, { marks: [{ on: 'b' }] }).id, 'b');
  assert.equal(crowdLead([p('a', 1), p('b', 0), p('c', 2)] as Any, {}).id, 'b');
  assert.equal(crowdLead([p('a'), p('b'), p('c')] as Any, {}), null, 'nothing to tell them apart');
  const { centres, widths } = crowdSlots(4, 1);
  assert.ok(widths[1]! > widths[0]! * 1.4);
  assert.ok(centres.every((c, i) => i === 0 || c > centres[i - 1]!));
});

test('at a peak of four, one head stands out and the row isn\'t level', () => {
  const pieces = ['a', 'b', 'c', 'd'].map((id, i) => ({ id, media: personMedia(id), at: 0, role: i === 1 ? 'lead' : undefined }));
  const t: Any = solveTimeline({ arrangement: 'row', style: 'cutouts', duration: 6, pieces } as Any);
  const heads = new Map(pieces.map((p) => {
    const prep = t.prepared.find((x: Any) => x.id === p.id);
    const pl = t.moments.at(-1).pieces.find((x: Any) => x.id === p.id);
    return [p.id, boxInFrame(pl, prep.head)];
  }));
  assert.ok(!t.report.notes.some((n: string) => /stage_tight/.test(n)), t.report.notes.join('; '));
  const hs = [...heads.values()].map((b) => b.h);
  const others = pieces.filter((p) => p.role !== 'lead').map((p) => heads.get(p.id)!.h);
  assert.ok(heads.get('b')!.h >= Math.max(...others) * 1.15, `lead ${heads.get('b')!.h} beside ${others}`);
  assert.ok(Math.max(...hs) / Math.min(...hs) <= LIMITS.headRatio + 0.01);
  const ys = [...heads.values()].map((b) => Math.round(b.y));
  assert.ok(new Set(ys).size > 1, `heads ${ys}`);
});

test('a small piece beside a wide one: the wide one gets its own row and most of the width', () => {
  const t: Any = solveTimeline({ arrangement: 'lead_inset', style: 'cutouts', duration: 6, pieces: [{ id: 'logo', media: { id: 'l', kind: 'logo', width: 400, height: 400, people: [], flags: ['logo'], regions: {} }, role: 'lead', at: 0 }, { id: 'wide', media: photo('w', 1500, 480), at: 1 }] } as Any);
  const last = t.moments.at(-1).pieces;
  const wide = last.find((p: Any) => p.id === 'wide');
  const logo = last.find((p: Any) => p.id === 'logo');
  assert.ok(wide.w >= 800, `wide ${wide.w}`);
  assert.ok(logo.y + logo.h <= wide.y + 20 || wide.y + wide.h <= logo.y + 20, 'stacked');
});

test('what belongs to a piece stands with it; two on one side stack on that side', () => {
  const t: Any = solveTimeline({ style: 'cutouts', duration: 6, bounds: { x0: 96, x1: 984, y0: 620, y1: 1500 }, pieces: [{ id: 'sheet', media: photo('s', 800, 800), at: 0 }, { id: 'year', note: '2015', note_role: 'date', belongs: 'sheet', at: 1 }, { id: 'other', media: photo('o', 800, 800), at: 2 }] } as Any);
  const by = new Map<string, Any>(t.moments.at(-1).pieces.map((p: Any) => [p.id, p]));
  const s = by.get('sheet'), y = by.get('year');
  assert.ok(y.y >= s.y + s.h - 10, 'under its owner');
  assert.ok(Math.abs(y.x + y.w / 2 - (s.x + s.w / 2)) < s.w / 2, 'and over it');

  const side: Any = solveTimeline({ style: 'cutouts', duration: 6, pieces: [{ id: 'l', media: photo('l', 800, 800), at: 0, side: 'left' }, { id: 'r1', media: photo('r1', 800, 600), at: 1, side: 'right' }, { id: 'r2', media: photo('r2', 800, 600), at: 2, side: 'right' }] } as Any);
  const b2 = new Map<string, Any>(side.moments.at(-1).pieces.map((p: Any) => [p.id, p]));
  for (const id of ['r1', 'r2']) assert.ok(b2.get(id).x + b2.get(id).w / 2 > STAGE.W / 2, `${id} on the right`);
  assert.ok(b2.get('l').x + b2.get('l').w / 2 < STAGE.W / 2);
});

test('a stat over a picture stands clear of the picture\'s subject and on screen', () => {
  const media = photo('v', 2160, 1620, { focus: { x: 0.35, y: 0.45, w: 0.3, h: 0.15 } });
  const t: Any = solveTimeline({ style: 'cutouts', duration: 6, pieces: [{ id: 'fill', media, fill: true, at: 0 }, { id: 'n', treatment: 'stat', opts: { kind: 'counter', value: '4' }, at: 1 }] } as Any);
  const last = t.moments.at(-1).pieces;
  const fill = last.find((p: Any) => p.id === 'fill');
  const stat = last.find((p: Any) => p.id === 'n');
  const f = boxInFrame(fill, media.regions.focus);
  const clear = stat.x + stat.w <= f.x || stat.x >= f.x + f.w || stat.y + stat.h <= f.y || stat.y >= f.y + f.h;
  assert.ok(clear, `stat ${JSON.stringify([stat.x, stat.y, stat.w, stat.h])} on ${JSON.stringify(f)}`);
  assert.ok(stat.x >= 0 && stat.x + stat.w <= STAGE.W && stat.y >= STAGE.top - 1 && stat.y + stat.h <= STAGE.bottom + 1);
});

test('what waits for a last arrival stands nearer the middle, within the slide\'s limit, and moves over as it lands', () => {
  const pieces = [{ id: 'a', media: photo('a', 600, 600), at: 0 }, { id: 'b', media: photo('b', 600, 600), at: 3 }];
  const t: Any = solveTimeline({ arrangement: 'row', style: 'cutouts', duration: 6, camera: { move: 'hold', stops: [{ at: 0, aim: 'whole' }] }, pieces } as Any);
  const sl = t.camera.slide;
  assert.ok(sl?.auto, 'it slides');
  assert.ok(Math.abs(sl.dx) <= LIMITS.slideMax);
  assert.equal(sl.to, 3);
  assert.deepEqual(sl.ids, ['a']);
  const a = t.moments.at(-1).pieces.find((p: Any) => p.id === 'a');
  const before = Math.abs(STAGE.W / 2 - (a.x + a.w / 2));
  const after = Math.abs(STAGE.W / 2 - (a.x + a.w / 2 + sl.dx));
  assert.ok(after < before, `${before} -> ${after}`);
  const peak: Any = solveTimeline({ arrangement: 'row', style: 'cutouts', duration: 6, peak: true, camera: { move: 'hold', stops: [{ at: 0, aim: 'whole' }] }, pieces } as Any);
  assert.equal(peak.camera.slide, null);
  assert.equal(autoSlide({ prep: [], placed: new Map(), plan: {}, duration: 6 } as Any), null);
});

test('a camera pull-back is quick: what is on holds its size for most of its beat', () => {
  const pieces = [{ id: 'a', media: photo('a', 700, 700), at: 0 }, { id: 'b', media: photo('b', 700, 700), at: 2 }];
  const t: Any = solveTimeline({ arrangement: 'row', style: 'cutouts', duration: 6, camera: { move: 'push', stops: [{ at: 0, aim: 'whole' }] }, pieces } as Any);
  const keys = t.camera.keys;
  const down = keys.findIndex((k: Any, i: number) => i > 0 && k.s < keys[i - 1].s - 1e-3);
  if (down > 0) assert.ok(keys[down].t - keys[down - 1].t <= 0.85, `${keys[down].t - keys[down - 1].t}s`);
});

test('a lone sheet on a dark ground that leaves it half bare has a backdrop; beside anything, or filling the frame, it doesn\'t', () => {
  const sheet = (id: string, w: number, h: number, at = 0) => ({ id, media: photo(id, w, h), kind: 'print', at });
  const solo: Any = solveTimeline({ style: 'cutouts', duration: 6, pieces: [sheet('w', 1600, 800)] } as Any);
  assert.deepEqual(bareSheets(solo.moments, solo.prepared, 'charcoal'), ['w']);
  assert.deepEqual(bareSheets(solo.moments, solo.prepared, 'whiteboard'), []);
  const two: Any = solveTimeline({ style: 'cutouts', duration: 6, pieces: [sheet('a', 1600, 800), sheet('b', 1600, 800, 1)] } as Any);
  assert.deepEqual(bareSheets(two.moments, two.prepared, 'charcoal'), []);
  const tall: Any = solveTimeline({ style: 'cutouts', duration: 6, pieces: [sheet('t', 900, 900)] } as Any);
  assert.deepEqual(bareSheets(tall.moments, tall.prepared, 'charcoal'), []);
  const page: Any = solveTimeline({ style: 'cutouts', duration: 6, pieces: [{ id: 'p', media: { ...photo('p', 1600, 800), kind: 'article' }, kind: 'print', at: 0 }] } as Any);
  assert.deepEqual(bareSheets(page.moments, page.prepared, 'charcoal'), []);
});

test('a body with a cut edge stands larger so its ledge sits lower, up to the head limit', () => {
  const media = personMedia('p', 0.3);
  (media.regions.open_edges as Any) = { left: false, right: false, top: false, bottom: true };
  const t: Any = solveTimeline({ style: 'cutouts', duration: 6, pieces: [{ id: 'p', media, at: 0 }] } as Any);
  const prep = t.prepared.find((x: Any) => x.id === 'p');
  const pl = t.moments.at(-1).pieces.find((x: Any) => x.id === 'p');
  assert.ok(boxInFrame(pl, prep.head).h <= LIMITS.headMax + 1);
  if (t.ledge != null) assert.ok(t.ledge >= LIMITS.ledgeTop);
});

test('a person\'s picture gives the scene above the head as a backdrop; with none there, what has no words', () => {
  const face = (y: number, h: number) => ({ x: 0.3, y, w: 0.4, h, score: 0.99, trusted: true });
  const high = backdropBand({ width: 100, height: 100, regions: { faces: [face(0.2, 0.35)] } });
  assert.ok(!high.words && high.y === 0 && Math.abs(high.h - 0.2) < 1e-9, JSON.stringify(high));
  const filled = backdropBand({ width: 100, height: 100, regions: { faces: [face(0.02, 0.96)], words: [{ text: 'word', box: { x: 0.1, y: 0.05, w: 0.3, h: 0.04 } }] } });
  assert.ok(!filled.words && filled.y >= 0.089, JSON.stringify(filled));
});

test('a stroke\'s ink is judged on the patch it runs on, and the marker colour gives way on a card of its own colour', () => {
  const rect = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h });
  const whole = rect(0, 0, 1000, 500);
  assert.deepEqual(strokeRect([rect(100, 400, 300, 8), rect(120, 410, 200, 6)], whole), rect(100, 400, 300, 16));
  assert.equal(strokeRect([rect(0, 0, 0, 0), undefined], whole), whole);
  assert.notEqual(pickInk('#E5531D', [222, 55, 75]), '#E5531D');
  assert.equal(pickInk('#E5531D', [240, 240, 235]), '#E5531D');
});
