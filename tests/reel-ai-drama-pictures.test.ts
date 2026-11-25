import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import sharp from 'sharp';

import { cutSource, hasCutoutOf, isRejectedCut, makeCutouts, stageCutoutRequests } from '@/lib/reel-ai-drama/harvest/cutouts';
import { mainFace, STRONG_FACE_SCORE, trustFaces } from '@/lib/reel-ai-drama/harvest/faces';
import { expressionOf, parseLooks, SUBMIT_LOOKS_TOOL } from '@/lib/reel-ai-drama/harvest/look';
import { brightnessAndEdges, CUT_REJECTED_FLAG, detailWidth, ENLARGE_LIMIT, looksLikeHead, markDuplicates, measureAsset, measureInventory, rawCutPath, sharpWidth } from '@/lib/reel-ai-drama/harvest/regions';
import { cleanCutRaw, gradeCut, straightEdgeShare } from '@/lib/reel-ai-drama/harvest/transparent';
import type { Asset, DirectorPlan, VisualsInventory } from '@/lib/reel-ai-drama/types';

import { remeasure } from '../scripts/reel-ai-drama-remeasure';

type Px = [number, number, number, number];
const CLEAR: Px = [0, 0, 0, 0];
const SKIN: Px = [200, 150, 120, 255];

/** RGBA pixels from a function of (x, y). */
function paint(w: number, h: number, at: (x: number, y: number) => Px): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) out.set(at(x, y), (y * w + x) * 4);
  return out;
}
const inDisc = (x: number, y: number, cx: number, cy: number, r: number) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const inRect = (x: number, y: number, x0: number, y0: number, x1: number, y1: number) => x >= x0 && x < x1 && y >= y0 && y < y1;
const save = (file: string, data: Uint8Array, w: number, h: number) => sharp(Buffer.from(data), { raw: { width: w, height: h, channels: 4 } }).png().toFile(file);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'pictures-'));
const alphaAt = (data: Uint8Array, w: number, x: number, y: number) => data[(y * w + x) * 4 + 3]!;

/** A person: a head on rounded shoulders running off the bottom of the picture. */
const person = (w: number, h: number) => (x: number, y: number): Px =>
  inDisc(x, y, w / 2, h * 0.3, h * 0.15) ? SKIN : ((x - w / 2) / (w * 0.38)) ** 2 + ((y - h) / (h * 0.58)) ** 2 <= 1 ? [40, 60, 90, 255] : CLEAR;
const HEAD = { x: 0.5 - 0.15 * (400 / 300), y: 0.15, w: 0.3 * (400 / 300), h: 0.3 };

const asset = (over: Partial<Asset> & Pick<Asset, 'id' | 'file'>): Asset => ({
  kind: 'person_photo', url: null, source_page: null, credit: '', license: null, shows: 'x', people: [], qids: [], place: null, date_taken: null, date_confidence: 'unknown',
  width: 300, height: 400, phash: null, character_image: false, made: false, upscaled: false, flags: [], anchor_for: null, face: null, made_kind: null, ...over,
});
const inventoryOf = (assets: Asset[]): VisualsInventory => ({ assets } as unknown as VisualsInventory);

// ── Faces ───────────────────────────────────────────────────────────────────

const CUP = { x: 0.0931, y: 0.6859, w: 0.339, h: 0.291, score: 0.52 };
const REAL = { x: 0.4106, y: 0.1813, w: 0.3285, h: 0.2813, score: 0.97 };

test('faces: the real failure. A larger cup at 0.52 never beats a real face at 0.97', () => {
  assert.deepEqual(mainFace([CUP, REAL]), { x: REAL.x, y: REAL.y, w: REAL.w, h: REAL.h }, 'even before any verdict');
  const judged = trustFaces([CUP, REAL], { people: ['Ada'] });
  assert.equal(judged[0]!.score, 0.97, 'main face first');
  assert.equal(judged[0]!.trusted, true);
  assert.equal(judged[0]!.name, 'Ada');
  assert.equal(judged[1]!.trusted, false);
  assert.equal(judged[1]!.name, undefined);
  assert.deepEqual(mainFace(judged), { x: REAL.x, y: REAL.y, w: REAL.w, h: REAL.h });
});

test('faces: a weak box is a head only on a picture of a named person, and only if it looks like one', () => {
  const weak = { ...CUP, score: STRONG_FACE_SCORE - 0.2 };
  assert.equal(trustFaces([weak], {})[0]!.trusted, false, 'nobody named: a false alarm (a cloud at 0.53)');
  assert.equal(trustFaces([weak], { people: ['Ada'], plausible: () => true })[0]!.trusted, true, 'a plain portrait can score this low');
  assert.equal(trustFaces([weak], { people: ['Ada'], plausible: () => false })[0]!.trusted, false);
  assert.equal(mainFace(trustFaces([weak], { people: ['Ada'], plausible: () => false })), null, 'no trusted face: no head');
});

test('faces: with people named a picture holds that many heads; with nobody named every sure box counts', () => {
  const three = [
    { x: 0, y: 0, w: 0.1, h: 0.1, score: 0.9 },
    { x: 0.3, y: 0, w: 0.3, h: 0.3, score: 0.9 },
    { x: 0.7, y: 0, w: 0.2, h: 0.2, score: 0.9 },
  ];
  const named = trustFaces(three, { people: ['Ada'] });
  assert.deepEqual(named.map((f) => f.trusted), [true, false, false]);
  assert.equal(named[0]!.w, 0.3, 'the largest sure box');
  assert.equal(trustFaces(three, { people: ['Ada', 'Ben'] }).filter((f) => f.trusted).length, 2);
  assert.equal(trustFaces(three, {}).filter((f) => f.trusted).length, 3);
});

test('faces: looksLikeHead reads skin on a weak box, a body above it on a cutout', () => {
  const w = 100, h = 100;
  const box = { x: 0.3, y: 0.4, w: 0.4, h: 0.4 };
  const fill = (px: Px) => paint(w, h, (x, y) => (inRect(x, y, 30, 40, 70, 80) ? px : CLEAR));
  assert.equal(looksLikeHead(fill(SKIN), w, h, box, false), true);
  assert.equal(looksLikeHead(fill([30, 30, 110, 255]), w, h, box, false), false, 'a dark blue cup has no skin');
  assert.equal(looksLikeHead(fill([30, 30, 110, 255]), w, h, box, false, false), true, 'a sure box needs no second opinion on colour');
  assert.equal(looksLikeHead(fill([120, 120, 120, 255]), w, h, box, false), true, 'a black and white picture has no colour to read');
  assert.equal(looksLikeHead(paint(w, h, () => CLEAR), w, h, box, true), false, 'nothing there');
  const bodyAbove = paint(w, h, (x, y) => (inRect(x, y, 30, 0, 70, 80) ? SKIN : CLEAR));
  const low = { x: 0.3, y: 0.65, w: 0.4, h: 0.15 };
  assert.equal(looksLikeHead(bodyAbove, w, h, low, true), false, 'a body above it: not its head');
  assert.equal(looksLikeHead(bodyAbove, w, h, low, false), true, 'only a cutout can tell');
});

// ── Cutout clean-up and grade ───────────────────────────────────────────────

test('cut: a solid figure is clean, and stays where it was', () => {
  const w = 300, h = 400;
  const m = cleanCutRaw(paint(w, h, person(w, h)), w, h, { person: true, head: HEAD });
  assert.ok(m.clean);
  assert.equal(m.edge_softness, 0);
  assert.equal(m.islands, 0);
  assert.equal(gradeCut({ ...m, sharpness: 1 }, true), 'clean');
  assert.equal(alphaAt(m.clean!, w, w / 2, 120), 255, 'the head stays solid');
  assert.equal(alphaAt(m.clean!, w, 5, 5), 0);
  assert.equal(alphaAt(m.clean!, w, w / 2, h - 1), 255, 'an open side is not eaten by the tighter edge');
});

test('cut: stray islands go, and the remover\'s half-belief goes solid or clear', () => {
  const w = 300, h = 400;
  const base = person(w, h);
  const noisy = paint(w, h, (x, y) => {
    if (inDisc(x, y, 30, 30, 8)) return [10, 200, 10, 255];
    const p = base(x, y);
    return p[3] ? [p[0], p[1], p[2], 225] : p;
  });
  const m = cleanCutRaw(noisy, w, h, { person: true, head: HEAD });
  assert.ok(m.clean);
  assert.equal(alphaAt(m.clean!, w, 30, 30), 0, 'the island is gone');
  assert.ok(m.islands > 0);
  assert.equal(alphaAt(m.clean!, w, w / 2, 300), 255, 'alpha 225 was the interior: now solid');
});

test('cut: old background on the edge is replaced with colour from inside', () => {
  const w = 300, h = 300;
  // A disc with a two-pixel ring of the old (green) background on its edge.
  const data = paint(w, h, (x, y) => (inDisc(x, y, 150, 150, 80) ? [200, 40, 40, 255] : inDisc(x, y, 150, 150, 82) ? [0, 255, 0, 255] : CLEAR));
  const { clean } = cleanCutRaw(data, w, h, { person: false });
  assert.ok(clean);
  let green = 0;
  for (let i = 0; i < w * h; i++) if (clean![i * 4 + 3]! > 8 && clean![i * 4 + 1]! > clean![i * 4]!) green += 1;
  assert.ok(green < 40, `only a trace of the ring may stay visible, saw ${green}`);
  assert.equal(alphaAt(clean!, w, 150, 150), 255);
});

test('cut: the real failure. A translucent smear with no body is rejected and not cleaned', () => {
  const w = 300, h = 200;
  // Every pixel half-believed, like a laptop the remover couldn't find.
  const data = paint(w, h, (x, y) => [120 + ((x * 7) % 40), 120, 125, 40 + ((x + y) % 90)]);
  const m = cleanCutRaw(data, w, h, { person: false });
  assert.equal(m.clean, null);
  assert.ok(m.edge_softness > 0.9);
  assert.equal(gradeCut({ ...m, sharpness: 1 }, false), 'rejected');
});

test('cut: a wide band of doubt on a real figure is rough, not rejected', () => {
  const w = 300, h = 400;
  const base = person(w, h);
  const data = paint(w, h, (x, y) => {
    const p = base(x, y);
    return p[3] && y > 300 ? [p[0], p[1], p[2], 170] : p;
  });
  const m = cleanCutRaw(data, w, h, { person: true, head: HEAD });
  assert.ok(m.edge_softness > 0.15 && m.edge_softness < 0.6, String(m.edge_softness));
  assert.equal(gradeCut({ ...m, sharpness: 1 }, true), 'rough');
});

test('cut: a person keeps the person and drops what hangs on them by a thin neck', () => {
  const w = 400, h = 400;
  const body = person(300, 400);
  const data = paint(w, h, (x, y) => {
    if (inRect(x, y, 300, 250, 390, 340)) return [90, 90, 90, 255]; // a table beside them
    if (inRect(x, y, 220, 290, 300, 293)) return [90, 90, 90, 255]; // joined by a sliver
    return x < 300 ? body(x, y) : CLEAR;
  });
  const head = { x: (150 - 60) / w, y: 60 / h, w: 120 / w, h: 120 / h };
  const { clean } = cleanCutRaw(data, w, h, { person: true, head });
  assert.ok(clean);
  assert.equal(alphaAt(clean!, w, 345, 295), 0, 'the table is dropped');
  assert.equal(alphaAt(clean!, w, 150, 300), 255, 'the body stays');
  assert.equal(alphaAt(clean!, w, 150, 120), 255, 'the head stays');
});

test('cut: hair-thin spikes above the head go, a small piece below it stays', () => {
  const w = 300, h = 400;
  const body = person(w, h);
  const data = paint(w, h, (x, y) => {
    if (inRect(x, y, 148, 40, 152, 72)) return SKIN; // a spike off the crown
    if (inRect(x, y, 60, 300, 75, 304)) return SKIN; // a finger off the body
    return body(x, y);
  });
  const { clean } = cleanCutRaw(data, w, h, { person: true, head: HEAD });
  assert.ok(clean);
  assert.equal(alphaAt(clean!, w, 150, 50), 0, 'the spike is gone');
  assert.ok(alphaAt(clean!, w, 72, 302) > 0, 'the finger stays');
});

test('cut: small holes close, a real gap stays', () => {
  const w = 400, h = 400;
  const data = paint(w, h, (x, y) => {
    if (inDisc(x, y, 200, 120, 8)) return CLEAR; // the remover's pinhole
    if (inRect(x, y, 150, 280, 250, 340)) return CLEAR; // the gap under an arm
    return inRect(x, y, 60, 60, 340, 400) ? [50, 50, 50, 255] : CLEAR;
  });
  const { clean } = cleanCutRaw(data, w, h, { person: false });
  assert.ok(clean);
  assert.equal(alphaAt(clean!, w, 200, 120), 255);
  assert.equal(alphaAt(clean!, w, 200, 310), 0);
});

test('cut: a thing keeps its parts and its straight sides; a person with straight sides is a mask\'s mistake', () => {
  const w = 300, h = 300;
  const box = paint(w, h, (x, y) => (inRect(x, y, 60, 60, 240, 240) ? [80, 80, 90, 255] : CLEAR));
  const thing = cleanCutRaw(box, w, h, { person: false });
  assert.ok(thing.straight_cuts > 0.8);
  assert.equal(gradeCut({ ...thing, sharpness: 1 }, false), 'clean', 'a laptop is straight');
  assert.equal(gradeCut({ ...thing, sharpness: 1 }, true), 'rejected', 'a person is not');
  const two = cleanCutRaw(paint(w, h, (x, y) => (inRect(x, y, 20, 20, 120, 120) || inRect(x, y, 170, 170, 280, 280) ? [80, 80, 90, 255] : CLEAR)), w, h, { person: false });
  assert.equal(alphaAt(two.clean!, w, 70, 70), 255);
  assert.equal(alphaAt(two.clean!, w, 220, 220), 255);
});

test('cut: the grade reads every measure', () => {
  const good = { edge_softness: 0.02, islands: 0, straight_cuts: 0, sharpness: 1 };
  assert.equal(gradeCut(good, true), 'clean');
  assert.equal(gradeCut({ ...good, islands: 0.2 }, true), 'rough');
  assert.equal(gradeCut({ ...good, islands: 0.6 }, true), 'rejected');
  assert.equal(gradeCut({ ...good, sharpness: 0.25 }, true), 'rough');
  assert.equal(gradeCut({ ...good, sharpness: 0.1 }, true), 'rejected');
  assert.equal(gradeCut({ ...good, lost: 0.7 }, true), 'rejected');
});

test('cut: straightEdgeShare ignores the image border', () => {
  const m = Uint8Array.from({ length: 100 }, () => 1);
  assert.equal(straightEdgeShare(m, 10, 10, 3), 0);
});

// ── The other measures ──────────────────────────────────────────────────────

test('open edges: only a real run of picture along a border counts', () => {
  const w = 100, h = 100;
  const bust = paint(w, h, (x, y) => (inRect(x, y, 20, 30, 80, 100) ? [10, 10, 10, 255] : x === 50 ? [10, 10, 10, 255] : CLEAR));
  assert.deepEqual(brightnessAndEdges(bust, w, h).open_edges, { left: false, right: false, top: false, bottom: true }, 'a stray hair on the top row is not a side');
  const photo = paint(w, h, () => [10, 10, 10, 255]);
  assert.deepEqual(brightnessAndEdges(photo, w, h).open_edges, { left: true, right: true, top: true, bottom: true });
});

test('brightness: mean luminance over what is opaque', () => {
  const w = 50, h = 50;
  assert.equal(brightnessAndEdges(paint(w, h, () => [255, 255, 255, 255]), w, h).brightness, 1);
  assert.equal(brightnessAndEdges(paint(w, h, () => [0, 0, 0, 255]), w, h).brightness, 0);
  const half = brightnessAndEdges(paint(w, h, (x) => (x < 25 ? [128, 128, 128, 255] : [255, 255, 255, 0])), w, h).brightness;
  assert.ok(Math.abs(half - 128 / 255) < 0.01, 'the clear half does not count');
});

test('sharp width: real detail, not pixel count', async () => {
  const dir = tmp();
  const w = 1200, h = 800;
  const sharpFile = path.join(dir, 'sharp.png');
  // Hard edges everywhere: small blocks of light and dark.
  await save(sharpFile, paint(w, h, (x, y) => {
    const v = (((x >> 3) * 2654435761) ^ ((y >> 3) * 40503)) >>> 11 & 1 ? 220 : 30;
    return [v, v, v, 255];
  }), w, h);
  assert.equal(await detailWidth(sharpFile), w);
  assert.equal(sharpWidth(w), Math.round(w * ENLARGE_LIMIT));
  // The same picture a quarter of the size, enlarged back: as many pixels, far less detail.
  const enlarged = path.join(dir, 'enlarged.png');
  const small = await sharp(sharpFile).resize(w / 4, h / 4).png().toBuffer();
  await sharp(small).resize(w, h, { kernel: 'cubic' }).png().toFile(enlarged);
  const detail = await detailWidth(enlarged);
  assert.ok(detail <= w / 2 && detail >= w / 8, `an enlarged picture holds about a quarter of its width, read ${detail}`);
  const blurred = path.join(dir, 'blurred.png');
  await sharp(sharpFile).blur(8).png().toFile(blurred);
  assert.ok((await detailWidth(blurred)) <= w / 3);
  const flat = path.join(dir, 'flat.png');
  await save(flat, paint(200, 100, () => [90, 90, 90, 255]), 200, 100);
  assert.equal(await detailWidth(flat), 200, 'nothing to lose');
});

test('sharp width: a cutout is read inside its silhouette, not along the edge the cut drew', async () => {
  const dir = tmp();
  const file = path.join(dir, 'cut.png');
  const w = 600, h = 600;
  // Smooth inside, a hard edge against clear: only the inside says how sharp the picture is.
  await save(file, paint(w, h, (x, y) => (inRect(x, y, 60, 60, 540, 540) ? [Math.round(60 + x / 8), 80, 90, 255] : CLEAR)), w, h);
  assert.ok((await detailWidth(file)) <= w / 3);
});

test('duplicates: near-identical pictures count as one; cuts, logos and made pictures stand apart', async () => {
  const dir = tmp();
  const scene = (shift: number) => paint(320, 240, (x, y) => {
    const v = 90 + 70 * Math.sin((x + shift) / 37) * Math.cos(y / 29);
    return [v, v, v, 255];
  });
  await save(path.join(dir, 'a.png'), scene(0), 320, 240);
  await save(path.join(dir, 'b.png'), scene(2), 320, 240);
  await save(path.join(dir, 'c.png'), paint(320, 240, (x, y) => ((x >> 5) % 2 === (y >> 5) % 2 ? [240, 240, 240, 255] : [20, 20, 20, 255])), 320, 240);
  const inv = inventoryOf([
    asset({ id: 'V1', file: 'a.png', kind: 'event_photo' }),
    asset({ id: 'V2', file: 'b.png', kind: 'event_photo' }),
    asset({ id: 'V3', file: 'c.png', kind: 'event_photo' }),
  ]);
  await measureInventory(inv, dir);
  assert.equal(inv.assets[0]!.regions!.dup_of, null);
  assert.equal(inv.assets[1]!.regions!.dup_of, 'V1');
  assert.equal(inv.assets[2]!.regions!.dup_of, null);
  // A cut of the same pixels isn't a repeat of the photo; a made picture and a logo never are.
  const same = inv.assets[0]!.regions!;
  const others = inventoryOf([
    asset({ id: 'V1', file: 'a.png', regions: { ...same } }),
    asset({ id: 'V2', file: 'a.png', flags: ['cutout'], regions: { ...same } }),
    asset({ id: 'V3', file: 'a.png', made: true, regions: { ...same } }),
    asset({ id: 'V4', file: 'a.png', kind: 'logo', regions: { ...same } }),
    asset({ id: 'V5', file: 'a.png', flags: ['cutout'], regions: { ...same, cut: { grade: 'clean', edge_softness: 0, islands: 0, straight_cuts: 0, sharpness: 1 } } }),
  ]);
  markDuplicates(others);
  assert.deepEqual(others.assets.map((a) => a.regions!.dup_of), [null, null, null, null, 'V2']);
});

test('expression: asked on the same sheet, no new call', () => {
  const props = SUBMIT_LOOKS_TOOL.input_schema.properties.tiles.items.properties as Record<string, unknown>;
  assert.ok(props.expression);
  const looks = parseLooks({ tiles: [{ tile: 1, shows: 'x', expression: ' tired, looking away ' }, { tile: 2, shows: 'y', expression: '' }, { tile: 3, shows: 'z' }] }, 3);
  assert.equal(expressionOf(looks.get(0)), 'tired, looking away');
  assert.equal(expressionOf(looks.get(1)), null);
  assert.equal(expressionOf(looks.get(2)), null);
  assert.equal(expressionOf(null), null);
});

// ── A whole asset, a whole inventory ────────────────────────────────────────

test('measure: a cutout with a cup and a face comes out honest, sidecar and all', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'media'));
  const w = 300, h = 400;
  const body = person(w, h);
  await save(path.join(dir, 'media/V1.png'), paint(w, h, (x, y) => (inRect(x, y, 30, 280, 100, 380) ? [30, 30, 110, 255] : body(x, y))), w, h);
  const cup = { x: 0.1, y: 0.7, w: 0.33, h: 0.25, score: 0.52 };
  const face = { x: HEAD.x, y: HEAD.y, w: HEAD.w, h: HEAD.h, score: 0.97 };
  fs.writeFileSync(path.join(dir, 'media/V1.boxes.json'), JSON.stringify({ faces: [cup, face], words: [], photos: [], lift: null }));
  const a = asset({ id: 'V1', file: 'media/V1.png', people: ['Ada'], flags: ['cutout'], face: { x: cup.x, y: cup.y, w: cup.w, h: cup.h } });
  const notes = await measureInventory(inventoryOf([a]), dir);
  assert.deepEqual(notes, []);
  const r = a.regions!;
  assert.equal(a.face!.y, face.y, 'Asset.face is the real face');
  assert.equal(r.faces![0]!.trusted, true);
  assert.equal(r.faces![0]!.name, 'Ada');
  assert.equal(r.faces![1]!.trusted, false);
  assert.equal(r.cut!.grade, 'clean');
  assert.deepEqual(r.open_edges, { left: false, right: false, top: false, bottom: true });
  assert.ok(r.phash && r.brightness! > 0 && r.sharp_width_px! > 0);
  assert.equal(r.expression, null);
  assert.equal(r.dup_of, null);
  assert.ok(r.shape && r.tone && r.visible);
  const side = JSON.parse(fs.readFileSync(path.join(dir, 'media/V1.boxes.json'), 'utf8'));
  assert.equal(side.faces[0].trusted, true, 'the project files read faces from the sidecar');
  assert.equal(side.faces[1].trusted, false);
  assert.ok(fs.existsSync(rawCutPath(path.join(dir, 'media/V1.png'))), "the remover's answer is kept");
});

test('measure: a rejected cut is flagged, its anchor moves on, and its file is left alone', async () => {
  const dir = tmp();
  const w = 300, h = 200;
  const smear = paint(w, h, (x, y) => [130, 130, 135, 40 + ((x + y) % 90)]);
  await save(path.join(dir, 'smear.png'), smear, w, h);
  await save(path.join(dir, 'photo.png'), paint(w, h, (x) => (x > 150 ? SKIN : [30, 60, 90, 255])), w, h);
  const before = fs.readFileSync(path.join(dir, 'smear.png'));
  const cut = asset({ id: 'V2', file: 'smear.png', people: ['Ada'], flags: ['cutout', 'cutout_of:V1', 'anchor:Ada'], anchor_for: 'Ada', character_image: true });
  const photo = asset({ id: 'V1', file: 'photo.png', people: ['Ada'], flags: ['identity:verified'] });
  const inv = inventoryOf([photo, cut]);
  await measureInventory(inv, dir);
  const after = inv.assets.find((a) => a.id === 'V2')!;
  assert.equal(after.regions!.cut!.grade, 'rejected');
  assert.ok(after.flags.includes(CUT_REJECTED_FLAG));
  assert.equal(after.anchor_for, null);
  assert.equal(inv.assets.find((a) => a.id === 'V1')!.anchor_for, 'Ada');
  assert.deepEqual(fs.readFileSync(path.join(dir, 'smear.png')), before);
  assert.equal(hasCutoutOf(inv, 'Ada'), false, 'never offered as a cutout');
  assert.equal(isRejectedCut(after), true);
  assert.equal(cutSource(inv, after)!.id, 'V1');
});

test('measure: a rejected cut in a stage frame goes back to its photo, and that photo is not cut again', () => {
  const regions = { visible: { x: 0, y: 0, w: 1, h: 1 }, shape: { w: 1, h: 1, cells: '1' }, tone: { w: 1, h: 1, cells: '8' }, cut: { grade: 'rejected' as const, edge_softness: 1, islands: 0, straight_cuts: 0, sharpness: 1 } };
  const inv = inventoryOf([
    asset({ id: 'V1', file: 'photo.png', people: ['Ada'] }),
    asset({ id: 'V2', file: 'smear.png', people: ['Ada'], flags: ['cutout', 'cutout_of:V1', CUT_REJECTED_FLAG], regions }),
  ]);
  const plan = { frames: [{ n: 1, treatment: 'collision', asset_ids: ['V2'] }, { n: 2, treatment: 'collision', asset_ids: ['V1'] }] } as unknown as DirectorPlan;
  const { requests, swaps } = stageCutoutRequests(plan, inv);
  assert.deepEqual(requests, []);
  assert.deepEqual(swaps, [{ from: 'V2', to: 'V1', frames: [1] }]);
});

test('measure: once per asset, an old inventory loads, and a bad file is a note', async () => {
  const dir = tmp();
  await save(path.join(dir, 'a.png'), paint(64, 64, () => [120, 120, 120, 255]), 64, 64);
  fs.writeFileSync(path.join(dir, 'bad.png'), 'not a picture');
  const measured = asset({ id: 'V1', file: 'a.png', regions: { visible: { x: 0, y: 0, w: 1, h: 1 }, shape: { w: 1, h: 1, cells: '1' }, tone: { w: 1, h: 1, cells: '8' }, brightness: 0.123, open_edges: { left: true, right: true, top: true, bottom: true }, sharp_width_px: 7, phash: 'ffffffffffffffff', expression: 'calm' } });
  const inv = inventoryOf([measured, asset({ id: 'V2', file: 'bad.png' }), asset({ id: 'V3', file: 'gone.png' })]);
  const notes = await measureInventory(inv, dir);
  assert.equal(notes.length, 1);
  assert.match(notes[0]!, /V2/);
  assert.equal(measured.regions!.brightness, 0.123, 'measured once');
  assert.equal(measured.regions!.sharp_width_px, 7);
  assert.equal(measured.regions!.expression, 'calm');
  assert.equal(inv.assets[2]!.regions, undefined);
});

test('measure: logos are keyed, or left for a chip', async () => {
  const dir = tmp();
  await save(path.join(dir, 'plain.png'), paint(200, 200, (x, y) => (inDisc(x, y, 100, 100, 60) ? [20, 20, 200, 255] : [255, 255, 255, 255])), 200, 200);
  await save(path.join(dir, 'busy.png'), paint(200, 200, (x, y) => (((x >> 2) + (y >> 2)) % 2 ? [255, 0, 0, 255] : [0, 200, 255, 255])), 200, 200);
  const plain = asset({ id: 'V1', file: 'plain.png', kind: 'logo' });
  const busy = asset({ id: 'V2', file: 'busy.png', kind: 'logo' });
  await measureInventory(inventoryOf([plain, busy]), dir);
  assert.ok(plain.flags.includes('logo_keyed'));
  assert.equal(plain.file, 'plain.keyed.png');
  assert.equal(plain.regions!.chip, undefined);
  assert.equal(busy.regions!.chip, true);
  assert.equal(busy.file, 'busy.png');
});

test('measure: the expression from the look lands on the record', async () => {
  const dir = tmp();
  await save(path.join(dir, 'a.png'), paint(64, 64, () => SKIN), 64, 64);
  const a = asset({ id: 'V1', file: 'a.png' });
  await measureAsset(a, dir, { expression: 'furious' });
  assert.equal(a.regions!.expression, 'furious');
});

// ── After the writer ────────────────────────────────────────────────────────

test('makeCutouts: a poor cut is refused and the frame stays on the photo; a good one comes out cleaned and graded', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'media'));
  const w = 300, h = 400;
  await save(path.join(dir, 'media/V1.png'), paint(w, h, (x) => (x > 150 ? SKIN : [30, 60, 90, 255])), w, h);
  const inv = inventoryOf([asset({ id: 'V1', file: 'media/V1.png', people: ['Ada'] })]);
  const request = { name: 'Ada', source_id: 'V1', anchor: false, frames: [1] };
  const poor = await makeCutouts(
    { cutout: async (_src, out) => { await save(out, paint(w, h, (x, y) => [130, 130, 135, 40 + ((x + y) % 90)]), w, h); return { ok: true, width: w, height: h, coverage: 0.9 }; } },
    { inventory: inv, requests: [request], jobDir: dir, jobId: null },
  );
  assert.deepEqual(poor.assets, []);
  assert.match(poor.problems[0]!, /too poor/);
  assert.equal(fs.readdirSync(path.join(dir, 'media')).filter((f) => /^V2/.test(f)).length, 0);
  const good = await makeCutouts(
    { cutout: async (_src, out) => { await save(out, paint(w, h, person(w, h)), w, h); return { ok: true, width: w, height: h, coverage: 0.5 }; }, detectFaces: async (files) => new Map(files.map((f) => [f, [{ ...HEAD, score: 0.95 }]])) },
    { inventory: inv, requests: [request], jobDir: dir, jobId: null },
  );
  assert.equal(good.assets.length, 1);
  const made = good.assets[0]!;
  assert.equal(made.regions!.cut!.grade, 'clean');
  assert.equal(made.regions!.faces![0]!.trusted, true);
  assert.ok(Math.abs(made.face!.w - HEAD.w) < 0.001);
});

// ── The replay ──────────────────────────────────────────────────────────────

test('remeasure: in place, from the remover\'s own answer, the same twice', async () => {
  const dir = tmp();
  fs.mkdirSync(path.join(dir, 'assets/media'), { recursive: true });
  const w = 300, h = 400;
  await save(path.join(dir, 'assets/media/V1.png'), paint(w, h, person(w, h)), w, h);
  const inv = inventoryOf([asset({ id: 'V1', file: 'assets/media/V1.png', people: ['Ada'], flags: ['cutout'] })]);
  (inv as unknown as { usable_count: number }).usable_count = 1;
  const file = path.join(dir, 'assets/inventory.json');
  fs.writeFileSync(file, JSON.stringify(inv));
  await remeasure(dir);
  const first = JSON.parse(fs.readFileSync(file, 'utf8'));
  const firstPixels = fs.readFileSync(path.join(dir, 'assets/media/V1.png'));
  assert.equal(first.assets[0].regions.cut.grade, 'clean');
  assert.equal(first.usable_count, 1, 'the rest of the inventory is kept');
  await remeasure(dir);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), first);
  assert.deepEqual(fs.readFileSync(path.join(dir, 'assets/media/V1.png')), firstPixels);
  await assert.rejects(remeasure(path.join(dir, 'nothing')), /no inventory/);
});
