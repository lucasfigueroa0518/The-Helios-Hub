// The Explainers world kit, core (hx-3, from Explainer 2.0; Explainers 3.0 adds the white ground): the style-independent math every shot stands on.
// No DOM and no imports, so it runs in the browser and in Node tests alike.
//
//   palette tokens (V-T1) · polarity curves (V-8) · speed ramps (V-9) · the calm camera (V-7,
//   X-20) · the state ledger (V-1) · seeded randomness and the stop-motion clock (V-15) · the
//   isometric projection (V-2)
//
// Determinism (E2-06): a shot has ONE clock. A single tween drives wall time; speed ramps warp
// it into content time; everything on screen is a pure function of content time.

export const VERSION = 'hx-3';
export const FRAME = { w: 1080, h: 1920, safe: { x0: 96, x1: 940, y0: 570, y1: 1600 } };

// ── Palette (V-T1) ────────────────────────────────────────────────────────────────────────
export const TOKENS = {
  paper: '#F3F0EA',
  'paper-lit': '#FBFAF6',
  'paper-shade': '#E2DACB',
  'paper-dark': '#CFC5B3',
  canvas: '#FFFFFF',
  ink: '#171717',
  'ink-lit': '#2B2926',
  'text-secondary': '#525252',
  'text-tertiary': '#737373',
  orange: '#FF5E1A',
  'orange-lit': '#FF7A3D',
  'orange-shade': '#E8541C',
  'orange-dark': '#C8430F',
  'orange-text': '#CC4E19',
  green: '#138510',
  night: '#171717',
  // Status colors (X-24): universal meaning only, on the signal itself, never a ground.
  'status-error': '#E5484D',
  'status-success': '#30C463',
  'status-warning': '#F5B014',
  'status-info': '#3E8BF0',
};

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

export function tok(name) {
  if (TOKENS[name]) return TOKENS[name];
  throw new Error(`HX: unknown token "${name}". Colors come from the palette only (V-T1).`);
}

/** A mix of exactly two palette tokens (V-T1). t = share of b, 0..1. */
export function mix(a, b, t) {
  const pb = Math.round(clamp(t, 0, 1) * 1000) / 10;
  return `color-mix(in oklab, ${tok(a)} ${100 - pb}%, ${tok(b)})`;
}

/** A palette token at an opacity, 0..1. */
export function alpha(a, opacity) {
  const p = Math.round(clamp(opacity, 0, 1) * 1000) / 10;
  return `color-mix(in oklab, ${tok(a)} ${p}%, transparent)`;
}

/** The three grounds (V-14). Forest is green mixed 30% into night, written out as hex. */
export const GROUNDS = {
  paper: { fill: TOKENS.paper, dark: false },
  night: { fill: TOKENS.night, dark: true },
  forest: { fill: '#163815', dark: true },
  // Explainers 3.0: the close is a white screen with only the logo (EX3-19). No grid, no grain.
  white: { fill: TOKENS.canvas, dark: false },
};

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

// ── Seeded randomness and the stop-motion clock (V-15) ────────────────────────────────────
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

/** Drawn things move on twos: a new pose 15 times a second. */
export const FPS_CAST = 15;
/** The line wobble redraws 10 times a second. */
export const FPS_BOIL = 10;
export const onTwos = (t) => Math.floor(t * FPS_CAST + 1e-6) / FPS_CAST;
/** The wobble seed at time t: cycles through six drawings so the line boils. */
export const boilSeed = (t) => 4 + (Math.floor(t * FPS_BOIL + 1e-6) % 6);

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
