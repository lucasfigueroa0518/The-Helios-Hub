// Try the world and the frames before the reel is assembled, with no browser (EX3-52).
//
//   node assets/kit/try.mjs world          imports assets/world/world.js
//   node assets/kit/try.mjs frame <id>     runs assets/frames/<id>.js draw(t) across the frame's
//                                          STORYBOARD.md duration
//   node assets/kit/try.mjs all            the world (when present) and every frame module
//
// Each frame also needs its sound events (assets/frames/<id>.events.json, EX3-63); frame 3 must
// draw the dictionary card (cards.js dictionaryCard(), data-role="definition", EX3-14/80); a frame
// 1 that is not the bank's opener draws the title card itself (cards.js titleCard(),
// data-role="title", EX3-61/79). Every scene
// frame longer than 6s exports its `shots` (shots.js), and they must pass validateShots (EX3-83).
// When the job chose an opener from the bank (EX3-102, every job now), frame 1 is the bank's: it
// ends on the title card with the term, and the worker's part is the hook, 01-hook.js: it must
// export its critter (`hero`, through its lens or on the page), hide it on `hideHero`, and draw no
// title card (the opener does).
// Every critter carries its world id
// (critter({ who }), data-who), so the cast is checked (EX3-90): no critter drawn twice at one
// moment, and none that vanishes mid-frame and comes back (a shot is a camera, never an edit).
// Every critter's look (body and outfit, or an exact-match wear; data-look) matches world.js's CAST in every frame,
// the hook's hero is CAST's one orange critter, and a critter outside CAST (frames 3, 6 and 7) is
// never orange and never copies the hero (EX3-107). The hero shows only in the analogy's frames
// (1, 4, 5 and a frame-7 callback): frames 2, 3 and 6 never draw it (EX3-132). In an object-led reel (assets/opener.json says
// "hero": "object", EX3-111) the hook follows its focal object and exports no critter hero.
// `try.mjs props` checks the scene's own new drawings (assets/world/new-props.js and
// assets/frames/*.props.js, NEW_PROPS, EX3-114): each draws in every state and carries full tags.
// The world check (hx-4, VISUAL_SYSTEM_4.md) also holds world.js's SIZES and DRAWN to the scale
// ledger (every entity's real size in cm, drawn true to it next to the critter, exaggeration at most
// 1.5×; space.js scaleProblems when the kit has it) and every CAST outfit to cast.js's kinds
// (normalizeOutfit), clear of the face (FACE_KEEPOUT) and never orange. Grounds are paper, stage and
// white; the retired night and forest are read as stage.
//
// Explainers 4.1 (recipe/principles.md). A job is 4.1 when assets/kit/VERSION says 4.1 (the worker
// writes it when it prepares the job); there the checks below are errors, and in an older job they
// are `warnings` that never fail the try. The world: SET (set.js setBriefProblems), its ROOM builds
// that set (setProblems), and assets/world/identity.js loads. The scene frames (1's hook, 4, 5, and 7
// when its storyboard block says `anchor: scene`): the cut grammar, depth of field by intent, the
// per-shot cast, labels on their entities (shots.js cutProblems, dofProblems, crowdProblems,
// labelProblems), the built set (setProblems) and no face cut by a nearer set piece
// (faceCutProblems). The tech frames (2, 3, 6, and 7 with `anchor:
// own`): the `// technique: <id> — <reason>` header (explain.js TECHNIQUES), every concept as
// identity.js draws it (identityProblems), no empty container (emptyShellProblems), read text at
// least READ_MIN and inside the safe area (safeProblems). Every frame: each drawn critter's rig
// (cast.js riggedProblems, written by critter() as data-rig). A check whose kit function is missing
// in a 4.1 job is reported, never silently skipped.
//
// Prints JSON { ok, errors[] } and exits 1 on any error; an older job's 4.1 warnings go to stderr
// (tryPart returns them as `warnings`). Freehand ink is stubbed here (the browser
// loads it from the CDN), so strokes look plain in this check; everything else is the real code.

import * as nodeModule from 'node:module';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { HOOK_ID, isBankOpener, projectFrames } from './frames.mjs';
import { storyboardHeroKind } from './openers/bank.js';
import { eventProblems } from './sound.mjs';

/** Frames whose pictures are scenes (not the dictionary card or the logo): they cut between shots. */
const SHOT_FRAMES = [1, 2, 4, 5, 6, 7];

const CDN = 'https://cdn.jsdelivr.net/npm/perfect-freehand';
const STUB = 'data:text/javascript,stub-perfect-freehand';
const STUB_SOURCE = 'export const getStroke = (points) => points.map((p) => [p[0], p[1]]);';
// module.registerHooks needs Node 22.15 or later; say so plainly instead of failing on the CDN import.
if (typeof nodeModule.registerHooks !== 'function') {
  console.log(JSON.stringify({ ok: false, errors: [`try.mjs needs Node 22.15 or later (this is ${process.version})`] }, null, 1));
  process.exit(1);
}
nodeModule.registerHooks({
  resolve: (spec, ctx, next) => (spec.startsWith(CDN) ? { url: STUB, format: 'module', shortCircuit: true } : next(spec, ctx)),
  load: (url, ctx, next) => (url === STUB ? { format: 'module', source: STUB_SOURCE, shortCircuit: true } : next(url, ctx)),
});

const BAD_OUTPUT = [['NaN', /NaN/], ['undefined', /\bundefined\b/], ['[object Object]', /\[object Object\]/], ['Infinity', /Infinity/]];

// ── Explainers 4.1: which job, which frame kind ────────────────────────────────────────────

/**
 * The kit generation this job was prepared with: the first line of assets/kit/VERSION (the worker's
 * prepareWorkspace writes "4.1"), or "legacy" when there is none. HELIOS_KIT_VERSION overrides it
 * (tests, and a by-hand try of an old job against the new rules).
 */
export function kitVersion() {
  if (process.env.HELIOS_KIT_VERSION) return process.env.HELIOS_KIT_VERSION.trim();
  try {
    return readFileSync(new URL('./VERSION', import.meta.url), 'utf8').split('\n')[0].trim() || 'legacy';
  } catch {
    return 'legacy';
  }
}

/** True when `version` is 4.1 or later: the 4.1 checks are errors. */
export function isStrict41(version = kitVersion()) {
  const m = /^(\d+)\.(\d+)/.exec(String(version));
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj > 4 || (maj === 4 && min >= 1);
}

/** The 4.1 problems of this try run in an older job: printed, never failing the try. */
const WARNINGS = [];
/** 4.1 problems: errors in a 4.1 job, warnings in an older one. */
function gate41(errors, problems) {
  if (!problems?.length) return;
  if (isStrict41()) errors.push(...problems);
  else WARNINGS.push(...problems);
}

/** The analogy world's frames and the real tech's (principles.md §6); frame 7 is either. */
export const SCENE_FRAMES = [1, 4, 5];
export const TECH_FRAMES = [2, 3, 6];

/**
 * A frame's kind, 'scene' or 'tech' (null for the close). Frame 7 is a scene frame when its
 * storyboard block says `anchor: scene` (a callback to the analogy world) and a tech frame when it
 * says `anchor: own` (built in glass); with neither, the module decides: a technique header or an
 * import of glass.js or explain.js makes it tech.
 */
export function frameKind(entry, source = '') {
  const n = entry?.number;
  if (SCENE_FRAMES.includes(n)) return 'scene';
  if (TECH_FRAMES.includes(n)) return 'tech';
  if (n !== 7) return null;
  const anchor = String(entry?.fields?.anchor ?? '').trim().toLowerCase();
  if (anchor === 'scene') return 'scene';
  if (anchor === 'own') return 'tech';
  const head = String(source).split('\n').slice(0, 12).join('\n');
  return /^\s*\/\/\s*technique:/m.test(head) || /\/(glass|explain)\.js['"]/.test(String(source)) ? 'tech' : 'scene';
}

/** What each rig code means to the worker (cast.js RIG_DRAWN_CODES). */
const RIG_SAYS = {
  faceless: 'its face does not draw (a mouth or brows the rig does not know)',
  'unknown-mood': 'its mood is not one the rig knows',
  'unknown-view': "its view is not one the rig knows (front, three-quarter or back, with side for the last two)",
  'hand-over-eyes': 'a hand covers its eyes',
  'hand-on-mouth': 'a hand covers its mouth',
  'arm-across-face': 'an arm crosses its face',
  'hand-above-mouth': 'a hand is in front of the body above the mouth line (no reach or point targets it there)',
  'prop-on-face': 'a held prop covers its face',
};

/**
 * Drawn critters whose pose breaks the rig: critter() writes cast.js riggedProblems' codes as
 * data-rig on the critter's group. Reported once per critter and code.
 */
export function rigProblems(samples) {
  const out = [];
  const seen = new Set();
  for (const { t, svg } of samples) {
    for (const m of String(svg).matchAll(/<g\b[^>]*\bdata-who="([^"]+)"[^>]*>/g)) {
      const rig = /\bdata-rig="([^"]*)"/.exec(m[0])?.[1];
      if (!rig) continue;
      for (const code of rig.split(/\s+/).filter(Boolean)) {
        const key = `${m[1]}:${code}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(`the critter "${m[1]}" at ${t.toFixed(2)}s: ${RIG_SAYS[code] ?? code} (cast.js riggedProblems; pose it by intent with act(), hold props with hold or gripAt())`);
      }
    }
  }
  return out;
}

/**
 * The set a frame shows across its samples (set.js setMetaFromSvg of each sample, merged): the
 * most walls, corners and openings any sample shows, every layer and tell seen, the most dressing,
 * and the largest share of the frame any ceiling takes.
 * Null when no sample draws a set.
 */
export function unionSetMeta(samples, setKit) {
  let out = null;
  const surfaces = new Map();
  for (const { svg } of samples) {
    if (!/data-set-(part|layer)=/.test(String(svg))) continue;
    const m = setKit.setMetaFromSvg(String(svg));
    if (!out) {
      out = { ...m, openings: [...m.openings], layers: { ...m.layers }, tells: [...m.tells], surfaces: [] };
    } else {
      out.walls = Math.max(out.walls, m.walls);
      out.corners = Math.max(out.corners, m.corners);
      if (m.openings.length > out.openings.length) out.openings = [...m.openings];
      out.floor = out.floor || m.floor;
      for (const k of Object.keys(m.layers)) out.layers[k] = Math.max(out.layers[k] ?? 0, m.layers[k]);
      for (const tell of m.tells) if (!out.tells.includes(tell)) out.tells.push(tell);
      out.dressing = Math.max(out.dressing ?? 0, m.dressing ?? 0);
      out.beyond = Math.max(out.beyond ?? 0, m.beyond ?? 0);
      out.orange = out.orange || m.orange;
      // the worst ceiling any sample shows (set.js CEILING_MAX_SHARE is per frame of video)
      if (m.ceiling && !(out.ceiling && out.ceiling.share >= m.ceiling.share)) out.ceiling = { ...m.ceiling };
    }
    for (const s of m.surfaces ?? []) surfaces.set(`${s.part}|${s.mat}|${s.area}`, s);
  }
  if (out) out.surfaces = [...surfaces.values()];
  return out;
}

// ── Read text in a tech frame: size and the safe area, without a browser ─────────────────────

const IDENTITY_M = [1, 0, 0, 1, 0, 0];
const mulM = (A, B) => [
  A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
  A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
  A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
];
const applyM = (M, [x, y]) => [M[0] * x + M[2] * y + M[4], M[1] * x + M[3] * y + M[5]];

/** An SVG transform attribute as a matrix [a, b, c, d, e, f] (translate, scale, rotate, matrix, skew). */
export function parseTransform(str) {
  let M = IDENTITY_M;
  for (const m of String(str ?? '').matchAll(/(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g)) {
    const a = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const rad = ((a[0] ?? 0) * Math.PI) / 180;
    let T = IDENTITY_M;
    if (m[1] === 'matrix' && a.length === 6) T = a;
    else if (m[1] === 'translate') T = [1, 0, 0, 1, a[0] ?? 0, a[1] ?? 0];
    else if (m[1] === 'scale') T = [a[0] ?? 1, 0, 0, a[1] ?? a[0] ?? 1, 0, 0];
    else if (m[1] === 'rotate') {
      const [cx, cy] = [a[1] ?? 0, a[2] ?? 0];
      T = mulM(mulM([1, 0, 0, 1, cx, cy], [Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0]), [1, 0, 0, 1, -cx, -cy]);
    } else if (m[1] === 'skewX') T = [1, 0, Math.tan(rad), 1, 0, 0];
    else if (m[1] === 'skewY') T = [1, Math.tan(rad), 0, 1, 0, 0];
    M = mulM(M, T);
  }
  return M;
}

/** Elements whose children are never drawn where they stand. */
const NOT_DRAWN = new Set(['defs', 'clipPath', 'mask', 'symbol', 'pattern', 'marker', 'filter', 'linearGradient', 'radialGradient']);
const attr = (attrs, name) => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs)?.[1];
const unescapeXml = (s) => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&');

/**
 * The words of a <text> body that are shown, and how shown: words fade in through
 * `<tspan opacity>` (cards.js textLine), so a word under half opacity is not there yet.
 * { text: the shown words, k: the strongest word's opacity (1 with no tspans) }.
 */
function shownText(body) {
  const spans = [...String(body).matchAll(/<tspan\b([^>]*)>([\s\S]*?)<\/tspan>/g)];
  if (!spans.length) return { text: unescapeXml(body).trim(), k: 1 };
  let k = 0;
  const words = [];
  for (const [, attrs, inner] of spans) {
    const o = attr(attrs, 'opacity') ?? attr(attrs, 'fill-opacity');
    const op = o !== undefined && Number.isFinite(Number(o)) ? Number(o) : 1;
    k = Math.max(k, op);
    if (op >= 0.5) words.push(unescapeXml(inner));
  }
  return { text: words.join('').trim(), k };
}

/**
 * Every drawn <text> in an SVG string, on the 1080x1920 page: { text, size (px, after every
 * transform), box { x, y, w, h }, opacity (with its groups'), decor, card } — `card` when it is in
 * the title or dictionary card (code's, sized by cards.js). `measure(text, size, face)` gives a
 * line's width (glass.js measure); without it a width is estimated.
 */
/** @param {string} svg @param {((text: string, size: number, face: string) => number) | null} [measure] */
export function drawnTexts(svg, measure = null) {
  const s = String(svg);
  const out = [];
  const stack = [{ M: IDENTITY_M, op: 1, card: false, decor: false, hidden: false }];
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*?)(\/?)>/g;
  let m;
  while ((m = re.exec(s))) {
    const [, close, tag, attrs, self] = m;
    const top = stack[stack.length - 1];
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    if (tag === 'text') {
      const end = s.indexOf('</text>', re.lastIndex);
      const body = self ? '' : s.slice(re.lastIndex, end < 0 ? s.length : end);
      if (!self && end >= 0) re.lastIndex = end + '</text>'.length;
      const shown = shownText(body);
      const text = shown.text;
      if (!text || top.hidden) continue;
      const fs0 = Number(attr(attrs, 'font-size'));
      if (!(fs0 > 0)) continue;
      const M = mulM(top.M, parseTransform(attr(attrs, 'transform')));
      const k = Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2]));
      const family = attr(attrs, 'font-family') ?? '';
      const face = /pragmatica/i.test(family) ? 'pragmatica-700' : `roboto-${attr(attrs, 'font-weight') ?? '400'}`;
      let w;
      try {
        w = measure ? measure(text, fs0, face) : null;
      } catch {
        w = null;
      }
      if (!(w > 0)) w = fs0 * (face.startsWith('pragmatica') ? 0.72 : 0.55) * [...text].length;
      const x = Number(attr(attrs, 'x')?.split(/[\s,]+/)[0] ?? 0) || 0;
      const y = Number(attr(attrs, 'y')?.split(/[\s,]+/)[0] ?? 0) || 0;
      const anchor = attr(attrs, 'text-anchor') ?? 'start';
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      const corners = [[x0, y - fs0 * 0.8], [x0 + w, y - fs0 * 0.8], [x0, y + fs0 * 0.2], [x0 + w, y + fs0 * 0.2]].map((p) => applyM(M, p));
      const xs = corners.map((p) => p[0]);
      const ys = corners.map((p) => p[1]);
      const op = top.op * (attr(attrs, 'opacity') !== undefined ? Number(attr(attrs, 'opacity')) : 1) * shown.k;
      out.push({
        text,
        size: fs0 * k,
        box: { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) },
        opacity: op,
        decor: top.decor || attr(attrs, 'data-decor') !== undefined,
        card: top.card,
      });
      continue;
    }
    if (self) continue;
    const op = attr(attrs, 'opacity');
    const role = attr(attrs, 'data-role');
    stack.push({
      M: mulM(top.M, parseTransform(attr(attrs, 'transform'))),
      op: top.op * (op !== undefined && Number.isFinite(Number(op)) ? Number(op) : 1),
      card: top.card || role === 'title' || role === 'definition',
      decor: top.decor || attr(attrs, 'data-decor') !== undefined,
      hidden: top.hidden || NOT_DRAWN.has(tag) || attr(attrs, 'display') === 'none' || attr(attrs, 'visibility') === 'hidden',
    });
  }
  return out;
}

// ── Every drawn element, with its containers (empty containers, the fill check) ──────────────

/** A path's points (absolute and relative commands; curve control points included), for a bounding box. */
function pathPoints(d) {
  const pts = [];
  const toks = String(d ?? '').match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  let cmd = '';
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  const num = () => Number(toks[i++]);
  const ARGS = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const lc = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const n = ARGS[lc];
    if (n === undefined) break;
    if (n === 0) {
      cx = sx;
      cy = sy;
      if (i < toks.length && !/[a-zA-Z]/.test(toks[i])) i++; // stray number after z
      continue;
    }
    if (i + n > toks.length) break;
    const a = Array.from({ length: n }, num);
    if (a.some((v) => !Number.isFinite(v))) break;
    const ox = rel ? cx : 0;
    const oy = rel ? cy : 0;
    if (lc === 'h') cx = a[0] + (rel ? cx : 0);
    else if (lc === 'v') cy = a[0] + (rel ? cy : 0);
    else if (lc === 'a') {
      cx = a[5] + ox;
      cy = a[6] + oy;
    } else {
      for (let k = 0; k + 1 < n - 2; k += 2) pts.push([a[k] + ox, a[k + 1] + oy]);
      cx = a[n - 2] + ox;
      cy = a[n - 1] + oy;
    }
    pts.push([cx, cy]);
    if (lc === 'm') {
      sx = cx;
      sy = cy;
      cmd = rel ? 'l' : 'L';
    }
  }
  return pts;
}

/** The local points of one drawn shape element (rect, circle, ellipse, line, poly, path, image, use). */
function shapePoints(tag, attrs) {
  const n = (k, d = 0) => {
    const v = Number(attr(attrs, k));
    return Number.isFinite(v) ? v : d;
  };
  if (tag === 'rect' || tag === 'image' || tag === 'use' || tag === 'foreignObject') {
    const [x, y, w, h] = [n('x'), n('y'), n('width', NaN), n('height', NaN)];
    return Number.isFinite(w) && Number.isFinite(h) ? [[x, y], [x + w, y + h], [x + w, y], [x, y + h]] : [];
  }
  if (tag === 'circle') return [[n('cx') - n('r'), n('cy') - n('r')], [n('cx') + n('r'), n('cy') + n('r')]];
  if (tag === 'ellipse') return [[n('cx') - n('rx'), n('cy') - n('ry')], [n('cx') + n('rx'), n('cy') + n('ry')]];
  if (tag === 'line') return [[n('x1'), n('y1')], [n('x2'), n('y2')]];
  if (tag === 'polygon' || tag === 'polyline') {
    const v = (attr(attrs, 'points')?.match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(Number);
    const out = [];
    for (let k = 0; k + 1 < v.length; k += 2) out.push([v[k], v[k + 1]]);
    return out;
  }
  if (tag === 'path') return pathPoints(attr(attrs, 'd'));
  return [];
}

const SHAPE_TAGS = new Set(['rect', 'circle', 'ellipse', 'line', 'polygon', 'polyline', 'path', 'image', 'use', 'foreignObject']);

/** What kind of container a group is: a phone, the definition or title card, a glass card or bubble, an explain.js shell. */
function containerKind(tag, attrs) {
  if (tag !== 'g') return null;
  const ui = attr(attrs, 'data-ui');
  const role = attr(attrs, 'data-role');
  if (role === 'definition' || role === 'title') return role;
  if (ui === 'phone' || ui === 'card' || ui === 'bubble') return ui;
  if (attr(attrs, 'data-shell') === '1') return 'shell';
  return null;
}

/**
 * Every drawn element of an SVG string on the 1080x1920 page, and the containers it sits in:
 * { elements: [{ tag, text?, size?, box, opacity, decor, ui[], kind, containers: number[], shape? }],
 *   containers: [{ kind, opacity, filled?, screen?, box }] }. Boxes are screen boxes after every
 * transform (a curve's control points count, so a box can be a little large). Elements in defs,
 * masks, clip paths and hidden groups are left out.
 */
/** @param {string} svg @param {((text: string, size: number, face: string) => number) | null} [measure] */
export function drawnElements(svg, measure = null) {
  const s = String(svg);
  const elements = [];
  const containers = [];
  const stack = [{ M: IDENTITY_M, op: 1, decor: false, hidden: false, cards: [], ui: [], ground: false }];
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b([^>]*?)(\/?)>/g;
  const boxOf = (M, pts) => {
    if (!pts.length) return null;
    const ps = pts.map((p) => applyM(M, p));
    const xs = ps.map((p) => p[0]);
    const ys = ps.map((p) => p[1]);
    return { x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
  };
  let m;
  while ((m = re.exec(s))) {
    const [, close, tag, attrs, self] = m;
    const top = stack[stack.length - 1];
    if (close) {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const opAttr = attr(attrs, 'opacity');
    const op = top.op * (opAttr !== undefined && Number.isFinite(Number(opAttr)) ? Number(opAttr) : 1);
    const M = mulM(top.M, parseTransform(attr(attrs, 'transform')));
    const hidden = top.hidden || NOT_DRAWN.has(tag) || attr(attrs, 'display') === 'none' || attr(attrs, 'visibility') === 'hidden';
    if (tag === 'text') {
      const end = s.indexOf('</text>', re.lastIndex);
      const body = self ? '' : s.slice(re.lastIndex, end < 0 ? s.length : end);
      if (!self && end >= 0) re.lastIndex = end + '</text>'.length;
      const shown = shownText(body);
      const text = shown.text;
      const fs0 = Number(attr(attrs, 'font-size'));
      if (!text || hidden || !(fs0 > 0)) continue;
      const family = attr(attrs, 'font-family') ?? '';
      const face = /pragmatica/i.test(family) ? 'pragmatica-700' : `roboto-${attr(attrs, 'font-weight') ?? '400'}`;
      let w;
      try {
        w = measure ? measure(text, fs0, face) : null;
      } catch {
        w = null;
      }
      if (!(w > 0)) w = fs0 * (face.startsWith('pragmatica') ? 0.72 : 0.55) * [...text].length;
      const x = Number(attr(attrs, 'x')?.split(/[\s,]+/)[0] ?? 0) || 0;
      const y = Number(attr(attrs, 'y')?.split(/[\s,]+/)[0] ?? 0) || 0;
      const anchor = attr(attrs, 'text-anchor') ?? 'start';
      const x0 = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
      elements.push({
        tag, text, size: fs0 * Math.sqrt(Math.abs(M[0] * M[3] - M[1] * M[2])),
        box: boxOf(M, [[x0, y - fs0 * 0.8], [x0 + w, y + fs0 * 0.2]]),
        opacity: op * shown.k, decor: top.decor || attr(attrs, 'data-decor') !== undefined, ui: top.ui, ground: top.ground,
        containers: top.cards, shape: false,
      });
      continue;
    }
    if (SHAPE_TAGS.has(tag) && !hidden) {
      const box = boxOf(M, shapePoints(tag, attrs));
      if (box) elements.push({ tag, box, opacity: op, decor: top.decor, ui: top.ui, ground: top.ground, containers: top.cards, shape: attr(attrs, 'data-k') === 'shape' });
    }
    if (self) continue;
    const kind = hidden ? null : containerKind(tag, attrs);
    let cards = top.cards;
    if (kind) {
      containers.push({ kind, opacity: op, filled: attr(attrs, 'data-filled') === '1' });
      cards = [...top.cards, containers.length - 1];
    }
    const ui = attr(attrs, 'data-ui');
    stack.push({
      M,
      op,
      decor: top.decor || attr(attrs, 'data-decor') !== undefined,
      hidden,
      cards,
      ui: ui ? [...top.ui, ui] : top.ui,
      ground: top.ground || ui === 'ground',
    });
  }
  // a container's box is its elements' union; a phone's screen is its data-k="shape" rect
  containers.forEach((c, k) => {
    const mine = elements.filter((e) => e.containers.includes(k));
    if (c.kind === 'phone') c.screen = mine.find((e) => e.shape && e.tag === 'rect')?.box ?? null;
    const bs = mine.map((e) => e.box).filter(Boolean);
    c.box = bs.length ? { x: Math.min(...bs.map((b) => b.x)), y: Math.min(...bs.map((b) => b.y)), w: Math.max(...bs.map((b) => b.x + b.w)) - Math.min(...bs.map((b) => b.x)), h: Math.max(...bs.map((b) => b.y + b.h)) - Math.min(...bs.map((b) => b.y)) } : null;
  });
  return { elements, containers };
}

/**
 * Whether container k has content: a phone shows text, or a mark of at least 1% of its screen, on
 * the screen below the status and header strip (not its own screen, shadows, sheen or hairlines); a card, bubble or the definition or
 * title card shows text; an explain.js shell says data-filled="1".
 */
function containerFilled(scan, k) {
  const c = scan.containers[k];
  if (c.kind === 'shell') return c.filled;
  const op0 = Math.max(1e-6, c.opacity);
  const mine = scan.elements.filter((e) => e.containers.includes(k) && e.opacity / op0 >= 0.3);
  if (c.kind === 'phone') {
    const sc = c.screen;
    if (!sc) return true; // not a glass.js phone we can read
    const area = sc.w * sc.h;
    return mine.some((e) => {
      if (e.shape || !e.box) return false;
      const a = e.box.w * e.box.h;
      const cx = e.box.x + e.box.w / 2;
      const cy = e.box.y + e.box.h / 2;
      // real content: text, or a mark of at least 1% of the screen (a spinner sliver or a hairline is not)
      if (a > area * 0.6 || (e.tag !== 'text' && (Math.min(e.box.w, e.box.h) < 4 || a < area * 0.01))) return false;
      // on the screen (its chrome, shadows and sheen are larger or reach past it), below the status strip
      const inside = e.box.x >= sc.x - 2 && e.box.x + e.box.w <= sc.x + sc.w + 2 && e.box.y >= sc.y - 2 && e.box.y + e.box.h <= sc.y + sc.h + 2;
      return inside && cx > sc.x && cy > sc.y + sc.h * 0.2;
    });
  }
  return mine.some((e) => e.tag === 'text' && e.opacity / op0 >= 0.5);
}

/** The longest a container may show with nothing in it (principles.md §6: "nothing empty"). */
export const EMPTY_MAX = 0.3;

/**
 * Containers shown empty (principles.md §6, "A container appears with its content, never seconds
 * before it"): a phone with a blank screen, a card or bubble with no text, the definition card
 * before its first word, an explain.js shell with no content, visible (opacity ≥ 0.5) and empty
 * for more than EMPTY_MAX seconds. Containers are matched across samples by kind and order.
 * `scanOf(svg)` is drawnElements (passed in so a caller can share a measure).
 */
export function emptyContainerProblems(samples, scanOf = drawnElements) {
  const out = [];
  const open = new Map(); // key → t it was first seen empty
  const reported = new Set();
  const NAME = { phone: 'a phone with a blank screen', card: 'a card with no text', bubble: 'a bubble with no text', definition: 'the dictionary card with no words', title: 'the title card with no words', shell: 'an empty container' };
  const report = (key, from, to) => {
    if (to - from <= EMPTY_MAX + 1e-6 || reported.has(key)) return;
    reported.add(key);
    const kind = key.split('#')[0];
    out.push(`${NAME[kind] ?? kind} shows from ${from.toFixed(2)}s to ${to.toFixed(2)}s: a container appears together with its first content (draw it when its content arrives${kind === 'definition' ? ', or start the definition the moment the card lands' : ''})`);
  };
  let lastT = 0;
  for (const { t, svg } of samples) {
    lastT = t;
    const scan = scanOf(String(svg));
    const ord = new Map();
    const now = new Set();
    scan.containers.forEach((c, k) => {
      const n = ord.get(c.kind) ?? 0;
      ord.set(c.kind, n + 1);
      const key = `${c.kind}#${n}`;
      if (c.opacity < 0.5 || containerFilled(scan, k)) return;
      now.add(key);
      if (!open.has(key)) open.set(key, t);
    });
    for (const [key, from] of open) {
      if (now.has(key)) continue;
      report(key, from, t);
      open.delete(key);
    }
  }
  for (const [key, from] of open) report(key, from, lastT);
  return out;
}

// ── The tech-frame fill check (principles.md §6) ────────────────────────────────────────────

/**
 * The thresholds, calibrated on the Phase 1 tech frames Lucas approved (cache, routing, git branch,
 * MCP: coverage 0.21–0.40, thirds ≥ 0.10, 10–13 readable texts, every one with a value or a build-up
 * that changes) against the round-1 rehearsal tech frames (blank phones, a few icons in a sea of
 * paper: coverage down to 0.10, empty bands down to 0.00, 1–5 readable texts).
 */
export const FILL = { cell: 20, maxPiece: 0.05, coverage: 0.18, third: 0.08, texts: 6, grow: 3 };

/**
 * How much of the safe area a drawing's content covers: a grid of FILL.cell px cells, marked by
 * every shown piece (opacity ≥ 0.3) that is text or a mark of at most FILL.maxPiece of the safe
 * area — so a ground, a glass panel, a glow or a phone's own body (its frame, screen, shadows)
 * never counts, while what is on a screen does. Returns { coverage, thirds: [top, middle, bottom],
 * texts: the readable texts (≥ 30 px, not decoration) }.
 */
/** @param {string} svg @param {{ safe?: { x0: number, x1: number, y0: number, y1: number }, measure?: ((text: string, size: number, face: string) => number) | null }} [o] */
export function contentFill(svg, { safe = { x0: 96, x1: 940, y0: 570, y1: 1600 }, measure = null } = {}) {
  const scan = drawnElements(svg, measure);
  const nx = Math.ceil((safe.x1 - safe.x0) / FILL.cell);
  const ny = Math.ceil((safe.y1 - safe.y0) / FILL.cell);
  const grid = new Uint8Array(nx * ny);
  const safeA = (safe.x1 - safe.x0) * (safe.y1 - safe.y0);
  const onScreen = (e) => {
    const k = e.containers.find((kk) => scan.containers[kk].kind === 'phone');
    if (k === undefined) return true;
    const sc = scan.containers[k].screen;
    return !!sc && !e.shape && e.box.x >= sc.x - 2 && e.box.x + e.box.w <= sc.x + sc.w + 2 && e.box.y >= sc.y + sc.h * 0.2 && e.box.y + e.box.h <= sc.y + sc.h + 2 && e.box.w * e.box.h < sc.w * sc.h * 0.6;
  };
  const texts = new Set();
  for (const e of scan.elements) {
    if (!e.box || e.opacity < 0.3 || e.ground) continue;
    if (e.tag === 'text' && e.opacity >= 0.5 && !e.decor && e.size >= 30) texts.add(e.text);
    if (e.box.w * e.box.h >= safeA * FILL.maxPiece || (e.tag !== 'text' && Math.min(e.box.w, e.box.h) < 4) || !onScreen(e)) continue;
    const x0 = Math.max(0, Math.floor((e.box.x - safe.x0) / FILL.cell));
    const x1 = Math.min(nx, Math.ceil((e.box.x + e.box.w - safe.x0) / FILL.cell));
    const y0 = Math.max(0, Math.floor((e.box.y - safe.y0) / FILL.cell));
    const y1 = Math.min(ny, Math.ceil((e.box.y + e.box.h - safe.y0) / FILL.cell));
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) grid[y * nx + x] = 1;
  }
  const share = (ya, yb) => {
    let n = 0;
    let c = 0;
    for (let y = ya; y < yb; y++) for (let x = 0; x < nx; x++) { n++; c += grid[y * nx + x]; }
    return n ? c / n : 0;
  };
  return { coverage: share(0, ny), thirds: [0, 1, 2].map((j) => share(Math.floor((j * ny) / 3), Math.floor(((j + 1) * ny) / 3))), texts: [...texts] };
}

/**
 * What changes across a frame (principles.md §6, "a measured outcome that changes on screen"):
 * { values: the places where a number changes (a timer, a counter, a cost: every value there is a
 * number or a placeholder dash), states: how many different data-state sets (a step tracker, a
 * card state), grew: readable texts at the end minus at a fifth of the frame (commits landing,
 * results filling in) }.
 */
/** @param {Array<{ t: number, svg: string }>} samples @param {((text: string, size: number, face: string) => number) | null} [measure] */
export function valueChanges(samples, measure = null) {
  const clusters = [];
  const states = new Set();
  const readable = (svg) => new Set(drawnElements(svg, measure).elements.filter((e) => e.tag === 'text' && e.opacity >= 0.5 && !e.decor && e.size >= 30).map((e) => e.text)).size;
  for (const { svg } of samples) {
    for (const e of drawnElements(String(svg), measure).elements) {
      if (e.tag !== 'text' || e.opacity < 0.5 || !e.box) continue;
      const cx = e.box.x + e.box.w / 2;
      const cy = e.box.y + e.box.h / 2;
      let c = clusters.find((k) => Math.hypot(k.x - cx, k.y - cy) < 60);
      if (!c) clusters.push((c = { x: cx, y: cy, vals: new Set() }));
      c.vals.add(e.text);
    }
    states.add([...String(svg).matchAll(/data-state="([^"]+)"/g)].map((m) => m[1]).join(','));
  }
  const numeric = (v) => /\d/.test(v) || /^[\s—–-]+$/.test(v);
  const grew = samples.length ? readable(String(samples[samples.length - 1].svg)) - readable(String(samples[Math.floor(samples.length * 0.2)].svg)) : 0;
  return { values: clusters.filter((c) => c.vals.size >= 2 && [...c.vals].every(numeric)).length, states: states.size, grew };
}

/**
 * A tech frame's fill (principles.md §6; Phase 2 round 2): at its held end state the content
 * covers FILL.coverage of the safe area, no third of it is empty (FILL.third), and at least
 * FILL.texts readable texts carry real content; and (frames 2, 6 and a glass 7, not the definition
 * beat) something changes on screen: a number, a state, or content that builds up (FILL.grow).
 * `end` is the held end's SVG.
 */
/** @param {Array<{ t: number, svg: string }>} samples @param {string} end @param {{ frameNumber?: number, measure?: ((text: string, size: number, face: string) => number) | null }} [o] */
export function techFillProblems(samples, end, { frameNumber, measure = null } = {}) {
  const out = [];
  const fill = contentFill(String(end), { measure });
  const pct = (v) => `${Math.round(v * 100)}%`;
  if (fill.coverage < FILL.coverage) out.push(`at its held end the content covers ${pct(fill.coverage)} of the safe area (at least ${pct(FILL.coverage)}): fill the frame with the mechanism and real content, not a few icons on paper`);
  const names = ['top', 'middle', 'bottom'];
  fill.thirds.forEach((v, j) => { if (v < FILL.third) out.push(`at its held end the ${names[j]} third of the safe area is empty (${pct(v)} covered, at least ${pct(FILL.third)}): use the whole frame`); });
  if (fill.texts.length < FILL.texts) out.push(`at its held end ${fill.texts.length} readable text(s) (at least ${FILL.texts}): show real content (a named file, a real request, the numbers that change), not a blank device or a lone icon`);
  if (frameNumber !== 3) {
    const ch = valueChanges(samples, measure);
    if (ch.values < 1 && ch.states < 2 && ch.grew < FILL.grow) out.push('nothing changes value or state over the frame: show a measured outcome changing on screen (a timer, a counter, a cost, a step state) or the mechanism building up step by step');
  }
  return out;
}

/**
 * A tech frame's read text (principles.md §6, "Readable on a phone"): every drawn, fully shown
 * text that is not decoration and not code's title or dictionary card is at least `readMin` px
 * and, while it is at rest and on the frame, stays inside the safe area (explain.js safeProblems):
 * a text moving across the edge, or pushed off the frame altogether by a crop shot, is not
 * flagged (frame.md). Reported once per text.
 */
/** @param {Array<{ t: number, svg: string }>} samples @param {{ readMin?: number, safeProblems?: ((boxes: Array<{ name: string, box: { x: number, y: number, w: number, h: number } }>) => string[]) | null, measure?: ((text: string, size: number, face: string) => number) | null }} [o] */
export function readTextProblems(samples, { readMin = 34, safeProblems = null, measure = null } = {}) {
  const out = [];
  const seen = new Set();
  const all = samples.map(({ t, svg }) => ({ t, texts: drawnTexts(svg, measure) }));
  // where the same text stands in a neighbouring sample (a moving text is matched by its words)
  const near = (k, x) => [all[k - 1], all[k + 1]].filter(Boolean).map((s) => s.texts.filter((y) => y.text === x.text).sort((a, b) => Math.hypot(a.box.x - x.box.x, a.box.y - x.box.y) - Math.hypot(b.box.x - x.box.x, b.box.y - x.box.y))[0]).filter(Boolean);
  all.forEach(({ t, texts }, k) => {
    for (const x of texts) {
      if (x.card || x.opacity < 0.95) continue;
      const name = `the text "${x.text.length > 40 ? `${x.text.slice(0, 40)}…` : x.text}"`;
      if (!x.decor && x.size < readMin * 0.95 && !seen.has(`size:${x.text}`)) {
        seen.add(`size:${x.text}`);
        out.push(`${name} is ${Math.round(x.size)}px at ${t.toFixed(2)}s: read text is at least ${readMin}px on a phone (explain.js READ_MIN)`);
      }
      if (typeof safeProblems !== 'function' || seen.has(`safe:${x.text}`)) continue;
      // off the frame altogether (a crop shot pushed it out): not on screen, so not read
      const b = x.box;
      if (b.x >= 1080 || b.x + b.w <= 0 || b.y >= 1920 || b.y + b.h <= 0) continue;
      // crossing the edge while it moves (frame.md): only a text at rest must stay in the safe area
      if (near(k, x).some((y) => Math.hypot(y.box.x - b.x, y.box.y - b.y) > 3)) continue;
      const p = safeProblems([{ name, box: b }]);
      if (p.length) {
        seen.add(`safe:${x.text}`);
        out.push(`${p[0]} at ${t.toFixed(2)}s`);
      }
    }
  });
  return out;
}

/** Concepts drawn in a frame (data-concept) that the identity map does not have, or drawn another way. */
export function identityMapProblems(samples, defs, identityProblems) {
  const out = [];
  const known = new Set(Object.keys(defs ?? {}));
  const unknown = new Set();
  for (const { svg } of samples) for (const m of String(svg).matchAll(/data-concept="([^"]+)"/g)) if (!known.has(m[1])) unknown.add(m[1]);
  for (const id of unknown) out.push(`the concept "${id}" is not in assets/world/identity.js: every concept is drawn through the reel's identity map (one icon, colour and shape)`);
  if (typeof identityProblems === 'function') {
    const declared = Object.values(defs ?? {}).map((d) => ({ id: d.id, icon: d.icon, color: d.color, shape: d.shape }));
    out.push(...identityProblems([...declared, ...samples.map((s) => String(s.svg))]).map((p) => `${p} (identity.js says how it looks)`));
  }
  return out;
}

/** Problems with one frame's SVG string. */
export function frameProblems(svg) {
  if (typeof svg !== 'string') return [`draw(t) returned ${svg === null ? 'null' : typeof svg}, not an SVG string`];
  if (!svg.trim()) return ['draw(t) returned an empty string'];
  const out = BAD_OUTPUT.filter(([, re]) => re.test(svg)).map(([name]) => `the SVG contains "${name}" (a value went missing or was not a number)`);
  const opens = (svg.match(/<[a-zA-Z]/g) ?? []).length;
  const closes = (svg.match(/<\/|\/>/g) ?? []).length;
  if (opens !== closes) out.push(`unbalanced tags: ${opens} opened, ${closes} closed`);
  return out;
}

/**
 * The cast problems in a frame's samples ([{ t, svg }], in time order): a critter id drawn more
 * than once at one moment, or one that disappears for VANISH seconds or more and comes back.
 * `castAt(t)` (4.1 camera shots) gives the active shot's cast, or null when the shot shows
 * everything: a critter outside that cast is not drawn on purpose, so only time missing while it
 * is in the shot's cast counts (a group id "patients" covers "patients-2").
 */
/** @param {Array<{ t: number, svg: string }>} samples @param {((t: number) => string[] | null) | null} [castAt] */
export function castProblems(samples, castAt = null) {
  const errors = [];
  const twice = new Set();
  const seen = new Map(); // id → { missing: seconds missing while in the shot's cast, gapFrom: when }
  const reported = new Set();
  const inCast = (cast, who) => !Array.isArray(cast) || cast.includes(who) || cast.includes(who.replace(/-\d+$/, ''));
  for (let k = 0; k < samples.length; k++) {
    const { t, svg } = samples[k];
    const dt = k + 1 < samples.length ? samples[k + 1].t - t : 0;
    const cast = typeof castAt === 'function' ? castAt(t) : null;
    const counts = new Map();
    for (const m of String(svg).matchAll(/data-who="([^"]+)"/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
    for (const [who, n] of counts) {
      if (n > 1 && !twice.has(who)) {
        twice.add(who);
        errors.push(`the critter "${who}" is drawn ${n} times at ${t.toFixed(2)}s: draw each critter once (a shot never adds a copy, EX3-90)`);
      }
    }
    for (const [who, s] of seen) {
      if (counts.has(who) || !inCast(cast, who)) continue;
      if (s.gapFrom == null) s.gapFrom = t;
      s.missing += dt;
    }
    for (const who of counts.keys()) {
      const s = seen.get(who);
      if (s && s.gapFrom != null && s.missing >= VANISH - 1e-9 && !reported.has(who)) {
        reported.add(who);
        errors.push(`the critter "${who}" vanishes at ${s.gapFrom.toFixed(2)}s and comes back at ${t.toFixed(2)}s: keep drawing it while it is in the shot's cast (a shot is a camera, never an edit of the scene, EX3-90)`);
      }
      seen.set(who, { missing: 0, gapFrom: null });
    }
  }
  return errors;
}

/** The grounds (hx-4): paper, stage, white; night and forest are old names for stage. */
export const GROUND_NAMES = ['paper', 'stage', 'white'];
export const GROUND_ALIASES = { night: 'stage', forest: 'stage' };
/** A ground name as the kit draws it (an alias resolved), or null when it is no ground. */
export function resolveGround(name) {
  const g = String(name ?? '').trim().toLowerCase();
  const resolved = GROUND_ALIASES[g] ?? g;
  return GROUND_NAMES.includes(resolved) ? resolved : null;
}

/** The critters' world ids and looks in an SVG: [{ who, look }]. */
function drawnCritters(svg) {
  const out = [];
  for (const m of String(svg).matchAll(/<g\b[^>]*\bdata-who="([^"]+)"[^>]*>/g)) {
    out.push({ who: m[1], look: /\bdata-look="([^"]*)"/.exec(m[0])?.[1] ?? null });
  }
  return out;
}

/**
 * Look problems (EX3-107; Lucas, 2026-10-21: "Character looks should be locked across frames"):
 * a CAST critter drawn with another body, wear or wear color; or a critter outside CAST that is
 * orange or wears the hero's look. `cast` is world.js's CAST; `keyOf` is cast.js's lookKey.
 */
export function lookProblems(samples, cast, keyOf) {
  const errors = [];
  const reported = new Set();
  const expected = new Map(Object.entries(cast).map(([id, look]) => [id, keyOf(look)]));
  const hero = Object.entries(cast).find(([, look]) => (look?.body ?? 'ink') === 'orange');
  const heroKey = hero ? keyOf(hero[1]) : null;
  for (const { t, svg } of samples) {
    for (const { who, look } of drawnCritters(svg)) {
      if (look === null || reported.has(who)) continue;
      const id = expected.has(who) ? who : who.replace(/-\d+$/, '');
      if (expected.has(id)) {
        if (look !== expected.get(id)) {
          reported.add(who);
          errors.push(`the critter "${who}" is drawn as ${look} at ${t.toFixed(2)}s, but CAST says ${expected.get(id)}: a critter's body and outfit never change during the reel (EX3-107)`);
        }
      } else if (/^orange\b/.test(look)) {
        reported.add(who);
        errors.push(`the critter "${who}" is orange at ${t.toFixed(2)}s: only the hero is an orange critter (EX3-107)`);
      } else if (heroKey && look === heroKey) {
        reported.add(who);
        errors.push(`the critter "${who}" wears the hero's look (${look}) at ${t.toFixed(2)}s: give it a look of its own (EX3-107)`);
      }
    }
  }
  return errors;
}

/** Frames that never show the hero (EX3-132): the gap, the definition and the example are the real thing. */
export const NO_HERO_FRAMES = [2, 3, 6];

/**
 * The hero in a frame that never shows it (EX3-132; Lucas, 2026-10-25: the hero's orange only in
 * the analogy frames): CAST's orange critter drawn in frames 2, 3 or 6, by its id or by its look.
 */
export function heroFrameProblems(samples, cast, keyOf, frameNumber) {
  if (!NO_HERO_FRAMES.includes(frameNumber)) return [];
  const hero = Object.entries(cast ?? {}).find(([, look]) => look?.body === 'orange');
  if (!hero) return [];
  const [heroId, heroLook] = hero;
  const heroKey = keyOf(heroLook);
  for (const { t, svg } of samples) {
    for (const { who, look } of drawnCritters(svg)) {
      if (who === heroId || who.replace(/-\d+$/, '') === heroId || look === heroKey) {
        return [`the hero "${heroId}" is drawn in frame ${frameNumber} at ${t.toFixed(2)}s (as "${who}"): frames 2, 3 and 6 show the real thing, never the hero; it appears only in frames 1, 4, 5 and a frame-7 callback (EX3-132)`];
      }
    }
  }
  return [];
}

/** Problems with world.js's CAST itself: every critter's look, at most one orange (the hero). */
export function castShapeProblems(cast) {
  if (!cast || typeof cast !== 'object' || Array.isArray(cast)) {
    return ['world.js must export CAST = { <critter id>: { body, outfit } }: every critter\'s look for the whole reel, its outfit drawn for its role (EX3-107, hx-4)'];
  }
  const errors = [];
  for (const [id, look] of Object.entries(cast)) {
    if (!['ink', 'paper', 'orange'].includes(look?.body ?? 'ink')) errors.push(`CAST.${id}.body "${look?.body}" must be ink, paper or orange`);
    if (look?.wear !== undefined && !Array.isArray(look.wear)) errors.push(`CAST.${id}.wear must be a list`);
    if (look?.outfit !== undefined && look.outfit !== null && (typeof look.outfit !== 'object' || Array.isArray(look.outfit))) {
      errors.push(`CAST.${id}.outfit must be an object ({ top, sleeves, pants, shoes, head, items, custom }), or omitted or null for a role with no costume`);
    }
  }
  const orange = Object.entries(cast).filter(([, look]) => look?.body === 'orange').map(([id]) => id);
  if (orange.length > 1) errors.push(`CAST has ${orange.length} orange critters (${orange.join(', ')}): only the hero is orange (EX3-107)`);
  return errors;
}

/** Things worn over the eyes or mouth (EX3-103): never part of an outfit; glasses are the one exception. */
const FACE_COVER = /\b(mask|blindfold|hood|visor|sunglasses|balaclava|veil|goggles|eye-?patch|face-?shield)s?\b/i;

/** A rough bounding box per element of an SVG string, in its own coordinates (transformed elements are skipped). */
export function elementBoxes(svg) {
  const out = [];
  const num = (tag, name) => {
    const m = new RegExp(`\\b${name}="(-?[\\d.]+)"`).exec(tag);
    return m ? Number(m[1]) : null;
  };
  for (const m of String(svg).matchAll(/<(rect|circle|ellipse|line|polygon|polyline|path)\b[^>]*>/g)) {
    const tag = m[0];
    if (/\btransform="/.test(tag)) continue;
    let xs = [];
    let ys = [];
    if (m[1] === 'rect') {
      const [x, y, w, h] = [num(tag, 'x') ?? 0, num(tag, 'y') ?? 0, num(tag, 'width'), num(tag, 'height')];
      if (w === null || h === null) continue;
      xs = [x, x + w];
      ys = [y, y + h];
    } else if (m[1] === 'circle' || m[1] === 'ellipse') {
      const [cx, cy] = [num(tag, 'cx') ?? 0, num(tag, 'cy') ?? 0];
      const rx = num(tag, m[1] === 'circle' ? 'r' : 'rx');
      const ry = num(tag, m[1] === 'circle' ? 'r' : 'ry');
      if (rx === null || ry === null) continue;
      xs = [cx - rx, cx + rx];
      ys = [cy - ry, cy + ry];
    } else if (m[1] === 'line') {
      xs = [num(tag, 'x1') ?? 0, num(tag, 'x2') ?? 0];
      ys = [num(tag, 'y1') ?? 0, num(tag, 'y2') ?? 0];
    } else {
      const raw = m[1] === 'path' ? /\bd="([^"]*)"/.exec(tag)?.[1] : /\bpoints="([^"]*)"/.exec(tag)?.[1];
      if (!raw || (m[1] === 'path' && /[a-y]/.test(raw.replace(/z/g, '')))) continue; // relative or arc commands: skip
      const nums = (raw.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) ?? []).map(Number);
      for (let i = 0; i + 1 < nums.length; i += 2) {
        xs.push(nums[i]);
        ys.push(nums[i + 1]);
      }
      if (!xs.length) continue;
    }
    out.push({ x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) });
  }
  return out;
}

/** The inner SVG of the first `<g …data-outfit="custom"…>` group in an SVG string, or ''. */
function customGroup(svg) {
  const text = String(svg);
  const open = /<g\b[^>]*\bdata-outfit="custom"[^>]*>/.exec(text);
  if (!open) return '';
  let depth = 1;
  const re = /<g\b[^>]*?(\/?)>|<\/g>/g;
  re.lastIndex = open.index + open[0].length;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0] === '</g>') depth -= 1;
    else if (!m[1]) depth += 1;
    if (depth === 0) return text.slice(open.index + open[0].length, m.index);
  }
  return '';
}

/**
 * Outfit problems (hx-4, still 03; EX3-103). `kit` is the kit's cast.js module: every CAST outfit
 * goes through its normalizeOutfit (the kinds, necks, items and colors cast.js draws; its error
 * names the allowed list), nothing in it covers the eyes or mouth, no part of it is orange, and a
 * `custom` garment, drawn on the critter by the kit, gives a clean SVG with no piece mostly inside
 * FACE_KEEPOUT (the kit clips it out of there, so a piece drawn there vanishes: it was a mask).
 * With an older kit (no normalizeOutfit) only the face and orange checks run.
 */
/** @param {any} cast @param {any} [kit] cast.js (its normalizeOutfit, critter and FACE_KEEPOUT), or null */
export function outfitProblems(cast, kit = null) {
  const errors = [];
  for (const [id, look] of Object.entries(cast ?? {})) {
    const raw = look?.outfit;
    if (!raw || typeof raw !== 'object') continue;
    const where = `CAST.${id}.outfit`;
    const named = [raw.top?.kind, typeof raw.head === 'string' ? raw.head : raw.head?.kind, ...[].concat(raw.items ?? [])].filter((x) => typeof x === 'string');
    const covers = named.filter((w) => FACE_COVER.test(w));
    for (const word of covers) errors.push(`${where}: "${word}" covers the eyes or mouth; nothing worn ever does, glasses excepted (EX3-103)`);
    let o = raw;
    if (typeof kit?.normalizeOutfit === 'function') {
      try {
        o = kit.normalizeOutfit(raw);
      } catch (e) {
        if (!covers.length) errors.push(`${where}: ${String(e?.message ?? e).replace(/^HX: /, '')}; a garment or tool the kit does not draw is drawn once with custom`);
        continue;
      }
    }
    const colors = [o.top?.color, o.top?.trim, o.top?.under, typeof o.top?.pocket === 'string' ? o.top.pocket : null, o.sleeves, o.pants, o.shoes, o.head?.kind !== 'none' ? o.head?.color : null];
    if (colors.some((c) => typeof c === 'string' && /^orange/.test(c))) errors.push(`${where} is orange: orange is the hero's body and the focal, never an outfit color`);
    if (raw.custom === undefined || raw.custom === null) continue;
    if (typeof raw.custom !== 'function') {
      errors.push(`${where}.custom must be a function ({ by, fill, tones, keepout, soft, line, el, g }) => SVG`);
      continue;
    }
    if (typeof kit?.critter !== 'function') continue;
    let svg;
    try {
      svg = kit.critter(0, 0, { body: look.body, outfit: raw });
    } catch (e) {
      errors.push(`${where}.custom threw: ${String(e?.message ?? e).replace(/^HX: /, '')}`);
      continue;
    }
    const piece = customGroup(svg);
    for (const p of piece ? frameProblems(piece) : []) errors.push(`${where}.custom: ${p}`);
    const keepout = Array.isArray(kit.FACE_KEEPOUT) ? kit.FACE_KEEPOUT : [];
    for (const b of elementBoxes(piece)) {
      const area = Math.max(0, b.x1 - b.x0) * Math.max(0, b.y1 - b.y0);
      if (area <= 0) continue;
      const over = keepout.reduce((a, k) => a + Math.max(0, Math.min(b.x1, k.x + k.w) - Math.max(b.x0, k.x)) * Math.max(0, Math.min(b.y1, k.y + k.h) - Math.max(b.y0, k.y)), 0);
      if (over / area >= 0.5) {
        const part = keepout.find((k) => b.x1 > k.x && b.x0 < k.x + k.w && b.y1 > k.y && b.y0 < k.y + k.h)?.part ?? 'eyes or mouth';
        errors.push(`${where}.custom draws a piece over the face (the ${part}): nothing worn covers the eyes or mouth, and the kit clips it away (EX3-103)`);
        break;
      }
    }
  }
  return errors;
}

/** Story exaggeration of a real size is capped (hx-4, still 01): at most 1.5× bigger or smaller. */
export const MAX_EXAGGERATE = 1.5;

/**
 * The scale ledger (hx-4, still 01; Lucas, 2026-10-26: sizes were "preposterous"). world.js exports
 * SIZES, `{ <id>: { w, d, h, exaggerate?, far? } }` in cm, with an entry for every ENTITIES id that
 * is not a critter (CAST; a critter is the 72 cm ruler), and DRAWN, the scene at rest as drawn:
 * `{ critterS: <the critters' scale>, <entity id>: <its drawn height in px> }` (or a list of such
 * samples). `space` is the kit's space.js module: its scaleProblems(SIZES, DRAWN) checks every
 * entry and every drawn size against the critter. With an older kit (no space.js) only the ledger's
 * own shape is checked, and only when the world has one. A lens-only world (it exports LENS and
 * no isometric entity drawings) needs no DRAWN: the lens draws every entity from SIZES.
 */
/** @param {any} world @param {{ scaleProblems: (sizes: unknown, drawn: unknown) => string[] } | null} [space] */
export function sizeLedgerProblems(world, space = null) {
  const kit = typeof space?.scaleProblems === 'function';
  const sizes = world?.SIZES;
  if (sizes === undefined) {
    return kit ? ['world.js must export SIZES = { <entity id>: { w, d, h } } in cm: every entity\'s real size, so the scene has one scale (a critter is 72 cm, the ruler; hx-4)'] : [];
  }
  if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)) return ['SIZES must be an object: { <entity id>: { w, d, h } } in cm'];
  const errors = [];
  if (!kit) {
    for (const [id, size] of Object.entries(sizes)) {
      if (!size || typeof size !== 'object' || !['w', 'd', 'h'].every((k) => Number.isFinite(size[k]) && size[k] > 0)) errors.push(`SIZES.${id} must be { w, d, h }: positive numbers, in cm`);
      const e = size?.exaggerate;
      if (e !== undefined && !(Number.isFinite(e) && e <= MAX_EXAGGERATE + 1e-9 && e >= 1 / MAX_EXAGGERATE - 1e-9)) {
        errors.push(`SIZES.${id}.exaggerate is ${e}: at most ${MAX_EXAGGERATE}× (bigger or smaller); show a tiny thing through magnifier() or an insert shot instead`);
      }
    }
  }
  const critters = new Set(Object.keys(world?.CAST ?? {}));
  for (const id of Object.keys(world?.ENTITIES ?? {})) {
    if (!critters.has(id) && !(id in sizes)) errors.push(`SIZES has no entry for the entity "${id}": give it its real size in cm`);
  }
  // A lens-only world (LENS drawings and no isometric entity drawings: every scene frame goes
  // through lens.js, which draws everything from SIZES at its true size) needs no DRAWN.
  const lensOnly = !!world?.LENS && !Object.keys(world?.ENTITIES ?? {}).some((id) => !critters.has(id) && typeof world[id] === 'function');
  if (kit && lensOnly && world.DRAWN === undefined) {
    try {
      errors.push(...[].concat(space.scaleProblems(sizes, []) ?? []).map(String)); // the ledger's own shape
    } catch (e) {
      errors.push(`scaleProblems threw: ${e?.message ?? e}`);
    }
    return errors;
  }
  if (kit) {
    if (world.DRAWN === undefined) {
      errors.push('world.js must export DRAWN = { critterS, <entity id>: <drawn height in px> }: the scene at rest as drawn, so the try can hold every entity to its real size next to the critter (hx-4)');
    }
    try {
      errors.push(...[].concat(space.scaleProblems(sizes, world.DRAWN) ?? []).map(String));
    } catch (e) {
      errors.push(`scaleProblems threw: ${e?.message ?? e}`);
    }
  }
  return errors;
}

/** Kit modules that exist but failed to import: reported, never silently skipped. */
const KIT_IMPORT_ERRORS = new Map();

/** The kit module at ./<name>, or null when this kit has no such file (an older kit). A module
 *  that exists but fails to import is recorded (kitImportProblems) so its checks are never
 *  silently disabled. */
async function kitModule(name) {
  if (!existsSync(new URL(`./${name}`, import.meta.url))) return null;
  try {
    return await import(`./${name}`);
  } catch (e) {
    KIT_IMPORT_ERRORS.set(name, String(e?.message ?? e));
    return null;
  }
}

const KIT_IMPORT_REPORTED = new Set();
/** The kit's import failures as error strings (the checks that module runs did not run), each
 *  reported once per try run. */
export function kitImportProblems() {
  const out = [];
  for (const [name, msg] of KIT_IMPORT_ERRORS) {
    if (KIT_IMPORT_REPORTED.has(name)) continue;
    KIT_IMPORT_REPORTED.add(name);
    out.push(`kit: assets/kit/${name} failed to load (${msg}); the checks it runs did not run`);
  }
  return out;
}

/**
 * The kit functions a 4.1 check calls, or a problem naming the missing one: a renamed or removed
 * check is reported, never silently skipped.
 */
function kitFns(mod, file, names) {
  const missing = names.filter((n) => typeof mod?.[n] !== 'function');
  return missing.length ? { ok: false, problem: `kit: assets/kit/${file} has no ${missing.join(', ')}; the 4.1 check that calls it did not run` } : { ok: true };
}

/** The reel's concept identity map (assets/world/identity.js: explain.js identity()), or { error }. */
export async function loadIdentity(root) {
  const file = join(root, 'assets', 'world', 'identity.js');
  if (!existsSync(file)) return { error: "assets/world/identity.js does not exist: the scene builder writes the reel's concept identity map (`export default identity({ <concept>: { icon, color, shape, label } })`, explain.js)" };
  try {
    const mod = await import(pathToFileURL(file).href);
    const reg = mod.default ?? mod.IDENTITY;
    if (!reg || typeof reg !== 'object' || !reg.defs || typeof reg.defs !== 'object') return { error: 'assets/world/identity.js must `export default identity({ … })` (explain.js identity(): one icon, colour and shape per concept)' };
    return { defs: reg.defs };
  } catch (e) {
    return { error: `assets/world/identity.js failed to load: ${e?.message ?? e}` };
  }
}

/** ROOM's pieces: the set builder's { env, items } (4.1) or an older world's list; null for anything else. */
export function roomPieces(room) {
  if (Array.isArray(room)) return room;
  if (room && typeof room === 'object' && (Array.isArray(room.env) || Array.isArray(room.items))) return [...(room.env ?? []), ...(room.items ?? [])];
  return null;
}
const pieceSvg = (p, P) => (typeof p === 'string' ? p : typeof p?.svg === 'function' ? String(p.svg(P)) : String(p?.svg ?? ''));

/**
 * world.js's ROOM through `view` (the world check's lens) for `place` ('main', or a SETS place):
 * { built, meta } — `built` false for an older world's list; `meta` the set builder's meta, or
 * the meta read from the pieces' SVG.
 */
function roomMeta(mod, lensKit, drawKit, setKit, view, place = 'main') {
  const state = Object.fromEntries(Object.entries(mod.STATES ?? {}).map(([k, v]) => [k, v && typeof v === 'object' && 'start' in v ? v.start : v]));
  drawKit.scope('tw-', 'paper');
  const P = lensKit.lens(view);
  let lights = {};
  try {
    lights = typeof mod.LIGHTS === 'function' ? mod.LIGHTS(state, place) ?? {} : {}; // per-place lights (K13)
  } catch {
    lights = {}; // lensWorldProblems reports it
  }
  const R = lensKit.rig(P, { ground: 'paper', ...lights });
  const room = place === 'main' ? mod.ROOM(P, R, state) : mod.ROOM(P, R, state, place);
  const built = !!room && !Array.isArray(room) && typeof room === 'object';
  if (built && room.meta && typeof room.meta === 'object') return { built, meta: room.meta };
  return { built, meta: setKit.setMetaFromSvg((roomPieces(room) ?? []).map((p) => pieceSvg(p, P)).join('')) };
}

/**
 * The world's 4.1 problems: world.js exports SET (set.js setBriefProblems), its ROOM builds that set
 * with every tell of the brief (setProblems), and assets/world/identity.js loads. A world with no
 * perspective parts (no LENS and no ROOM) is an older world and is only asked for identity.js.
 */
export async function worldProblems41(root, mod) {
  const out = [];
  if (mod?.LENS || mod?.ROOM) {
    const setKit = await kitModule('set.js');
    const need = kitFns(setKit, 'set.js', ['setBriefProblems', 'setProblems']);
    if (!need.ok) out.push(need.problem);
    else if (mod.SET === undefined) out.push('world.js must export SET = { place, tells, architecture, materials, colorStory, layers, beyond, density }: the set brief, written before the set is built (set.js, principles.md §1)');
    else {
      out.push(...setKit.setBriefProblems(mod.SET).map((e) => `SET: ${e}`));
      // the other places the story goes (a trip's destination), each briefed like SET
      const sets = mod.SETS && typeof mod.SETS === 'object' ? mod.SETS : {};
      for (const [place, brief] of Object.entries(sets)) out.push(...setKit.setBriefProblems(brief).map((e) => `SETS.${place}: ${e}`));
      if (typeof mod.ROOM !== 'function') out.push('world.js must export ROOM (P, R, state, place) => setBuilder(P, R, SET)…done(): the set its SET briefs');
      else {
        const lensKit = await kitModule('lens.js');
        const drawKit = await kitModule('draw.js');
        const viewFor = (place) => (Array.isArray(mod.VIEWS) ? mod.VIEWS.find((v) => v?.pos && (v.place ?? 'main') === place) : null) ?? WORLD_CHECK_LENS;
        for (const [place, brief] of [['main', mod.SET], ...Object.entries(sets)]) {
          const where = place === 'main' ? 'set' : `set (${place})`;
          try {
            if (!lensKit || !drawKit) break;
            const { built, meta } = roomMeta(mod, lensKit, drawKit, setKit, viewFor(place), place);
            if (!built) out.push(`${where}: ROOM returns a list of pieces; return the set builder's result (setBuilder(P, R, ${place === 'main' ? 'SET' : `SETS.${place}`})…done()), so render() draws the architecture first and sorts the fixtures with the cast`);
            out.push(...setKit.setProblems(meta, brief).map((e) => `${where}: ${e}`));
          } catch (e) {
            if (place !== 'main') out.push(`${where}: ROOM(P, R, state, '${place}') threw: ${e?.message ?? e}`);
            // the main ROOM's throw is lensWorldProblems'
          }
        }
      }
    }
  }
  const id = await loadIdentity(root);
  if (id.error) out.push(id.error);
  return out;
}

/** world.js's CAST, or null when the project has no world (a frame with its own picture only). */
async function loadCast(root) {
  const file = join(root, 'assets', 'world', 'world.js');
  if (!existsSync(file)) return null;
  try {
    const cast = (await import(pathToFileURL(file).href)).CAST;
    return castShapeProblems(cast).length ? null : cast;
  } catch {
    return null; // tryWorld reports the load error
  }
}

/** No crowds (EX3-117; Lucas, 2026-10-22: "give the viewer one thing to look at at a time"). */
export const MAX_CRITTERS_AT_ONCE = 4;

/** A crowd on screen: more than MAX_CRITTERS_AT_ONCE critters at one moment (reported once per frame). */
export function crowdProblems(samples, visible = null) {
  for (const { t, svg } of samples) {
    // a lens frame counts only the critters its shot shows (visible: lens.js visibleCritters)
    const shown = typeof visible === 'function' ? visible(svg) : null;
    const n = shown ? shown.length : new Set(drawnCritters(svg).map((c) => c.who)).size;
    if (n > MAX_CRITTERS_AT_ONCE) {
      return [`${n} critters on screen at ${t.toFixed(2)}s: at most ${MAX_CRITTERS_AT_ONCE}, never a crowd; give the viewer one thing to look at (EX3-117)`];
    }
  }
  return [];
}

/**
 * Look-alikes on screen (frame.md V-4; rehearsal 2: patients nobody could tell apart): two critters
 * with different world ids and the same look (body and outfit) at one moment. Reported once per pair.
 */
export function twinProblems(samples) {
  const errors = [];
  const seen = new Set();
  for (const { t, svg } of samples) {
    const byLook = new Map();
    for (const { who, look } of drawnCritters(svg)) {
      if (!look) continue;
      const list = byLook.get(look) ?? [];
      if (!list.includes(who)) list.push(who);
      byLook.set(look, list);
    }
    for (const list of byLook.values()) {
      if (list.length < 2) continue;
      const key = [...list].sort().join('+');
      if (seen.has(key)) continue;
      seen.add(key);
      errors.push(`the critters ${list.map((w) => `"${w}"`).join(' and ')} look alike at ${t.toFixed(2)}s: no two critters on screen share a body and an outfit; give each its own outfit in CAST (frame.md V-4)`);
    }
  }
  return errors;
}

/** A critter missing this long and then back has vanished (not a one-sample blink). */
const VANISH = 0.2;

/** Sample times across a frame: every 0.1s, plus the last video frame. */
export const sampleTimes = (duration) => [...Array.from({ length: Math.floor(duration * 10) }, (_, i) => i / 10), Math.max(0, duration - 1 / 30)];

/**
 * Outfit colors (hx-4.1): orange is the hero's and the focal's, so a critter that is not the
 * hero (its CAST body is not orange) draws nothing orange: no garment, no item (held or worn),
 * no custom piece. `kit` is cast.js (outfitColors: the palette names an outfit draws).
 */
export function outfitColorProblems(cast, kit = null) {
  if (typeof kit?.outfitColors !== 'function') return [];
  const errors = [];
  for (const [id, look] of Object.entries(cast ?? {})) {
    if ((look?.body ?? 'ink') === 'orange') continue;
    if (typeof kit.isNoOutfit === 'function' ? kit.isNoOutfit(look?.outfit) : !look?.outfit) continue;
    let colors;
    try {
      colors = kit.outfitColors(look.outfit);
    } catch {
      continue; // outfitProblems names a bad outfit
    }
    if (colors?.has?.('orange')) errors.push(`CAST.${id}.outfit draws orange (a garment or an item): orange is only the hero's and the focal's (EX3-139); give it another palette color`);
  }
  return errors;
}

/** A default lens for the world check: eye level, looking into the room from the front. */
const WORLD_CHECK_LENS = { pos: [0, -600, 110], target: [0, 0, 80], fov: 38 };

/**
 * The perspective parts of world.js (hx-4.1): LIGHTS(state), ROOM(P, R, state) and every
 * LENS.<id>(P, R, state, pose) are called once through a default lens with the STATES' start
 * values, so a world that throws (or returns the wrong shape) is caught at `try world`, not
 * mid-render.
 */
export async function lensWorldProblems(mod) {
  if (!mod?.LENS && !mod?.ROOM && !mod?.LIGHTS) return [];
  const lensKit = await kitModule('lens.js');
  const drawKit = await kitModule('draw.js');
  if (!lensKit || !drawKit) return [];
  const errors = [];
  const state = Object.fromEntries(Object.entries(mod.STATES ?? {}).map(([k, v]) => [k, v && typeof v === 'object' && 'start' in v ? v.start : v]));
  drawKit.scope('tw-', 'paper');
  const P = lensKit.lens(WORLD_CHECK_LENS);
  let lights = {};
  if (mod.LIGHTS !== undefined) {
    if (typeof mod.LIGHTS !== 'function') errors.push('LIGHTS must be a function (state) => ({ dirs, points })');
    else {
      try {
        lights = mod.LIGHTS(state) ?? {};
        if (typeof lights !== 'object' || (lights.dirs && !Array.isArray(lights.dirs)) || (lights.points && !Array.isArray(lights.points))) errors.push('LIGHTS(state) must return { dirs: [...], points: [...] }');
        for (const [k, pl] of (lights.points ?? []).entries()) {
          if (!Array.isArray(pl?.pos) || pl.pos.length !== 3 || !pl.pos.every(Number.isFinite)) errors.push(`LIGHTS(state).points[${k}].pos must be [x, y, z] in cm`);
        }
      } catch (e) {
        errors.push(`LIGHTS(state) threw: ${e?.message ?? e}`);
        lights = {};
      }
    }
  }
  let R;
  try {
    R = lensKit.rig(P, { ground: 'paper', ...lights });
  } catch (e) {
    errors.push(`rig(P, LIGHTS(state)) threw: ${e?.message ?? e}`);
    R = lensKit.rig(P, { ground: 'paper' });
  }
  if (mod.ROOM !== undefined) {
    if (typeof mod.ROOM !== 'function') errors.push('ROOM must be a function (P, R, state) => [ ...pieces ]');
    else {
      try {
        // 4.1: setBuilder(P, R, SET)…done() = { env, items, meta, … }; an older world: a list of pieces
        const room = mod.ROOM(P, R, state);
        const pieces = roomPieces(room);
        if (!pieces) errors.push('ROOM(P, R, state) must return the set builder\'s result (setBuilder(P, R, SET)…done(): { env, items, meta }) or, in an older world, a list of pieces');
        else for (const piece of pieces) for (const p of frameProblems(pieceSvg(piece, P))) errors.push(`ROOM: ${p}`);
      } catch (e) {
        errors.push(`ROOM(P, R, state) threw: ${e?.message ?? e}`);
      }
    }
  }
  for (const [id, entity] of Object.entries(mod.LENS ?? {})) {
    if (typeof entity !== 'function') {
      errors.push(`LENS.${id} must be a function (P, R, state, pose) => ({ at, svg })`);
      continue;
    }
    try {
      const it = entity(P, R, state, {});
      // off stage until the narration needs it: an empty drawing is fine
      if (it === '' || it === null || it === undefined || (typeof it === 'object' && it.svg === '')) continue;
      if (typeof it.svg !== 'string' || !Array.isArray(it.at) || it.at.length !== 3 || !it.at.every(Number.isFinite)) errors.push(`LENS.${id}(P, R, state, pose) must return { at: [x, y, z], svg } (at: the world point that stands for it, in cm)`);
      else for (const p of frameProblems(it.svg)) errors.push(`LENS.${id}: ${p}`);
    } catch (e) {
      errors.push(`LENS.${id}(P, R, state, pose) threw: ${e?.message ?? e}`);
    }
  }
  return errors;
}

async function tryWorld(root) {
  const file = join(root, 'assets', 'world', 'world.js');
  if (!existsSync(file)) return ['assets/world/world.js does not exist'];
  try {
    const mod = await import(pathToFileURL(file).href);
    if (!Object.keys(mod).length) return ['world.js exports nothing'];
    const errors = castShapeProblems(mod.CAST);
    if (!errors.length) errors.push(...outfitProblems(mod.CAST, await kitModule('cast.js')));
    errors.push(...sizeLedgerProblems(mod, await kitModule('space.js')));
    errors.push(...outfitColorProblems(mod.CAST, await kitModule('cast.js')));
    errors.push(...(await lensWorldProblems(mod)));
    gate41(errors, await worldProblems41(root, mod));
    errors.push(...kitImportProblems());
    return errors;
  } catch (e) {
    return [`world.js failed to load: ${e?.message ?? e}`];
  }
}

/**
 * The hook's hero kind (EX3-111): assets/opener.json's `hero` (the worker and pace write it), else
 * the storyboard's (`- hero: <id> — object | critter` in its anchor scene): 'object' in an
 * object-led reel, else 'critter'.
 */
export function openerHero(root) {
  try {
    const hero = JSON.parse(readFileSync(join(root, 'assets', 'opener.json'), 'utf8'))?.hero;
    if (hero === 'object' || hero === 'critter') return hero;
  } catch {
    // no choice on file: the storyboard says
  }
  try {
    return storyboardHeroKind(readFileSync(join(root, 'STORYBOARD.md'), 'utf8'));
  } catch {
    return 'critter';
  }
}

/** The files a scene's own new drawings live in (EX3-114). */
export function newPropFiles(root) {
  const out = [];
  if (existsSync(join(root, 'assets', 'world', 'new-props.js'))) out.push(join('assets', 'world', 'new-props.js'));
  const frames = join(root, 'assets', 'frames');
  if (existsSync(frames)) for (const f of readdirSync(frames).sort()) if (f.endsWith('.props.js')) out.push(join('assets', 'frames', f));
  return out;
}

/**
 * The scene's own new drawings (EX3-114): every NEW_PROPS entry loads, has states and a size, draws
 * a clean SVG in each state, and carries full tags (props/tags.js TAG_FIELDS). Returns the problems
 * and what was found, for the bank's harvest.
 */
export async function tryProps(root) {
  const { tagProblems } = await import('./props/tags.js');
  const { propFrom } = await import('./props.js');
  const errors = [];
  const props = [];
  for (const file of newPropFiles(root)) {
    let defs;
    try {
      defs = (await import(pathToFileURL(join(root, file)).href)).NEW_PROPS;
    } catch (e) {
      errors.push(`${file} failed to load: ${e?.message ?? e}`);
      continue;
    }
    if (!defs || typeof defs !== 'object') {
      errors.push(`${file} must export NEW_PROPS = { '<specific name>': { tags, size, states, draw } } (EX3-114)`);
      continue;
    }
    for (const [name, def] of Object.entries(defs)) {
      const problems = [...tagProblems(name, def?.tags)];
      if (!Array.isArray(def?.states) || !def.states.length) problems.push(`asset "${name}" needs states (a list, e.g. ['default'])`);
      if (!Array.isArray(def?.size) || def.size.length !== 2 || !def.size.every(Number.isFinite)) problems.push(`asset "${name}" needs size: [w, h]`);
      if (typeof def?.draw !== 'function') problems.push(`asset "${name}" needs draw({ state, focal })`);
      else {
        for (const state of Array.isArray(def.states) ? def.states : []) {
          try {
            for (const p of frameProblems(propFrom(defs, name, 540, 960, { state }))) problems.push(`asset "${name}" (${state}): ${p}`);
          } catch (e) {
            problems.push(`asset "${name}" (${state}) threw: ${e?.message ?? e}`);
          }
        }
      }
      props.push({ file, name, tags: def?.tags ?? null, ok: problems.length === 0 });
      errors.push(...problems.map((p) => `${file}: ${p}`));
    }
  }
  return { errors, props };
}

/** The hook contract (EX3-102): what the bank's openers need from 01-hook.js. */
async function tryHook(root, duration) {
  const file = join(root, 'assets', 'frames', `${HOOK_ID}.js`);
  if (!existsSync(file)) return [`assets/frames/${HOOK_ID}.js does not exist (frame 1's hook: the frame worker writes it; 01-opener.js is code's)`];
  let mod;
  try {
    mod = await import(pathToFileURL(file).href);
  } catch (e) {
    return [`${HOOK_ID}.js failed to load: ${e?.message ?? e}`];
  }
  const scene = mod.default;
  if (typeof scene?.draw !== 'function') return [`${HOOK_ID}.js needs \`export default { ground, shots, draw(t, { hideHero, heroPose }) { … } }\``];
  const errors = [];
  // An object-led reel's hook follows its focal object: no critter hero, and its openers never use one (EX3-111).
  if (openerHero(root) === 'object') {
    for (const t of [0, duration / 2]) {
      try {
        if (String(scene.draw(t)).includes('data-role="title"')) errors.push(`${HOOK_ID}.js draws a title card; the opener draws it (draw the hook only)`);
      } catch (e) {
        errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}) threw: ${e?.message ?? e}`);
        break;
      }
    }
    return errors;
  }
  const hero = mod.hero ?? scene.hero;
  // The hero on the page: through the hook's static lens (hero.lens: { P, at: [x, y, z] cm, rig },
  // preferred; the kit derives at, s and box), or as a page point and scale (hero.at, hero.s).
  const onPage = Array.isArray(hero?.at) && hero.at.length === 2 && hero.at.every(Number.isFinite) && Number(hero.s) > 0;
  const throughLens = typeof hero?.lens?.P === 'function' && Array.isArray(hero.lens.at) && hero.lens.at.length >= 2 && hero.lens.at.every(Number.isFinite);
  // or its projected box alone (hero.box, critterAt's [x0, y0, x1, y1]): the opener derives the rest
  const boxed = Array.isArray(hero?.box) && hero.box.length === 4 && hero.box.every(Number.isFinite);
  const ok = hero && (onPage || throughLens || boxed) && typeof hero.who === 'string' && hero.who;
  if (!ok) errors.push(`${HOOK_ID}.js must export \`hero = { who, critter, lens: { P, at: [x, y, z], rig } }\` (the hook's critter seen through the hook's static lens: its world id, its CAST look, the lens, its feet in cm and the shot's rig), or \`hero = { who, critter, at: [x, y], s, box }\` when it is not drawn through a lens (its feet on the 1080x1920 page before any shot's crop, its scale, its page box)`);
  // The hero is CAST's orange critter, drawn the same way in the opener as everywhere (EX3-107).
  const cast = await loadCast(root);
  const { lookKey } = await import('./cast.js');
  if (ok && cast) {
    const declared = cast[hero.who];
    if (!declared) errors.push(`the hero "${hero.who}" is not in world.js's CAST (EX3-107)`);
    else {
      if (declared.body !== 'orange') errors.push(`the hero "${hero.who}" is ${declared.body ?? 'ink'} in CAST: a critter hero is the one orange critter (EX3-107)`);
      if (lookKey(hero.critter ?? {}) !== lookKey(declared)) errors.push(`${HOOK_ID}.js's hero.critter (${lookKey(hero.critter ?? {})}) differs from CAST.${hero.who} (${lookKey(declared)}) (EX3-107)`);
    }
  }
  const drawn = [];
  for (const t of [0, duration / 2]) {
    let svg = '';
    let hidden = '';
    try {
      svg = String(scene.draw(t));
      hidden = String(scene.draw(t, { hideHero: true, heroPose: { look: [0.5, 0] } }));
    } catch (e) {
      errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}) threw: ${e?.message ?? e}`);
      break;
    }
    drawn.push({ t, svg });
    if (svg.includes('data-role="title"')) errors.push(`${HOOK_ID}.js draws a title card; the opener draws it (draw the hook only)`);
    if (ok && !svg.includes(`data-who="${hero.who}"`)) errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}) does not draw its hero (data-who="${hero.who}")`);
    if (ok && hidden.includes(`data-who="${hero.who}"`)) errors.push(`${HOOK_ID}.js draw(${t.toFixed(2)}, { hideHero: true }) still draws its hero`);
    if (errors.length) break;
  }
  if (cast) errors.push(...lookProblems(drawn, cast, lookKey));
  return errors;
}

async function tryFrame(root, id) {
  const file = join(root, 'assets', 'frames', `${id}.js`);
  if (!existsSync(file)) return [`assets/frames/${id}.js does not exist`];
  const entry = projectFrames(root).find((f) => f.id === id);
  if (!entry) return [`STORYBOARD.md has no frame whose src is compositions/frames/${id}.html`];
  if (!(entry.duration > 0)) return [`STORYBOARD.md gives frame ${id} no duration`];
  // frame 1 over a hook that is not written yet: say so, not the import error (EX3-102)
  if (isBankOpener(root, entry) && !existsSync(join(root, 'assets', 'frames', `${HOOK_ID}.js`))) {
    return [`assets/frames/${HOOK_ID}.js does not exist (frame 1's hook: the frame worker writes it; ${id}.js is code's)`];
  }
  let scene;
  try {
    scene = (await import(pathToFileURL(file).href)).default;
  } catch (e) {
    return [`${id}.js failed to load: ${e?.message ?? e}`];
  }
  if (typeof scene?.draw !== 'function') return [`${id}.js needs \`export default { ground, draw(t) { … } }\``];
  if (scene.ground !== undefined && !resolveGround(scene.ground)) {
    return [`${id}.js: ground "${scene.ground}" must be paper, stage, or white`];
  }
  // Night and forest are old names for the stage (hx-4): compared as the kit draws them.
  const planned = (entry.fields.ground ?? '').trim().toLowerCase() || 'paper';
  if (resolveGround(scene.ground ?? 'paper') !== resolveGround(planned)) {
    return [`${id}.js: ground "${scene.ground ?? 'paper'}" does not match the storyboard's ground "${planned}"`];
  }
  const errors = [];
  const eventsFile = join(root, 'assets', 'frames', `${id}.events.json`);
  if (!existsSync(eventsFile)) errors.push(`assets/frames/${id}.events.json does not exist (every moment of motion needs a sound event)`);
  else {
    try {
      errors.push(...eventProblems(JSON.parse(readFileSync(eventsFile, 'utf8')), entry.duration));
    } catch (e) {
      errors.push(`${id}.events.json is not valid JSON: ${e?.message ?? e}`);
    }
  }
  const bank = isBankOpener(root, entry);
  if (bank) errors.push(...(await tryHook(root, entry.duration)));
  if (entry.number === 1 && !bank) {
    try {
      if (!String(scene.draw(0.15)).includes('data-role="title"')) errors.push('frame 1: the title card starts animating at 0s (titleCard() with no `from`); at t=0.15 it is not drawn');
    } catch {
      // draw errors are reported by the sampling below
    }
  }
  // The bank's openers place the title card themselves, some after the line (EX3-102).
  const role = entry.number === 1 && !bank ? 'title' : entry.number === 3 ? 'definition' : null;
  if (role) {
    const late = Math.max(0, entry.duration - 0.3);
    try {
      if (!String(scene.draw(late)).includes(`data-role="${role}"`)) {
        errors.push(entry.number === 1
          ? `frame 1 must draw the title card (titleCard() from assets/kit/cards.js, finished by the line's end) at t=${late.toFixed(2)}`
          : `frame 3 must draw the dictionary card (dictionaryCard() from assets/kit/cards.js) at t=${late.toFixed(2)}`);
      }
    } catch {
      // draw errors are reported by the sampling below
    }
  }
  // shots.js imports draw.js (its CDN import needs the hooks above), so it loads here.
  const { MULTI_SHOT_AFTER, validateShots } = await import('./shots.js');
  if (SHOT_FRAMES.includes(entry.number) && entry.duration > MULTI_SHOT_AFTER) {
    if (!Array.isArray(scene.shots)) errors.push(`export \`shots\` (shots.js): a ${entry.duration}s frame cuts between at least 2 shots`);
    else errors.push(...validateShots(scene.shots, entry.duration).map((e) => `shots: ${e}`));
  }
  const samples = [];
  for (const t of sampleTimes(entry.duration)) {
    let svg;
    try {
      svg = scene.draw(t);
    } catch (e) {
      errors.push(`draw(${t.toFixed(2)}) threw: ${e?.message ?? e}`);
      continue;
    }
    samples.push({ t, svg });
    for (const p of frameProblems(svg)) errors.push(`draw(${t.toFixed(2)}): ${p}`);
    if (errors.length >= 8) break;
  }
  // 4.1 camera shots list their cast: a critter outside it is off screen on purpose
  const camShots = Array.isArray(scene.shots) && scene.shots.some((sh) => sh?.camera && Array.isArray(sh.cast)) ? scene.shots : null;
  const shotsKit = camShots ? await import('./shots.js') : null;
  const castAt = camShots && typeof shotsKit?.shotAt === 'function' ? (t) => {
    const sh = shotsKit.shotAt(t, camShots)?.shot;
    return sh?.camera && Array.isArray(sh.cast) ? sh.cast : null;
  } : null;
  errors.push(...castProblems(samples, castAt));
  // a perspective (lens.js) frame, recognised by lens.render's mark: only the critters in view
  // count toward the crowd; the shot's subject (its focal()) stays whole inside the safe area at
  // the shot's rest poses; orange stays the hero's and the focal's; no critter is mostly hidden
  // behind a nearer one, and no face fills the frame outside a reaction shot. Other frames skip these.
  const lensKit = await kitModule('lens.js');
  errors.push(...crowdProblems(samples, lensKit?.visibleCritters ?? null));
  errors.push(...twinProblems(samples));
  if (lensKit?.framingProblems && samples.some(({ svg }) => /data-lens="/.test(String(svg)))) {
    errors.push(...lensKit.framingProblems(samples, { shots: Array.isArray(scene.shots) ? scene.shots : null }).map((e) => `framing: ${e}`));
    if (lensKit.orangeProblems) errors.push(...lensKit.orangeProblems(samples).map((e) => `orange: ${e}`));
    if (lensKit.occlusionProblems) errors.push(...lensKit.occlusionProblems(samples, { shots: Array.isArray(scene.shots) ? scene.shots : null }).map((e) => `occlusion: ${e}`));
  }
  // the kit's cut check repeats validateShots' jump cuts on crop shots: say each once
  const said = new Set(errors.map((e) => e.replace(/^shots: /, '')));
  gate41(errors, (await frameProblems41(root, entry, file, scene, samples, bank)).filter((e) => !said.has(e.replace(/^cut: /, ''))));
  errors.push(...kitImportProblems());
  const cast = await loadCast(root);
  if (cast) {
    const { lookKey } = await import('./cast.js');
    errors.push(...lookProblems(samples, cast, lookKey));
    errors.push(...heroFrameProblems(samples, cast, lookKey, entry.number));
  }
  return errors;
}

/**
 * Frame 7 is one thing or the other (principles.md §6; DOCS EX4): `anchor: scene`, a callback to
 * the analogy world, drawn through the lens with no glass; or `anchor: own`, built in glass, with no
 * critter and no lens shot. A 4.1 job names which in the storyboard.
 */
export function frame7Problems(entry, source, samples) {
  const anchor = String(entry?.fields?.anchor ?? '').trim().toLowerCase();
  if (anchor !== 'scene' && anchor !== 'own') return [`the storyboard's frame 7 block needs \`- anchor: scene\` (a callback to the analogy world) or \`- anchor: own\` (built in glass), never both`];
  const head = String(source).split('\n').slice(0, 12).join('\n');
  const glassSource = /^\s*\/\/\s*technique:/m.test(head) || /\/(glass|explain)\.js['"]/.test(String(source));
  const glassDrawn = samples.find(({ svg }) => /data-concept="|data-ui="/.test(String(svg)));
  const worldDrawn = samples.find(({ svg }) => /data-lens="|\bdata-who="/.test(String(svg)));
  if (anchor === 'scene' && (glassSource || glassDrawn)) {
    return [`anchor: scene is a callback to the analogy world, but the frame ${glassDrawn ? `draws glass (data-concept / data-ui) at ${glassDrawn.t.toFixed(2)}s` : 'imports glass.js or explain.js or declares a technique'}: frame 7 is one or the other; make it anchor: own, or drop the glass`];
  }
  if (anchor === 'own' && worldDrawn) {
    return [`anchor: own is built in glass, but the frame draws the analogy world (a lens shot or a critter) at ${worldDrawn.t.toFixed(2)}s: frame 7 is one or the other; make it anchor: scene, or drop the world`];
  }
  return [];
}

/** world.js's exports, or null when the project has none or it fails to load (tryWorld reports it). */
async function loadWorld(root) {
  const file = join(root, 'assets', 'world', 'world.js');
  if (!existsSync(file)) return null;
  try {
    return await import(pathToFileURL(file).href);
  } catch {
    return null;
  }
}

/**
 * One frame's 4.1 problems (principles.md §2–§6), by its kind. A bank opener's frame 1 is checked
 * on its hook (01-hook.js), the worker's part: the opener around it is code's. Every frame that
 * draws a critter gets the rig check.
 */
export async function frameProblems41(root, entry, file, scene, samplesIn, bank = false) {
  const out = [];
  let source = readFileSync(file, 'utf8');
  let samples = samplesIn;
  let shots = Array.isArray(scene?.shots) ? scene.shots : null;
  if (bank) {
    const hookFile = join(root, 'assets', 'frames', `${HOOK_ID}.js`);
    try {
      const hook = (await import(pathToFileURL(hookFile).href)).default;
      source = readFileSync(hookFile, 'utf8');
      shots = Array.isArray(hook?.shots) ? hook.shots : shots;
      samples = [];
      for (const t of sampleTimes(entry.duration)) {
        try {
          samples.push({ t, svg: String(hook.draw(t)) });
        } catch {
          // tryHook reports a hook that throws
        }
      }
    } catch {
      return out; // tryHook reports a hook that does not load
    }
  }
  const kind = frameKind(entry, source);
  if (entry.number === 7) out.push(...frame7Problems(entry, source, samples).map((e) => `frame 7: ${e}`));
  if (samples.some(({ svg }) => /data-rig="/.test(String(svg)))) out.push(...rigProblems(samples).map((e) => `rig: ${e}`));
  // nothing empty (principles.md §6): a phone, card, bubble or shell shown before its content
  out.push(...emptyContainerProblems(samples).map((e) => `empty: ${e}`));
  if (kind === 'scene') {
    const S = await import('./shots.js');
    const need = kitFns(S, 'shots.js', ['cutProblems', 'dofProblems', 'crowdProblems', 'labelProblems']);
    if (!need.ok) out.push(need.problem);
    else {
      if (shots) {
        out.push(...S.cutProblems(shots, { duration: entry.duration, samples }).map((e) => `cut: ${e}`));
        out.push(...S.dofProblems(shots, samples).map((e) => `focus: ${e}`));
        out.push(...S.crowdProblems(shots, samples).map((e) => `crowd: ${e}`));
      }
      out.push(...S.labelProblems(samples, shots).map((e) => `label: ${e}`));
    }
    const lensFrame = samples.some(({ svg }) => /data-lens="/.test(String(svg)));
    if (lensFrame) {
      const setKit = await kitModule('set.js');
      const needSet = kitFns(setKit, 'set.js', ['setProblems', 'setMetaFromSvg']);
      if (!needSet.ok) out.push(needSet.problem);
      else {
        // one set check per place the frame's shots are in (a trip's destination is its own SETS
        // place, shot.place); a place's own tells come from its brief
        const world = await loadWorld(root);
        const S = await import('./shots.js');
        const placeAt = (t) => (shots && typeof S.shotAt === 'function' ? S.shotAt(t, shots)?.shot?.place : null) ?? 'main';
        const byPlace = new Map();
        for (const smp of samples) byPlace.set(placeAt(smp.t), [...(byPlace.get(placeAt(smp.t)) ?? []), smp]);
        let drew = false;
        for (const [place, group] of byPlace) {
          const meta = unionSetMeta(group, setKit);
          if (!meta) continue;
          drew = true;
          const where = place === 'main' ? 'set' : `set (${place})`;
          // a critter near the lens is that shot's foreground piece (set.js setProblems { cast })
          out.push(...setKit.setProblems(meta, null, { cast: group.map((g) => String(g.svg)) }).map((e) => `${where}: ${e}`));
          if (place !== 'main' && world?.SETS && !world.SETS[place]) out.push(`${where}: no "${place}" in world.js SETS (the place a shot names must be briefed)`);
        }
        if (!drew && world?.SET) out.push('set: world.js has a SET but this frame draws no set: draw world.js ROOM (built with set.js setBuilder) in every shot of the analogy world');
        // faces are always whole: no eye or mouth behind a nearer counter, desk or solid
        const needFace = kitFns(setKit, 'set.js', ['faceCutProblems']);
        if (!needFace.ok) out.push(needFace.problem);
        else out.push(...setKit.faceCutProblems(samples).map((e) => `face: ${e}`));
      }
    }
  } else if (kind === 'tech') {
    const X = await kitModule('explain.js');
    const need = kitFns(X, 'explain.js', ['techniqueOf', 'identityProblems', 'emptyShellProblems', 'safeProblems']);
    if (!need.ok) out.push(need.problem);
    else {
      out.push(...X.techniqueOf(source).problems.map((e) => `technique: ${e}`));
      if (samples.some(({ svg }) => /data-concept="/.test(String(svg)))) {
        const id = await loadIdentity(root);
        if (id.error) out.push(`identity: ${id.error}`);
        else out.push(...identityMapProblems(samples, id.defs, X.identityProblems).map((e) => `identity: ${e}`));
      }
      out.push(...X.emptyShellProblems(samples).map((e) => `empty: ${e}`));
      const glassKit = await kitModule('glass.js');
      out.push(...readTextProblems(samples, { readMin: X.READ_MIN ?? 34, safeProblems: X.safeProblems, measure: glassKit?.measure ?? null }).map((e) => `read: ${e}`));
      // the frame is filled with real content and something changes on screen, judged at its held end
      const held = Math.max(0, entry.duration - 0.3);
      const end = samples.reduce((best, smp) => (Math.abs(smp.t - held) < Math.abs(best.t - held) ? smp : best), samples[0] ?? { t: 0, svg: '' });
      if (samples.length) out.push(...techFillProblems(samples, end.svg, { frameNumber: entry.number, measure: glassKit?.measure ?? null }).map((e) => `fill: ${e}`));
      if (typeof scene?.boxes === 'function' || Array.isArray(scene?.boxes)) {
        const boxes = [];
        for (const { t } of samples) {
          try {
            boxes.push(...[].concat(typeof scene.boxes === 'function' ? scene.boxes(t) ?? [] : scene.boxes));
          } catch (e) {
            out.push(`boxes(${t.toFixed(2)}) threw: ${e?.message ?? e}`);
            break;
          }
          if (Array.isArray(scene.boxes)) break;
        }
        out.push(...[...new Set(X.safeProblems(boxes))].map((e) => `safe: ${e}`));
      }
    }
  }
  return [...new Set(out)];
}

async function tryAll(root) {
  const errors = [];
  // each part's warnings carry its name, like its errors
  const part = async (name, run) => {
    const from = WARNINGS.length;
    const found = await run();
    WARNINGS.splice(from, WARNINGS.length - from, ...WARNINGS.slice(from).map((w) => `${name}: ${w}`));
    errors.push(...found.map((e) => `${name}: ${e}`));
  };
  if (existsSync(join(root, 'assets', 'world', 'world.js'))) await part('world', () => tryWorld(root));
  errors.push(...(await tryProps(root)).errors.map((e) => `props: ${e}`));
  for (const f of projectFrames(root)) {
    if (!existsSync(join(root, 'assets', 'frames', `${f.id}.js`))) {
      errors.push(`${f.id}: assets/frames/${f.id}.js does not exist`);
      continue;
    }
    await part(f.id, () => tryFrame(root, f.id));
  }
  return errors;
}

/**
 * Run one check from a project root; resolves to { ok, errors } (plus `warnings`: the 4.1 checks'
 * problems in a job prepared before 4.1, and `kit`, the job's kit generation).
 */
export async function tryPart(root, what, id) {
  WARNINGS.length = 0;
  const result = await tryPartErrors(root, what, id);
  const warnings = [...new Set(WARNINGS)];
  return warnings.length ? { ...result, warnings, kit: kitVersion() } : result;
}

async function tryPartErrors(root, what, id) {
  const errors =
    what === 'world' ? await tryWorld(root)
    : what === 'frame' && id ? await tryFrame(root, id)
    : what === 'all' ? await tryAll(root)
    : what === 'props' ? null
    : ['usage: try.mjs world | try.mjs frame <id> | try.mjs props | try.mjs all'];
  if (errors === null) {
    const found = await tryProps(root);
    return { ok: found.errors.length === 0, errors: found.errors, props: found.props };
  }
  return { ok: errors.length === 0, errors };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [what, id] = process.argv.slice(2);
  const { warnings, kit, ...result } = await tryPart(process.cwd(), what, id);
  console.log(JSON.stringify(result, null, 1));
  // An older job's 4.1 problems: shown, never failing the try, and kept off stdout's { ok, errors }.
  if (warnings?.length) console.error(`try.mjs: ${warnings.length} Explainers 4.1 warning(s) (kit ${kit}; errors in a 4.1 job):\n${warnings.map((w) => `- ${w}`).join('\n')}`);
  process.exit(result.ok ? 0 : 1);
}
