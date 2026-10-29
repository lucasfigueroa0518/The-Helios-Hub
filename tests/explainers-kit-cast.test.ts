/**
 * Explainers hx-4 cast (Critter 2.0 and outfits, VISUAL_SYSTEM_4 §cast.js), offline: every outfit
 * kind and item draws; nothing worn enters the face keep-out (EX3-103, glasses excepted); the
 * kit clips custom garments out of it; the look key carries the outfit (EX3-107); squash,
 * heldScale and the old stock `wear` still work. No model, no browser.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

type Pt = [number, number];
type Box = { part: string; x: number; y: number; w: number; h: number };
type Shape = { part: string; pts?: Pt[]; line?: Pt[]; w?: number; item?: boolean };

// try.mjs stubs the CDN import draw.js makes (perfect-freehand), as in the kit tests.
async function kit() {
  await import('../explainers/world-kit/try.mjs');
  const draw = await import('../explainers/world-kit/draw.js');
  const cast = await import('../explainers/world-kit/cast.js');
  const outfits = await import('../explainers/world-kit/outfits.js');
  return { draw, cast, outfits };
}
const DARK = (draw: { scope: (p: string, g: string) => void }) => {
  try {
    draw.scope('t-', 'stage');
    return 'stage';
  } catch {
    return 'night';
  }
};

// ── geometry: does a shape put ink inside a keep-out box? ───────────────────────────────────
const inRect = ([x, y]: Pt, b: Box) => x > b.x && x < b.x + b.w && y > b.y && y < b.y + b.h;
function segHitsRect(a: Pt, c: Pt, b: Box): boolean {
  if (inRect(a, b) || inRect(c, b)) return true;
  // Liang–Barsky clip of the segment against the open box
  let t0 = 0;
  let t1 = 1;
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  for (const [p, q] of [[-dx, a[0] - b.x], [dx, b.x + b.w - a[0]], [-dy, a[1] - b.y], [dy, b.y + b.h - a[1]]]) {
    if (p === 0) {
      if (q <= 0) return false;
    } else {
      const r = q / p;
      if (p < 0) t0 = Math.max(t0, r);
      else t1 = Math.min(t1, r);
      if (t0 >= t1) return false;
    }
  }
  return t1 - t0 > 1e-9;
}
function inPoly(poly: Pt[], [px, py]: Pt) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const segDist = (p: Pt, a: Pt, c: Pt) => {
  const dx = c[0] - a[0];
  const dy = c[1] - a[1];
  const l = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l));
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
};
const pointRectDist = ([x, y]: Pt, b: Box) => Math.hypot(Math.max(b.x - x, 0, x - b.x - b.w), Math.max(b.y - y, 0, y - b.y - b.h));
/** A filled polygon enters the box: an edge crosses it, or the box sits inside the polygon. */
function fillHits(poly: Pt[], b: Box) {
  for (let i = 0; i < poly.length; i++) if (segHitsRect(poly[i], poly[(i + 1) % poly.length], b)) return true;
  return inPoly(poly, [b.x + b.w / 2, b.y + b.h / 2]);
}
/** A stroke w wide along a polyline comes within w/2 of the box. */
function lineHits(line: Pt[], w: number, b: Box) {
  const corners: Pt[] = [[b.x, b.y], [b.x + b.w, b.y], [b.x + b.w, b.y + b.h], [b.x, b.y + b.h]];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1];
    const c = line[i];
    if (segHitsRect(a, c, b)) return true;
    if (pointRectDist(a, b) < w / 2 || pointRectDist(c, b) < w / 2) return true;
    if (corners.some((k) => segDist(k, a, c) < w / 2)) return true;
  }
  return false;
}
const shapeHits = (s: Shape, b: Box) => (s.pts ? fillHits(s.pts, b) : s.line ? lineHits(s.line, s.w ?? 0, b) : false);
const bboxOf = (pts: Pt[]) => {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
};
const boxesMeet = (a: { x: number; y: number; w: number; h: number }, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

test('the geometry check catches a garment over the mouth and a cord beside the eye', () => {
  const mouth: Box = { part: 'mouth', x: -32, y: -74, w: 64, h: 35 };
  const eyes: Box = { part: 'eyes', x: -51, y: -134, w: 102, h: 62 };
  assert.ok(fillHits([[-40, -72], [40, -72], [46, -30], [-46, -30]], mouth), 'a bib over the mouth');
  assert.ok(fillHits([[-200, -300], [200, -300], [200, 200], [-200, 200]], mouth), 'a sheet over everything');
  assert.ok(!fillHits([[-60, -30], [60, -30], [60, -10], [-60, -10]], mouth), 'a hem band below it');
  assert.ok(lineHits([[-54, -120], [-54, -80]], 9, eyes), 'a strap 9 wide 3px from the eye zone');
  assert.ok(!lineHits([[-60, -120], [-60, -80]], 9, eyes));
});

test('every outfit kind, neck, head and item draws on every body, on both grounds', async () => {
  const { draw, cast, outfits } = await kit();
  const dark = DARK(draw);
  const { critter, TOP_KINDS, NECKS, HEAD_KINDS, ITEMS } = cast;
  assert.deepEqual(TOP_KINDS, ['scrubs', 'coat', 'vest', 'waistcoat', 'tee', 'cardigan', 'apron', 'jacket', 'overalls', 'uniform', 'sweater', 'dress', 'hoodie', 'none']);
  assert.deepEqual(NECKS, ['v', 'crew', 'collar', 'lapel']);
  assert.deepEqual(HEAD_KINDS, ['scrub-cap', 'chef', 'hard-hat', 'beanie', 'bandana', 'headband', 'crown', 'peaked', 'headphones', 'none']);
  assert.deepEqual(ITEMS, ['stethoscope', 'badge', 'lanyard', 'fob-watch', 'pen', 'heart-pin', 'bowtie', 'tie', 'towel', 'tray', 'earpiece', 'wristband', 'glasses', 'glasses-chain', 'clipboard', 'name-tag', 'whistle', 'tool-belt', 'apron-pocket', 'scarf']);
  const bad = /NaN|undefined|\[object Object\]|Infinity/;
  for (const ground of ['paper', dark]) {
    draw.scope('k-', ground);
    for (const body of ['ink', 'paper', 'orange']) {
      for (const kind of TOP_KINDS as string[]) {
        for (const neck of NECKS as string[]) {
          const svg = critter(500, 900, { body, outfit: { top: { kind, color: 'teal', trim: 'yellow', neck, pocket: true, under: 'white' }, sleeves: kind === 'vest' ? false : undefined, pants: 'blue', shoes: 'ink' } });
          assert.ok(!bad.test(svg), `${kind}/${neck} on ${body} (${ground})`);
          if (kind !== 'none') assert.match(svg, /data-outfit="front"/, `${kind} draws a front layer`);
        }
      }
      for (const kind of HEAD_KINDS as string[]) {
        const svg = critter(0, 0, { body, outfit: { head: { kind } } });
        assert.ok(!bad.test(svg), `head ${kind}`);
        if (kind !== 'none') assert.match(svg, /data-outfit="head"/, `head ${kind} draws`);
      }
      for (const item of ITEMS as string[]) {
        const svg = critter(0, 0, { body, arms: 'offer', outfit: { top: { kind: 'tee', color: 'blue' }, items: [item] } });
        assert.ok(!bad.test(svg), `item ${item}`);
        const bare = critter(0, 0, { body, arms: 'offer', outfit: { top: { kind: 'tee', color: 'blue' } } });
        assert.ok(svg.length > bare.length, `item ${item} adds a drawing`);
      }
    }
  }
  // Each item puts at least one silhouette on the body (the arm and hand items draw on the arm).
  for (const item of ITEMS as string[]) {
    if (['towel', 'tray', 'wristband', 'clipboard', 'glasses'].includes(item)) continue;
    assert.ok((cast.outfitShapes({ items: [item] }) as Shape[]).length > 0, `${item} has a silhouette`);
  }
  // Typos are caught, never drawn as nothing.
  assert.throws(() => critter(0, 0, { outfit: { top: { kind: 'tuxedo' } } }), /top\.kind "tuxedo" must be one of scrubs, coat/);
  assert.throws(() => critter(0, 0, { outfit: { top: { kind: 'tee', color: 'pink' } } }), /"pink" must be a palette name/);
  assert.throws(() => critter(0, 0, { outfit: { items: ['cape'] } }), /item "cape" must be one of/);
  assert.throws(() => critter(0, 0, { outfit: { head: { kind: 'cap' } } }), /head\.kind "cap" must be one of/);
  assert.throws(() => critter(0, 0, { outfit: { pants: 'grey' } }), /pants "grey" must be a palette name/);
  void outfits;
});

test('nothing an outfit draws enters the face keep-out (EX3-103); glasses sit on the eyes', async () => {
  const { draw, cast } = await kit();
  draw.scope('ko-', 'paper');
  const { FACE_KEEPOUT, TOP_KINDS, NECKS, HEAD_KINDS, ITEMS, ARM_POSES, outfitShapes } = cast;
  const zones = FACE_KEEPOUT as Box[];
  assert.deepEqual(zones.map((z) => z.part), ['eyes', 'mouth']);
  const check = (outfit: Record<string, unknown>, label: string, arms = 'down') => {
    const shapes = outfitShapes(outfit, { arms }) as Shape[];
    for (const s of shapes) {
      for (const z of zones) assert.ok(!shapeHits(s, z), `${label}: ${s.part} enters the ${z.part} keep-out`);
      // compact items (badges, pins, buckles…) also keep their whole bounding box clear
      const box = bboxOf((s.pts ?? s.line) as Pt[]);
      if (s.item && box.w < 40 && box.h < 40) for (const z of zones) assert.ok(!boxesMeet(box, z), `${label}: ${s.part}'s bounding box meets the ${z.part} keep-out`);
    }
    return shapes.length;
  };
  for (const kind of TOP_KINDS as string[]) {
    for (const neck of NECKS as string[]) {
      for (const extra of [{}, { pocket: true, under: 'white', print: 'STAFF', pattern: 'stripes', trim: 'yellow' }]) {
        check({ top: { kind, color: 'blue', neck, ...extra } }, `${kind}/${neck}`);
      }
    }
  }
  for (const kind of HEAD_KINDS as string[]) check({ head: { kind } }, `head ${kind}`);
  for (const item of (ITEMS as string[]).filter((i) => i !== 'glasses')) {
    for (const top of ['tee', 'apron', 'coat']) check({ top: { kind: top, color: 'teal' }, items: [item] }, `${item} over a ${top}`);
  }
  check({ items: ['glasses-chain'] }, 'glasses-chain with the glasses hanging at the base');
  check({ items: ['glasses', 'glasses-chain'] }, 'glasses-chain on worn glasses');
  // Sleeves on an arm over the body stop before the face, in every pose.
  for (const arms of Object.keys(ARM_POSES)) check({ top: { kind: 'coat', color: 'white' } }, `coat sleeves (${arms})`, arms);
  check({ top: { kind: 'tee', color: 'white' } }, 'sleeves to a hand on the chin', 'think');
  // The one exception: glasses are drawn over the eyes, outside the keep-out clip.
  const { critter } = cast;
  const svg = critter(0, 0, { outfit: { items: ['glasses'] } });
  const front = /<g clip-path="[^"]+" data-outfit="front">/.exec(svg);
  assert.ok(front, 'the front layer is clipped');
  const glassesAt = svg.indexOf('cy="-98" r="20.5"');
  assert.ok(glassesAt > 0, 'glasses drawn round the eyes');
});

test('custom garments are clipped out of the keep-out by the kit, and get the context', async () => {
  const { draw, cast } = await kit();
  draw.scope('cu-', 'paper');
  let seen: Record<string, unknown> | null = null;
  const custom = (ctx: Record<string, unknown>) => {
    seen = ctx;
    return '<rect x="-80" y="-140" width="160" height="120" fill="#FF5E1A"></rect>';
  };
  const svg = cast.critter(0, 0, { body: 'ink', outfit: { custom } });
  assert.ok(seen, 'custom was called');
  const ctx = seen as unknown as { by: number; fill: string; tones: Record<string, { base: string }>; keepout: Box[] };
  assert.equal(ctx.by, -142);
  assert.equal(typeof ctx.fill, 'string');
  assert.equal(ctx.tones.teal.base.toUpperCase(), '#57AFAF');
  assert.deepEqual(ctx.keepout, cast.FACE_KEEPOUT);
  // the custom drawing sits inside the clipped front layer
  const m = /<g clip-path="url\(#([^)]+)\)" data-outfit="front">(.*?)<g data-outfit="custom"><rect x="-80"/.exec(svg);
  assert.ok(m, 'custom is inside the front layer');
  const clipDef = new RegExp(`<clipPath id="${m![1]}"><path clip-rule="evenodd" d="([^"]+)"`).exec(svg);
  assert.ok(clipDef, 'the front layer clip is defined');
  // the clip is the whole plane minus the eye and mouth zones
  assert.match(clipDef![1], /M -51 -134 L 51 -134 L 51 -72 L 32 -72 L 32 -39 L -32 -39 L -32 -72 L -51 -72 Z/);
  // a custom changes the look key
  assert.notEqual(cast.lookKey({ outfit: { custom } }), cast.lookKey({ outfit: { custom: () => '' } }));
});

test('the look key carries the outfit (EX3-107): order-free, quote-free, body first', async () => {
  const { draw, cast } = await kit();
  draw.scope('lk-', 'paper');
  const { lookKey, critter } = cast;
  const nurse = { top: { kind: 'scrubs', color: 'green' }, shoes: 'paper', items: ['stethoscope', 'badge'] };
  // no outfit: the hx-3 key, unchanged
  assert.equal(lookKey({ body: 'orange', wear: ['scarf', 'cap'] }), 'orange|cap+scarf|');
  const k = lookKey({ body: 'orange', outfit: nurse });
  assert.ok(k.startsWith('orange|||'), k);
  assert.notEqual(k, lookKey({ body: 'orange' }));
  assert.equal(k, lookKey({ body: 'orange', outfit: { ...nurse, items: ['badge', 'stethoscope'] } }), 'item order does not matter');
  assert.notEqual(k, lookKey({ body: 'orange', outfit: { ...nurse, top: { kind: 'scrubs', color: 'blue' } } }), 'a new color is a new look');
  assert.notEqual(k, lookKey({ body: 'orange', outfit: { ...nurse, items: ['badge'] } }), 'a lost item is a new look');
  assert.ok(!/["<>&]/.test(k), 'safe in an attribute');
  const svg = critter(0, 0, { who: 'nurse', body: 'orange', outfit: nurse, mood: 'happy', arms: 'wave' });
  assert.ok(svg.startsWith(`<g data-who="nurse" data-look="${k}"`), svg.slice(0, 200));
  // pose and mood change; the look does not
  assert.equal(/data-look="([^"]+)"/.exec(critter(0, 0, { who: 'nurse', body: 'orange', outfit: nurse, mood: 'sad', arms: 'hips', s: 0.6 }))![1], k);
});

test('a critter draws the same string every time, and the old stock wear still works', async () => {
  const { draw, cast } = await kit();
  draw.scope('w-', 'paper');
  const { critter, wearDrawing, WEAR } = cast;
  const o = { body: 'paper', mood: 'proud', arms: 'carry', outfit: { top: { kind: 'apron', color: 'green', under: 'ink' }, head: { kind: 'chef' }, items: ['scarf', 'clipboard'] } };
  assert.equal(critter(10, 20, o), critter(10, 20, o), 'a frame is a pure function of its arguments');
  for (const item of WEAR as string[]) {
    const svg = critter(0, 0, { wear: [item] });
    assert.ok(svg.includes(wearDrawing([item]).front), `${item}: critter draws the stock accessory`);
    assert.ok(!/data-outfit/.test(svg), 'stock wear is not an outfit');
  }
  // both at once: the outfit and an exact-match stock accessory
  const both = critter(0, 0, { wear: ['gradcap'], outfit: { top: { kind: 'tee', color: 'blue' } } });
  assert.ok(both.includes(wearDrawing(['gradcap']).front) && /data-outfit="front"/.test(both));
});

test('squash scales about the feet; hands follow; heldScale sizes a prop from CRITTER_CM', async () => {
  const { draw, cast } = await kit();
  draw.scope('sq-', 'paper');
  const { critter, handAt, heldScale, CRITTER_CM, CRITTER_PX } = cast;
  const core = await import('../explainers/world-kit/core.js');
  assert.equal(CRITTER_CM, (core as { CRITTER_CM?: number }).CRITTER_CM ?? 72);
  assert.equal(CRITTER_CM, 72);
  const svg = critter(100, 500, { s: 2, squash: { sx: 1.25, sy: 0.8 } });
  assert.match(svg, /transform="translate\(100\.00 500\.00\)"/, 'the feet stay put');
  assert.match(svg, /scale\(2\.5000 1\.6000\)/, 'the body scales about the feet');
  const flat = handAt(100, 500, { s: 2, arms: 'reach', squash: { sx: 1.25, sy: 0.8 } });
  assert.deepEqual(flat.r, [100 + 156 * 2 * 1.25, 500 - 98 * 2 * 0.8]);
  assert.deepEqual(handAt(100, 500, { s: 2, arms: 'reach', squash: { sx: 1, sy: 1 } }).r, [100 + 156 * 2, 500 - 98 * 2]);
  // the ruler: a 72 cm prop drawn critter-tall needs no scaling; a 12 cm one is a sixth of it
  assert.equal(heldScale(72), 1);
  assert.ok(Math.abs(heldScale(12) - 12 / 72) < 1e-12);
  // a drawing 50 px tall at scale 1 that is really 12 cm
  assert.ok(Math.abs(heldScale(12, 50) - (12 * (CRITTER_PX / CRITTER_CM)) / 50) < 1e-12);
  assert.throws(() => heldScale(0), /positive sizes/);
});

test('on the stage a critter gets the rim light; on paper it does not; the light follows a flip', async () => {
  const { draw, cast } = await kit();
  const dark = DARK(draw);
  const { critter } = cast;
  draw.scope('st-', dark);
  const lit = critter(0, 0, { body: 'ink' });
  assert.match(lit, /<filter id="[^"]+"[^>]*>.*feFlood/, 'a rim-light filter');
  assert.match(lit, /<g data-part="body" filter="url\(#/, '4.2: applied to the body only, under the outfit');
  draw.scope('pp-', 'paper');
  assert.ok(!/feFlood/.test(critter(0, 0, { body: 'ink' })));
  // flipped: the figure mirrors, the gloss stays top right on screen (drawn at −x before the mirror)
  const flipped = critter(0, 0, { body: 'orange', flip: true });
  assert.match(flipped, /scale\(-1\.0000 1\.0000\)/);
  assert.match(flipped, /<ellipse cx="-34" cy="-122"/);
  assert.match(critter(0, 0, { body: 'orange' }), /<ellipse cx="34" cy="-122"/);
});

test('the peaked cap sits above the brows; headphones put their cups on the sides', async () => {
  const { draw, cast } = await kit();
  draw.scope('hd-', 'paper');
  const [eyes] = cast.FACE_KEEPOUT as Box[];
  const peaked = cast.outfitShapes({ head: { kind: 'peaked', color: 'blue' } }) as Shape[];
  assert.deepEqual(peaked.map((p) => p.part), ['peaked-crown', 'peaked-band', 'peaked-visor', 'peaked-badge']);
  // across the face (|x| < 51) every part of the cap, the visor included, stays at or above y −137
  for (const p of peaked) for (const [x, y] of p.pts!) if (Math.abs(x) < 51) assert.ok(y <= -137, `${p.part} at (${x}, ${y}) dips toward the brows`);
  for (const p of peaked) assert.ok(!shapeHits(p, eyes), p.part);
  const phones = cast.outfitShapes({ head: { kind: 'headphones' } }) as Shape[];
  const cups = phones.filter((p) => p.part === 'headphones-cup');
  assert.equal(cups.length, 2);
  for (const c of cups) assert.ok(Math.min(...c.pts!.map(([x]) => Math.abs(x))) >= 59, 'a cup sits on the side, not over an eye');
  const band = phones.find((p) => p.part === 'headphones-band')!;
  assert.ok(Math.max(...band.line!.filter(([x]) => Math.abs(x) < 51).map(([, y]) => y)) < -134 - 4, 'the band passes over the crown, above the brows');
  for (const p of phones) assert.ok(!shapeHits(p, eyes), p.part);
  // they draw, on both grounds, and are part of the look
  for (const ground of ['paper', DARK(draw)]) {
    draw.scope('hd-', ground);
    for (const kind of ['peaked', 'headphones']) assert.match(cast.critter(0, 0, { body: 'ink', outfit: { head: { kind } } }), /data-outfit="head"/);
  }
  assert.notEqual(cast.lookKey({ outfit: { head: { kind: 'peaked' } } }), cast.lookKey({ outfit: { head: { kind: 'headphones' } } }));
});

test('no arm pose puts a forearm or hand over the mouth or eyes, except cover (hands to the face)', async () => {
  const { cast } = await kit();
  const zones = cast.FACE_KEEPOUT as Box[];
  // The surgeon on 02-outfits-paper.png: the hold pose crossed both forearms over the mouth.
  for (const [name, pose] of Object.entries(cast.ARM_POSES as Record<string, { arms: number[][]; front?: string[] }>)) {
    if (name === 'cover') continue;
    (pose.front ?? []).forEach((side) => {
      const [x0, y0, x1, y1] = pose.arms[side === 'l' ? 0 : 1];
      const cx = (x0 + x1) / 2 + (x1 > 0 ? 8 : -8);
      const cy = (y0 + y1) / 2 - 10;
      const arm: Pt[] = Array.from({ length: 33 }, (_, k) => {
        const t = k / 32;
        return [(1 - t) ** 2 * x0 + 2 * t * (1 - t) * cx + t * t * x1, (1 - t) ** 2 * y0 + 2 * t * (1 - t) * cy + t * t * y1];
      });
      for (const z of zones) {
        assert.ok(!lineHits(arm, 17, z), `${name}: the ${side} arm crosses the ${z.part} keep-out`);
        assert.ok(pointRectDist([x1, y1], z) >= 12.5, `${name}: the ${side} hand is in the ${z.part} keep-out`);
      }
    });
  }
  // the old hold pose is caught
  const old: Pt[] = [[-58, -86], [-49, -84], [-24, -62]];
  assert.ok(lineHits(old, 17, zones[1]) || pointRectDist([-24, -62], zones[1]) < 12.5);
});

test('orange is only the hero\'s body (EX3-139): no item, head or default detail draws it; outfitColors reports what an outfit draws', async () => {
  const { draw, cast } = await kit();
  draw.scope('or-', 'paper');
  const { critter, outfitColors, ITEMS, HEAD_KINDS, TOP_KINDS } = cast;
  const ORANGE = /#FF5E1A|#FF7A3D|#E8541C|#C8430F|#CC4E19/i;
  const base = { top: { kind: 'tee', color: 'blue' } };
  for (const item of ITEMS as string[]) {
    const outfit = { ...base, items: [item] };
    assert.ok(!(outfitColors(outfit) as Set<string>).has('orange'), `${item} defaults to orange`);
    assert.ok(!ORANGE.test(critter(0, 0, { body: 'ink', arms: 'offer', outfit })), `${item} draws an orange hex`);
  }
  for (const kind of HEAD_KINDS as string[]) {
    assert.ok(!(outfitColors({ head: { kind } }) as Set<string>).has('orange'), `head ${kind} defaults to orange`);
    assert.ok(!ORANGE.test(critter(0, 0, { body: 'paper', outfit: { head: { kind } } })), `head ${kind} draws an orange hex`);
  }
  for (const kind of TOP_KINDS as string[]) assert.ok(!ORANGE.test(critter(0, 0, { body: 'ink', outfit: { top: { kind, color: 'teal', pocket: true } } })), `${kind} draws orange details`);
  // what an outfit draws, garments to held items
  const nurse = outfitColors({ top: { kind: 'scrubs', color: 'green' }, shoes: 'paper', items: ['stethoscope', 'badge', 'fob-watch'] }) as Set<string>;
  for (const c of ['green', 'paper', 'ink']) assert.ok(nurse.has(c), `nurse draws ${c}: ${[...nurse]}`);
  assert.ok(!nurse.has('orange') && !nurse.has('steel'), 'metal is not a palette color');
  assert.ok((outfitColors({ top: { kind: 'tee', color: 'blue', trim: 'orange' }, items: ['wristband'] }) as Set<string>).has('orange'), 'a chosen orange trim is reported');
  assert.ok((outfitColors({ items: ['tray'] }) as Set<string>).has('yellow'), 'held items count');
  assert.ok((outfitColors({ items: ['towel'] }) as Set<string>).has('white'), 'arm items count');
  assert.ok((outfitColors({ pants: 'lilac' }) as Set<string>).has('lilac'), 'trousers count');
  const viaCustom = outfitColors({ custom: (ctx: { soft: (p: number[][], c: string) => string }) => ctx.soft([[0, 0], [10, 0], [10, 10]], 'orange') }) as Set<string>;
  assert.deepEqual([...viaCustom], ['orange'], 'a custom garment counts, the tones it is handed do not');
});

test('no outfit can be written as null, undefined, false or "none"', async () => {
  const { draw, cast } = await kit();
  draw.scope('no-', 'paper');
  const { critter, lookKey, outfitShapes, outfitColors } = cast;
  const plain = critter(0, 0, { who: 'a', body: 'ink', mood: 'happy' });
  for (const outfit of [null, undefined, false, 'none']) {
    assert.equal(critter(0, 0, { who: 'a', body: 'ink', mood: 'happy', outfit: outfit as never }), plain, String(outfit));
    assert.equal(lookKey({ body: 'ink', outfit: outfit as never }), 'ink||', String(outfit));
    assert.deepEqual(outfitShapes(outfit as never), []);
    assert.equal((outfitColors(outfit as never) as Set<string>).size, 0);
  }
  assert.throws(() => critter(0, 0, { outfit: 'nurse' }), /outfit must be/);
});
