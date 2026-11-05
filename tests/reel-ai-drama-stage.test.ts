// Iteration 9: composition by construction. The property test throws thousands of seeded casts at the solver and checks
// the invariants from the outside (I1–I6 of planning/AI Mini Docs/ITERATION-9.md). Offline: no pictures, no model.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import sharp from 'sharp';

import { keepCovered, keepUnderBox, preparePiece, slideClean, solveStage, solveTimeline, STAGE, WHITEBOARD_BOUNDS, headIn, boxInFrame } from '../explainers/reel-ai-drama/kit/stage-layout.js';
import { handPlaced, sourceProblems } from '../explainers/reel-ai-drama/kit/try.mjs';
import { screenProblems } from '../explainers/reel-ai-drama/kit/screen.mjs';
import { playersLayout } from '../explainers/reel-ai-drama/kit/components/scenes.js';
import { keyBackground, measureInventory, measureRaw } from '../lib/reel-ai-drama/harvest/regions';
import { stageCutoutRequests } from '../lib/reel-ai-drama/harvest/cutouts';
import { problemFrame, } from '../lib/reel-ai-drama/production/run';
import { repeatedPictures, planWarnings } from '../lib/reel-ai-drama/writing/validate';
import type { Asset, DirectorPlan, VisualsInventory, WriterDraft } from '../lib/reel-ai-drama/types';

// ── A seeded cast of measured pictures ───────────────────────────────────────────────────────────

const rng = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
/** A shape grid: true inside the given test. */
const grid = (inside: (x: number, y: number) => boolean, n = 32) => {
  const rows: string[] = [];
  for (let y = 0; y < n; y++) {
    let row = '';
    for (let x = 0; x < n; x++) row += inside((x + 0.5) / n, (y + 0.5) / n) ? '1' : '0';
    rows.push(row);
  }
  return { w: n, h: n, cells: rows.join('') };
};
const tone = (v: number) => ({ w: 1, h: 1, cells: [v] });

function person(r: () => number, id: string) {
  const fw = 0.14 + r() * 0.16;
  const fx = 0.5 - fw / 2 + (r() - 0.5) * 0.12;
  const fy = 0.08 + r() * 0.08;
  const face = { x: fx, y: fy, w: fw, h: fw * 0.8 };
  const cx = fx + fw / 2;
  const shape = grid((x, y) => (y < fy + fw && Math.hypot((x - cx) * 1.1, y - fy - fw * 0.4) < fw * 0.8) || (y >= fy + fw * 0.7 && Math.abs(x - cx) < 0.12 + (y - fy) * 0.4));
  return { id, kind: 'person_photo', width: 800, height: 1000, people: [id], flags: ['cutout', 'transparent'], regions: { faces: [{ ...face, name: id }], visible: { x: 0.05, y: 0.04, w: 0.9, h: 0.96 }, shape, tone: tone(0.4) } };
}
const logo = (r: () => number, id: string) => {
  const aspect = 1 + r() * 4;
  return { id, kind: 'logo', width: Math.round(400 * aspect), height: 400, people: [], flags: ['logo'], regions: { faces: [], visible: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, shape: grid((x, y) => x > 0.1 && x < 0.9 && y > 0.1 && y < 0.9), tone: tone(0.2) } };
};
const thing = (r: () => number, id: string) => {
  const aspect = 0.7 + r() * 1.3;
  return { id, kind: 'object', width: Math.round(600 * aspect), height: 600, people: [], flags: ['cutout', 'transparent'], regions: { faces: [], visible: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, shape: grid((x, y) => Math.hypot(x - 0.5, y - 0.5) < 0.4), tone: tone(0.5) } };
};
const print = (r: () => number, id: string) => ({ id, kind: 'event_photo', width: 1000, height: Math.round(600 + r() * 300), people: [], flags: [], regions: { faces: [], visible: { x: 0, y: 0, w: 1, h: 1 }, tone: tone(0.5) } });

/** A cast of 1–5 mixed pictures, with seeded arrivals, sides, labels and marks. */
function castOf(seed: number) {
  const r = rng(seed * 2654435761);
  const n = 1 + Math.floor(r() * 5);
  const pieces: Record<string, unknown>[] = [];
  const makers = [person, person, person, logo, thing, print];
  for (let i = 0; i < n; i++) {
    const id = `p${i}`;
    const media = makers[Math.floor(r() * makers.length)](r, `m${seed}-${i}`);
    pieces.push({ id, media, at: i === 0 ? 0 : Math.round(r() * 40) / 10, ...(r() < 0.2 ? { side: r() < 0.5 ? 'left' : 'right' } : {}), ...(r() < 0.2 && i === 0 ? { role: 'lead' } : {}) });
  }
  const labels: Record<string, unknown>[] = [];
  for (const p of pieces) if (r() < 0.4) labels.push({ id: `l-${p.id}`, text: 'Demis Hassabis', sub: r() < 0.3 ? 'DeepMind' : undefined, owner: p.id, at: (p.at as number) - (r() < 0.3 ? 0.5 : -0.2) });
  if (r() < 0.4) labels.push({ id: 'frame', text: 'February 2010', kind: r() < 0.5 ? 'date' : 'label', at: 0.2 + r(), ...(r() < 0.4 ? { until: 1 + r() * 3 } : {}) });
  const heads = pieces.filter((p) => (p.media as { people: string[] }).people.length);
  const marks = heads.length && r() < 0.4 ? [{ id: 'm0', kind: ['worry', 'argue', 'idea', 'thought'][Math.floor(r() * 4)], on: heads[0].id as string }] : [];
  const style = r() < 0.4 ? 'paper' : 'cutouts';
  const arrangement = [undefined, undefined, 'pile', 'row', 'face_off', 'lead_inset'][Math.floor(r() * 6)];
  return { pieces, labels, marks, style, arrangement, seed, duration: 6 };
}

type Pl = { id: string; x: number; y: number; w: number; h: number; z: number; rot: number; kind: string };

// ── I1–I6 ────────────────────────────────────────────────────────────────────────────────────────

test('property: thousands of seeded casts keep I1–I6', () => {
  const CASTS = 2000;
  let tight = 0, moments = 0, arrangements = new Set<string>();
  const broken: string[] = [];
  for (let seed = 1; seed <= CASTS; seed++) {
    const spec = castOf(seed);
    // I6: it always returns a layout; never throws, never blocks.
    const t = solveTimeline(spec as never);
    assert.ok(t.moments.length >= 1, `seed ${seed}: no moments`);
    const prepared = new Map(spec.pieces.map((p) => [p.id as string, preparePiece(p as never)]));
    arrangements.add(t.report.arrangement);
    for (const [id, l] of Object.entries(t.labelTimes as Record<string, { at: number }>)) {
      const owner = spec.labels.find((x) => x.id === id)?.owner as string | undefined;
      // I4: never before its owner.
      if (owner) assert.ok(l.at >= (prepared.get(owner) as { at: number }).at, `seed ${seed}: label ${id} before its owner`);
    }
    t.moments.forEach((m: { pieces: Pl[]; labels: (Pl & { owner?: string })[]; report: { tight: boolean; flags: string[] } }, mi: number) => {
      moments += 1;
      for (const p of m.pieces) {
        for (const k of ['x', 'y', 'w', 'h', 'z', 'rot'] as const) assert.ok(Number.isFinite(p[k]), `seed ${seed}: ${p.id}.${k}`);
      }
      if (m.report.tight) { tight += 1; return; }
      const here = m.pieces;
      for (const a of here) {
        const pa = prepared.get(a.id)!;
        // I1, I2: nobody's keep is covered by what stands in front; the head core not at all.
        for (const b of here) {
          if (a === b || t.z[a.id] <= t.z[b.id]) continue;
          const c = keepCovered(pa as never, a as never, prepared.get(b.id) as never, b as never);
          if (c > STAGE.keepMax) broken.push(`I1 seed ${seed} moment ${mi}: ${b.id} ${(c * 100).toFixed(0)}% under ${a.id}`);
        }
        // I1: nor by words.
        for (const l of m.labels) {
          const c = keepUnderBox(l as never, pa as never, a as never);
          if (c > STAGE.keepMax) broken.push(`I1 seed ${seed} moment ${mi}: ${a.id} ${(c * 100).toFixed(0)}% under label ${l.id}`);
        }
        // I3: a head is whole, and clear of the caption band.
        if ((pa as { head?: unknown }).head) {
          const hd = boxInFrame(a as never, (pa as { head: never }).head) as { x: number; y: number; w: number; h: number };
          if (hd.y < 560 - 1) broken.push(`I3 seed ${seed} moment ${mi}: ${a.id} head in the caption band at ${hd.y}`);
          if (hd.x < -1 || hd.x + hd.w > 1081) broken.push(`I3 seed ${seed} moment ${mi}: ${a.id} head cut by the frame`);
        }
      }
      // I4: an owned label sits by its owner; labels of different owners don't stack.
      m.labels.forEach((l, i) => {
        if (l.owner) {
          const o = here.find((p) => p.id === l.owner);
          if (o) {
            const gapX = Math.max(0, o.x - (l.x + l.w), l.x - (o.x + o.w));
            const gapY = Math.max(0, o.y - (l.y + l.h), l.y - (o.y + o.h));
            if (Math.hypot(gapX, gapY) > 300) broken.push(`I4 seed ${seed} moment ${mi}: ${l.id} ${Math.round(Math.hypot(gapX, gapY))}px off ${l.owner}`);
          }
        }
        for (const other of m.labels.slice(i + 1)) {
          const apart = l.x + l.w <= other.x || other.x + other.w <= l.x || l.y + l.h <= other.y || other.y + other.h <= l.y;
          if (!apart) broken.push(`I4 seed ${seed} moment ${mi}: labels ${l.id} and ${other.id} overlap`);
        }
      });
    });
    // I5: through time nobody passes across anyone's keep; a moment that couldn't slide clean holds the final layout.
    const zOf = new Map(Object.entries(t.z as Record<string, number>));
    for (let i = 1; i < t.moments.length; i++) {
      if (t.moments[i - 1].report.tight || t.moments[i].report.tight) continue;
      if (!slideClean([...prepared.values()] as never, t.moments[i - 1], t.moments[i], zOf)) broken.push(`I5 seed ${seed}: moment ${i - 1} to ${i} isn't clean`);
    }
  }
  assert.deepEqual(broken.slice(0, 12), [], `${broken.length} broken of ${moments} moments`);
  // The stage fits nearly always: a tight report is the exception, and the arrangements are really different ones.
  assert.ok(tight / moments < 0.1, `tight ${tight} of ${moments}`);
  assert.ok(arrangements.size >= 4, [...arrangements].join());
});

test('a stage has real variety: arrangements and the paper style differ; the same seed is the same layout', () => {
  const r = rng(7);
  const pieces = [{ id: 'a', media: person(r, 'a'), at: 0, role: 'lead' }, { id: 'b', media: person(r, 'b'), at: 0 }, { id: 'c', media: logo(r, 'c'), at: 0 }];
  const look = (o: Record<string, unknown>) => JSON.stringify((solveStage({ pieces, seed: 3, ...o } as never).pieces as Pl[]).map((p) => [p.id, Math.round(p.x), Math.round(p.y), Math.round(p.w), Math.round(p.rot * 10)]));
  const seen = new Set([look({ arrangement: 'face_off' }), look({ arrangement: 'row' }), look({ arrangement: 'pile' }), look({ arrangement: 'lead_inset' }), look({ arrangement: 'face_off', style: 'paper' })]);
  assert.ok(seen.size >= 4, [...seen].join('\n'));
  assert.equal(look({ arrangement: 'face_off' }), look({ arrangement: 'face_off' }));
  const paper = solveStage({ pieces, seed: 3, style: 'paper' } as never).pieces as Pl[];
  assert.ok(paper.some((p) => Math.abs(p.rot) > 0.3), 'paper keeps its tilt');
  const other = new Set(Array.from({ length: 12 }, (_, s) => look({ seed: s + 1, style: 'paper' })));
  assert.ok(other.size >= 4, 'the seed varies the paper layout');
});

test('a cast that cannot fit shrinks, reports, and still returns everyone', () => {
  const r = rng(11);
  const pieces = Array.from({ length: 5 }, (_, i) => ({ id: `p${i}`, media: person(r, `p${i}`), at: 0 }));
  const out = solveStage({ pieces, arrangement: 'row', labels: pieces.map((p) => ({ id: `l${p.id}`, text: 'A very long name for a person, with a role', owner: p.id })) } as never);
  assert.equal(out.pieces.length, 5);
  assert.ok(out.report.shrink <= 1);
});

test('a whiteboard stage stays on the board', () => {
  const r = rng(13);
  const drawing = (id: string) => ({ id, kind: 'illustration', made: true, made_kind: 'expression', width: 800, height: 800, people: [], flags: [], regions: { faces: [], visible: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, shape: grid((x, y) => Math.hypot(x - 0.5, y - 0.5) < 0.4), tone: tone(0.8) } });
  const out = solveTimeline({ pieces: [{ id: 'a', media: drawing('a'), at: 0 }, { id: 'b', media: logo(r, 'b'), at: 1 }, { id: 'c', media: drawing('c'), at: 2 }], bounds: WHITEBOARD_BOUNDS, hold: true, duration: 5 } as never);
  for (const m of out.moments) {
    for (const p of m.pieces) {
      // What shows is the picture's visible box.
      const v = p.kind === 'logo' ? { x: 0, y: 0, w: 1, h: 1 } : { x: 0.1, y: 0.1, w: 0.8, h: 0.8 };
      const b = { x0: p.x + v.x * p.w, x1: p.x + (v.x + v.w) * p.w, y0: p.y + v.y * p.h, y1: p.y + (v.y + v.h) * p.h };
      assert.ok(b.x0 >= WHITEBOARD_BOUNDS.x0 - 1 && b.x1 <= WHITEBOARD_BOUNDS.x1 + 1 && b.y0 >= WHITEBOARD_BOUNDS.y0 - 1 && b.y1 <= WHITEBOARD_BOUNDS.y1 + 1, JSON.stringify(p));
    }
  }
  // Drawn things hold still: a piece doesn't move between moments.
  const places = out.moments.map((m: { pieces: Pl[] }) => m.pieces.find((p) => p.id === 'a')).filter(Boolean).map((p: Pl | undefined) => p!).map((p: Pl) => `${Math.round(p.x)},${Math.round(p.y)},${Math.round(p.w)}`);
  assert.equal(new Set(places).size, 1);
});

test('a person with no measured face still gets a head from the silhouette; headIn reads it', () => {
  const r = rng(17);
  const p = person(r, 'x');
  const head = headIn(p as never, p.regions.faces[0] as never) as { x: number; y: number; w: number; h: number };
  assert.ok(head.y <= p.regions.faces[0].y, 'the head rises above the face box');
  assert.ok(head.w >= p.regions.faces[0].w * 0.9);
});

// ── Measuring ────────────────────────────────────────────────────────────────────────────────────

test('measured pictures: visible box, shape and tone come from the pixels', () => {
  const W = 64, H = 64;
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    const inside = x >= 16 && x < 48 && y >= 8 && y < 40;
    data.set(inside ? [255, 255, 255, 255] : [0, 0, 0, 0], i);
  }
  const out = measureRaw(data, W, H);
  assert.ok(Math.abs(out.visible!.x - 0.25) < 0.04 && Math.abs(out.visible!.w - 0.5) < 0.06, JSON.stringify(out.visible));
  assert.ok(Math.abs(out.visible!.y - 0.125) < 0.04 && Math.abs(out.visible!.h - 0.5) < 0.06);
  assert.equal(out.shape!.w, 32);
  assert.equal(out.tone!.w, 16);
});

test('logos are keyed transparent when their background is plain, and left alone when it is not', async () => {
  const W = 40, H = 40;
  const plain = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) plain.set(x > 14 && x < 26 && y > 14 && y < 26 ? [10, 10, 10, 255] : [250, 250, 250, 255], (y * W + x) * 4);
  const keyed = keyBackground(plain, W, H);
  assert.ok(keyed);
  assert.equal(keyed![3], 0, 'the corner is keyed out');
  assert.ok(keyed![(20 * W + 20) * 4 + 3] > 200, 'the mark stays');
  const busy = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) busy.set([(i * 37) % 255, (i * 91) % 255, (i * 13) % 255, 255], i * 4);
  assert.equal(keyBackground(busy, W, H), null);
  // Through the files: a logo gets a keyed file and its measures; a measured asset isn't measured twice.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-measure-'));
  await sharp(Buffer.from(plain), { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(dir, 'L.png'));
  const inv = { assets: [{ id: 'L', kind: 'logo', flags: ['logo'], people: [], file: 'L.png', width: W, height: H, regions: { faces: [], words: [], photos: [] } }] } as unknown as VisualsInventory;
  await measureInventory(inv, dir);
  const a = inv.assets[0];
  assert.ok(a.file.endsWith('.keyed.png'), a.file);
  assert.ok(a.regions?.shape && a.regions?.tone && a.regions?.visible);
  assert.ok(a.regions!.visible!.w < 0.5);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ── Checks ───────────────────────────────────────────────────────────────────────────────────────

test('hand_placed: a frame that places a stage by hand fails; nk.stage and seeded tableaus pass', () => {
  const frame = (treatment: string, body: string) => `export default { treatment: '${treatment}', build(root, ctx) { ${body} }, render(t) {} };`;
  assert.match(handPlaced(frame('collision', 'nk.collision(doc, { left: {}, right: {} })'))!, /\[hand_placed\].*nk\.collision/);
  assert.match(handPlaced(frame('collage', 'nk.collage(doc, { layers: [] })'))!, /nk\.collage/);
  assert.match(handPlaced(frame('tableau', "nk.tableau(doc, { ground: 'kraft', cast: [] })"))!, /real setting/);
  assert.equal(handPlaced(frame('tableau', "nk.tableau(doc, { setting: 'boardroom', cast: [] })")), null);
  assert.match(handPlaced(frame('whiteboard', 'nk.drawn(doc, { media: m, x: 100, y: 700, w: 300 });'))!, /nk\.drawn with pixel numbers/);
  assert.equal(handPlaced(frame('collage', 'nk.stage(doc, { pieces: [] })')), null);
  assert.ok(sourceProblems(frame('collision', 'nk.collision(doc, {})')).some((p: string) => p.startsWith('[hand_placed]')));
});

test('screenProblems: the composition checks fire once they hold long enough', () => {
  const m = (o: Record<string, unknown>) => [0, 0.2, 0.4, 0.6, 0.8, 1].map((t) => ({ t, cover: 0.5, imgs: [], texts: [], blocks: [], ...o }));
  const run = (o: Record<string, unknown>) => screenProblems(m(o) as never, { duration: 1.2 }).join('\n');
  assert.match(run({ keepCovered: [{ label: 'V97 is covered by V32' }] }), /\[keep_covered\] V97 is covered by V32/);
  assert.match(run({ labelOffOwner: [{ label: '"Larry Page" sits 500px from Larry Page' }] }), /\[label_off_owner\]/);
  assert.match(run({ labelBeforeOwner: [{ label: '"Hassabis" lands before his picture' }] }), /\[label_before_owner\]/);
  assert.match(run({ markOffHead: [{ label: 'worry marks' }] }), /\[mark_off_head\]/);
  assert.match(run({ mixedStyle: [{ label: 'V58' }] }), /\[mixed_style\]/);
  // Iteration 10: the guarantees measured on the render.
  assert.match(run({ headSize: [{ label: 'a head' }] }), /\[head_size\]/);
  assert.match(run({ overSharp: [{ label: 'a print' }] }), /\[over_sharp\]/);
  assert.match(run({ openEdge: [{ label: 'a body' }] }), /\[open_edge\]/);
  assert.match(run({ plateOnHead: [{ label: 'a plate' }] }), /\[plate_on_head\]/);
  assert.match(run({ plateOff: [{ label: 'a plate' }] }), /\[plate_off_frame\]/);
  assert.match(run({ labelOnBody: [{ label: 'a name' }] }), /\[label_on_body\]/);
  assert.match(run({ creditsStacked: [{ label: 'two' }] }), /\[credits_stacked\]/);
  assert.match(run({ voidFrame: [{ label: 'a card' }] }), /\[void\]/);
  const brief = screenProblems([{ t: 0, cover: 0.5, imgs: [], texts: [], blocks: [], keepCovered: [{ label: 'x' }] }, ...[0.2, 0.4].map((t) => ({ t, cover: 0.5, imgs: [], texts: [], blocks: [] }))] as never, { duration: 1 }).join();
  assert.doesNotMatch(brief, /\[keep_covered\]/, 'a passing moment is not a problem');
});

test('board cords hang from pins on the top edges, slightly varied', () => {
  for (let n = 2; n <= 5; n++) {
    const links = Array.from({ length: n - 1 }, (_, i) => ({ from: i, to: i + 1 }));
    const { cards, cords } = playersLayout(n, links);
    const spots = new Set<string>();
    for (const c of cords) {
      for (const [pin, k] of [[c.a, c.from], [c.b, c.to]] as [number[], number][]) {
        const card = cards[k];
        assert.ok(pin[1] < card.y + 40, `pin on the top edge: ${n}`);
        assert.ok(pin[0] > card.x && pin[0] < card.x + card.w);
        spots.add(`${Math.round(pin[0] - card.x)}`);
      }
      assert.ok(c.mid[1] > (c.a[1] + c.b[1]) / 2, 'the cord hangs');
    }
    if (n >= 3) assert.ok(spots.size >= 2, 'not the same spot every time');
  }
});

// ── The pipeline's part ──────────────────────────────────────────────────────────────────────────

const asset = (o: Partial<Asset>) => ({ kind: 'person_photo', people: [], flags: [], ...o }) as Asset;

test('stage people: an uncut one-person picture in a stage frame gets cut, or swaps to the cut that exists', () => {
  const inventory = { assets: [
    asset({ id: 'V1', people: ['Larry Page'], character_image: true }),
    asset({ id: 'V2', people: ['Elon Musk'] }),
    asset({ id: 'V3', people: ['Elon Musk'], flags: ['cutout', 'transparent', 'cutout_of:V2'] }),
    asset({ id: 'V4', people: ['Musk', 'Page'] }),
    asset({ id: 'V5', kind: 'logo', flags: ['logo'] }),
  ] } as VisualsInventory;
  const plan = { frames: [{ n: 1, treatment: 'collision', asset_ids: ['V1', 'V2', 'V4', 'V5'] }, { n: 2, treatment: 'photo', asset_ids: ['V1'] }] } as unknown as DirectorPlan;
  const { requests, swaps } = stageCutoutRequests(plan, inventory);
  assert.deepEqual(requests.map((r) => [r.source_id, r.name, r.frames]), [['V1', 'Larry Page', [1]]], 'character_image is not trusted');
  assert.deepEqual(swaps, [{ from: 'V2', to: 'V3', frames: [1] }]);
});

test('a problem finds its frame by the ids the compile wrote', () => {
  const frames = [{ n: 3, id: '03-who' }, { n: 5, id: '05-b' }];
  assert.equal(problemFrame('[keep_covered] 03-who: V97 is covered', frames), 3);
  assert.equal(problemFrame('the check could not run', frames), null);
});

test('a repeated picture is caught on the storyboard; a logo may return, and a person\'s picture or a cut to its limit', () => {
  const inventory = { assets: [
    asset({ id: 'V1', kind: 'event_photo' }),
    asset({ id: 'V2', kind: 'logo', flags: ['logo'] }),
    asset({ id: 'V3', flags: ['cutout'], people: ['A'] }),
    asset({ id: 'V4', character_image: true, people: ['B'] }),
    asset({ id: 'V5', kind: 'event_photo' }),
  ] } as VisualsInventory;
  const plan = { frames: [
    { n: 1, purpose: 'x', line_ids: [], asset_ids: ['V1', 'V2', 'V3', 'V4'] },
    { n: 2, purpose: 'x', line_ids: [], asset_ids: ['V1', 'V2', 'V3', 'V4'] },
    { n: 3, purpose: 'y', line_ids: [], asset_ids: ['V5'], shows: [{ person: 'A', asset_id: 'V1', treatment: 'collage' }] },
  ] } as unknown as DirectorPlan;
  const found = repeatedPictures(plan, { inventory });
  assert.deepEqual(found.length, 3, 'V1 past its one frame; V3 and V4 in adjacent frames; the logo V2 not at all');
  assert.ok(found.some((f) => /^\[repeated_picture\] V1 holds frames 1, 2, 3/.test(f)));
  assert.ok(!found.some((f) => /\bV2 holds/.test(f)));
  const warnings = planWarnings(plan, { draft: { rungs: [], hook: {} } as unknown as WriterDraft, inventory });
  assert.ok(warnings.some((w) => w.startsWith('[repeated_picture]')), 'it ships flagged if it stays');
});
