// Mount the frames of an AI News Explained reel (D1, RC-47). Deterministic, no model.
//
// Frame workers write scene code only: assets/frames/<id>.js, whose default export is
//   { ground, build(root, ctx), render(t) }
// build() creates the frame's DOM once with the news kit (assets/kit/components/), render(t) is a pure
// function of frame time (transforms, dash offsets, clip paths, opacity). This writes the HyperFrames
// composition around it, compositions/frames/<id>.html: the kit installed, fonts and images loaded,
// build() run, one paused clock tween calling render(t), the timeline registered, and build readiness
// held until frame 0 is drawn. The frame's word times (assets/timing/<id>.json) are baked in as
// ctx.timing so render(t) can land marks on words.
//
// Frame 1 gets the sting over its hold (sting.js, from its voice_end); frame 8 is the kit's close.
// Caption windows in .hyperframes/caption-skin.html: DARK (light captions) on the board; QUIET during
// the sting and the close.
//
//   node assets/kit/mount.mjs          every storyboard frame that has a scene module
//   node assets/kit/mount.mjs <id>     one frame
//
// Prints JSON { mounted[], skipped[], errors[], darkWindows } and exits 1 on any error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  DARK_GROUNDS, GROUND_NAMES, STING_FRAME, frameGround, isClose, projectFrames, stingAt, writeClose, writeStingEvents,
  objectStrokes,
} from './frames.mjs';

export { GROUND_NAMES };

const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
/** Faces a frame may use; each is loaded before build() so measured marks land on final glyphs. */
export const FONT_LOADS = [
  '700 40px "Pragmatica Extended"', '400 40px Roboto', '700 40px Roboto', '400 40px "Gochi Hand"',
  '700 40px "Playfair Display"', '400 40px "Courier Prime"', '400 40px Tinos', '700 40px Tinos', 'italic 400 40px Tinos',
];

/** A frame id as a safe DOM id ("04-moment" → "f04_moment"). */
export const domKey = (id) => `f${id.replace(/[^a-zA-Z0-9]/g, '_')}`;

/** The frame's timing file, or a minimal one. */
function timingOf(root, f) {
  const file = join(root, 'assets', 'timing', `${f.id}.json`);
  try {
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    // fall through
  }
  return { frame: f.number, id: f.id, duration: f.duration, voice_end: null, hold: null, words: [] };
}

/** The composition for one frame. */
export function frameHtml(id, duration, { ground = 'board', timing = null, sting = null, close = false, objects = null } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`mount: frame id ${id} must be lowercase letters, digits, dashes`);
  if (!(duration > 0)) throw new Error(`mount: frame ${id} needs a positive duration`);
  if (!close && !GROUND_NAMES.includes(ground)) throw new Error(`mount: frame ${id} ground "${ground}" must be ${GROUND_NAMES.join(', ')}`);
  const key = domKey(id);
  const ctx = { id, duration, ground, timing: timing ?? { words: [] }, sting, objects: objects ?? { drawing: {}, 'person-sketch': {} } };
  return `<template>
  <div id="root" data-composition-id="${id}" data-width="1080" data-height="1920" data-start="0" data-duration="${duration}">
    <script src="${GSAP}"></script>
    <style>
      #root { position: absolute; inset: 0; container-type: size; overflow: hidden; }
      #${key}-world { position: absolute; inset: 0; overflow: hidden; }
    </style>
    <script>
      window.__hf = window.__hf || {};
      window.__hf.buildReady = window.__hf.buildReady || {};
      window.__hf.buildReady['${id}'] = new Promise(function (resolve) { window.__ready_${key} = resolve; });
    </script>
    <div id="${key}-world" class="clip" data-start="0" data-duration="${duration}" data-track-index="0" data-layout-allow-overflow></div>
    <script type="module">
      import * as nk from './assets/kit/components/index.js';
      import scene from './assets/frames/${id}.js';
      ${sting ? "import { buildSting } from './assets/kit/sting.js';" : ''}
      nk.installKit(document, { fonts: 'assets/fonts/' });
      const host = document.getElementById('${key}-world');
      const ctx = Object.assign(${JSON.stringify(ctx)}, { nk, assets: 'assets/' });
      await Promise.all(${JSON.stringify(FONT_LOADS)}.map((f) => document.fonts.load(f).catch(() => null)));
      scene.build(host, ctx);
      ${sting ? 'const sting = buildSting(host, nk, { at: ctx.sting.at });' : ''}
      await Promise.all([...host.querySelectorAll('img')].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
      // One clock (seek-safe): a single tween drives t; the frame is a pure function of t.
      const draw = (t) => { scene.render(t);${sting ? ' sting.render(t);' : ''} };
      const clock = { t: 0 };
      const tl = gsap.timeline({ paused: true });
      tl.fromTo(clock, { t: 0 }, { t: ${duration}, duration: ${duration}, ease: 'none', onUpdate: () => draw(clock.t) }, 0);
      draw(0);
      window.__timelines = window.__timelines || {};
      window.__timelines['${id}'] = tl;
      window.__ready_${key}();
    </script>
  </div>
</template>
`;
}

/** Mount every frame of the project at `root` that has a scene module (or only `only`). */
export function mountFrames(root, only = null) {
  const mounted = [];
  const skipped = [];
  const errors = [];
  const frames = projectFrames(root).filter((f) => !only || f.id === only);
  const strokes = objectStrokes(root);
  if (only && frames.length === 0) errors.push(`STORYBOARD.md has no frame ${only}`);
  for (const f of frames) {
    if (!f.id) {
      errors.push(`frame ${f.number} has no src`);
      continue;
    }
    const close = isClose(f);
    if (close) writeClose(root, f);
    if (!existsSync(join(root, 'assets', 'frames', `${f.id}.js`))) {
      skipped.push(f.id);
      continue;
    }
    const sting = f.number === STING_FRAME ? { at: stingAt(f) } : null;
    if (sting) writeStingEvents(root, f);
    try {
      const out = join(root, 'compositions', 'frames', `${f.id}.html`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, frameHtml(f.id, f.duration, { ground: frameGround(f), timing: timingOf(root, f), sting, close, objects: close ? null : strokes }));
      mounted.push(f.id);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const dark = only ? null : fillCaptionGrounds(root);
  return { mounted, skipped, errors, darkWindows: dark };
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Where captions turn light: every board frame (dark cork), in reel seconds. */
export function darkWindows(frames) {
  const out = [];
  let at = 0;
  for (const f of frames) {
    const dur = f.duration > 0 ? f.duration : 0;
    if (!isClose(f) && DARK_GROUNDS.has(frameGround(f))) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - at) < 1e-6) last[1] = round(at + dur);
      else out.push([round(at), round(at + dur)]);
    }
    at += dur;
  }
  return out;
}

/** Where captions step aside: the sting (frame 1 from its voice end) and the close. */
export function quietWindows(frames) {
  const out = [];
  let at = 0;
  for (const f of frames) {
    const dur = f.duration > 0 ? f.duration : 0;
    if (f.number === STING_FRAME && dur > 0) out.push([round(at + Math.min(stingAt(f), dur)), round(at + dur)]);
    if (isClose(f) && dur > 0) out.push([round(at), round(at + dur)]);
    at += dur;
  }
  return out;
}

/** Fill `var DARK = …;` and `var QUIET = …;` in the project's caption skin. Returns the dark windows, or null with no skin. */
export function fillCaptionGrounds(root) {
  const skin = join(root, '.hyperframes', 'caption-skin.html');
  if (!existsSync(skin)) return null;
  const frames = projectFrames(root);
  const windows = darkWindows(frames);
  const html = readFileSync(skin, 'utf8');
  const next = html
    .replace(/^([ \t]*)var DARK = \[[\s\S]*?\];/m, (_, indent) => `${indent}var DARK = ${JSON.stringify(windows)};`)
    .replace(/^([ \t]*)var QUIET = \[[\s\S]*?\];/m, (_, indent) => `${indent}var QUIET = ${JSON.stringify(quietWindows(frames))};`);
  if (next !== html) writeFileSync(skin, next);
  return windows;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = mountFrames(process.cwd(), process.argv[2] ?? null);
  console.log(JSON.stringify(result, null, 1));
  process.exit(result.errors.length ? 1 : 0);
}
