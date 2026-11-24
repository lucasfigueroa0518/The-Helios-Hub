// The Explainers world kit, core (hx-5, visual system 5 "D"): the style-independent math every shot
// stands on. No DOM and no imports, so it runs in the browser and in Node tests alike.
//
//   palette tokens and their ramps (VISUAL_SYSTEM_5 §2) · the grounds (paper, white) · the safe
//   area · the light moods (day, evening, dusk) · the one key light · the critter ruler
//   (CRITTER_CM, PX_PER_CM) and the cheated scale (CHEAT, propScale) · polarity curves · speed
//   ramps · the calm camera · the state ledger · seeded randomness · the isometric projection
//
// Determinism: a shot has ONE clock. A single tween drives wall time; speed ramps warp it into
// content time; everything on screen is a pure function of content time.

export const VERSION = 'hx-5';
/** The frame (1080 × 1920) and its safe area (VISUAL_SYSTEM_5 §4): the caption sits at y ≥ 250;
 *  every character, key object and label lies inside x 65–960 and above y 1580. Walls, floors and
 *  the ground may run to the frame edge. */
export const FRAME = { w: 1080, h: 1920, safe: { x0: 65, x1: 960, y0: 250, y1: 1580 } };

// ── Palette (VISUAL_SYSTEM_5 §2) ──────────────────────────────────────────────────────────
// A ramp family is `<family>`, `<family>-lit`, `<family>-shade`, `<family>-dark`: a solid's lit top
// is `-lit`, its front the base, its side `-shade`. Every color on screen is a token or a mix of two.
export const TOKENS = {
  /** The ground. */
  paper: '#F3F0EA',
  'paper-lit': '#FBFAF6',
  'paper-shade': '#E2DACB',
  'paper-dark': '#CFC5B3',
  /** Line, text, the mechanism tray, ink critters. */
  ink: '#171717',
  'ink-lit': '#2B2926',
  'ink-shade': '#101010',
  'ink-dark': '#0A0A0A',
  /** The hero only (and at most one UI action button). */
  orange: '#FF5E1A',
  'orange-lit': '#FF7A3D',
  'orange-shade': '#E8541C',
  'orange-dark': '#C8430F',
  /** Helios green: status, structure, green critters. */
  green: '#138510',
  'green-lit': '#5D9831',
  'green-shade': '#036A29',
  'green-dark': '#013D1F',
  /** Room walls, with their wainscot and trim. */
  wall: '#F1E9DA',
  wainscot: '#E4D8C3',
  trim: '#CDBFA6',
  /** Room floors, with their board lines. */
  floor: '#E2DACB',
  board: '#D3C9B6',
  /** Systems (servers, routers, machines); rugs; the dusk room. */
  slate: '#6684B0',
  'slate-lit': '#86A1C8',
  'slate-shade': '#4F6B94',
  'slate-dark': '#34496A',
  /** Data and key objects. */
  mustard: '#E0AB3E',
  'mustard-lit': '#F3C65E',
  'mustard-shade': '#C38F29',
  'mustard-dark': '#8F6418',
  /** The payoff thing. */
  teal: '#46978F',
  'teal-lit': '#5DB5AE',
  'teal-shade': '#357A74',
  'teal-dark': '#24534F',
  /** Furniture. */
  wood: '#9A7250',
  'wood-lit': '#B48A62',
  'wood-shade': '#7E5B3E',
  'wood-dark': '#5E432D',
  /** Plants. */
  leaf: '#5F8F48',
  'leaf-lit': '#7FAE62',
  'leaf-shade': '#4A7438',
  'leaf-dark': '#355428',
  /** Small accents only. */
  red: '#B4473A',
  'red-lit': '#D27665',
  'red-shade': '#91372D',
  'red-dark': '#5F231C',
  /** Glass, sky. */
  window: '#BFD3EC',
  /** White critters, cards, pills. */
  white: '#FFFFFF',
};

/** The palette colors that have a 4-step ramp, by name. */
export const PALETTE = ['paper', 'ink', 'orange', 'green', 'slate', 'mustard', 'teal', 'wood', 'leaf', 'red'];

/** A palette color's ramp: { lit, base, shade, dark }. */
export function ramp(name) {
  if (!PALETTE.includes(name)) throw new Error(`HX: no ramp "${name}". Ramps: ${PALETTE.join(', ')}.`);
  return { lit: TOKENS[`${name}-lit`], base: TOKENS[name], shade: TOKENS[`${name}-shade`], dark: TOKENS[`${name}-dark`] };
}

const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
/** Two hex colors mixed in linear light (t = share of b), as hex: a mix of two palette tokens.
 *  Inputs are palette hexes. */
export function mixHex(a, b, t) {
  const A = hexRgb(a);
  const B = hexRgb(b);
  const k = Math.min(1, Math.max(0, t));
  return '#' + A.map((v, i) => {
    const l = toLin(v / 255) * (1 - k) + toLin(B[i] / 255) * k;
    return Math.round(Math.min(1, Math.max(0, toGam(l))) * 255).toString(16).padStart(2, '0');
  }).join('').toUpperCase();
}

/** Names a tone may also go by (older scene code): `canvas` is white. */
export const TONE_ALIASES = { canvas: 'white' };
const HEX6 = /^#[0-9A-Fa-f]{6}$/;
/** Every color name a tone may use: the ramp names, the palette tokens and the aliases. */
export const toneNames = () => [...new Set([...PALETTE, ...Object.keys(TOKENS), ...Object.keys(TONE_ALIASES)])];

/**
 * The one tone resolver: what every lens/draw solid and every set piece is painted from.
 * Accepts a ramp name ('teal', 'wood'; returned as is, so the solid uses the palette's own ramp),
 * a palette token ('ink-lit', 'green-shade', 'wall'; its hex), `{ mix: [a, b, k] }` of two tones
 * (k = share of b, default 0.5; mixed in linear light, as hex) or a '#RRGGBB' hex already mixed
 * from the palette. Anything else THROWS with the allowed names (a color that silently rendered
 * white would hide the mistake). set.js tone() is this, with paper for nothing.
 * @param {string | { mix: [any, any, number?] }} v
 * @returns {string} a PALETTE ramp name or a hex
 */
export function resolveTone(v) {
  if (typeof v === 'string') {
    if (PALETTE.includes(v)) return v;
    const name = TONE_ALIASES[v] ?? v;
    if (TOKENS[name]) return TOKENS[name];
    if (HEX6.test(v)) return v.toUpperCase();
  } else if (v && typeof v === 'object' && Array.isArray(v.mix)) {
    const [a, b, k = 0.5] = v.mix;
    return mixHex(toneHex(a), toneHex(b), k);
  }
  const shown = typeof v === 'string' ? `"${v}"` : JSON.stringify(v);
  throw new Error(`HX: unknown color ${shown}. A tone is a palette name (${PALETTE.join(', ')}), a palette token (${Object.keys(TOKENS).filter((k) => !PALETTE.includes(k)).join(', ')}), { mix: [a, b, k] } or a palette hex.`);
}
/** A tone as one hex: a ramp name gives its base. */
export function toneHex(v) {
  const t = resolveTone(v);
  return HEX6.test(t) ? t : TOKENS[t];
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function tok(name) {
  if (TOKENS[name]) return TOKENS[name];
  throw new Error(`HX: unknown token "${name}". Colors come from the palette only (VISUAL_SYSTEM_5 §2).`);
}

/** A mix of exactly two palette tokens. t = share of b, 0..1. */
export function mix(a, b, t) {
  const pb = Math.round(clamp(t, 0, 1) * 1000) / 10;
  return `color-mix(in oklab, ${tok(a)} ${100 - pb}%, ${tok(b)})`;
}

/** A palette token at an opacity, 0..1. */
export function alpha(a, opacity) {
  const p = Math.round(clamp(opacity, 0, 1) * 1000) / 10;
  return `color-mix(in oklab, ${tok(a)} ${p}%, transparent)`;
}

/** The grounds (VISUAL_SYSTEM_5 §3): `paper` (TOKENS.paper with the grain and a faint drafting
 *  grid; every frame but the logo close) and `white` (the logo close only). `fill` is the ground's
 *  flat color; draw.js ground() paints it. A dark beat is a light mood (`dusk`), never a ground. */
export const GROUNDS = {
  paper: { fill: TOKENS.paper, dark: false },
  white: { fill: TOKENS.white, dark: false },
};
/** Retired ground names, drawn as paper so an old project still renders (a storyboard naming
 *  them is a lint error). */
export const GROUND_ALIASES = { stage: 'paper', night: 'paper', forest: 'paper' };

/** A ground by name, aliases resolved: { name, fill, dark }. Throws on an unknown name. */
export function groundOf(name = 'paper') {
  const key = GROUND_ALIASES[name] ?? name;
  const gr = GROUNDS[key];
  if (!gr) throw new Error(`HX: ground must be ${Object.keys(GROUNDS).join(', ')} (got "${name}").`);
  return { name: key, ...gr };
}

// ── Light (VISUAL_SYSTEM_5 §3) ────────────────────────────────────────────────────────────
/** The light moods a frame can be in: `day`, `evening`, `dusk` (slate walls, lamps lit, windows
 *  dark; the dark beat). light.js mood() resolves them. */
export const MOODS = ['day', 'evening', 'dusk'];
/** key: the screen direction the key light comes FROM (toward the top right); ambient: the share
 *  of light a face turned away still gets. Faces are stepped flat tones chosen by their angle to
 *  the key, never a gradient. */
export const LIGHT = { key: [0.62, -0.78], ambient: 0.42 };
/** A thing's one soft shadow: ink at this opacity. */
export const SHADOW_OPACITY = 0.1;

// ── The ruler ─────────────────────────────────────────────────────────────────────────────
/** A critter's real height in cm: the ruler every world entity is sized against. */
export const CRITTER_CM = 72;
/** A critter's drawn height at s = 1 in px, feet to the top of its body (the 200-unit critter
 *  tile: feet at y 192, body top at y 40). */
export const CRITTER_PX = 152;
/** Screen px per cm at scale 1. */
export const PX_PER_CM = CRITTER_PX / CRITTER_CM;

// ── Cheated scale ───────────────────────────────────────────────────────────────────
/** Scale is believable, not true (house style): things stay plausible next to each other, and
 *  the props the action depends on are cheated bigger so they read on a phone. `scale: 'cheat'`
 *  grows a prop until its longest side is at least `readCm` next to the 72 cm critter, at most
 *  `max` times its real size, and never shrinks it. A number is the factor itself. */
export const CHEAT = { readCm: 30, max: 3 };
/**
 * The factor a prop is drawn at: `scale` 'cheat' (CHEAT, from its real size `sizeCm`, a number or
 * [w, d, h] in cm), a positive number (that factor), or nothing (1, its real size). Anything else
 * throws, saying what it takes.
 * @param {'cheat' | number | undefined | null} scale
 * @param {number | number[]} [sizeCm]
 */
export function propScale(scale, sizeCm) {
  if (scale === undefined || scale === null) return 1;
  if (typeof scale === 'number') {
    if (!(scale > 0 && Number.isFinite(scale))) throw new Error(`HX: a prop's scale is 'cheat' or a positive number (got ${scale})`);
    return scale;
  }
  if (scale === 'cheat') {
    const dims = (Array.isArray(sizeCm) ? sizeCm : [sizeCm]).filter((v) => typeof v === 'number' && v > 0);
    if (!dims.length) throw new Error("HX: scale 'cheat' needs the prop's real size in cm (a number or [w, d, h])");
    return Math.min(CHEAT.max, Math.max(1, CHEAT.readCm / Math.max(...dims)));
  }
  throw new Error(`HX: a prop's scale is 'cheat' or a positive number (got ${JSON.stringify(scale)})`);
}

// ── Polarity: the speed curve of a move (V-8) ─────────────────────────────────────────────
function backOut(s, x) {
  const u = x - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
}
const SPRING_ZETA = 0.38;
const SPRING_OMEGA = 13;
function springRaw(t) {
  const wd = SPRING_OMEGA * Math.sqrt(1 - SPRING_ZETA * SPRING_ZETA);
  const decay = Math.exp(-SPRING_ZETA * SPRING_OMEGA * t);
  return 1 - decay * (Math.cos(wd * t) + ((SPRING_ZETA * SPRING_OMEGA) / wd) * Math.sin(wd * t));
}
const SPRING_END = springRaw(1);

export const POLARITY = {
  linear: (t) => t,
  /** Fast in, hard stop: arrivals, landings, impacts, verdicts. */
  slam: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : (1 - Math.pow(2, -11 * t)) / (1 - Math.pow(2, -11))),
  /** Instant, tiny overshoot: state flips, switches, counters. Lands by 55%, then holds. */
  snap: (t) => (t <= 0 ? 0 : t >= 0.55 ? 1 : backOut(1.6, t / 0.55)),
  /** Slow start, accelerating: build-ups that end in an impact. */
  'ramp-up': (t) => t * t * t,
  /** Slow, fast, slow: repositioning, release after a peak. */
  glide: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  /** Overshoot and settle: objects with weight, physical bounces. */
  spring: (t) => (t <= 0 ? 0 : t >= 1 ? 1 : springRaw(t) + t * (1 - SPRING_END)),
  /** Goes, then pulls back to where it started: false starts, refusals, rejections. */
  reverse: (t) => {
    if (t <= 0 || t >= 1) return 0;
    const turn = 0.58;
    if (t < turn) return Math.sin((Math.PI / 2) * (t / turn));
    return 1 - POLARITY.slam((t - turn) / (1 - turn));
  },
  /** Near-constant and slow: the tension hold only (V-10). */
  drift: (t) => -(Math.cos(Math.PI * clamp(t, 0, 1)) - 1) / 2,
};
// `ramp` is a time remap rather than a shape (V-9): as a leg polarity it means linear motion
// while the shot's warp slows the moment itself.
POLARITY.ramp = POLARITY.linear;

export function polarity(name) {
  const f = POLARITY[name];
  if (!f) throw new Error(`HX: unknown polarity "${name}". Use one of: ${Object.keys(POLARITY).join(', ')} (V-8).`);
  return f;
}

// ── Speed ramps: the shot's time warp (V-9) ───────────────────────────────────────────────
// A ramp { at, dur, speed, lead?, tail? } in WALL seconds plays the whole scene at `speed`
// during [at, at+dur], and wins the lost time back in `lead` before and `tail` after, so content
// time equals wall time outside [at − lead, at + dur + tail] and voice sync holds.
const WARP_HZ = 600;
const smoothstep = (x) => {
  x = clamp(x, 0, 1);
  return x * x * (3 - 2 * x);
};

export function makeWarp(ramps, duration) {
  ramps = (ramps || []).slice().sort((a, b) => a.at - b.at);
  const n = Math.max(2, Math.ceil(duration * WARP_HZ) + 1);
  const dt = duration / (n - 1);
  const speed = new Float64Array(n).fill(1);
  let prevEnd = 0;
  ramps.forEach((r, k) => {
    if (!(r.speed > 0 && r.speed < 1)) throw new Error(`HX: ramp ${k} speed must be between 0 and 1.`);
    const lead = r.lead == null ? Math.max(0.3, r.dur * 0.75) : r.lead;
    const tail = r.tail == null ? Math.max(0.3, r.dur * 0.75) : r.tail;
    const s0 = r.at - lead;
    const s3 = r.at + r.dur + tail;
    if (s0 < prevEnd - 1e-9 || s3 > duration + 1e-9) {
      throw new Error(`HX: ramp ${k} (with its lead and tail) must fit inside the shot and not overlap another ramp.`);
    }
    prevEnd = s3;
    const edge = Math.min(0.12, r.dur / 3);
    let slowLoss = 0;
    for (let j = 0; j < n; j++) {
      const t = j * dt;
      if (t >= r.at && t <= r.at + r.dur) {
        const w = Math.min(smoothstep((t - r.at) / edge), smoothstep((r.at + r.dur - t) / edge));
        speed[j] = 1 + (r.speed - 1) * w;
        slowLoss += (1 - speed[j]) * dt;
      }
    }
    let bumpArea = 0;
    for (let j = 0; j < n; j++) {
      const t = j * dt;
      if (t >= s0 && t < r.at) bumpArea += Math.sin(Math.PI * ((t - s0) / lead)) * dt;
      else if (t > r.at + r.dur && t <= s3) bumpArea += Math.sin(Math.PI * ((t - r.at - r.dur) / tail)) * dt;
    }
    const gain = bumpArea > 0 ? slowLoss / bumpArea : 0;
    for (let j = 0; j < n; j++) {
      const u = j * dt;
      if (u >= s0 && u < r.at) speed[j] += gain * Math.sin(Math.PI * ((u - s0) / lead));
      else if (u > r.at + r.dur && u <= s3) speed[j] += gain * Math.sin(Math.PI * ((u - r.at - r.dur) / tail));
    }
  });
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + ((speed[i - 1] + speed[i]) / 2) * dt;
  const scale = cum[n - 1] > 0 ? duration / cum[n - 1] : 1;
  for (let i = 0; i < n; i++) cum[i] *= scale;

  const wallToContent = (t) => {
    if (t <= 0) return 0;
    if (t >= duration) return duration;
    const x = t / dt;
    const k = Math.floor(x);
    return cum[k] + (cum[Math.min(k + 1, n - 1)] - cum[k]) * (x - k);
  };
  const contentToWall = (c) => {
    if (c <= 0) return 0;
    if (c >= duration) return duration;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] < c) lo = mid;
      else hi = mid;
    }
    const span = cum[hi] - cum[lo];
    return (lo + (span > 0 ? (c - cum[lo]) / span : 0)) * dt;
  };
  const speedAt = (t) => speed[clamp(Math.round(t / dt), 0, n - 1)] * scale;
  return { duration, ramps, wallToContent, contentToWall, speedAt };
}

/** Ramps given by the CONTENT moment they slow (`around`), resolved to wall time (V-9). */
export function resolveRamps(ramps, duration) {
  const resolved = [];
  (ramps || []).forEach((r) => {
    if (r.around == null) {
      resolved.push(r);
      return;
    }
    const lead = r.lead == null ? Math.max(0.3, r.dur * 0.75) : r.lead;
    const tail = r.tail == null ? Math.max(0.3, r.dur * 0.75) : r.tail;
    let lo = lead;
    let hi = duration - r.dur - tail;
    if (hi < lo) throw new Error(`HX: a ${r.dur}s ramp does not fit in a ${duration}s shot.`);
    const spec = { dur: r.dur, speed: r.speed, lead, tail };
    for (let it = 0; it < 40; it++) {
      const mid = (lo + hi) / 2;
      const w = makeWarp(resolved.concat([{ at: mid, ...spec }]), duration);
      if (w.wallToContent(mid + r.dur / 2) < r.around) lo = mid;
      else hi = mid;
    }
    resolved.push({ at: (lo + hi) / 2, ...spec });
  });
  return resolved;
}

// ── The calm camera (V-7, X-20) ───────────────────────────────────────────────────────────
// A 2D camera over the isometric table. x, y: the world point (frame px) shown at frame center,
// relative to the shot's own framing; zoom (1 = native); rot (roll, degrees); tilt (refused).
const CAM_KEYS = ['x', 'y', 'zoom', 'rot', 'tilt'];
const DEFAULT_CAM = { x: 0, y: 0, zoom: 1, rot: 0, tilt: 0 };

/** @typedef {{ x: number, y: number, zoom: number, rot: number, tilt: number }} Cam */

/** @param {Partial<Cam>} [c] @returns {Cam} */
export function cam(c) {
  const out = /** @type {Cam} */ ({});
  CAM_KEYS.forEach((k) => {
    out[k] = c && typeof c[k] === 'number' ? c[k] : DEFAULT_CAM[k];
  });
  return out;
}

/** Zoom interpolates geometrically so a push feels even; the rest linearly. */
/** @param {Cam} a @param {Cam} b @param {number} f @returns {Cam} */
export function lerpCam(a, b, f) {
  const out = /** @type {Cam} */ ({});
  CAM_KEYS.forEach((k) => {
    out[k] = k === 'zoom' ? a.zoom * Math.pow(b.zoom / a.zoom, f) : a[k] + (b[k] - a[k]) * f;
  });
  return out;
}

/** Camera at content time t, from a start camera and non-overlapping legs.
 *  @param {Partial<Cam>} start @param {any[]} legs @param {number} t @returns {Cam} */
export function camAt(start, legs, t) {
  let current = cam(start);
  for (const leg of legs) {
    if (t <= leg.at) break;
    const target = cam({ ...current, ...leg.to });
    if (t >= leg.at + leg.dur) {
      current = leg.polarity === 'reverse' ? current : target;
      continue;
    }
    return lerpCam(current, target, polarity(leg.polarity)((t - leg.at) / leg.dur));
  }
  return current;
}

/** The SVG transform of the world under camera c, pivoting on (cx, cy). */
export function cameraTransform(c, cx = FRAME.w / 2, cy = FRAME.h / 2) {
  return `translate(${cx} ${cy}) rotate(${(-c.rot).toFixed(4)}) scale(${c.zoom.toFixed(5)}) translate(${(-cx - c.x).toFixed(3)} ${(-cy - c.y).toFixed(3)})`;
}

export const CAMERA_LIMITS = { maxZoomRatio: 1.2, maxRoll: 3, maxTilt: 0 };

export function validateLegs(legs, duration, start) {
  const sorted = legs.slice().sort((a, b) => a.at - b.at);
  let zoom = cam(start).zoom;
  sorted.forEach((l, i) => {
    if (!(l.dur > 0)) throw new Error(`HX: camera leg ${i} needs a positive duration.`);
    polarity(l.polarity || '');
    if (l.at < 0 || l.at + l.dur > duration + 1e-6) throw new Error(`HX: camera leg ${i} runs outside the shot.`);
    if (i > 0 && l.at < sorted[i - 1].at + sorted[i - 1].dur - 1e-6) {
      throw new Error(`HX: camera legs ${i - 1} and ${i} overlap. One camera, one move at a time (V-7).`);
    }
    const to = l.to || {};
    if (to.rot != null && Math.abs(to.rot) > CAMERA_LIMITS.maxRoll) throw new Error(`HX: roll stays within ${CAMERA_LIMITS.maxRoll}° (V-7).`);
    if (to.tilt != null && Math.abs(to.tilt) > CAMERA_LIMITS.maxTilt) throw new Error('HX: no perspective tilt; the camera is calm (V-7).');
    if (to.zoom != null) {
      if (!(to.zoom > 0)) throw new Error('HX: zoom must be positive.');
      const ratio = Math.max(to.zoom / zoom, zoom / to.zoom);
      if (ratio > CAMERA_LIMITS.maxZoomRatio + 1e-9 && l.verb !== 'zoom-through') {
        throw new Error(`HX: camera leg ${i} changes zoom by ${ratio.toFixed(2)}×; one move stays within ${CAMERA_LIMITS.maxZoomRatio}× (V-7).`);
      }
      if (l.polarity !== 'reverse') zoom = to.zoom;
    }
  });
  return sorted;
}

// ── Ledger: the world's state over time (V-1) ─────────────────────────────────────────────
export function ledgerValue(start, changes, t) {
  let v = start;
  for (const ch of changes) {
    if (t < ch.at) break;
    const d = ch.dur || 0;
    if (d > 0 && t < ch.at + d && typeof v === 'number' && typeof ch.to === 'number') {
      return v + (ch.to - v) * polarity(ch.polarity || 'glide')((t - ch.at) / d);
    }
    v = ch.to;
  }
  return v;
}

// ── Seeded randomness; the old stop-motion clock (retired) ────────────────────────────────
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// There is no boil and no on-twos pose clock: everything moves smoothly. The names stay
// exported so older scene code keeps working.
/** The old pose rate; mark.js still rounds its landing cue to it. */
export const FPS_CAST = 15;
/** Smooth motion: returns t unchanged (it used to hold each pose for two frames). */
export const onTwos = (t) => t;
/** No boil: the seed never changes (kept for old callers, which pass t). */
export const boilSeed = (_t = 0) => 4;

// ── The isometric projection (V-2) ────────────────────────────────────────────────────────
export const ISO_COS = Math.cos(Math.PI / 6);
export const ISO_SIN = 0.5;

/** World (x right-back, y left-back, z up) → screen, with world origin at (ox, oy), scale s. */
export function iso(ox, oy, s = 1) {
  return (x, y, z = 0) => [ox + (x - y) * ISO_COS * s, oy + (x + y) * ISO_SIN * s - z * s];
}

/** The SVG transform that lays flat 2D drawing (u along world x, v along world y) on the
 *  plane z, with its origin at world (x, y). */
export function isoPlane(P, s, x, y, z = 0) {
  const [X, Y] = P(x, y, z);
  return `matrix(${(ISO_COS * s).toFixed(5)} ${(ISO_SIN * s).toFixed(5)} ${(-ISO_COS * s).toFixed(5)} ${(ISO_SIN * s).toFixed(5)} ${X.toFixed(2)} ${Y.toFixed(2)})`;
}
