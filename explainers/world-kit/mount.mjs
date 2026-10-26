// Mount the frames of an Explainers 3.0 reel (EX3-52). Deterministic, no model.
//
// Frame workers write scene code only: assets/frames/<id>.js, whose default export is
// { ground, draw(t) } (an SVG string, a pure function of frame time). This writes the HyperFrames
// composition around it, compositions/frames/<id>.html: the frame's storyboard `ground` drawn once
// underneath on a clip layer, the world redrawn on every tick of a single clock tween, the
// timeline registered for HyperFrames, and build readiness held until the module has drawn frame
// 0. Ported from Explainer 2.0's shot wrapper.
//
// It also fills the caption skin's dark-ground windows (`var DARK = [];` in
// .hyperframes/caption-skin.html) from the storyboard's grounds and durations, so captions turn
// light on the stage (hx-4's one dark ground; `night` and `forest` are its old names), and its quiet windows (`var QUIET = [];`): the opener's title card
// (all of frame 1) and the dictionary card (all of frame 3), where captions step
// aside (EX3-44, EX3-45). Run it after pace.mjs and before `captions.mjs build`. The voiceless
// close (frame 8) is the kit's close.js: this writes its module and sound events (EX3-95).
//
//   node assets/kit/mount.mjs          every storyboard frame that has a scene module
//   node assets/kit/mount.mjs <id>     one frame
//
// Prints JSON { mounted[], skipped[], errors[], darkWindows } and exits 1 on any error.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { HOOK_ID, isBankOpener, isClose, projectFrames, seconds, writeClose, writeOpener } from './frames.mjs';
import { GROUNDS, GROUND_ALIASES } from './core.js';

/** The grounds (hx-4): paper (the studio sweep), stage (the premium lit stage), white (the close). */
export const GROUND_NAMES = Object.keys(GROUNDS);
/** Retired names that still mount, drawn as the stage (lint flags them in a storyboard). */
export { GROUND_ALIASES };
const groundKey = (name) => GROUND_ALIASES[name] ?? name;
const DARK_GROUNDS = new Set(GROUND_NAMES.filter((n) => GROUNDS[n].dark));

const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js';
export const FONTS = `
      @font-face{font-family:"Pragmatica Extended";font-weight:700;font-display:block;src:url("assets/fonts/PragmaticaExtended-Bold.otf") format("opentype");}
      @font-face{font-family:"Roboto";font-weight:300;font-display:block;src:url("assets/fonts/Roboto-300.woff2") format("woff2");}
      @font-face{font-family:"Roboto";font-weight:400;font-display:block;src:url("assets/fonts/Roboto-400.woff2") format("woff2");}
      @font-face{font-family:"Roboto";font-weight:500;font-display:block;src:url("assets/fonts/Roboto-500.woff2") format("woff2");}
      @font-face{font-family:"Roboto";font-weight:700;font-display:block;src:url("assets/fonts/Roboto-700.woff2") format("woff2");}`;

/** A frame id as a safe DOM id and JS identifier fragment ("04-analogy" → "f04_analogy"). */
export const domKey = (id) => `f${id.replace(/[^a-zA-Z0-9]/g, '_')}`;

/** The composition for one frame. `id` is the storyboard frame id; `duration` in seconds. */
export function frameHtml(id, duration, ground = 'paper') {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error(`mount: frame id ${id} must be lowercase letters, digits, dashes`);
  if (!(duration > 0)) throw new Error(`mount: frame ${id} needs a positive duration`);
  // an old name (night, forest) mounts as written; the kit draws it as the stage
  if (!GROUND_NAMES.includes(groundKey(ground))) throw new Error(`mount: frame ${id} ground "${ground}" must be ${GROUND_NAMES.join(', ')}`);
  const key = domKey(id);
  return `<template>
  <div id="root" data-composition-id="${id}" data-width="1080" data-height="1920" data-start="0" data-duration="${duration}">
    <script src="${GSAP}"></script>
    <style>${FONTS}
      #root { position: absolute; inset: 0; container-type: size; }
      #${key}-ground, #${key}-world { position: absolute; inset: 0; }
    </style>
    <script>
      window.__hf = window.__hf || {};
      window.__hf.buildReady = window.__hf.buildReady || {};
      window.__hf.buildReady['${id}'] = new Promise(function (resolve) { window.__ready_${key} = resolve; });
    </script>
    <div id="${key}-ground" class="clip" data-start="0" data-duration="${duration}" data-track-index="0"></div>
    <div id="${key}-world" data-layout-allow-overflow></div>
    <script type="module">
      import scene from './assets/frames/${id}.js';
      import { underlay } from './assets/kit/motion.js';
      // One clock (seek-safe): a single tween drives t; the frame is a pure function of t.
      const svg = (inner) => '<svg width="1080" height="1920" viewBox="0 0 1080 1920" xmlns="http://www.w3.org/2000/svg">' + inner + '</svg>';
      document.getElementById('${key}-ground').innerHTML = svg(underlay('u${key}-', '${ground}'));
      const world = document.getElementById('${key}-world');
      const draw = (t) => { world.innerHTML = svg(scene.draw(t)); };
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
  if (only && frames.length === 0) errors.push(`STORYBOARD.md has no frame ${only}`);
  for (const f of frames) {
    if (!f.id) {
      errors.push(`frame ${f.number} has no src`);
      continue;
    }
    // The close is the kit's (EX3-95): always its canonical module and sounds.
    if (isClose(f)) writeClose(root, f);
    // Frame 1 is the bank's opener over the worker's hook (EX3-102): ready once the hook is.
    const opener = isBankOpener(root, f) && writeOpener(root, f);
    if (opener && !existsSync(join(root, 'assets', 'frames', `${HOOK_ID}.js`))) {
      skipped.push(f.id);
      continue;
    }
    if (!existsSync(join(root, 'assets', 'frames', `${f.id}.js`))) {
      skipped.push(f.id);
      continue;
    }
    try {
      const out = join(root, 'compositions', 'frames', `${f.id}.html`);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, frameHtml(f.id, f.duration, frameGround(f)));
      mounted.push(f.id);
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  const dark = only ? null : fillCaptionGrounds(root);
  return { mounted, skipped, errors, darkWindows: dark };
}

/** A storyboard frame's ground (`- ground:`), paper when unset. */
export function frameGround(frame) {
  return (frame.fields?.ground ?? '').trim().toLowerCase() || 'paper';
}

/** The dark-ground windows of a storyboard, in seconds from the start of the reel. */
export function darkWindows(frames) {
  const out = [];
  let at = 0;
  for (const f of frames) {
    const dur = f.duration > 0 ? f.duration : 0;
    if (DARK_GROUNDS.has(groundKey(frameGround(f)))) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - at) < 1e-6) last[1] = round(at + dur);
      else out.push([round(at), round(at + dur)]);
    }
    at += dur;
  }
  return out;
}
const round = (n) => Math.round(n * 1000) / 1000;

/** Where captions step aside (EX3-79): all of frame 1 (the title card writes itself while the
 *  opener line plays), all of frame 3 (the dictionary card), and the close (EX3-95: no captions,
 *  and the last line's page never lingers over the logo). */
export function quietWindows(frames) {
  const out = [];
  let at = 0;
  for (const f of frames) {
    const dur = f.duration > 0 ? f.duration : 0;
    if ((f.number === 1 || f.number === 3 || isClose(f)) && dur > 0) out.push([round(at), round(at + dur)]);
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
