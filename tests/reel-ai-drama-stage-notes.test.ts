// Iteration 9: the owner's notes on the Musk and Siri reels, as tests on the real measurements of those pictures
// (tests/fixtures/reel-ai-drama-stage-pictures.json: faces, visible boxes, shapes and tones copied from the two runs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { boxInFrame, keepCovered, keepUnderBox, markOnHead, pieceKind, preparePiece, solveTimeline, toneBehind, toneIn } from '../explainers/reel-ai-drama/kit/stage-layout.js';
import { placementAt, stageSpec } from '../explainers/reel-ai-drama/kit/components/stage.js';
import { crossesHead, expressionBounds, EXPRESSIONS } from '../explainers/reel-ai-drama/kit/settings/index.js';
import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';

const PICS = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'tests/fixtures/reel-ai-drama-stage-pictures.json'), 'utf8'));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const m = (reel: string) => new Proxy({}, { get: (_, id: string) => PICS[`${reel}:${id}`] }) as Record<string, any>;
const MUSK = m('musk');
const SIRI = m('siri');

type Box = { x: number; y: number; w: number; h: number };
type Pl = Box & { id: string; z: number; rot: number; owner?: string; on?: string; side?: number; head?: Box; face?: Box; kind?: string };
type Moment = { t: number; pieces: Pl[]; labels: Pl[]; marks: Pl[]; report: { tight: boolean } };

/** Solve a frame as `nk.stage` does, and check every moment of it against what the note says. */
function shot(o: Record<string, unknown>) {
  const spec = stageSpec(o);
  const prepared = new Map(spec.pieces.map((p: { id: string }) => [p.id, preparePiece(p as never)]));
  const t = solveTimeline({ ...o, ...spec, duration: o.duration ?? 8 } as never);
  const pieceOf = (id: string) => prepared.get(id) as never;
  const moments = t.moments as Moment[];
  const covered = (over: string, under: string, mo: Moment) => {
    const a = mo.pieces.find((p) => p.id === over), b = mo.pieces.find((p) => p.id === under);
    return a && b && t.z[over] > t.z[under] ? keepCovered(pieceOf(over), a as never, pieceOf(under), b as never) : 0;
  };
  /** The share of a piece's keep under any word on screen, its worst moment. */
  const underWords = (id: string) => Math.max(...moments.flatMap((mo) => {
    const p = mo.pieces.find((x) => x.id === id);
    return p ? mo.labels.map((l) => keepUnderBox(l as never, pieceOf(id), p as never)) : [0];
  }), 0);
  /** The share of a piece's keep under any other piece, its worst moment. */
  const underPieces = (id: string) => Math.max(...moments.flatMap((mo) => mo.pieces.filter((p) => p.id !== id).map((p) => covered(p.id, id, mo))), 0);
  const label = (id: string) => moments.flatMap((mo) => mo.labels).find((l) => l.id === id);
  const finalOf = (id: string) => moments[moments.length - 1].pieces.find((p) => p.id === id)!;
  const headBox = (id: string, mo = moments[moments.length - 1]) => boxInFrame(mo.pieces.find((p) => p.id === id) as never, (prepared.get(id) as { head: never }).head) as Box;
  return { spec, t, moments, covered, underWords, underPieces, label, finalOf, headBox, prepared };
}
const clean = (s: ReturnType<typeof shot>) => {
  for (const mo of s.moments) assert.equal(mo.report.tight, false, `moment ${mo.t} is tight`);
};
const near = (a: Box, b: Box) => Math.hypot(Math.max(0, b.x - (a.x + a.w), a.x - (b.x + b.w)), Math.max(0, b.y - (a.y + a.h), a.y - (b.y + b.h)));

// ── Musk ─────────────────────────────────────────────────────────────────────────────────────────

test('Musk 2: the Hassabis label covers no logo and lands after his picture', () => {
  const s = shot({ ground: MUSK.V9, pieces: [
    { id: 'hassabis', media: MUSK.V32, at: 2.3, label: { text: 'Demis Hassabis', sub: 'DeepMind co-founder and CEO', at: 2 } },
    { id: 'musk', media: MUSK.V111, at: 3.45 },
    { id: 'deepmind', media: MUSK.V97, at: 3 },
  ] });
  clean(s);
  assert.ok(s.underWords('deepmind') <= 0.05);
  assert.ok((s.t.labelTimes as Record<string, { at: number }>)['label-hassabis'].at >= 2.3, 'never before his picture');
});

test('Musk 3: $5 million covers no logo, and Page\'s label is on his side', () => {
  const s = shot({ style: 'paper', ground: 'kraft', arrangement: 'pile', pieces: [
    { id: 'musk', media: MUSK.V12, at: 0 },
    { id: 'page', media: MUSK.V58, at: 4, label: 'Larry Page' },
    { id: 'deepmind', media: MUSK.V97, at: 0.8 },
    { id: 'google', media: MUSK.V64, at: 4.9 },
  ], labels: [{ text: '$5 million', sub: 'Musk into DeepMind', kind: 'number', at: 0.8, until: 3.4 }] });
  clean(s);
  assert.ok(s.underWords('deepmind') <= 0.05);
  assert.ok(s.underWords('google') <= 0.05);
  const label = s.label('label-page')!;
  assert.ok(near(label, s.finalOf('page')) < 300, 'Page\'s label by Page');
  const pageMiddle = s.finalOf('page').x + s.finalOf('page').w / 2, muskMiddle = s.finalOf('musk').x + s.finalOf('musk').w / 2;
  const labelMiddle = label.x + label.w / 2;
  assert.ok(Math.abs(labelMiddle - pageMiddle) <= Math.abs(labelMiddle - muskMiddle), 'closer to Page than to Musk');
});

test('Musk 4: an uncut photo beside a cutout is a framed print; nobody enters hidden; argue marks by the foreheads', () => {
  assert.equal(pieceKind(MUSK.V58), 'print', 'an uncut Page: a framed print on a stage, never a bare rectangle');
  assert.equal(pieceKind(MUSK.V95), 'person');
  const s = shot({ arrangement: 'face_off', pieces: [
    { id: 'musk', media: MUSK.V10, at: 0, side: 'left' },
    { id: 'page', media: MUSK.V95, at: 0.6, side: 'right' },
  ], labels: [{ text: "Musk's birthday party", sub: '2013', at: 0.4 }], marks: [{ kind: 'argue', on: 'musk', at: 3.6 }, { kind: 'argue', on: 'page', at: 3.75 }] });
  clean(s);
  assert.ok(s.underPieces('musk') <= 0.05, 'Musk isn\'t hidden behind Page');
  assert.ok(s.underPieces('page') <= 0.05);
  const last = s.moments[s.moments.length - 1];
  for (const k of last.marks) {
    const head = s.headBox(k.on as never);
    const bounds = expressionBounds('argue', (k as { face: Box }).face, k.side, (k as { head: Box }).head) as Box;
    assert.ok(markOnHead(bounds, head), 'on the head');
    assert.ok(bounds.y < head.y + head.h / 2, 'by the forehead');
  }
});

test('Musk 6: Nosek\'s label is on his side, under him; the logos are not covered by people', () => {
  const s = shot({ arrangement: 'face_off', pieces: [
    { id: 'nosek', media: MUSK.V49, at: 0, side: 'right', label: { text: 'Luke Nosek', sub: 'SpaceX investor', at: 1.5 } },
    { id: 'musk', media: MUSK.V10, at: 2.63, side: 'left' },
    { id: 'deepmind', media: MUSK.V97, at: 4.27 },
    { id: 'google', media: MUSK.V64, at: 5.43 },
  ] });
  clean(s);
  assert.ok(s.underPieces('google') <= 0.05, 'Google is seen');
  assert.ok(s.underPieces('deepmind') <= 0.05, 'DeepMind is seen');
  // Iteration 10: a name stands in clear space beside its owner or at the body's outer edge (I17), for its beat.
  const last = s.moments[s.moments.length - 1];
  const label = s.label('label-nosek')!;
  const head = s.headBox('nosek', last);
  const headMiddle = head.x + head.w / 2;
  assert.ok(headMiddle > 540 && label.x + label.w / 2 > 400, 'on his side');
});

test('Musk 7: Hassabis is big enough, and the small laptop is not covered by him', () => {
  const s = shot({ ground: MUSK.V96, pieces: [
    { id: 'musk', media: MUSK.V107, at: 0, side: 'left' },
    { id: 'nosek', media: MUSK.V49, at: 0, side: 'right' },
    { id: 'hassabis', media: MUSK.V110, at: 1 },
    { id: 'laptop', media: MUSK.V109, at: 0.9, belongs: 'hassabis' },
  ], labels: [{ text: 'Los Angeles', at: 0.2 }] });
  clean(s);
  assert.ok(s.underPieces('laptop') <= 0.05);
  const last = s.moments[s.moments.length - 1];
  const heads = ['musk', 'nosek', 'hassabis'].map((id) => s.headBox(id, last).h);
  assert.ok(heads[2] >= Math.max(heads[0], heads[1]) * 0.75, `his head ${Math.round(heads[2])} beside ${heads.map(Math.round)}`);
  assert.ok(heads[2] >= 200);
});

test('Musk 9: the Mallaby and Hassabis labels do not cover the Google logo', () => {
  const s = shot({ ground: 'whiteboard', arrangement: 'row', hold: true, bounds: { x0: 96, x1: 984, y0: 620, y1: 1500 }, pieces: [
    { id: 'mallaby', media: MUSK.M1, at: 0, label: { text: 'Mallaby', at: 1.14 } },
    { id: 'google', media: MUSK.V64, at: 2.79 },
    { id: 'hassabis', media: MUSK.M2, at: 1.83, label: { text: 'Hassabis', at: 2.03 } },
    { id: 'racks', media: MUSK.M3, at: 5.75 },
  ] });
  clean(s);
  assert.ok(s.underWords('google') <= 0.05);
  assert.ok(s.underPieces('google') <= 0.05);
  const a = s.label('label-mallaby')!, b = s.label('label-hassabis')!;
  assert.ok(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, 'not one block');
});

test('Musk 5: a close-up makes room for its marks by pulling back', () => {
  const dom = new JSDOM('<!doctype html><div id="w"></div>').window.document;
  const face = { x: 0.42, y: 0.34, w: 0.2, h: 0.16 };
  const media = { id: 'V', file: 'v.png', width: 1000, height: 1000, people: ['M'], regions: { faces: [{ ...face, name: 'M' }] } };
  const tour = nk.tour(dom, { media, stops: [{ face: 'M', zoom: 2.6, at: 0 }], duration: 6 }) as unknown as { stops: { zoom: number }[]; makeRoom: (kind: string, region: Box, head: Box, at: number) => number | null };
  const before = tour.stops[0].zoom;
  const side = tour.makeRoom('worry', face, { x: 0.41, y: 0.28, w: 0.22, h: 0.22 }, 1);
  assert.ok(side === 1 || side === -1, 'a side that fits');
  assert.ok(tour.stops[0].zoom < before, 'pulled back');
});

// ── Siri ─────────────────────────────────────────────────────────────────────────────────────────

test('Siri 1: the Siri logo is not under the date; the phone photo holds its spot, Jobs lands beside it', () => {
  const s = shot({ style: 'paper', ground: 'charcoal', arrangement: 'pile', pieces: [
    { id: 'phones', media: SIRI.V56, at: 0 },
    { id: 'apple', media: SIRI.V3, at: 1 },
    { id: 'siri', media: SIRI.V80, at: 2 },
    { id: 'phone', media: SIRI.V79, at: 3 },
    { id: 'jobs', media: SIRI.V8, at: 4.5 },
  ], labels: [{ text: 'February 2010', kind: 'date', at: 0.3 }] });
  clean(s);
  assert.ok(s.underWords('siri') <= 0.05);
  const at = (t: number, id: string) => placementAt(s.moments, id, t);
  // Iteration 10: pieces hold their final spots (decision 3), so room for Jobs was left from the start.
  const before = at(4.4, 'phones') as Box, after = at(7, 'phones') as Box;
  assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 0.5 && after.w === before.w, 'the phones hold their spot');
  assert.ok(s.underPieces('phones') <= 0.05 && s.underPieces('jobs') <= 0.05);
});

test('Siri 5: a drawing on a night picture is drawn in light ink, from the pixels', () => {
  const night = toneIn(SIRI.M5.regions) as number;
  assert.ok(night < 0.4, `a dark picture ${night}`);
  const s = shot({ ground: SIRI.M5, pieces: [{ id: 'jobs', media: SIRI.M4, at: 0, label: { text: 'Steve Jobs', at: 0.3 } }] });
  const p = s.finalOf('jobs');
  const behind = toneBehind(p, [], (x: number, y: number) => toneIn(SIRI.M5.regions, { x: x / 1080, y: y / 1920, w: 0.05, h: 0.05 }));
  assert.ok(behind < 0.5, 'chalk');
});

test('Siri 6: Jobs does not cover Kittlaus', () => {
  const s = shot({ arrangement: 'face_off', pieces: [
    { id: 'kittlaus', media: SIRI.V24, at: 0, side: 'left' },
    { id: 'shoes', media: SIRI.V89, at: 1.3 },
    { id: 'jobs', media: SIRI.V8, at: 2.2, side: 'right' },
  ], labels: [{ text: 'come before the ballet', at: 2.7, for: 'jobs' }] });
  clean(s);
  assert.ok(s.underPieces('kittlaus') <= 0.05);
  assert.ok(s.underPieces('shoes') <= 0.05);
});

test('Siri 7: the fire is not hidden behind the people', () => {
  const s = shot({ ground: 'charcoal', pieces: [
    { id: 'fire', media: SIRI.V90, at: 1.6 },
    { id: 'kittlaus', media: SIRI.V92, at: 0, side: 'left' },
    { id: 'jobs', media: SIRI.V91, at: 0, side: 'right' },
  ], marks: [{ kind: 'idea', on: 'jobs', at: 3.9 }] });
  clean(s);
  assert.ok(s.underPieces('fire') <= 0.05);
});

test('Siri 8: the co-founder does not enter behind Jobs', () => {
  const s = shot({ arrangement: 'face_off', pieces: [
    { id: 'jobs', media: SIRI.V8, at: 0, side: 'right' },
    { id: 'cheyer', media: SIRI.V36, at: 2, side: 'left' },
    { id: 'siri', media: SIRI.V80, at: 4 },
  ], labels: [{ text: 'not looking to sell', at: 3, for: 'cheyer' }] });
  clean(s);
  assert.ok(s.underPieces('cheyer') <= 0.05);
  // Anyone on stage at 2.1s is seen, on the way as well as at rest.
  const j = placementAt(s.moments, 'jobs', 2.1) as Box, c = placementAt(s.moments, 'cheyer', 2.1) as Box;
  assert.ok(c.x + c.w / 2 < j.x + j.w / 2);
});

test('Siri 12: worry lines are drawn around the top of Kittlaus\'s head, off it, on either side', () => {
  const f = SIRI.V24 as { regions: { faces: Box[] } };
  const px = (b: Box) => ({ x: b.x * 800, y: b.y * 1000 + 600, w: b.w * 800, h: b.h * 1000 });
  const face = px(f.regions.faces[0]);
  for (const side of [1, -1]) {
    const pts = EXPRESSIONS.worry(face, side).flatMap((p: { d: string }) => [...p.d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((n) => [Number(n[1]), Number(n[2])]));
    assert.ok(pts.length > 0);
    assert.equal(crossesHead(pts, { x: face.x, y: face.y - face.h * 0.2, w: face.w, h: face.h * 1.2 }), false);
    const b = expressionBounds('worry', face, side) as Box;
    assert.ok(b.y < face.y, 'above the brow');
  }
});
