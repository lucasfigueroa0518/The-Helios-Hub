// Layout breakage checks (Explainers 4.3 visual fixes, 2026-10-28), run by try.mjs on a frame's
// samples ([{ t, svg }]). Pure: the SVG scans are passed in (try.mjs drawnElements, lens.js
// framedBoxes), so these run offline in the tests. Each returns problem strings; try.mjs files them
// as `breakage:<check>` records (fail open: the builder's one fix round, then warnings).
//
//   textOverObjectProblems   a text, label or card over an object (a label pinned on its own object is fine)
//   subjectShareProblems     the shot's subject mostly cropped, or under a minimum share of the frame
//   nearEmptyProblems        a lens shot with too little drawn (a box and a dongle in an empty room)
//   blankOpenProblems        a frame that opens with nothing visible for more than 0.5 s
//   uiCollisionProblems      UI texts overlapping each other, or straddling an icon or button edge
//   setLockProblems          a place's declared dressing missing, or an object coming and going across a cut
//   subjectOcclusionProblems the shot's subject more than 40% hidden by a thing drawn in front of it
//   shotTimingProblems       a shot shorter than 0.8 s, or a cut within 0.5 s of the frame's start or end
//   popInProblems            a thing appearing from nothing within 0.3 s after a cut

const W = 1080;
const H = 1920;
const AREA = W * H;
/** A subject must keep at least this share of its box on screen. */
export const SUBJECT_VISIBLE = 0.5;
/** A subject must cover at least this share of the frame, by shot kind (shots.js SHOT_KINDS): a
 *  wide only needs it recognizable (the place is the point), a medium a fair share, a close or an
 *  insert is about the subject. An unknown kind is held to the medium's. */
export const SUBJECT_MIN_SHARE = { wide: 0.006, medium: 0.03, close: 0.1, insert: 0.1, reaction: 0.1 };
/** The subject may be at most this share hidden by things drawn in front of it. */
export const SUBJECT_OCCLUDED = 0.4;
/** A shot lasts at least this long (s). */
export const MIN_SHOT = 0.8;
/** No cut this close to the frame's start or end (s): the frame boundary is a cut already. */
export const CUT_EDGE = 0.5;
/** Nothing new appears this soon after a cut (s): what the shot shows is there when it opens. */
export const POP_IN = 0.3;
/** A lens shot's things (entities, critters) must cover at least this share of the frame. */
export const MIN_CONTENT = 0.06;
/** A frame may open on nothing for at most this long (s). */
export const BLANK_OPEN = 0.5;

const toArr = (b) => (Array.isArray(b) ? b : [b.x, b.y, b.x + b.w, b.y + b.h]);
const area = (b) => Math.max(0, b[2] - b[0]) * Math.max(0, b[3] - b[1]);
const inter = (a, b) => [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])];
const clip = (b) => inter(b, [0, 0, W, H]);
const at = (t) => (typeof t === 'number' ? ` at ${t.toFixed(2)}s` : '');

function once() {
  const seen = new Set();
  const out = [];
  return { out, say: (key, msg) => !seen.has(key) && seen.add(key) && out.push(msg) };
}

/** The objects of a sample: framed entities (lens) and drawn objects (data-object groups). */
function thingsOf(svg, scan, framed) {
  const out = [];
  for (const b of framed ?? []) if (b.kind === 'entity' && b.who) out.push({ who: b.who, box: b.box });
  // flat objects (objects.js object(), data-object="<id>"): the union of each one's elements
  const ids = new Set([...String(svg).matchAll(/data-object="([^"]+)"/g)].map((m) => m[1]));
  const byKey = new Map();
  for (const e of scan.elements) {
    if (!e.box || e.tag === 'text' || e.opacity < 0.3) continue;
    const key = e.names.find((n) => ids.has(n));
    if (!key) continue;
    const b = toArr(e.box);
    const u = byKey.get(key);
    byKey.set(key, u ? [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])] : b);
  }
  if (!out.length) for (const [who, box] of byKey) out.push({ who, box });
  // a backdrop-sized thing (a desk filling the frame) is ground, not an object a text could cover
  return out.filter((o) => area(clip(o.box)) < AREA * 0.45 && area(clip(o.box)) > 0);
}

/**
 * Texts, labels and cards over objects: a read text (opacity ≥ 0.5, not decor) whose box is more
 * than a quarter covered by an object's box, unless the text belongs to that object (a label pinned
 * on it, a word on its screen); the dictionary or title card over any object.
 * `scanOf(svg)` is try.mjs drawnElements, `framedOf(svg)` lens.js framedBoxes.
 */
export function textOverObjectProblems(samples, { scanOf, framedOf = () => null } = {}) {
  const { out, say } = once();
  for (const { t, svg } of samples ?? []) {
    const s = String(svg);
    const scan = scanOf(s);
    const things = thingsOf(s, scan, framedOf(s));
    if (!things.length) continue;
    // the cards: the union of their elements
    scan.containers.forEach((c, k) => {
      if ((c.kind !== 'definition' && c.kind !== 'title') || !c.box || c.opacity < 0.5) return;
      const cb = toArr(c.box);
      for (const th of things) {
        const ov = area(inter(cb, th.box));
        if (ov > area(cb) * 0.06) say(`card:${k}:${th.who}`, `text: the ${c.kind === 'definition' ? 'dictionary' : 'title'} card sits over "${th.who}"${at(t)}: place it in a clear zone (layout.js clearZone) on its opaque plate`);
      }
    });
    for (const e of scan.elements) {
      if (e.tag !== 'text' || !e.box || e.opacity < 0.5 || e.decor || e.ground) continue;
      if (e.containers.some((k) => ['definition', 'title'].includes(scan.containers[k]?.kind))) continue;
      const tb = toArr(e.box);
      for (const th of things) {
        if (e.names.includes(th.who)) continue; // pinned on its own object
        const ov = area(inter(tb, th.box));
        if (ov > area(tb) * 0.25) say(`text:${e.text}:${th.who}`, `text: "${e.text.slice(0, 40)}" sits over "${th.who}"${at(t)}: move the text to a clear zone, or pin it on its own object`);
      }
    }
  }
  return out;
}

/**
 * The subject of each camera shot (shot.subject, else its cast's first), at the shot's first
 * sample after it settles: at least SUBJECT_VISIBLE of its box on screen, and at least its shot
 * kind's SUBJECT_MIN_SHARE of the frame. A subject too small is answered with another shot kind or
 * angle, never a push-in alone (that forced cramped, occluded closeups on small subjects).
 * `shotAt(t)` gives { i, shot }.
 */
export function subjectShareProblems(samples, { shotAt, framedOf } = {}) {
  const { out, say } = once();
  const firstOf = new Map();
  for (const smp of samples ?? []) {
    const { i, shot } = shotAt(smp.t) ?? {};
    if (!shot) continue;
    const k = firstOf.get(i);
    // the shot's rest: its first sample at least 0.2 s in (a move has begun settling)
    if (!k || (k.t < shot.at + 0.2 && smp.t >= shot.at + 0.2)) firstOf.set(i, { ...smp, shot });
  }
  for (const [i, { t, svg, shot }] of firstOf) {
    const id = shot.subject ?? (Array.isArray(shot.cast) ? shot.cast[0] : null);
    if (!id) continue;
    const boxes = (framedOf(String(svg)) ?? []).filter((b) => b.who === id);
    if (!boxes.length) continue;
    const box = [Math.min(...boxes.map((b) => b.box[0])), Math.min(...boxes.map((b) => b.box[1])), Math.max(...boxes.map((b) => b.box[2])), Math.max(...boxes.map((b) => b.box[3]))];
    const full = area(box);
    const vis = area(clip(box));
    if (!(full > 0)) continue;
    if (vis / full < SUBJECT_VISIBLE) say(`crop:${i}`, `framing: shot ${i + 1}'s subject "${id}" is mostly cropped${at(t)} (${Math.round((vis / full) * 100)}% on screen): pull the camera back until it is mostly in frame`);
    else {
      const kind = SUBJECT_MIN_SHARE[shot.kind] !== undefined ? shot.kind : 'medium';
      const min = SUBJECT_MIN_SHARE[kind];
      if (vis / AREA >= min) continue;
      const fix = kind === 'wide'
        ? 'turn the camera or move it so the subject stands clear and recognizable, or make this a medium on it'
        : `make it a wide if the place is the point, or a ${kind === 'medium' ? 'close or insert' : 'tighter angle'} from a side where nothing stands in front of it`;
      say(`small:${i}`, `framing: shot ${i + 1}'s subject "${id}" covers ${(vis / AREA * 100).toFixed(1)}% of the frame${at(t)}, under a ${kind}'s ${+(min * 100).toFixed(1)}%: ${fix}`);
    }
  }
  return out;
}

/**
 * A lens shot with too little drawn: the union of its things' on-screen boxes (entities and
 * critters, lens.js framedBoxes) under MIN_CONTENT of the frame at the shot's samples.
 */
export function nearEmptyProblems(samples, { shotAt = () => ({ i: 0 }), framedOf } = {}) {
  const { out, say } = once();
  const byShot = new Map();
  for (const { t, svg } of samples ?? []) {
    const boxes = framedOf(String(svg));
    if (!boxes) continue; // not a lens picture
    const things = boxes.filter((b) => b.kind === 'entity' || b.kind === 'critter').map((b) => clip(b.box)).filter((b) => area(b) > 0);
    // a coarse union: a 40 px grid
    const cell = 40;
    const grid = new Set();
    for (const b of things) for (let y = Math.floor(b[1] / cell); y < Math.ceil(b[3] / cell); y++) for (let x = Math.floor(b[0] / cell); x < Math.ceil(b[2] / cell); x++) grid.add(y * 100 + x);
    const share = (grid.size * cell * cell) / AREA;
    const i = shotAt(t)?.i ?? 0;
    const cur = byShot.get(i);
    if (!cur || share > cur.share) byShot.set(i, { share, t });
  }
  for (const [i, { share, t }] of byShot) if (share < MIN_CONTENT) say(`empty:${i}`, `framing: shot ${i + 1} is near empty (its things cover ${(share * 100).toFixed(1)}% of the frame, by ${t.toFixed(2)}s): frame the place's set so the shot reads full`);
  return out;
}

/**
 * A frame that opens on nothing: no read text and no drawn thing (a non-ground, non-decor element
 * of at least 0.5% of the frame and under 60%, opacity ≥ 0.3) in every sample up to BLANK_OPEN s,
 * in a frame that shows something later.
 */
export function blankOpenProblems(samples, { scanOf } = {}) {
  const early = (samples ?? []).filter((s) => s.t <= BLANK_OPEN + 1e-6);
  if (!early.length || early[early.length - 1].t < BLANK_OPEN - 0.11) return [];
  const shows = ({ svg }) => {
    const scan = scanOf(String(svg));
    return scan.elements.some((e) => {
      if (!e.box || e.ground || e.decor || e.opacity < 0.3) return false;
      if (e.tag === 'text') return e.opacity >= 0.5;
      const a = area(clip(toArr(e.box)));
      return a >= AREA * 0.005 && a <= AREA * 0.6;
    });
  };
  if (early.some(shows)) return [];
  // a frame that never shows anything is not an opening problem (the empty and draw checks say so)
  const later = (samples ?? []).filter((s) => s.t > BLANK_OPEN + 1e-6);
  if (!later.some(shows)) return [];
  return [`open: the frame shows nothing for its first ${BLANK_OPEN}s (a blank glow): open on the subject, or the card with its first words`];
}

/**
 * UI collisions in glass and mechanism pictures: two different read texts whose boxes overlap, or
 * a text that straddles the edge of an icon or button (a rect, circle or ellipse in the same UI:
 * more than 10% of the text inside it and less than 90%). Space them with layout.js row()/column().
 */
export function uiCollisionProblems(samples, { scanOf } = {}) {
  const { out, say } = once();
  for (const { t, svg } of samples ?? []) {
    const scan = scanOf(String(svg));
    const ui = scan.elements.filter((e) => e.box && e.ui?.length && !e.decor && !e.ground && e.opacity >= 0.5);
    const texts = ui.filter((e) => e.tag === 'text');
    const shapes = ui.filter((e) => ['rect', 'circle', 'ellipse'].includes(e.tag) && area(toArr(e.box)) < AREA * 0.05 && area(toArr(e.box)) > 200);
    for (let i = 0; i < texts.length; i++) {
      const a = toArr(texts[i].box);
      for (let j = i + 1; j < texts.length; j++) {
        if (texts[j].text === texts[i].text) continue;
        const b = toArr(texts[j].box);
        const ov = area(inter(a, b));
        if (ov > Math.min(area(a), area(b)) * 0.15) say(`tt:${texts[i].text}:${texts[j].text}`, `ui: "${texts[i].text.slice(0, 30)}" and "${texts[j].text.slice(0, 30)}" overlap${at(t)}: space them with layout.js row()/column() (MIN_GAP)`);
      }
      for (const sh of shapes) {
        const ov = area(inter(a, toArr(sh.box))) / (area(a) || 1);
        if (ov > 0.1 && ov < 0.9) say(`ts:${texts[i].text}:${sh.ui.join('/')}`, `ui: "${texts[i].text.slice(0, 30)}" runs into an icon or button edge (${sh.ui[sh.ui.length - 1]})${at(t)}: space them with layout.js row()/column() (MIN_GAP)`);
      }
    }
  }
  return out;
}

// ── The locked set (setlock.js) ─────────────────────────────────────────────────────────────

/** The dressing ids drawn in an SVG (data-dressing). */
export function drawnDressing(svg) {
  return new Set([...String(svg).matchAll(/data-dressing="([^"]+)"/g)].map((m) => m[1]));
}
/** The entity ids drawn in an SVG (data-frame-who of entities, and data-key of objects). */
export function drawnThings(svg) {
  const s = String(svg);
  const ids = new Set();
  for (const m of s.matchAll(/data-frame-kind="entity"[^>]*data-frame-who="([^"]+)"/g)) ids.add(m[1]);
  for (const m of s.matchAll(/data-frame-who="([^"]+)"[^>]*data-frame-kind="entity"/g)) ids.add(m[1]);
  return ids;
}

/**
 * The set-lock problems of one frame's samples ({ t, svg }): `placeAt(t)` gives the place of the
 * shot at t ('main' by default), `shotAt(t)` its index, `dressing` the world's DRESSING, `story`
 * the ids allowed to come and go (critters, the cast's story objects). A declared dressing object
 * missing from a sample of its place, or an undeclared thing present in one shot and gone in the
 * next shot of the same place (or the other way round), is a problem.
 */
export function setLockProblems(samples, { placeAt = () => 'main', shotAt = () => 0, dressing = {}, story = [] } = {}) {
  const out = [];
  const seen = new Set();
  const say = (m) => !seen.has(m) && seen.add(m) && out.push(m);
  const storySet = new Set(story);
  const shots = new Map(); // shot index → { place, ids }
  for (const { t, svg } of samples ?? []) {
    const place = placeAt(t) ?? 'main';
    const declared = (Array.isArray(dressing?.[place]) ? dressing[place] : []).map((d) => d.id);
    const drawn = drawnDressing(svg);
    if (declared.length) {
      for (const id of declared) if (!drawn.has(id)) say(`set: "${id}" is ${place}'s set dressing (world.js DRESSING) but is not drawn at ${t.toFixed(2)}s: draw the place's dressing with dressedItems(world, '${place}', P, R, …) in every shot of it`);
    }
    const k = shotAt(t);
    const cur = shots.get(k) ?? { place, ids: new Set(), first: t };
    for (const id of drawnThings(svg)) if (!declared.includes(id) && !storySet.has(id) && !id.startsWith('critter')) cur.ids.add(id);
    shots.set(k, cur);
  }
  const order = [...shots.keys()].sort((a, b) => a - b);
  for (let i = 1; i < order.length; i++) {
    const a = shots.get(order[i - 1]);
    const b = shots.get(order[i]);
    if (a.place !== b.place) continue;
    for (const id of a.ids) if (!b.ids.has(id)) say(`set: "${id}" is in shot ${order[i - 1] + 1} of ${a.place} and gone in shot ${order[i] + 1}: a set object is declared once in DRESSING and drawn in every shot; a story object leaves on screen`);
    for (const id of b.ids) if (!a.ids.has(id)) say(`set: "${id}" appears in shot ${order[i] + 1} of ${b.place} but not in shot ${order[i - 1] + 1}: declare it in DRESSING (drawn in every shot), or bring it in on screen`);
  }
  return out;
}

// ── Occlusion, shot timing, pop-in (2026-10-28) ─────────────────────────────────────────────

/** The union of `boxes` inside `box`, as a share of `box` (a 20 px grid). */
function coveredShare(box, boxes) {
  const cell = 20;
  let all = 0;
  let hit = 0;
  for (let y = box[1] + cell / 2; y < box[3]; y += cell) {
    for (let x = box[0] + cell / 2; x < box[2]; x += cell) {
      all++;
      if (boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) hit++;
    }
  }
  return all ? hit / all : 0;
}

/**
 * The shot's subject (shot.subject, else its cast's first) hidden by things drawn in front of it:
 * a critter or entity box (lens.js framedBoxes) later in the paint order than the subject and no
 * farther from the lens covering more than SUBJECT_OCCLUDED of the subject's on-screen box, at
 * any sample once the shot settles (0.2 s in). Names the occluder that hides the most.
 */
export function subjectOcclusionProblems(samples, { shotAt, framedOf } = {}) {
  const { out, say } = once();
  for (const { t, svg } of samples ?? []) {
    const { i, shot } = shotAt(t) ?? {};
    if (!shot || t < (shot.at ?? 0) + 0.2) continue;
    const id = shot.subject ?? (Array.isArray(shot.cast) ? shot.cast[0] : null);
    if (!id) continue;
    const boxes = (framedOf(String(svg)) ?? []).filter((b) => b.kind === 'entity' || b.kind === 'critter');
    const k = boxes.findIndex((b) => b.who === id);
    if (k < 0) continue;
    const sub = boxes[k];
    const sb = clip(sub.box);
    if (!(area(sb) > 0)) continue;
    const front = boxes.slice(k + 1).filter((b) => b.who !== id && !(Number.isFinite(b.depth) && Number.isFinite(sub.depth) && b.depth > sub.depth + 1));
    if (!front.length) continue;
    const share = coveredShare(sb, front.map((b) => b.box));
    if (share <= SUBJECT_OCCLUDED) continue;
    const worst = front.map((b) => ({ who: b.who, s: coveredShare(sb, [b.box]) })).sort((a, b) => b.s - a.s)[0];
    say(`occ:${i}`, `occlusion: shot ${i + 1}'s subject "${id}" is ${Math.round(share * 100)}% hidden behind "${worst.who}"${at(t)}: move the camera to an angle where "${worst.who}" does not stand between it and the lens, move "${worst.who}" aside, or pick a shot kind that frames "${id}" clear of it`);
  }
  return out;
}

/**
 * A frame's shot list timing: every shot at least MIN_SHOT long, and no cut within CUT_EDGE of
 * the frame's start or end (the boundary is already a cut; a cut beside it reads as a flash).
 */
export function shotTimingProblems(shots, duration) {
  const out = [];
  if (!Array.isArray(shots) || shots.length < 2 || !(duration > 0)) return out;
  for (let k = 0; k < shots.length; k++) {
    const a = Number(shots[k]?.at) || 0;
    const b = k + 1 < shots.length ? Number(shots[k + 1]?.at) : duration;
    if (!Number.isFinite(b)) continue;
    if (b - a < MIN_SHOT - 1e-6) out.push(`shots: shot ${k + 1} lasts ${(b - a).toFixed(2)}s (${a.toFixed(2)}–${b.toFixed(2)}s), under ${MIN_SHOT}s: merge it into a neighbour or move the cut to a later word`);
    if (k === 0) continue;
    if (a < CUT_EDGE - 1e-6) out.push(`shots: shot ${k + 1}'s cut at ${a.toFixed(2)}s is within ${CUT_EDGE}s of the frame's start: open the frame on that shot, or cut on a later word`);
    else if (a > duration - CUT_EDGE + 1e-6) out.push(`shots: shot ${k + 1}'s cut at ${a.toFixed(2)}s is within ${CUT_EDGE}s of the frame's end (${duration.toFixed(2)}s): drop it, or cut on an earlier word`);
  }
  return out;
}

/**
 * Pop-in after a cut: a critter or entity (lens.js framedBoxes) absent from the first sample at or
 * after a cut that appears in a sample within POP_IN of it. What a shot shows is there when it
 * opens, or comes in on screen later. `shots` the frame's shot list.
 */
export function popInProblems(samples, { shots, framedOf } = {}) {
  const { out, say } = once();
  if (!Array.isArray(shots)) return out;
  const whoAt = (svg) => new Set((framedOf(String(svg)) ?? []).filter((b) => (b.kind === 'entity' || b.kind === 'critter') && b.who && area(clip(b.box)) > 0).map((b) => b.who));
  for (let k = 1; k < shots.length; k++) {
    const cut = Number(shots[k]?.at);
    if (!Number.isFinite(cut)) continue;
    const win = (samples ?? []).filter((s) => s.t >= cut - 1e-6 && s.t < cut + POP_IN - 1e-6);
    if (win.length < 2) continue;
    const first = whoAt(win[0].svg);
    for (const s of win.slice(1)) for (const who of whoAt(s.svg)) if (!first.has(who)) say(`pop:${k}:${who}`, `pop_in: "${who}" appears ${(s.t - cut).toFixed(2)}s after shot ${k + 1}'s cut at ${cut.toFixed(2)}s: have it in the shot from the cut, or bring it in on screen after ${POP_IN}s`);
  }
  return out;
}

/** Anything shown stays on screen at least this long (s): a thing glimpsed for less reads as a glitch. */
export const MIN_DWELL = 1.2;

/** The things a sample shows, with how visible each is: lens things (data-frame-who) and flat objects (data-key), each at the opacity of the nearest wrapping group before it. */
export function shownThings(svg) {
  const s = String(svg);
  const out = new Map();
  for (const m of s.matchAll(/data-(?:frame-who|key)="([^"@]+)[^"]*"/g)) {
    const before = s.slice(Math.max(0, m.index - 800), m.index);
    const ops = [...before.matchAll(/<g [^>]*opacity="([0-9.]+)"/g)];
    const op = ops.length ? Number(ops[ops.length - 1][1]) : 1;
    out.set(m[1], Math.max(out.get(m[1]) ?? 0, op));
  }
  return out;
}

/**
 * Brief appearances: a thing (critter, entity or flat object) that is on screen (opacity ≥ 0.3) for
 * under MIN_DWELL in total, while not on screen at the frame's end (where it may carry across the
 * frame cut). A glimpse at the frame's start counts: nothing carries in from before a cut. A glimpse of something, then nothing, reads as a broken picture.
 */
export function briefThingProblems(samples) {
  const { out, say } = once();
  const list = (samples ?? []).filter((s) => typeof s.t === 'number');
  if (list.length < 3) return out;
  const step = list.length > 1 ? list[1].t - list[0].t : 0.1;
  const seen = new Map();
  list.forEach((s, i) => {
    for (const [who, op] of shownThings(s.svg)) {
      if (op < 0.3) continue;
      const e = seen.get(who) ?? { n: 0, first: s.t, last: s.t, edge: false };
      e.n += 1;
      e.last = s.t;
      if (i === list.length - 1) e.edge = true;
      seen.set(who, e);
    }
  });
  for (const [who, e] of seen) {
    const dwell = e.n * step;
    if (!e.edge && dwell < MIN_DWELL - 1e-6) say(`brief:${who}`, `brief: "${who}" is on screen for only ${dwell.toFixed(1)}s (${e.first.toFixed(2)}–${e.last.toFixed(2)}s): a glimpse reads as a glitch. Hold it at least ${MIN_DWELL}s (its first look included, before any change into something else), or leave it out`);
  }
  return out;
}

/** A frame may show content under MIN_CONTENT of its area for at most this long (s). */
export const SPARSE_HOLD = 1;

/**
 * How much of the frame a sample's content covers (0..1): in a lens picture its things (entities
 * and critters, lens.js framedBoxes); in a flat picture every shown piece (opacity ≥ 0.3, not
 * ground or decor, under 60% of the frame) and read text. A coarse union on a 40 px grid.
 */
export function contentShare(svg, { scanOf, framedOf = () => null } = {}) {
  const s = String(svg);
  const framed = framedOf(s);
  let boxes;
  if (framed) boxes = framed.filter((b) => b.kind === 'entity' || b.kind === 'critter').map((b) => b.box);
  else {
    boxes = scanOf(s).elements
      .filter((e) => e.box && !e.ground && !e.decor && e.opacity >= 0.3)
      .map((e) => toArr(e.box))
      .filter((b) => area(clip(b)) <= AREA * 0.6);
  }
  const cell = 40;
  const grid = new Set();
  for (const b0 of boxes) {
    const b = clip(b0);
    if (area(b) <= 0) continue;
    for (let y = Math.floor(b[1] / cell); y < Math.ceil(b[3] / cell); y++) for (let x = Math.floor(b[0] / cell); x < Math.ceil(b[2] / cell); x++) grid.add(y * 100 + x);
  }
  return (grid.size * cell * cell) / AREA;
}

/**
 * A sparse frame, sustained: content (contentShare) under MIN_CONTENT of the frame for more than
 * SPARSE_HOLD seconds in a row (a lone small object on an empty ground). One instant is not a
 * problem; a run of samples is.
 */
export function sparseProblems(samples, { scanOf, framedOf = () => null } = {}) {
  const list = samples ?? [];
  let from = null;
  let last = null;
  let worst = 1;
  for (const { t, svg } of list) {
    const share = contentShare(svg, { scanOf, framedOf });
    if (share < MIN_CONTENT) {
      if (from === null) from = t;
      last = t;
      worst = Math.min(worst, share);
      if (last - from > SPARSE_HOLD + 1e-6) {
        return [`fill: content covers under ${MIN_CONTENT * 100}% of the frame from ${from.toFixed(2)}s for more than ${SPARSE_HOLD}s (down to ${(worst * 100).toFixed(1)}%): the subject covers about 25–50% of the frame; bring the camera in or show what it acts on`];
      }
    } else {
      from = null;
      worst = 1;
    }
  }
  return [];
}

/** Shot kinds that are a close look (a close must show a relationship). */
export const CLOSE_KINDS = ['close', 'insert'];

/**
 * A close or insert whose drawn cast is one text or label alone (a lone score pill): through the
 * whole shot exactly one thing (entity or critter) is in frame and it is drawn only as text on its
 * plate. A close shows two related things, or the subject and what it acts on.
 */
export function loneCloseProblems(samples, { shotAt = () => ({ i: 0, shot: null }), framedOf = () => null, scanOf } = {}) {
  const per = new Map(); // shot index → { lone: bool, who, t }
  for (const { t, svg } of samples ?? []) {
    const { i, shot } = shotAt(t) ?? {};
    if (!shot || !CLOSE_KINDS.includes(shot.kind)) continue;
    const s = String(svg);
    const framed = framedOf(s);
    if (!framed) continue;
    const on = framed.filter((b) => (b.kind === 'entity' || b.kind === 'critter') && area(clip(b.box)) > 0);
    const whos = [...new Set(on.map((b) => b.who))];
    const cur = per.get(i) ?? { lone: true, who: null, t };
    if (whos.length !== 1) cur.lone = false;
    else {
      const who = whos[0];
      const mine = scanOf(s).elements.filter((e) => e.box && e.opacity >= 0.3 && e.names.includes(who));
      const texts = mine.filter((e) => e.tag === 'text' || e.hand);
      const inside = (b, p) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
      const centre = (e) => { const b = toArr(e.box); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; };
      const labelOnly = texts.length > 0 && mine.every((e) => texts.includes(e) || texts.some((x) => inside(toArr(e.box), centre(x))));
      if (!labelOnly || (cur.who && cur.who !== who)) cur.lone = false;
      cur.who = who;
    }
    per.set(i, cur);
  }
  const out = [];
  for (const [i, c] of per) {
    if (c.lone && c.who) out.push(`close: shot ${i + 1} (from ${c.t.toFixed(2)}s) shows "${c.who}" alone, only a label: a close shows two related things, or the subject and what it acts on`);
  }
  return out;
}
