// Mount the frames of a Reel AI Drama reel. Deterministic, no model. Forked from the news kit's
// mount.mjs: no sting; any number of frames; the last frame is the brand close; ctx carries the frame's
// treatment and the reel's media.
//
// Frame workers write scene code only: assets/frames/<id>.js, whose default export is
//   { treatment, build(root, ctx), render(t) }
// build() creates the frame's DOM once with the kit (assets/kit/components/), render(t) is a pure
// function of frame time. This writes the HyperFrames composition around it,
// compositions/frames/<id>.html: the kit installed, fonts and images loaded, build() run, one paused
// clock tween calling render(t), the timeline registered, and build readiness held until frame 0 is
// drawn. ctx = { id, duration, treatment, timing: { words[], lines[] }, media, objects, nk, assets: 'assets/' }.
//
// Caption windows in .hyperframes/caption-skin.html: DARK (light captions) on every dark ground (all
// but the whiteboard); QUIET stays empty: the close question is captioned (MD-18).
//
//   node assets/kit/mount.mjs          every storyboard frame that has a scene module
//   node assets/kit/mount.mjs <id>     one frame
//
// Prints JSON { mounted[], skipped[], errors[], darkWindows } and exits 1 on any error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { LIGHT_TREATMENTS, TREATMENTS, frameTreatment, isClose, objectStrokes, projectFrames, projectMedia, writeClose } from './frames.mjs';

export { TREATMENTS };

const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
/** Faces a frame may use; each is loaded before build() so measured marks land on final glyphs. */
export const FONT_LOADS = [
  '700 40px "Pragmatica Extended"', '400 40px Roboto', '500 40px Roboto', '700 40px Roboto', '400 40px "Gochi Hand"',
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
  return { frame: f.number, id: f.id, duration: f.duration, voice_end: null, hold: null, words: [], lines: [] };
}

/**
 * The composition for one frame.
 * @param {string} id
 * @param {number} duration
 * @param {{ treatment?: string, timing?: object | null, media?: Record<string, object> | null, objects?: object | null }} [options]
 */
export function frameHtml(id, duration, { treatment = 'photo', timing = null, media = null, objects = null } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`mount: frame id ${id} must be lowercase letters, digits, dashes`);
  if (!(duration > 0)) throw new Error(`mount: frame ${id} needs a positive duration`);
  if (!TREATMENTS.includes(treatment)) throw new Error(`mount: frame ${id} treatment "${treatment}" must be one of ${TREATMENTS.join(', ')}`);
  const key = domKey(id);
  const ctx = { id, duration, treatment, timing: timing ?? { words: [], lines: [] }, media: media ?? {}, objects: objects ?? { drawing: {}, 'person-sketch': {} } };
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
      nk.installKit(document, { fonts: 'assets/fonts/' });
      const host = document.getElementById('${key}-world');
      const ctx = Object.assign(${JSON.stringify(ctx)}, { nk, assets: 'assets/' });
      await Promise.all(${JSON.stringify(FONT_LOADS)}.map((f) => document.fonts.load(f).catch(() => null)));
      scene.build(host, ctx);
      await nk.settleImages(host, ctx.assets);
      // One clock (seek-safe): a single tween drives t; the frame is a pure function of t.
      const draw = (t) => { scene.render(t); };
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
  const media = projectMedia(root);
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
    try {
      const out = join(root, 'compositions', 'frames', `${f.id}.html`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, frameHtml(f.id, f.duration, { treatment: frameTreatment(f), timing: timingOf(root, f), media: close ? {} : media, objects: close ? null : strokes }));
      mounted.push(f.id);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const dark = only ? null : fillCaptionGrounds(root);
  return { mounted, skipped, errors, darkWindows: dark };
}

const round = (n) => Math.round(n * 1000) / 1000;

/** Where captions are light: every frame on a dark ground (all but the whiteboard), in reel seconds. */
export function darkWindows(frames) {
  const out = [];
  let at = 0;
  for (const f of frames) {
    const dur = f.duration > 0 ? f.duration : 0;
    if (!LIGHT_TREATMENTS.has(frameTreatment(f))) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - at) < 1e-6) last[1] = round(at + dur);
      else out.push([round(at), round(at + dur)]);
    }
    at += dur;
  }
  return out;
}

/** Where captions step aside: nowhere. The close's question is spoken and captioned (MD-18). */
export function quietWindows() {
  return [];
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
