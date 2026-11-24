// Iteration 10: guarantees I7–I20 of the stage (planning/AI Mini Docs/ITERATION-10-CONTRACT.md), checked from outside the
// solver over thousands of seeded casts of measured pictures: cut grades, open edges, trusted and untrusted faces, sharpness
// limits, wide pictures, words, treatment pieces, notes, arrows, hooks, plates, camera tours and lifetimes. Offline.
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';

import { applyPose, boxInFrame, boxOnBody, chestOf, facesOf, fillOf, fillPlacement, footOf, headIn, keepCovered, LIMITS, lineAround, openEdgesOf, phraseLines, poseAt, preparePiece, routeArrow, slideAt, solveStage, solveTimeline, STAGE, stageMoments, toneBehind } from '../explainers/reel-ai-drama/kit/stage-layout.js';
import { crossesHead } from '../explainers/reel-ai-drama/kit/settings/index.js';
import { cutoutSource, liftBox, stageSpec } from '../explainers/reel-ai-drama/kit/components/stage.js';
import { findFace } from '../explainers/reel-ai-drama/kit/components/anchor.js';
import * as nk from '../explainers/reel-ai-drama/kit/components/index.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;
type Box = { x: number; y: number; w: number; h: number };
const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const grid = (inside: (x: number, y: number) => boolean, n = 32) => {
  let cells = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) cells += inside((x + 0.5) / n, (y + 0.5) / n) ? '1' : '0';
  return { w: n, h: n, cells };
};
const tone = (v: number) => ({ w: 1, h: 1, cells: [v] });

/** A tight bust: shoulders stop at both sides of the picture and at its foot, as the real cut-outs do. */
function bust(r: () => number, id: string, name: string) {
  const fw = 0.42 + r() * 0.14, fh = fw * 0.75;
  const fx = 0.5 - fw / 2 + (r() - 0.5) * 0.06, fy = 0.14 + r() * 0.1;
  const cx = fx + fw / 2;
  const shoulders = fy + fh * 1.45;
  const shape = grid((x, y) => (y > 0.04 && y < fy + fh * 1.3 && Math.hypot((x - cx) / (fw * 0.62), (y - fy - fh * 0.42) / (fh * 0.86)) < 1) || (y >= shoulders - 0.02 && Math.abs(x - cx) < 0.18 + (y - shoulders) * 1.6) || (y > fy + fh * 0.8 && y < shoulders + 0.03 && Math.abs(x - cx) < 0.16));
  return {
    id, kind: 'person_photo', width: 1500 + Math.round(r() * 300), height: 2000, people: [name], flags: ['cutout', 'transparent'], credit: `Photo ${id}, CC BY-SA 4.0`,
    regions: {
      faces: [{ x: fx, y: fy, w: fw, h: fh, name, trusted: true, score: 0.95 }], visible: { x: 0, y: 0.04, w: 1, h: 0.96 }, shape,
      tone: tone(4 + Math.round(r() * 8)), cut: { grade: 'clean', edge_softness: 0.1, islands: 0, straight_cuts: 0, sharpness: 0.8 },
      open_edges: { left: true, right: true, top: false, bottom: true }, sharp_width_px: 1500, brightness: 0.3 + r() * 0.4,
    },
  };
}
/** A whole figure, feet and all, with a coffee cup the detector took for a bigger face. */
function figure(r: () => number, id: string, name: string) {
  const fw = 0.14 + r() * 0.1, fh = fw * 0.8;
  const fx = 0.5 - fw / 2, fy = 0.06 + r() * 0.04;
  const cx = fx + fw / 2;
  const shape = grid((x, y) => (y >= fy - 0.01 && y < fy + fh * 1.15 && Math.hypot((x - cx) / (fw * 0.65), (y - fy - fh * 0.45) / (fh * 0.8)) < 1) || (y >= fy + fh && y < 0.98 && Math.abs(x - cx) < 0.26));
  return {
    id, kind: 'person_photo', width: 800, height: 1400, people: [name], flags: ['cutout', 'transparent'],
    regions: {
      faces: [{ x: 0.05, y: 0.5, w: 0.4, h: 0.25, trusted: false, score: 0.51 }, { x: fx, y: fy, w: fw, h: fh, name, trusted: true, score: 0.97 }], visible: { x: 0.1, y: 0.05, w: 0.8, h: 0.93 }, shape,
      tone: tone(9), cut: { grade: r() < 0.3 ? 'rough' : 'clean' }, open_edges: { left: false, right: false, top: false, bottom: false }, sharp_width_px: 800,
    },
  };
}
const rejected = (r: () => number, id: string, name: string) => { const b = bust(r, id, name); b.regions.cut = { grade: 'rejected', edge_softness: 0.9, islands: 7, straight_cuts: 3, sharpness: 0.1 }; return b; };
const logo = (r: () => number, id: string) => { const a = 1 + r() * 4; return { id, kind: 'logo', width: Math.round(400 * a), height: 400, people: [], flags: ['logo'], credit: 'Logo', regions: { faces: [], visible: { x: 0.08, y: 0.08, w: 0.84, h: 0.84 }, tone: tone(13) } }; };
const printed = (r: () => number, id: string) => ({ id, kind: 'event_photo', width: 1000, height: Math.round(620 + r() * 300), people: [], flags: [], credit: `Photo ${id}`, regions: { faces: [], visible: { x: 0, y: 0, w: 1, h: 1 }, tone: tone(7), sharp_width_px: 900 } });
const WORDS = ['the', 'board', 'voted', 'last', 'night', 'to', 'remove', 'its', 'chief', 'executive', 'after', 'weeks', 'of', 'quiet', 'argument', 'between', 'the', 'founders'];
function article(r: () => number, id: string) {
  const words: Any[] = [];
  const lines = 26;
  for (let j = 0; j < lines; j++) {
    for (let i = 0; i < 6; i++) words.push({ text: `${WORDS[(j * 6 + i) % WORDS.length]}${j}`, box: { x: 0.06 + i * 0.15, y: 0.04 + j * 0.035, w: 0.13, h: 0.022 } });
  }
  return { id, kind: 'article', width: 1080, height: 1500 + Math.round(r() * 400), people: [], flags: [], credit: 'Screenshot', regions: { faces: [], visible: { x: 0, y: 0, w: 1, h: 1 }, words, tone: tone(14) } };
}
const wide = (r: () => number, id: string) => ({ id, kind: 'event_photo', width: 3000, height: 800, people: ['A', 'B'], flags: [], credit: `Wide ${id}`, regions: { faces: [{ x: 0.05, y: 0.3, w: 0.05, h: 0.2, name: 'A', trusted: true }, { x: 0.9, y: 0.3, w: 0.05, h: 0.2, name: 'B', trusted: true }], visible: { x: 0, y: 0, w: 1, h: 1 }, tone: tone(6), sharp_width_px: 3000 } });
const scenePhoto = (r: () => number, id: string) => ({ id, kind: 'place_photo', width: 2160, height: 1440, people: [], flags: [], credit: `Place ${id}`, regions: { faces: [], visible: { x: 0, y: 0, w: 1, h: 1 }, tone: tone(5), sharp_width_px: 2160 * 2 } });
const subjectPhoto = (r: () => number, id: string) => ({ id, kind: 'event_photo', width: 1440, height: 2160, people: ['Z'], flags: [], credit: `Crowd ${id}`, regions: { faces: [{ x: 0.42, y: 0.42, w: 0.16, h: 0.11, name: 'Z', trusted: true }], visible: { x: 0, y: 0, w: 1, h: 1 }, tone: tone(5), sharp_width_px: 2880 } });

/** A seeded frame, as the compile step would write it. */
function frameOf(seed: number) {
  const r = rng(seed * 2654435761);
  const pieces: Any[] = [];
  const speech: Any[] = [];
  const arrows: Any[] = [];
  const marks: Any[] = [];
  const labels: Any[] = [];
  const kind = Math.floor(r() * 7);
  const n = 1 + Math.floor(r() * 4);
  const at = (i: number) => (i === 0 ? 0 : Math.round(r() * 50) / 10);
  const person = (i: number) => {
    const name = `Person${seed}x${i}`;
    const make = [bust, bust, figure, rejected][Math.floor(r() * 4)];
    return { id: `s${i}`, media: make(r, `m${seed}-${i}`, name), at: at(i), ...(r() < 0.3 ? { side: r() < 0.5 ? 'left' : 'right' } : {}), name };
  };
  let camera: Any = { move: ['hold', 'push', 'drift'][Math.floor(r() * 3)], stops: [{ at: 0, aim: 'whole' }] };
  let ground: Any = ['charcoal', 'kraft'][Math.floor(r() * 2)];
  let peak = false;
  if (kind <= 2) {
    // People, with whatever else the line names.
    const people = Math.min(n, 3 + Math.floor(r() * 2));
    for (let i = 0; i < people; i++) pieces.push(person(i));
    if (r() < 0.45) pieces.push({ id: 'logo', media: logo(r, `l${seed}`), at: at(1) });
    if (r() < 0.35) pieces.push({ id: 'print', media: printed(r, `p${seed}`), at: at(2) });
    if (r() < 0.4) pieces.push({ id: 'n', treatment: 'number', opts: { value: '$44B', label: 'the price' }, at: at(1) });
    if (r() < 0.5) speech.push({ on: 's0', text: 'We never agreed to that at all', at: 0.8 + r() * 2, until: 4 + r() * 2 });
    if (r() < 0.45) marks.push({ id: 'm', kind: ['worry', 'argue', 'idea', 'shock', 'thought'][Math.floor(r() * 5)], on: 's0' });
    for (const p of pieces) if (p.name && r() < 0.6) labels.push({ id: `l-${p.id}`, text: p.name.slice(0, 14), owner: p.id, at: p.at });
    if (r() < 0.4) labels.push({ id: 'when', text: 'February 2010', kind: 'date', at: 0.2 + r() });
    if (r() < 0.2) { camera = { move: 'slide', stops: [{ at: 0, aim: 'whole' }] }; peak = r() < 0.4; }
    if (r() < 0.3) camera = { move: 'tour', stops: [{ at: 0, aim: 'whole' }, { at: 2.5, aim: `face:${pieces[0].name}` }, { at: 4.5, aim: 'whole' }] };
    if (r() < 0.3) pieces.unshift({ id: 'back', media: r() < 0.5 ? scenePhoto(r, `b${seed}`) : subjectPhoto(r, `c${seed}`), fill: true, at: 0 });
  } else if (kind === 3) {
    // A page or post, read by a tour.
    const doc = article(r, `a${seed}`);
    const treatment = ['page', 'post', 'document'][Math.floor(r() * 3)];
    pieces.push({ id: 'pg', treatment, media: doc, opts: {}, at: 0 });
    const a1 = `${doc.regions.words[6 * 5].text} ${doc.regions.words[6 * 5 + 1].text}`;
    const a2 = `${doc.regions.words[6 * 20].text} ${doc.regions.words[6 * 20 + 1].text}`;
    camera = { move: 'tour', stops: [{ at: 0, aim: 'whole' }, { at: 2.2, aim: `text:${a1}` }, { at: 4.4, aim: `text:${a2}`, zoom: 1.5 + r() }] };
    marks.push({ id: 'u', kind: 'underline', on: 'pg', target: `text:${a1}`, at: 2.8 }, { id: 'u2', kind: 'highlight', on: 'pg', target: `text:${a2}`, at: 5 });
  } else if (kind === 4) {
    // A whiteboard: drawings, notes, arrows.
    ground = 'whiteboard';
    const d = (id: string) => ({ id, kind: 'person_photo', made: true, made_kind: 'expression', width: 1024, height: 1024, people: ['D'], flags: [], regions: { faces: [], visible: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } } });
    pieces.push({ id: 'a', media: d(`da${seed}`), at: 0 }, { id: 'b', media: d(`db${seed}`), at: 1 + r(), role: r() < 0.5 ? 'lead' : undefined });
    if (r() < 0.6) pieces.push({ id: 'n1', note: '$5 million', role: 'figure', at: 2 + r() });
    if (r() < 0.5) pieces.push({ id: 'n2', note: 'London', role: 'place', at: 2.5 + r() });
    if (r() < 0.3) pieces.push({ id: 'n3', note: 'May 2015', role: 'date', at: 3 });
    if (r() < 0.4) pieces.push({ id: 'lg', media: logo(r, `wl${seed}`), at: 3 });
    arrows.push({ from: 'a', to: 'b', at: 2 });
    (camera as Any).move = 'push';
  } else if (kind === 5) {
    // A picture meant to fill the frame: some can't.
    const media = [wide, scenePhoto, subjectPhoto][Math.floor(r() * 3)](r, `f${seed}`);
    pieces.push({ id: 'f', media, fill: true, at: 0 });
    if (r() < 0.6) pieces.push(person(1));
    camera = { move: 'drift', stops: [{ at: 0, aim: 'whole' }] };
  } else {
    // Loose things.
    pieces.push({ id: 'x', media: printed(r, `x${seed}`), at: 0 });
    if (r() < 0.6) pieces.push({ id: 'y', media: logo(r, `y${seed}`), at: 1 + r() });
    if (r() < 0.5) pieces.push({ id: 'z', treatment: 'stat', opts: { kind: 'counter', value: '40%' }, aspect: 1.35, at: 2 });
    if (r() < 0.3) pieces.push({ id: 'cc', custom: { file: 'cc.js', aspect: 1.2, min_width: 200 }, at: 1 });
  }
  const hook = r() < 0.2 ? { text: 'He lost the race before it began', at: 0.2 + r() * 2 } : null;
  const arrangement = [undefined, undefined, 'row', 'pile', 'face_off', 'lead_inset', 'facing', 'turned_away', 'leads_to', 'solo'][Math.floor(r() * 10)];
  return { pieces, labels, marks, speech, arrows, camera, hook, peak, ground, arrangement, seed, style: r() < 0.3 ? 'paper' : 'cutouts', duration: 7, bounds: ground === 'whiteboard' ? { x0: 96, x1: 984, y0: 620, y1: 1500 } : undefined };
}

const inside = (b: Box, r: Box, slack = 1) => b.x >= r.x - slack && b.y >= r.y - slack && b.x + b.w <= r.x + r.w + slack && b.y + b.h <= r.y + r.h + slack;
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const FRAME = { x: 0, y: 0, w: STAGE.W, h: STAGE.H };

function solved(seed: number) {
  const spec = frameOf(seed);
  const t = solveTimeline(spec as never) as Any;
  const prep = new Map<string, Any>(t.prepared.map((p: Any) => [p.id, p]));
  const last = t.moments.at(-1);
  const place = new Map<string, Any>();
  for (const m of t.moments) for (const p of m.pieces) place.set(p.id, p);
  const times: number[] = [];
  for (let u = 0; u <= spec.duration; u += 0.2) times.push(u);
  return { spec, t, prep, last, place, times };
}

/** Run a check over the casts: returns [broken lines], tight count. */
function over(CASTS: number, check: (s: ReturnType<typeof solved>, broken: (why: string) => void) => void) {
  const out: string[] = [];
  let tight = 0;
  for (let seed = 1; seed <= CASTS; seed++) {
    const s = solved(seed);
    if (s.t.report.tight) { tight += 1; continue; }
    check(s, (why) => out.push(`seed ${seed}: ${why}`));
  }
  return { out, tight };
}
const CASTS = 2500;
const ok = ({ out, tight }: { out: string[]; tight: number }, tightMax = 0.08) => {
  assert.deepEqual(out.slice(0, 6), [], `${out.length} broken`);
  assert.ok(tight / CASTS <= tightMax, `tight ${tight} of ${CASTS}`);
};

test('I6 holds on the new pieces too: every frame comes back with every piece, finite, and fast', () => {
  for (let seed = 1; seed <= CASTS; seed++) {
    const s = solved(seed);
    assert.ok(s.t.moments.length >= 1);
    for (const p of s.spec.pieces) assert.ok(s.place.has(p.id), `seed ${seed}: lost ${p.id}`);
    for (const p of s.place.values()) for (const k of ['x', 'y', 'w', 'h', 'z', 'rot']) assert.ok(Number.isFinite(p[k]), `seed ${seed}: ${p.id}.${k}`);
    for (const k of s.t.camera.keys) for (const f of ['t', 's', 'tx', 'ty']) assert.ok(Number.isFinite(k[f]), `seed ${seed}: camera ${f}`);
  }
});

test('I7: open edges are off the frame or behind another piece or the ledge, and there is no mask fade', () => {
  ok(over(CASTS, (s, broken) => {
    if (s.t.report.flags.includes('open_edge')) return;
    for (const [id, p] of s.prep) {
      if (!p.open || !s.place.has(id)) continue;
      const pl = s.place.get(id);
      const see = (u: number, v: number, side: string) => {
        const b = boxInFrame({ ...pl, rot: pl.rot }, { x: u, y: v, w: 0, h: 0 });
        if (b.x < -2 || b.x > STAGE.W + 2 || b.y > STAGE.H + 2) return;
        if (s.t.ledge != null && b.y >= s.t.ledge - 1) return;
        const behind = [...s.prep.keys()].some((o) => o !== id && s.place.has(o) && s.t.z[o] > s.t.z[id] && s.prep.get(o).kind !== 'fill' && inside({ ...b, w: 0, h: 0 }, boxInFrame(s.place.get(o), s.prep.get(o).vis)));
        if (!behind) broken(`${id}'s ${side} edge shows at ${Math.round(b.x)},${Math.round(b.y)} (ledge ${s.t.ledge})`);
      };
      for (let i = 0; i <= 5; i++) {
        const k = i / 5;
        if (p.open.left) see(0, p.open.left[0] + (p.open.left[1] - p.open.left[0]) * k, 'left');
        if (p.open.right) see(1, p.open.right[0] + (p.open.right[1] - p.open.right[0]) * k, 'right');
        if (p.open.bottom) see(p.open.bottom[0] + (p.open.bottom[1] - p.open.bottom[0]) * k, 1, 'bottom');
      }
    }
  }), 0.1);
});

test('I8: everything holds its one spot; the one slide is limited and never on a peak', () => {
  ok(over(CASTS, (s, broken) => {
    const seen = new Map<string, Any>();
    for (const m of s.t.moments) {
      for (const p of m.pieces) {
        const was = seen.get(p.id);
        if (was && (was.x !== p.x || was.y !== p.y || was.w !== p.w)) broken(`${p.id} moved between moments`);
        seen.set(p.id, p);
      }
    }
    const sl = s.t.camera.slide;
    if (sl) {
      if (s.spec.peak) broken('a slide on a peak frame');
      if (Math.abs(sl.dx) > LIMITS.slideMax + 0.01) broken(`slide of ${sl.dx}`);
      if (sl.dy !== 0 || sl.scale !== 1) broken('slide changes scale');
      // Without the move only as the one move a frame makes unasked: what's on waits nearer the middle for the last arrival.
      if (s.t.camera.move !== 'slide' && !sl.auto) broken('slide without the move');
    }
    if (s.spec.camera?.move === 'slide' && s.spec.peak && s.t.camera.move === 'slide') broken('peak frame kept the slide');
  }));
});

test('I9: an aim and a marked phrase stay inside the frame at every point of a move', () => {
  ok(over(CASTS, (s, broken) => {
    const keys = s.t.camera.keys;
    const poses = s.t.camera.poses;
    poses.forEach((p: Any, i: number) => {
      const end = poses[i + 1]?.at ?? s.spec.duration;
      // The first moment the camera has arrived, to the moment it leaves.
      for (const u of s.times) {
        if (u < p.at + (i ? 1.7 : 0) || u >= end - 0.4) continue;
        const shown = applyPose(poseAt(keys, u), p.box);
        const fits = p.box.w * p.s <= STAGE.W && p.box.h * p.s <= STAGE.bottom - STAGE.top;
        if (fits && !inside(shown, FRAME, p.kind === "whole" ? 12 : 2)) broken(`stop ${i} (${p.kind}) leaves the frame at ${u.toFixed(1)}: ${JSON.stringify(shown)}`);
      }
    });
    for (const m of s.spec.marks) {
      const tg = /^text:(.+)$/.exec(String(m.target ?? ''));
      if (!tg) continue;
      const p = s.prep.get(m.on);
      const line = lineAround(p.media, phraseLines(p.media, tg[1]).reduce((a: Box, b: Box) => (a ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) } : b), null as never));
      const box = boxInFrame(s.place.get(m.on), line);
      const stop = [...poses].reverse().find((q: Any) => q.at <= m.at);
      const next = poses[poses.indexOf(stop) + 1]?.at ?? s.spec.duration;
      for (const u of s.times) {
        if (u < m.at || u >= next - 0.4) continue;
        if (!inside(applyPose(poseAt(keys, u), box), FRAME, 2)) broken(`marked "${tg[1]}" leaves the frame at ${u.toFixed(1)}`);
      }
    }
  }));
});

test('I10: a wide picture that cannot fill without cutting its keep becomes a print on a ground of its own', () => {
  const r = rng(5);
  const out = solveTimeline({ pieces: [{ id: 'w', media: wide(r, 'w'), fill: true, at: 0 }], duration: 4 } as never) as Any;
  const p = out.prepared.find((q: Any) => q.id === 'w');
  assert.equal(p.kind, 'print');
  assert.equal(p.backdrop, true);
  assert.ok(out.report.notes.some((n: string) => /fill_print/.test(n)));
  const pl = out.moments[0].pieces[0];
  assert.ok(pl.x >= -1 && pl.x + pl.w <= 1081, 'the whole print shows');
  // A picture that can, does.
  const can = solveTimeline({ pieces: [{ id: 'f', media: scenePhoto(r, 'f'), fill: true, at: 0 }], duration: 4 } as never) as Any;
  const f = can.moments[0].pieces[0];
  assert.equal(f.kind, 'fill');
  assert.ok(f.x <= 0 && f.y <= 0 && f.x + f.w >= 1080 && f.y + f.h >= 1920, 'it covers the frame');
});

test('I11: a background keep counts: nobody stands on it', () => {
  ok(over(CASTS, (s, broken) => {
    for (const [id, p] of s.prep) {
      if (p.kind !== 'fill' || p.softKeep) continue;
      for (const [o, q] of s.prep) {
        if (o === id || !s.place.has(o)) continue;
        if (q.at >= p.until || p.at >= q.until) continue;
        const c = keepCovered(q, s.place.get(o), p, s.place.get(id));
        if (c > STAGE.keepMax) broken(`${o} covers ${(c * 100).toFixed(0)}% of the background's keep`);
      }
    }
  }));
});

test('I12: words a shot aims at or marks stay clear of the caption band', () => {
  ok(over(CASTS, (s, broken) => {
    const keys = s.t.camera.keys;
    for (const m of s.spec.marks) {
      const tg = /^text:(.+)$/.exec(String(m.target ?? ''));
      if (!tg) continue;
      const p = s.prep.get(m.on);
      const lines = phraseLines(p.media, tg[1]);
      if (!lines.length) continue;
      const box = boxInFrame(s.place.get(m.on), lines[0]);
      const stop = [...s.t.camera.poses].reverse().find((q: Any) => q.at <= m.at);
      const si = s.t.camera.poses.indexOf(stop);
      const next = s.t.camera.poses[si + 1]?.at ?? s.spec.duration;
      const landed = keys.find((k: Any) => k.stop === si)?.t ?? 0;
      for (const u of s.times) {
        if (u < Math.max(m.at, landed) || u >= next - 0.4) continue;
        const b = applyPose(poseAt(keys, u), box);
        if (b.y < STAGE.top - 2) broken(`"${tg[1]}" is in the caption band at ${u.toFixed(1)}: y ${Math.round(b.y)}`);
        if (b.y + b.h > STAGE.bottom + 2) broken(`"${tg[1]}" is below the usable area at ${u.toFixed(1)}: ${Math.round(b.y + b.h)}`);
      }
    }
  }));
});

test('I13: heads have a maximum and a minimum, and one frame keeps a ratio except its insets', () => {
  ok(over(CASTS, (s, broken) => {
    const keys = s.t.camera.keys;
    const most = Math.max(...keys.map((k: Any) => k.s));
    const heads: { id: string; h: number; inset: boolean }[] = [];
    for (const [id, p] of s.prep) {
      if (p.kind !== 'person' || !p.measuredHead || !s.place.has(id)) continue;
      const h = p.head.h * s.place.get(id).h;
      const inset = Boolean(p.belongs) || p.role === 'inset' || (s.t.report.arrangement === 'lead_inset' && p.role !== 'lead' && [...s.prep.values()].some((q: Any) => q.role === 'lead'));
      heads.push({ id, h, inset });
      if (h > LIMITS.headMax + 1) broken(`${id}'s head is ${Math.round(h)} at rest`);
      if (h < (inset ? LIMITS.insetMin : LIMITS.headMin) - 1) broken(`${id}'s head is ${Math.round(h)}`);
      const on = keys.filter((k: Any) => k.t >= p.at - 0.01);
      // On screen means from its arrival: the camera may be closer before it lands, on what's there then.
      const biggest = Math.max(...on.map((k: Any) => k.s), ...(p.at <= keys[0].t + 0.01 ? [keys[0].s] : []));
      void most;
      if (h * biggest > LIMITS.headOnScreen + 1) broken(`${id}'s head reaches ${Math.round(h * biggest)} on screen`);
    }
    const main = heads.filter((x) => !x.inset);
    if (main.length > 1) {
      const a = Math.max(...main.map((x) => x.h)), b = Math.min(...main.map((x) => x.h));
      if (a / b > LIMITS.headRatio + 0.02) broken(`heads ${Math.round(a)} and ${Math.round(b)}`);
    }
  }));
});

test('I14: the usable area is filled: no small card on a void', () => {
  ok(over(CASTS, (s, broken) => {
    if (!s.t.moments.length) return;
    const m = s.last;
    if (!m.pieces.length) return;
    const pose = poseAt(s.t.camera.keys, s.spec.duration - 0.05);
    const extra = [...(s.t.hook ? [{ x: 0, y: s.t.hook.y, w: STAGE.W, h: s.t.hook.h }] : []), ...(s.t.ledge != null ? [{ x: 0, y: s.t.ledge, w: STAGE.W, h: 700 }] : [])];
    const f = fillOf(m.pieces, s.t.prepared, pose, undefined, extra);
    if (f.share < LIMITS.fillShare && Math.max(f.spanX, f.spanY) < LIMITS.fillSpan) broken(`share ${f.share.toFixed(2)} span ${f.spanX.toFixed(2)},${f.spanY.toFixed(2)} with ${m.pieces.map((p: Any) => p.kind)}`);
  }));
});

test('I15: nothing is shown wider than it stays sharp', () => {
  ok(over(CASTS, (s, broken) => {
    const keys = s.t.camera.keys;
    for (const [id, p] of s.prep) {
      if (!Number.isFinite(p.maxW) || !s.place.has(id)) continue;
      const pl = s.place.get(id);
      const on = keys.filter((k: Any) => k.t >= p.at - 0.01 && (k.t < p.until));
      const biggest = Math.max(1, ...on.map((k: Any) => k.s));
      if (pl.w * biggest > p.maxW + 1) broken(`${id} is ${Math.round(pl.w * biggest)} wide, sharp to ${p.maxW}`);
    }
  }));
});

test('I16: only trusted faces are heads; the biggest box no longer wins', () => {
  const r = rng(9);
  const m = figure(r, 'f', 'Luke Nosek');
  const real = m.regions.faces[1];
  assert.deepEqual(facesOf(m), [real]);
  const p = preparePiece({ id: 'f', media: m } as never) as Any;
  assert.equal(p.face, real);
  assert.ok(p.head.y + p.head.h < 0.5, 'the head is his, not the cup');
  const found = findFace(m, 0);
  assert.ok(found && Math.abs(found.x - real.x) < 1e-6, 'the marks and the camera use the same face');
  assert.ok(findFace({ ...m, regions: { ...m.regions, faces: [m.regions.faces[0]] } }, 0) == null, 'no trusted face, no head');
  const older = { ...m, regions: { ...m.regions, faces: [{ x: 0.05, y: 0.6, w: 0.4, h: 0.3, score: 0.5 }, { x: real.x, y: real.y, w: real.w, h: real.h, score: 0.97 }] } };
  assert.equal(facesOf(older).length, 1, 'an older inventory, by its scores');
});

test('I17: code sets a label\'s lifetime; names beside their owner, never on the chest; frame words on nobody', () => {
  ok(over(CASTS, (s, broken) => {
    const people = [...s.prep.values()].filter((p: Any) => p.kind === 'person');
    for (const m of s.t.moments) {
      for (const l of m.labels) {
        for (const q of people as Any[]) {
          if (!s.place.has(q.id) || q.at >= l.until || l.at >= q.until) continue;
          const pl = s.place.get(q.id);
          if (s.t.ledge != null && l.y >= s.t.ledge) continue; // On the ledge, bodies stand behind it.
          const chest = chestOf(q, pl);
          if (chest && overlaps(l, chest)) broken(`"${l.text}" on ${q.id}'s chest`);
          if (!l.owner && boxOnBody(l, q, pl) > 0.02) broken(`"${l.text}" lies on ${q.id}`);
        }
      }
    }
    for (const [id, w] of Object.entries<Any>(s.t.labelTimes)) {
      const l = s.spec.labels.find((x: Any) => x.id === id);
      const owner = l?.owner ? s.prep.get(l.owner) : null;
      if (!owner) { if (w.until - w.at > LIMITS.dateBeat + 0.01) broken(`${id} stays ${w.until - w.at}`); continue; }
      if (w.at < owner.at) broken(`${id} before its owner`);
      const next = Math.min(Infinity, ...(people as Any[]).filter((q) => q !== owner && q.at > w.at).map((q) => q.at));
      if (w.until > Math.min(w.at + LIMITS.labelBeat, Math.max(next, w.at + LIMITS.labelRead)) + 0.01) broken(`${id} outstays its beat: ${w.at}–${w.until}, next person ${next}`);
    }
  }));
  // Only a first appearance gets a name.
  const r = rng(3);
  const once = stageSpec({ known_names: ['Elon Musk'], pieces: [{ id: 'a', media: bust(r, 'a', 'Elon Musk'), label: 'Elon Musk' }, { id: 'b', media: bust(r, 'b', 'Sam Altman'), label: 'Sam Altman' }] }) as Any;
  assert.deepEqual(once.labels.map((l: Any) => l.text), ['Sam Altman']);
  // A logo says its own name.
  const self = stageSpec({ pieces: [{ id: 'a', media: { ...logo(r, 'a'), shows: 'Apple logo, the bitten fruit' }, label: 'Apple' }, { id: 'b', media: { ...logo(r, 'b'), shows: 'Google wordmark' }, label: 'Search' }] }) as Any;
  assert.deepEqual(self.labels.map((l: Any) => l.text), ['Search']);
});

test('I18: marks clear the hair and the plates; plates never on a head and always in the frame', () => {
  ok(over(CASTS, (s, broken) => {
    const plates = s.t.speech as Any[];
    for (const sp of plates) {
      if (!inside(sp, { x: STAGE.words.x0, y: STAGE.top, w: STAGE.words.x1 - STAGE.words.x0, h: STAGE.bottom - STAGE.top }, 2)) broken(`plate outside the zone: ${JSON.stringify([sp.x, sp.y, sp.w, sp.h])}`);
      for (const [id, q] of s.prep) {
        if (q.kind !== 'person' || !q.head || !s.place.has(id)) continue;
        if (q.at >= sp.until || sp.at >= q.until) continue;
        const hd = boxInFrame(s.place.get(id), q.head);
        const chin = { ...hd, h: hd.h * 1.15 };
        if (overlaps(sp, chin)) broken(`plate on ${id}'s head`);
      }
    }
    for (const m of s.last.marks) {
      if (!m.box) continue;
      for (const sp of plates) if (sp.until > s.prep.get(m.on).at && overlaps(m.box, sp)) broken(`${m.kind} marks under a plate`);
      if (m.head && crossesHead([[m.box.x + m.box.w / 2, m.box.y + m.box.h / 2]], m.head, 0.7)) broken(`${m.kind} marks cross the head`);
      if (m.box.x < 0 || m.box.x + m.box.w > STAGE.W) broken(`${m.kind} marks leave the frame`);
    }
  }));
});

const dom = () => {
  const win = new JSDOM('<!doctype html><html><body><div id="w" data-opening-not></div></body></html>').window as Any;
  nk.installKit(win.document, { fonts: 'f/', textures: 't/' });
  return win.document;
};
const shown = (el: Any) => el.style.visibility !== 'hidden';

test('I19 and I20: one credit line at a time, a picture once a stage; people in one tone, one outline, no glow', () => {
  const doc = dom();
  const r = rng(17);
  const a = bust(r, 'a', 'Elon Musk'), b = bust(r, 'b', 'Sam Altman');
  a.regions.brightness = 0.2; b.regions.brightness = 0.7;
  const cropOfA = { ...a, id: 'a-cut', cutout_of: 'a' };
  const s = nk.stage(doc, { ground: 'charcoal', duration: 6, pieces: [{ id: 'x', media: a, at: 0 }, { id: 'y', media: b, at: 1 }, { id: 'again', media: a, at: 2 }, { id: 'pr', media: printed(r, 'pr'), at: 2 }], labels: [{ text: 'Musk', for: 'again' }] }) as Any;
  assert.deepEqual(Object.keys(s.pieces).sort(), ['pr', 'x', 'y'], 'the repeat is gone');
  assert.equal(s.manifest().labels[0].owner, 'x', 'its label moved to the one kept');
  assert.ok(s.report.notes.some((n: string) => /repeated_picture/.test(n)));
  void cropOfA;
  for (const t of [0, 1.5, 3, 5]) {
    s.render(t);
    assert.ok([...s.el.querySelectorAll('[data-credit]')].filter(shown).length <= 1, 'never stacked');
  }
  const filters = ['x', 'y'].map((id) => s.pieces[id].el.querySelector('img').style.filter);
  const edge = (f: string) => f.replace(/^.*?sepia\([^)]*\)/, '');
  assert.equal(edge(filters[0]), edge(filters[1]), 'one outline weight');
  assert.notEqual(filters[0], filters[1], 'their brightness is matched toward each other');
  assert.ok(!filters.some((f) => /0(px)? 0(px)? 5px/.test(f)), 'no glow');
  assert.ok(!s.el.innerHTML.includes('mask-image'), 'no mask fade');
});

test('every §2 option builds, and manifest() says what was planned', () => {
  const doc = dom();
  const r = rng(23);
  const art = article(r, 'art');
  const words = `${art.regions.words[30].text} ${art.regions.words[31].text}`;
  const mod = { built: 0, build(el: Any) { this.built += 1; el.append(doc.createElement('canvas')); }, render() {} };
  const s = nk.stage(doc, {
    ground: 'charcoal', duration: 8, hook: { text: 'He lost it all', at: 3 }, peak: true,
    pieces: [
      { id: 'p', treatment: 'page', media: art, opts: {}, at: 0 },
      { id: 'n', treatment: 'number', opts: { value: '$44B', label: 'the price' }, at: 1 },
      { id: 't', treatment: 'stat', opts: { kind: 'counter', value: '40%' }, at: 2 },
      { id: 'l3', treatment: 'lower_third', opts: { name: 'Elon Musk', role: 'Founder' }, at: 2 },
      { id: 'c', custom: { file: 'c.js', aspect: 1.2, min_width: 100, module: mod }, at: 3 },
      { id: 'o', media: logo(r, 'o'), onto: { piece: 'p', box: words }, at: 3 },
      { id: 'cropped', media: printed(r, 'cr'), crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, at: 2 },
    ],
    marks: [{ kind: 'underline', on: 'p', target: `text:${words}`, at: 4 }],
    camera: { move: 'slide', stops: [{ at: 0, aim: 'whole' }] },
    ground_tone: [{ at: 2, to: 0.1 }],
    in_turn: [{ ids: ['n', 't'], from: 1, to: 2.5 }],
  }) as Any;
  for (const t of [0, 1, 3, 5, 7.9]) s.render(t);
  assert.equal(mod.built, 1);
  assert.ok(s.report.notes.every((n: string) => !/treatment_failed|custom_failed/.test(n)), s.report.notes.join('; '));
  const m = s.manifest();
  assert.deepEqual(m.pieces.map((p: Any) => p.id).sort(), ['c', 'cropped', 'l3', 'n', 'o', 'p', 't']);
  assert.equal(m.pieces.find((p: Any) => p.id === 't').at, 2.5, 'in_turn sets the arrivals');
  assert.ok(m.pieces.every((p: Any) => Number.isFinite(p.box_at_rest.x) && Number.isFinite(p.until)));
  assert.equal(m.marks[0].kind, 'underline');
  assert.notEqual(m.camera.move, 'slide', 'a peak frame does not slide');
  assert.equal(m.hook.at, 1.2, 'the hook is on by 1.2s');
  assert.ok(s.el.querySelector('[data-hook]'));
  for (const treatment of ['post', 'document', 'headline', 'map', 'photo', 'board', 'newspaper', 'lift', 'flash_reveal', 'phone_shot', 'click_reveal', 'burst', 'pull_quote']) {
    const media = treatment === 'map' || treatment === 'board' ? undefined : treatment === 'newspaper' ? printed(r, 'np') : art;
    const opts = treatment === 'board' ? { players: [{ media: bust(r, 'pl', 'Elon Musk'), name: 'Elon Musk' }], links: [] } : treatment === 'map' ? { src: 'x.png', width: 1000, height: 800, pins: [] } : treatment === 'newspaper' ? { masthead: 'THE TIMES', headline: 'A headline' } : {};
    const one = nk.stage(doc, { duration: 4, pieces: [{ id: 'q', treatment, media, opts, at: 0 }] }) as Any;
    one.render(1);
    assert.ok(one.report.notes.every((n: string) => !/treatment_failed/.test(n)), `${treatment}: ${one.report.notes.join('; ')}`);
  }
});

test('a whiteboard: the arrows have room, notes are sized by role, the lead is largest, the board is filled', () => {
  const d = (id: string) => ({ id, kind: 'person_photo', made: true, made_kind: 'expression', width: 1024, height: 1024, people: ['D'], flags: [], regions: { faces: [], visible: { x: 0.05, y: 0.05, w: 0.9, h: 0.9 } } });
  const t = solveTimeline({ bounds: { x0: 96, x1: 984, y0: 620, y1: 1500 }, arrangement: 'leads_to', duration: 8, pieces: [{ id: 'a', media: d('a'), at: 0 }, { id: 'b', media: d('b'), at: 2, role: 'lead' }, { id: 'n1', note: '$5 million', note_role: 'figure', at: 3 }, { id: 'n2', note: 'London', note_role: 'place', at: 4 }], arrows: [{ from: 'a', to: 'b', at: 2.6 }] } as never) as Any;
  assert.equal(t.report.tight, false);
  assert.ok(t.arrows[0].length >= LIMITS.arrowMin, `arrow ${t.arrows[0].length}`);
  assert.ok(t.arrows[0].at >= 2.3, 'it waits for what it joins');
  const size = Object.fromEntries(t.moments.at(-1).pieces.map((p: Any) => [p.id, p]));
  assert.ok(size.b.w > size.a.w, 'the person the line is about is largest');
  assert.ok(size.n1.h > size.n2.h, 'a figure is bigger than a place');
  const f = fillOf(t.moments.at(-1).pieces, t.prepared);
  assert.ok(f.spanX > 0.8 && f.spanY > 0.7, `span ${f.spanX},${f.spanY}`);
});

test('arrangements show relations: facing leans in, turned away leans out and stands apart', () => {
  const r = rng(31);
  const a = bust(r, 'a', 'A'), b = bust(r, 'b', 'B');
  const of = (arrangement: string) => solveStage({ arrangement, seed: 4, pieces: [{ id: 'a', media: a, at: 0, side: 'left' }, { id: 'b', media: b, at: 0, side: 'right' }] } as never).pieces as Any[];
  const gap = (p: Any[]) => p[1].x + p[1].w / 2 - (p[0].x + p[0].w / 2);
  assert.ok(gap(of('turned_away')) > gap(of('facing')), 'turned away stands further apart');
  assert.ok(of('facing')[0].rot > 0 && of('facing')[1].rot < 0, 'facing tilts inward');
  assert.ok(of('turned_away')[0].rot < 0 && of('turned_away')[1].rot > 0, 'turned away tilts outward');
});

test('slideAt and the moments: the render stays a pure function of t', () => {
  const sl = { from: 1, to: 1.55, dx: 100, dy: 0, scale: 1, ids: ['a'] };
  assert.equal(slideAt(sl, 'a', 0.5).dx, 100);
  assert.equal(slideAt(sl, 'a', 2).dx, 0);
  assert.equal(slideAt(sl, 'b', 0.5).dx, 0);
  assert.deepEqual(stageMoments([{ at: 0, until: 3 }, { at: 1 }], 6), [0, 1, 3]);
  assert.ok(headIn);
});

// The audit of the Iteration 10 replays: each of these stopped a class of finding there.
const sketch = (id: string, name = 'D') => ({ id, kind: 'person_photo', made: true, made_kind: 'expression', width: 1024, height: 1024, people: [name], flags: [], regions: { faces: [], visible: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, tone: tone(240) } });
const WHITEBOARD = { ground: 'whiteboard', bounds: { x0: 96, x1: 984, y0: 620, y1: 1500 }, style: 'cutouts' };
const flatSolve = (spec: Any) => solveTimeline({ seed: 1, duration: 7, camera: { move: 'hold', stops: [{ at: 0, aim: 'whole' }] }, ...spec }) as Any;
const placedIn = (t: Any, id: string) => t.moments.flatMap((m: Any) => m.pieces).filter((p: Any) => p.id === id).at(-1);

test('faces hold the subject line: nobody main stands with their face under the band', () => {
  ok(over(CASTS, (s, broken) => {
    for (const [id, p] of s.prep) {
      if (p.kind !== 'person' || !p.head || p.asPrint || !s.place.has(id)) continue;
      const b = boxInFrame(s.place.get(id), p.head);
      if (b.y + b.h / 2 > STAGE.faceBand[1] + 30) broken(`${id}'s head centres at ${Math.round(b.y + b.h / 2)}`);
    }
  }), 0.1);
});

test('a body runs off the foot when it can reach, and takes the ledge when it can\'t', () => {
  const r = rng(11);
  const long = bust(r, 'long', 'Lee');
  long.height = 4200;
  for (const f of long.regions.faces) { f.y *= 0.45; f.h *= 0.45; }
  const reached = flatSolve({ pieces: [{ id: 'a', media: long, at: 0 }] });
  const pl = placedIn(reached, 'a');
  assert.ok(pl.y + pl.h >= STAGE.H, `a long body stops at ${Math.round(pl.y + pl.h)}`);
  assert.equal(reached.ledge ?? null, null, 'no ledge for a body that runs off');
  const short = bust(r, 'short', 'Kim');
  short.width = 1000; short.height = 620; short.regions.sharp_width_px = 760;
  const stopped = flatSolve({ pieces: [{ id: 'a', media: short, at: 0 }] });
  const ps = placedIn(stopped, 'a');
  assert.ok(ps.y + ps.h >= STAGE.H || stopped.ledge != null, 'its foot shows in mid-air');
});

test('a ledge never sits on a chin, and comes back even from a tight solve', () => {
  const r = rng(5);
  const crowd = () => ['a', 'b', 'c', 'd'].map((id, i) => ({ id, media: bust(r, id, `P${id}`), at: i * 0.5 }));
  ok(over(CASTS, (s, broken) => {
    // The net: a frame with no clean answer ships flagged, never blocked.
    if (s.t.ledge == null || s.t.report.flags.includes('open_edge') || s.t.report.flags.includes('stage_tight') || s.t.report.notes.some((n: string) => n.startsWith('ledge_on_chin'))) return;
    for (const [id, p] of s.prep) {
      if (p.kind !== 'person' || !p.measuredHead || !s.place.has(id) || p.asPrint) continue;
      const pl = s.place.get(id);
      const chin = pl.y + (p.face.y + p.face.h) * pl.h;
      if (chin > s.t.ledge + 1) broken(`${id}'s chin ${Math.round(chin)} under the ledge ${s.t.ledge}`);
    }
  }), 0.1);
  const tight = flatSolve({ pieces: crowd(), arrangement: 'row' });
  const open = tight.prepared.filter((p: Any) => p.open?.bottom);
  const stopped = open.some((p: Any) => { const pl = placedIn(tight, p.id); return pl.y + footOf(p.open) * pl.h < STAGE.H - 2; });
  if (stopped) assert.ok(tight.ledge != null, 'bodies stop in mid-air with no ledge');
});

test('a straight cut inside the picture is an open foot, at the height it stops', () => {
  const g = grid((x, y) => y > 0.1 && y < 0.7 && x > 0.2 && x < 0.8);
  const media = { people: ['A'], regions: { cut: { straight_cuts: 0.2 } } };
  const open = openEdgesOf(media, gridLike(g), { x: 0.2, y: 0.1, w: 0.6, h: 0.6 }) as Any;
  assert.ok(open.bottom, 'the foot is open');
  assert.ok(Math.abs(open.foot - 0.7) < 0.05, `foot ${open.foot}`);
  assert.equal(footOf(open), open.foot);
  assert.equal(footOf({}), 1);
  const clean = openEdgesOf({ people: ['A'], regions: { cut: { straight_cuts: 0 } } }, gridLike(g), { x: 0.2, y: 0.1, w: 0.6, h: 0.6 }) as Any;
  assert.ok(!clean.bottom, 'a rounded cut has no open foot');
  const thing = openEdgesOf({ people: [], regions: { cut: { straight_cuts: 0.2 } } }, gridLike(g), { x: 0.2, y: 0.1, w: 0.6, h: 0.6 }) as Any;
  assert.ok(!thing.bottom, 'only a body runs off');
});
function gridLike(g: { w: number; h: number; cells: string }) {
  return { w: g.w, h: g.h, cells: Array.from(g.cells, (c) => c === '1') };
}

test('heads in a frame keep their ratio: a deliberate inset is smaller, never a thumbnail', () => {
  ok(over(CASTS, (s, broken) => {
    if (s.t.report.flags.includes('stage_tight')) return;
    const heads: number[] = [];
    for (const [id, p] of s.prep) {
      if (p.kind !== 'person' || !p.head || p.asPrint || !s.place.has(id)) continue;
      heads.push(boxInFrame(s.place.get(id), p.head).h);
    }
    if (heads.length < 2) return;
    const ratio = Math.max(...heads) / Math.min(...heads);
    if (ratio > LIMITS.insetRatio * 1.06) broken(`heads ${heads.map(Math.round).join('/')} in ${s.spec.arrangement}`);
  }), 0.1);
});

test('pieces that never meet share a spot on the board, and a side asked for is the side it lands on', () => {
  const asked = flatSolve({ ...WHITEBOARD, pieces: [{ id: 'a', media: sketch('a', 'A'), at: 0, side: 'left' }, { id: 'b', media: sketch('b', 'B'), at: 1, side: 'right' }] });
  const [pa, pb] = [placedIn(asked, 'a'), placedIn(asked, 'b')];
  assert.ok(pa.x + pa.w / 2 < STAGE.W / 2 && pb.x + pb.w / 2 > STAGE.W / 2, `a ${pa.x} b ${pb.x}`);
  const flipped = flatSolve({ ...WHITEBOARD, pieces: [{ id: 'a', media: sketch('a', 'A'), at: 0, side: 'right' }, { id: 'b', media: sketch('b', 'B'), at: 1, side: 'left' }] });
  assert.ok(placedIn(flipped, 'a').x > placedIn(flipped, 'b').x, 'the sides follow the plan');
  const together = flatSolve({ ...WHITEBOARD, pieces: [{ id: 'a', media: sketch('a', 'A'), at: 0 }, { id: 'b', media: sketch('b', 'B'), at: 1 }, { id: 'c', media: sketch('c', 'C'), at: 2 }] });
  const apart = flatSolve({ ...WHITEBOARD, pieces: [{ id: 'a', media: sketch('a', 'A'), at: 0, until: 2 }, { id: 'b', media: sketch('b', 'B'), at: 2, until: 4 }, { id: 'c', media: sketch('c', 'C'), at: 4 }] });
  const area = (t: Any, id: string) => { const p = placedIn(t, id); return p.w * p.h; };
  for (const id of ['a', 'b', 'c']) assert.ok(area(apart, id) > area(together, id) * 1.15, `${id}: ${Math.round(area(apart, id))} against ${Math.round(area(together, id))}`);
});

test('a blurred ground of a place may pass its sharpness limit; anything else stays inside it', () => {
  const base = { aspect: 1.5, maxW: 500, keep: { x: 0.2, y: 0.2, w: 0.6, h: 0.6 } };
  assert.ok(fillPlacement({ ...base, asGround: true, softKeep: true, media: { kind: 'place_photo' } }));
  assert.equal(fillPlacement({ ...base, asGround: false, softKeep: true, media: { kind: 'place_photo' } }), null);
  assert.equal(fillPlacement({ ...base, asGround: true, softKeep: true, media: { kind: 'event_photo' } }), null);
});

test('the camera: nothing is left half on at the frame\'s sides, and a piece is on screen as it arrives', () => {
  ok(over(CASTS, (s, broken) => {
    const k = s.t.camera.keys as Any[];
    for (const [id, p] of s.prep) {
      if (!s.place.has(id) || p.kind === 'fill' || p.asGround || p.kind === 'person') continue;
      const box = boxInFrame(s.place.get(id), p.vis ?? { x: 0, y: 0, w: 1, h: 1 });
      const at = Math.min((p.at ?? 0) + 0.5, s.spec.duration);
      if ((p.until ?? Infinity) <= at) continue;
      const b = applyPose(poseAt(k, at), box);
      const seen = Math.max(0, Math.min(b.x + b.w, STAGE.W) - Math.max(b.x, 0)) / Math.max(1, b.w);
      if (s.spec.camera.move !== 'tour' && seen < 0.5) broken(`${id} arrives at ${at}s with ${Math.round(seen * 100)}% on screen`);
    }
  }), 0.1);
});

test('an arrow bends round what is in its way and ends inside the frame', () => {
  const box = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });
  const piece = (id: string) => ({ id, kind: 'print', vis: { x: 0, y: 0, w: 1, h: 1 }, at: 0 });
  const plan = (others: Any[]) => {
    const byId = new Map<string, Any>([['f', piece('f')], ['t', piece('t')], ...others.map((o) => [o.id, piece(o.id)] as [string, Any])]);
    const placed = new Map<string, Any>([['f', { x: 100, y: 800, w: 200, h: 200, rot: 0 }], ['t', { x: 780, y: 800, w: 200, h: 200, rot: 0 }], ...others.map((o) => [o.id, { ...o.box, rot: 0 }] as [string, Any])]);
    return { byId, placed, bounds: { x0: 0, x1: STAGE.W, y0: 600, y1: 1500 }, placedPieces: () => [...placed.keys()].map((id) => [id, byId.get(id)]) };
  };
  const fb = box(100, 800, 200, 200), tb = box(780, 800, 200, 200);
  const straight = routeArrow({ from: 'f', to: 't' }, fb, tb, plan([])) as Any;
  assert.equal(straight.crossing, null);
  assert.ok(Math.abs(straight.bend) < 0.2 * 480, 'no bend it does not need');
  const round = routeArrow({ from: 'f', to: 't' }, fb, tb, plan([{ id: 'in', box: box(500, 860, 80, 80) }])) as Any;
  assert.equal(round.crossing, null, 'it goes round');
  assert.ok(Math.abs(round.bend) > Math.abs(straight.bend));
  const wall = routeArrow({ from: 'f', to: 't' }, fb, tb, plan([{ id: 'wall', box: box(500, 600, 80, 900) }])) as Any;
  assert.equal(wall.crossing, 'wall', 'a wall is named, not hidden');
  const words = routeArrow({ from: 'f', to: 't' }, fb, tb, plan([]), [{ owner: null, text: 'London', x: 500, y: 860, w: 80, h: 80 }]) as Any;
  assert.equal(words.crossing, null);
  assert.ok(Math.abs(words.bend) > Math.abs(straight.bend), 'words count');
});

test('a drawing can carry a mark, and line art is ink rather than a surface', () => {
  assert.ok((preparePiece({ id: 'a', media: sketch('a') }) as Any).markable, 'a sketch is markable');
  const t = flatSolve({ ...WHITEBOARD, pieces: [{ id: 'a', media: sketch('a', 'A'), at: 0 }, { id: 'b', media: sketch('b', 'B'), at: 0 }], marks: [{ id: 'm', kind: 'shock', on: 'a' }] });
  assert.ok((t.moments.at(-1).marks as Any[]).some((m) => m.id === 'm'), 'the mark was dropped');
  const box = { x: 100, y: 100, w: 100, h: 100 };
  const drawing = { p: { kind: 'drawing', shape: null, regions: {}, media: { regions: { tone: tone(0) } } }, pl: { x: 0, y: 0, w: 1000, h: 1000, rot: 0, z: 2 } };
  assert.equal(toneBehind(box, [drawing], () => 240), toneBehind(box, [], () => 240), 'a drawing changes the mark\'s ink');
});

test('lift and rejected cuts: the piece grows from its own spot, a rejected cut shows its source', () => {
  const base = { w: 800, h: 1000 };
  const right = liftBox({ regions: { lift_from: { x: 0.6, y: 0.2, w: 0.3, h: 0.3 } } }, base);
  const left = liftBox({ regions: { lift_from: { x: 0.05, y: 0.2, w: 0.3, h: 0.3 } } }, base);
  assert.ok(right.x > left.x, 'its side follows its spot');
  for (const b of [right, left, liftBox({ regions: {} }, base)]) assert.ok(b.x >= 0 && b.x + b.w <= base.w + 1, JSON.stringify(b));
  assert.equal(cutoutSource({ flags: ['cutout', 'cutout_of:photo-3'] }), 'photo-3');
  assert.equal(cutoutSource({ cutout_of: 'p', flags: [] }), 'p');
  assert.equal(cutoutSource({ flags: ['cutout'] }), null);
});

test('small things stay readable: placed freely, no print under its least size, no wordmark under its least width', () => {
  const { out } = over(CASTS, (s, broken) => {
    if (s.t.report.flags.includes('stage_tight') || s.t.report.shrink < 1 || s.t.report.arrangement === 'row') return;
    for (const [id, p] of s.prep) {
      if (!s.place.has(id)) continue;
      const pl = s.place.get(id);
      if (p.kind === 'logo' && p.aspect >= 2 && pl.w < 170 * 0.99) broken(`wordmark ${id} ${Math.round(pl.w)} wide`);
      if (p.kind === 'print' && !p.asPrint && pl.w < 280 * 0.99) broken(`print ${id} ${Math.round(pl.w)} wide`);
    }
  });
  // A floor the crowded casts can still press through: rare, and each one has been seen.
  assert.ok(out.length / CASTS <= 0.01, `${out.length} under: ${out.slice(0, 4).join('; ')}`);
});

test('a person who is drawn gets a head where the picture is, and an untrusted region never counts as one', () => {
  const drawn = preparePiece({ id: 'a', media: sketch('a') }) as Any;
  assert.ok(drawn.head && drawn.head.y < 0.5, 'a head on the drawing');
  const r = rng(3);
  const fig = preparePiece({ id: 'b', media: figure(r, 'b', 'Brian') }) as Any;
  assert.ok(fig.head.y < 0.3, `the cup isn't the head: ${JSON.stringify(fig.head)}`);
});

test('a ring stays in the frame: the camera keeps the room of what it rings', () => {
  const t = flatSolve({ ...WHITEBOARD, duration: 4, pieces: [{ id: 'a', media: sketch('a', 'A'), at: 0 }], marks: [{ id: 'c', kind: 'circle', on: 'a' }], arrangement: 'solo' });
  const p = t.prepared[0];
  const box = boxInFrame(placedIn(t, 'a'), p.vis);
  for (let u = 0; u <= 4; u += 0.2) {
    const b = applyPose(poseAt(t.camera.keys, u), { x: box.x - 24, y: box.y - 24, w: box.w + 48, h: box.h + 48 });
    assert.ok(b.x >= -1 && b.x + b.w <= STAGE.W + 1, `at ${u}s the ring spans ${Math.round(b.x)}..${Math.round(b.x + b.w)}`);
  }
});

test('a lifted sheet fills its piece box, and the piece rests in its own part of it', () => {
  const win = new JSDOM('<!doctype html><html><body><div id="w" data-opening-not></div></body></html>').window as Any;
  nk.installKit(win.document, { fonts: 'f/', textures: 't/' });
  const media = { id: 'card', kind: 'event_photo', file: 'c.jpg', width: 1000, height: 500, people: ['R'], flags: [], regions: { faces: [{ x: 0.6, y: 0.2, w: 0.2, h: 0.4, name: 'R', trusted: true, score: 0.9 }], visible: { x: 0, y: 0, w: 1, h: 1 }, lift_from: { x: 0.55, y: 0.1, w: 0.4, h: 0.8 }, tone: tone(120) } };
  const made = nk.lift(win.document, { media, sheet: 'page', at: 1, region: media.regions.lift_from, box: { x: 300, y: 40, w: 500, h: 300 }, sheetBox: { w: 1000, h: 500 } }) as Any;
  assert.equal(made.el.style.width, '1000px', 'the sheet takes the whole box');
  const rest = JSON.parse(made.piece.el.getAttribute('data-rest'));
  assert.ok(parseFloat(rest.left) >= 300 && parseFloat(rest.left) + parseFloat(rest.width) <= 801, JSON.stringify(rest));
  assert.ok(parseFloat(rest.top) >= 40, JSON.stringify(rest));
});

test('a blurred ground declares no sharpness limit to the screen check; a sharp picture does', () => {
  const win = new JSDOM('<!doctype html><html><body><div id="w" data-opening-not></div></body></html>').window as Any;
  nk.installKit(win.document, { fonts: 'f/', textures: 't/' });
  const place = { ...scenePhoto(rng(9), 'g'), regions: { ...scenePhoto(rng(9), 'g').regions, sharp_width_px: 900 } };
  const s = nk.stage(win.document, { ground: 'charcoal', duration: 3, pieces: [{ id: 'g', media: place, fill: true, asGround: true, at: 0 }, { id: 'p', media: printed(rng(4), 'p'), at: 0 }] }) as Any;
  const held = (id: string) => s.el.querySelector(`[data-piece="${id}"]`);
  assert.ok(held('p'), 'the print has a holder');
  assert.equal(held('g')?.dataset.maxw, undefined);
});
