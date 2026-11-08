// The hooks' timing, crops and scores, from slots alone: a HookChoice, the frame's spoken words, its pictures and its length.
// Pure, no DOM. The templates (templates.js) draw from `planHook`'s result; render/compile.ts writes `hookScore`'s cues to
// <id>.events.json, so what is seen and what is heard resolve from the same times. Every cue comes from spoken words; a word
// that can't be found spreads evenly and is reported. Nothing here is tuned to a reel.

export const W = 1080;
export const H = 1920;
/** Where captions run (presets/reel-ai-drama/caption-skin.html, two lines at 74px): a hook keeps what must be read out of it. */
export const CAPTION_BAND = { top: 292, bottom: 480 };
/** Where the eye rests in a full-frame picture: a face sits here, under the captions. */
export const FACE_PLACE = [0.5, 0.45];

/** Plate geometry, measured from the plates in plates/ (fractions of 1080×1920). */
export const SCREENS = [
  [0.3072, 0.0588, 0.1809, 0.0789],
  [0.0452, 0.0670, 0.1569, 0.0707],
  [0.6051, 0.0871, 0.1090, 0.0484],
  [0.8245, 0.0938, 0.1051, 0.0476],
  [0.4561, 0.1667, 0.1556, 0.0692],
  [0.7367, 0.1674, 0.1702, 0.0766],
  [0.2327, 0.1719, 0.1383, 0.0632],
  [0.0479, 0.1763, 0.1144, 0.0521],
  [0.0452, 0.2619, 0.1330, 0.0595],
  [0.3324, 0.2723, 0.2633, 0.1138],
  [0.7553, 0.2775, 0.1569, 0.0707],
  [0.1636, 0.3452, 0.0971, 0.0432],
  [0.7500, 0.3839, 0.1676, 0.0744],
  [0.0386, 0.4100, 0.1689, 0.0759],
  [0.4747, 0.4211, 0.1569, 0.0707],
  [0.3045, 0.4315, 0.1077, 0.0491],
  [0.8524, 0.4911, 0.1117, 0.0513],
  [0.6210, 0.5149, 0.1449, 0.0662],
  [0.3112, 0.5164, 0.1809, 0.0811],
  [0.0359, 0.5186, 0.1529, 0.0699],
  [0.6729, 0.6057, 0.2074, 0.0908],
  [0.1915, 0.6243, 0.1569, 0.0707],
  [0.4707, 0.6302, 0.1303, 0.0595],
  [0.0386, 0.6414, 0.1051, 0.0476],
  [0.0412, 0.7292, 0.2008, 0.0878],
  [0.7566, 0.7366, 0.1676, 0.0759],
  [0.3564, 0.7381, 0.1569, 0.0714],
  [0.5931, 0.7567, 0.1197, 0.0536],
  [0.2447, 0.8430, 0.1489, 0.0677],
  [0.5346, 0.8445, 0.1503, 0.0677],
  [0.8019, 0.8482, 0.1237, 0.0565],
  [0.0372, 0.8527, 0.1130, 0.0521],
];
export const PLATES = {
  projector: { key: 'projector-key', screen: [0.04920, 0.08631, 0.90160, 0.40997] },
  frontpage: { key: 'frontpage-key', headline: [0.03590, 0.02530, 0.92952, 0.13690], photo: [0.03723, 0.16964, 0.92686, 0.33854] },
  darkroom: { key: 'darkroom-key', tray: [0.14761, 0.23214, 0.70612, 0.51190] },
  screens: { key: 'screens-key' },
};
export const BURN_FRAMES = 44;

const SFX = (name) => `assets/kit/hooks/sfx/${name}.mp3`;
/** Sound lengths in the bank, seconds (a test holds these to the files): beds repeat to cover a long line. */
export const SFX_SECONDS = { crtroom: 5.01, vcr: 5.0, darkroom: 4.82, fan: 6.0, press: 5.01 };
/** Every shipped sound in the bank. */
export const SFX_NAMES = ['shutter', 'whoosh', 'hit', 'flash', 'crtroom', 'crtoff', 'staticburst', 'track', 'servo', 'locktone', 'rewind', 'vcr', 'slip', 'darkroom', 'timer', 'fan', 'kachunk', 'press', 'paperspin', 'papersnap', 'fire', 'crinkle1', 'crinkle2', 'crinkle3', 'crinkle4', 'crinkle5'];

const round = (n) => Math.round(n * 1000) / 1000;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

/** Beats on their words: found words in order; anything else spreads evenly between its neighbours. Pure. */
export function beatTimes(beats, { words = [], duration, cueAt, report = () => {}, minGap = 0.28 }) {
  const end = voiceEnd(words, duration);
  const raw = beats.map((b) => {
    const on = String(b.on ?? '').trim();
    if (!on) return null;
    const at = cueAt(words, on);
    if (at == null) report(`hook_word_missing: "${on}" is not in the voice; ${b.asset} spreads evenly`);
    return at;
  });
  let last = -Infinity;
  const kept = raw.map((t, i) => {
    if (t == null) return null;
    if (t < last + minGap) {
      report(`hook_beat_close: ${beats[i].asset} on "${beats[i].on}" is too near the one before; it spreads evenly`);
      return null;
    }
    last = t;
    return t;
  });
  const out = [...kept];
  let i = 0;
  while (i < out.length) {
    if (out[i] != null) { i++; continue; }
    let j = i;
    while (j < out.length && out[j] == null) j++;
    const from = i > 0 ? out[i - 1] : null;
    const to = j < out.length ? out[j] : end * 0.9;
    const start = from ?? 0;
    const steps = j - i + (from == null ? 0 : 1);
    for (let k = i; k < j; k++) out[k] = round(start + ((to - start) * (k - i + (from == null ? 0 : 1))) / Math.max(1, steps));
    i = j;
  }
  return out.map((t) => round(t));
}

export function voiceEnd(words, duration) {
  const last = words?.length ? words[words.length - 1] : null;
  return Math.min(duration, last?.end ?? last?.start ?? duration);
}

/** When the charged words start, or `fallback`. */
function chargedAt(choice, { words, cueAt, report }, fallback) {
  const on = String(choice.charged ?? '').trim();
  const t = on ? cueAt(words, on) : null;
  if (on && t == null) report(`hook_word_missing: the charged words "${on}" are not in the voice`);
  return round(t ?? fallback);
}

/** The times of word starts in [from, to], at least `gap` apart: where a long hold's small moves land. */
function wordsBetween(words, from, to, gap) {
  const out = [];
  let last = from;
  for (const w of words ?? []) {
    const t = w.start ?? 0;
    if (t >= last + gap && t <= to) { out.push(round(t)); last = t; }
  }
  return out;
}

// ── Crops ───────────────────────────────────────────────────────────────────────────────────────

/** The main subject of a picture, as a box of 0–1 fractions, or null. Pure. */
export function subjectOf(m) {
  return m?.face ?? m?.regions?.faces?.[0] ?? m?.regions?.focus ?? null;
}

/**
 * The part of a picture that fills a box: at `zoom`, with point `at` (0–1) landing on `place` (0–1 of the box) as near as the
 * picture's edges let it. Fractions of the picture: { x, y, w, h }. Pure.
 */
export function coverCrop(m, boxW, boxH, { zoom = 1, at = null, place = FACE_PLACE } = {}) {
  const iw = m.width || 1;
  const ih = m.height || 1;
  const aspect = boxW / boxH;
  const fit = Math.min(iw, ih * aspect) / Math.max(zoom, 1);
  const sw = fit;
  const sh = fit / aspect;
  const s = subjectOf(m);
  const focus = at ?? (s ? [s.x + s.w / 2, s.y + s.h / 2] : [0.5, 0.5]);
  const x = clamp(focus[0] * iw - place[0] * sw, 0, iw - sw);
  const y = clamp(focus[1] * ih - place[1] * sh, 0, ih - sh);
  return { x: x / iw, y: y / ih, w: sw / iw, h: sh / ih };
}

/** How a picture holds the full frame: 'cover', or 'print' (a framed print over a backdrop), or 'logo' (drawn whole on a ground). Pure. */
export function fullFrameLook(m) {
  if (!m) return 'print';
  if (m.kind === 'logo' || m.kind === 'headline') return 'logo';
  const crop = coverCrop(m, W, H);
  // The picture is too small to hold the frame, or its subject would not fit in the crop.
  const sharp = m.regions?.sharp_width_px ?? m.width;
  const wanted = 1080 / crop.w;
  if (sharp < wanted * 0.38) return 'print';
  if (m.face && (m.face.w * 1.05 > crop.w || m.face.h / crop.h > 0.55)) return 'print';
  return 'cover';
}

/** A logo's ground: light under a dark mark, dark under anything else. Pure. */
export function logoGround(m) {
  const b = m?.regions?.brightness;
  return Number.isFinite(b) && b < 0.3 ? '#efece4' : '#0b0b0b';
}

// ── Wall of Screens ─────────────────────────────────────────────────────────────────────────────

/**
 * About five ways to show one image on a TV, read from its faces and subject: the whole picture, close on the face, closer
 * still, what stands beside it, and another part of the scene. Each reads as a different shot. Pure.
 */
export function screenTreatments(m) {
  if (m.kind === 'logo') {
    return [
      { at: [0.5, 0.5], zoom: 1 },
      { at: [0.5, 0.5], zoom: 1.5 },
      { at: [0.3, 0.3], zoom: 2.2 },
      { at: [0.7, 0.6], zoom: 2.2 },
      { at: [0.5, 0.5], zoom: 2.8 },
    ];
  }
  const s = subjectOf(m);
  if (!s) {
    return [
      { at: [0.5, 0.5], zoom: 1 },
      { at: [0.28, 0.38], zoom: 2.4 },
      { at: [0.72, 0.6], zoom: 2.4 },
      { at: [0.55, 0.3], zoom: 1.8 },
      { at: [0.4, 0.72], zoom: 3 },
    ];
  }
  const cx = s.x + s.w / 2;
  const cy = s.y + s.h / 2;
  const tight = clamp(0.6 / Math.max(s.w, s.h, 0.05), 1.2, 4.5);
  const faces = m.regions?.faces ?? [];
  const other = faces.length > 1 ? [faces[1].x + faces[1].w / 2, faces[1].y + faces[1].h / 2] : [clamp(cx + (cx < 0.5 ? 0.3 : -0.3)), clamp(cy + 0.3)];
  return [
    { at: [0.5, 0.5], zoom: 1 },
    { at: [cx, cy], zoom: tight },
    { at: [cx, cy - s.h * 0.1], zoom: tight * 1.7 },
    { at: other, zoom: Math.max(1.6, tight * 0.7) },
    { at: [clamp(cx + (cx < 0.5 ? 0.22 : -0.22)), clamp(cy + 0.42)], zoom: 2.1 },
  ];
}

/** Which image and treatment each TV shows, so neighbours differ and the images spread evenly. The largest shows the first image. Pure. */
export function wallCells(screens, assets) {
  let big = 0;
  screens.forEach((q, i) => { if (q[2] * q[3] > screens[big][2] * screens[big][3]) big = i; });
  const order = screens.map((_, i) => i).filter((i) => i !== big).sort((a, b) => (screens[a][1] - screens[b][1]) * 3 + (screens[a][0] - screens[b][0]));
  const cells = screens.map(() => null);
  cells[big] = { asset: assets[0], way: 0, big: true };
  const used = assets.map(() => 0);
  order.forEach((i, n) => {
    const a = n % assets.length;
    cells[i] = { asset: assets[a], way: used[a] % 5, big: false };
    used[a]++;
  });
  return { cells, big };
}

const rnd = (s) => { const v = Math.sin(s * 127.1 + 11.7) * 43758.5453; return v - Math.floor(v); };

// ── Plans ───────────────────────────────────────────────────────────────────────────────────────

function flashbulb(choice, env) {
  const { duration, words } = env;
  const times = beatTimes(choice.beats, env);
  const charged = chargedAt(choice, env, times[times.length - 1]);
  // The last picture freezes on the charged words; a line that says them early still fires every picture first.
  const lastBefore = times[times.length - 2] ?? 0;
  const freezeAt = round(Math.min(Math.max(charged, lastBefore + 0.25), Math.max(lastBefore + 0.25, duration - 0.8)));
  const shots = choice.beats.map((b, i) => ({ asset: b.asset, t: i === times.length - 1 ? freezeAt : times[i] }));
  shots[0].t = 0;
  const end = voiceEnd(words, duration);
  // Past the freeze the press keeps shooting: a long hold stays alive, each flash with its shutter.
  const later = wordsBetween(words, freezeAt + 0.9, end - 0.2, 1.05);
  return { id: 'flashbulb', duration, shots, freeze: shots.length - 1, freezeAt, later };
}

function wall(choice, env) {
  const { duration } = env;
  const times = beatTimes(choice.beats, env);
  const assets = choice.beats.map((b) => b.asset);
  const charged = chargedAt(choice, env, times[times.length - 1]);
  // Inside the screen before the charged words land; whatever appears inside can be read before the frame ends.
  const hold = 1.2;
  const tIn = round(clamp(charged - 0.35, Math.min(1.3, duration * 0.3), Math.max(Math.min(1.3, duration * 0.3), duration - hold - 0.35)));
  const tEnter = round(Math.max(0.3, tIn - 0.55));
  const first = round(Math.min(Math.max(charged, tIn + 0.3), duration - hold));
  const later = choice.beats.map((b, i) => ({ asset: b.asset, t: times[i] })).filter((b, i) => i > 0 && b.t > first + 0.05);
  const inside = [{ asset: pickInside(choice, times, charged), t: first }];
  for (const b of later) {
    const prev = inside[inside.length - 1];
    // An inset joins the picture already on screen, so that one stays readable; a new main picture replaces it and has to wait.
    const wait = inside.length % 2 === 1 ? 0.6 : hold;
    if (b.asset !== prev.asset && b.t >= prev.t + wait && b.t <= duration - hold) inside.push({ asset: b.asset, t: b.t });
  }
  const { cells, big } = wallCells(SCREENS, assets);
  const others = SCREENS.map((_, i) => i).filter((i) => i !== big).sort((a, b) => rnd(a + 3) - rnd(b + 3));
  const kills = {};
  const from = tEnter * 0.28;
  others.forEach((i, n) => { kills[i] = round(from + (tEnter - from) * Math.pow(n / others.length, 0.85)); });
  return { id: 'wall_of_screens', duration, assets, cells, big, kills, tEnter, tIn, inside, entered: assets[0], charged };
}

/** What appears inside the screen first: the beat on or nearest after the charged words, never the picture we entered. */
function pickInside(choice, times, charged) {
  const later = choice.beats.findIndex((b, i) => i > 0 && times[i] >= charged - 0.05);
  const at = later >= 0 ? later : choice.beats.length - 1;
  return choice.beats[Math.max(at, Math.min(1, choice.beats.length - 1))].asset;
}

function lockOn(choice, env) {
  const { duration, media, words } = env;
  const times = beatTimes(choice.beats, env);
  const charged = chargedAt(choice, env, times[times.length - 1]);
  const targets = [];
  let start = 0;
  choice.beats.forEach((b, i) => {
    const m = media[b.asset] ?? {};
    const logo = m.kind === 'logo';
    const lock = round(Math.max(times[i], start + 0.75));
    if (lock > duration - 0.5 && i > 0) return;
    const s = subjectOf(m) ?? { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };
    // Close enough to read a face, never so close the brackets leave the frame.
    const aspect = (m.width || 1) / (m.height || 1);
    const fh = logo ? 0.7 : clamp(Math.max(s.h / 0.42, (s.w / 0.62) * aspect * (16 / 9)), 0.12, 1);
    const n = logo ? 2 : clamp(Math.floor((lock - start) / 0.38) + 1, 2, 4);
    const steps = [];
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      steps.push({ t: round(lock - (lock - start) * (1 - f)), h: Math.pow(fh, f) });
    }
    targets.push({ asset: b.asset, logo, start, lock, steps, box: { x: s.x, y: s.y, w: s.w, h: s.h } });
    start = round(lock + Math.max(0.55, Math.min(1, (times[i + 1] ?? lock + 1) - lock - 0.8)));
  });
  // A figure on the charged words is the line's point: it stamps over the picture, in the voice's own words.
  const said = String(choice.charged ?? '').trim();
  const stamp = /\d/.test(said) && said.length <= 18 ? { text: said, t: charged, until: round(Math.min(duration, (targets.find((x) => x.start > charged)?.start ?? duration))) } : null;
  const beatsAfter = wordsBetween(words, (targets[targets.length - 1]?.lock ?? 0) + 1.2, voiceEnd(words, duration) - 0.2, 1.4);
  return { id: 'lock_on', duration, targets, stamp, charged, pulses: beatsAfter };
}

function rewind(choice, env) {
  const { duration, words, years } = env;
  const times = beatTimes(choice.beats, env);
  const yearOf = (a) => years?.[a] ?? null;
  const dated = choice.beats.map((b, i) => ({ ...b, i, year: yearOf(b.asset) })).filter((b) => b.year != null);
  const landing = dated.length ? dated.reduce((a, b) => (b.year < a.year ? b : a)) : { asset: choice.beats[0].asset, i: 0, year: null };
  const run = dated.filter((b) => b.asset !== landing.asset).sort((a, b) => b.year - a.year);
  // The tape needs a moment to run, whatever word the landing is on.
  const land = round(clamp(Math.max(times[landing.i], 0.3 * run.length + 0.5), 0.6, Math.max(0.6, duration - 1.2)));
  const rew = run.map((b, i) => ({ asset: b.asset, t: round((land * i) / Math.max(1, run.length)), year: b.year }));
  const after = choice.beats.map((b, i) => ({ asset: b.asset, t: times[i], i })).filter((b) => b.i !== landing.i && !run.some((r) => r.asset === b.asset) && b.t > land + 0.4);
  const shots = [{ asset: landing.asset, t: land }, ...after.map(({ asset, t }) => ({ asset, t }))];
  // A last picture far enough off gets the tape run forward into it.
  const last = shots[shots.length - 1];
  const ff = shots.length > 1 && last.t - shots[shots.length - 2].t >= 1.4 ? { from: round(last.t - 0.54), to: last.t } : null;
  const charged = chargedAt(choice, env, land);
  const end = voiceEnd(words, duration);
  const cuts = shots.slice(1).map((s) => s.t);
  // A long hold on the tape still tracks now and then.
  const glitches = wordsBetween(words, land + 1.3, end - 0.3, 1.6).filter((t) => !cuts.some((c) => Math.abs(c - t) < 0.7) && !(ff && t >= ff.from - 0.3));
  return { id: 'rewind', duration, land, rew, shots, ff, charged, cuts, glitches, topYear: run[0]?.year ?? landing.year, landYear: landing.year };
}

function darkroom(choice, env) {
  const { duration, words } = env;
  const times = beatTimes(choice.beats, env);
  const charged = chargedAt(choice, env, voiceEnd(words, duration) * 0.7);
  const developFrom = Math.min(0.4, duration * 0.08);
  const done = round(clamp(charged, Math.min(1.5, duration - 0.6), Math.max(Math.min(1.5, duration - 0.6), duration - 0.6)));
  const prints = [{ asset: choice.beats[0].asset, t: 0, from: developFrom, to: done }];
  const second = choice.beats[1];
  if (second) {
    const t = round(Math.max(times[1], done + 0.5));
    if (t <= duration - 0.9) prints.push({ asset: second.asset, t, from: t + 0.1, to: round(t + Math.min(0.9, duration - t - 0.2)) });
  }
  const agitations = wordsBetween(words, 0.9, done - 0.4, 1.3);
  const lastTo = prints[prints.length - 1].to;
  const after = wordsBetween(words, lastTo + 0.8, voiceEnd(words, duration) - 0.2, 1.4);
  return { id: 'darkroom', duration, prints, done, agitations, after };
}

function slideCarousel(choice, env) {
  const { duration } = env;
  const times = beatTimes(choice.beats, env);
  const slides = choice.beats.map((b, i) => ({ asset: b.asset, t: round(Math.max(times[i], i === 0 ? 0.14 : 0)) }));
  return { id: 'slide_carousel', duration, slides, pullFrom: Math.max(0, slides[0].t - 0.02), pullTo: slides[0].t + 0.5, charged: chargedAt(choice, env, slides[slides.length - 1].t) };
}

function frontPage(choice, env) {
  const { duration } = env;
  const times = beatTimes(choice.beats, env);
  const heads = choice.headlines ?? [];
  const pages = choice.beats.map((b, i) => {
    const prev = i ? times[i - 1] : -Infinity;
    const land = round(Math.max(times[i], i === 0 ? 0.8 : prev + 0.7));
    const spin = round(Math.max(land - 0.5, i === 0 ? 0.3 : prev + 0.2));
    return { asset: b.asset, land, spin, headline: heads.length ? heads[i % heads.length].text : '' };
  }).filter((p, i) => i === 0 || p.land <= duration - 0.6);
  const charged = chargedAt(choice, env, pages[pages.length - 1].land);
  const main = pages.reduce((a, p) => (Math.abs(p.land - charged) < Math.abs(a.land - charged) ? p : a)).land;
  const pushes = pages.map((p, i) => round(p.land + Math.min(0.6, ((pages[i + 1]?.spin ?? duration) - p.land) * 0.4)));
  return { id: 'front_page', duration, pages, main, pushes };
}

function burn(choice, env) {
  const { duration } = env;
  const times = beatTimes(choice.beats, env);
  const charged = chargedAt(choice, env, times[times.length - 1]);
  const burns = [];
  choice.beats.forEach((b, i) => {
    if (i === 0) return;
    const prevEnd = burns.length ? burns[burns.length - 1].t + burns[burns.length - 1].d : 0.2;
    // A word near the end burns in time to finish; there's always at least one burn when a burn fits at all.
    const t = round(Math.max(Math.min(times[i] - 0.35, duration - 0.95), prevEnd + 0.1));
    const room = (times[i + 1] ?? duration) - t - 0.15;
    const main = Math.abs(times[i] - charged) < 0.8;
    const d = round(clamp(room, 0.9, main ? 1.55 : 1.15));
    if (t + 0.9 <= duration) burns.push({ t, d: Math.min(d, duration - t), flipX: i % 2 ? 1 : -1, flipY: i === 3 ? -1 : 1 });
  });
  const shots = [choice.beats[0].asset, ...choice.beats.slice(1, burns.length + 1).map((b) => b.asset)];
  return { id: 'burn', duration, shots, burns };
}

const PLANS = { flashbulb, wall_of_screens: wall, lock_on: lockOn, rewind, darkroom, slide_carousel: slideCarousel, front_page: frontPage, burn };

/**
 * A hook's plan: every time and crop its template draws and its score plays. `years`: picture id → year, for the tape's
 * counter. `reports`: the words that couldn't be found. Pure; throws only on a hook it doesn't know or one with no beats.
 */
export function planHook(choice, { media = {}, words = [], duration, cueAt, years = {} }) {
  const make = PLANS[choice?.id];
  if (!make) throw new Error(`no hook "${choice?.id}"`);
  if (!choice.beats?.length) throw new Error(`hook ${choice.id} has no pictures`);
  const reports = [];
  const env = { media, words, duration, cueAt, years, report: (r) => reports.push(r) };
  const plan = make(choice, env);
  const assets = [...new Set(choice.beats.map((b) => b.asset))];
  return { ...plan, assets, reports };
}

// ── Scores ──────────────────────────────────────────────────────────────────────────────────────

/** One sound: a file from the bank at `level_db` over its normalized peak (-1 dBFS). */
function cue(t, name, level_db, dur = null) {
  return { t: round(Math.max(0, t)), kind: 'file', src: SFX(name), level_db, ...(dur != null ? { dur: round(dur) } : {}) };
}

/** A bed from `from` to `to`, its file repeating with a small overlap. */
function bed(name, level_db, from, to) {
  const len = SFX_SECONDS[name] ?? 4;
  const out = [];
  for (let at = from; at < to - 0.2; at += len - 0.15) out.push(cue(at, name, level_db, Math.min(len, to - at)));
  return out;
}

// Levels, from the approved mockups' effective peaks. Sounds the mockups left inaudible (generated at -40 dB and below)
// are lifted so every visible move is heard; the press bed stays well under the voice, and Burn has no low hit.
const SCORES = {
  flashbulb: (p) => [
    cue(p.shots[1]?.t ?? 0.3, 'flash', -16),
    cue(0, 'shutter', -3),
    ...p.shots.slice(1).flatMap((s, i) => (i === p.shots.length - 2 ? [cue(s.t, 'shutter', -2), cue(s.t, 'hit', -1.5)] : [cue(s.t, 'shutter', -3)])),
    ...p.later.map((t) => cue(t, 'shutter', -9)),
  ],
  wall_of_screens: (p) => [
    ...bed('crtroom', -8, 0, p.duration),
    ...Object.values(p.kills).map((t) => cue(t, 'crtoff', -20, 0.25)),
    cue(p.tEnter, 'whoosh', -7),
    cue(p.tIn - 0.03, 'staticburst', -10, 0.35),
    ...p.inside.flatMap((s, i) => (i === 0 ? [cue(s.t, 'hit', -2)] : [cue(s.t - 0.03, 'track', -13), cue(s.t, 'staticburst', -14, 0.25), cue(s.t, 'hit', -11)])),
  ],
  lock_on: (p) => [
    ...p.targets.flatMap((tg, i) => [
      ...(i > 0 ? [cue(tg.start - 0.12, 'whoosh', -9)] : []),
      ...tg.steps.map((s) => cue(s.t, 'servo', -5)),
      cue(tg.lock, 'locktone', -4),
    ]),
    cue(p.charged, 'hit', p.stamp ? -3 : -6),
    ...p.pulses.map((t) => cue(t, 'servo', -14)),
  ],
  rewind: (p) => [
    cue(0.03, 'rewind', -5.5, Math.max(0.3, p.land - 0.03)),
    cue(p.land, 'hit', -1.5),
    ...bed('vcr', -18, p.land, p.duration),
    ...p.cuts.flatMap((t) => [cue(t - 0.02, 'track', -11), cue(t, 'hit', -8)]),
    ...(p.ff ? [cue(p.ff.from, 'rewind', -9, p.ff.to - p.ff.from)] : []),
    ...p.glitches.map((t) => cue(t, 'track', -14)),
    ...(Math.abs(p.charged - p.land) > 0.4 && !p.cuts.some((t) => Math.abs(t - p.charged) < 0.4) ? [cue(p.charged, 'hit', -9)] : []),
  ],
  darkroom: (p) => [
    cue(0.03, 'slip', -13),
    ...bed('darkroom', -7, 0, p.done),
    cue(p.prints[0].from, 'timer', -10, Math.max(0.3, p.done - p.prints[0].from)),
    ...p.agitations.map((t) => cue(t, 'slip', -18)),
    cue(p.done, 'hit', -2.5),
    cue(p.done, 'shutter', -7),
    ...bed('darkroom', -10, p.done, p.duration),
    ...p.prints.slice(1).flatMap((s) => [cue(s.t - 0.02, 'slip', -9), cue(s.to, 'hit', -7)]),
    ...p.after.map((t) => cue(t, 'slip', -18)),
  ],
  slide_carousel: (p) => [
    ...bed('fan', -20, 0, p.duration),
    ...p.slides.map((s) => cue(s.t - 0.01, 'kachunk', -2)),
  ],
  // Each page lands on its own paper crinkle, none repeated; the press bed sits far under the voice (Lucas, 2026-11-07).
  front_page: (p) => [
    cue(0, 'press', -26, p.pages[0].land),
    ...p.pages.map((s, i) => cue(s.land - 0.12, `crinkle${(i % 5) + 1}`, s.land === p.main ? -1.5 : -4, 1.2)),
  ],
  burn: (p) => p.burns.map((b) => cue(b.t - 0.05, 'fire', -1, b.d + 0.2)),
};

/** The hook's sounds as `file` events, in order, inside the frame. Pure. */
export function hookScore(plan) {
  const out = SCORES[plan.id](plan).filter((c) => c.t < plan.duration - 0.02).map((c) => (c.dur != null && c.t + c.dur > plan.duration ? { ...c, dur: round(plan.duration - c.t) } : c));
  return out.map((c) => (c.dur != null && c.dur < 0.05 ? { ...c, dur: 0.05 } : c)).sort((a, b) => a.t - b.t);
}
