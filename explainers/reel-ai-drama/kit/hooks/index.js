// A hook as a frame module: `export default compiledHook(spec)`, the same { treatment, build(root, ctx), render(t) } shape as
// `compiledFrame`. render/compile.ts writes the spec as data: the frame's treatment, the resolved HookChoice, the pictures'
// years, and the frame's own compiled spec, which is what shows if the hook can't draw: the frame's first picture, plain. The
// reel still ships and the failure is reported. Records `document.__compiled[id]` so compiled-read and the plan check work.

import { compiledFrame } from '../components/compiled.js';
import { BURN_FRAMES, H, W, planHook } from './plan.js';
import { PLATES_NEEDED, TEMPLATES } from './templates.js';

export { planHook, hookScore, SFX_NAMES } from './plan.js';

const pad = (n) => String(n).padStart(3, '0');

/** What a template draws with: pictures by id, plates, and canvases that hold what doesn't change. */
function resources(doc, holder, choice, media) {
  const imgs = new Map();
  const add = (key, src) => {
    const im = doc.createElement('img');
    im.setAttribute('src', src);
    im.style.display = 'none';
    holder.append(im);
    imgs.set(key, im);
  };
  for (const b of choice.beats) if (media[b.asset]?.file && !imgs.has(b.asset)) add(b.asset, media[b.asset].file);
  for (const name of PLATES_NEEDED[choice.id] ?? []) add(`plate:${name}`, `assets/kit/hooks/plates/${name}.${name.startsWith('noise') ? 'png' : 'webp'}`);
  if (choice.id === 'burn') {
    for (let i = 0; i < BURN_FRAMES; i++) {
      add(`m:${i}`, `assets/kit/hooks/burn/m${pad(i)}.webp`);
      add(`f:${i}`, `assets/kit/hooks/burn/f${pad(i)}.webp`);
    }
  }
  const need = (key) => {
    const im = imgs.get(key);
    if (!im?.naturalWidth) throw new Error(`the picture ${key} did not load`);
    return im;
  };
  const canvases = new Map();
  const cached = new Map();
  return {
    media,
    img: (id) => need(id),
    plate: (name) => need(`plate:${name}`),
    burnMask: (n) => need(`m:${n}`),
    burnFire: (n) => need(`f:${n}`),
    /** A working canvas, reused between draws: nothing on it survives from one draw to the next that matters. */
    canvas(name, w = W, h = H) {
      if (!canvases.has(name)) {
        const c = doc.createElement('canvas');
        c.width = w;
        c.height = h;
        canvases.set(name, c);
      }
      return canvases.get(name);
    },
    /** A canvas painted once: the same whenever it's asked for. */
    cached(name, w, h, paint) {
      if (!cached.has(name)) {
        const c = doc.createElement('canvas');
        c.width = w;
        c.height = h;
        paint(c.getContext('2d'));
        cached.set(name, c);
      }
      return cached.get(name);
    },
  };
}

/** The record the plan check and the creative pass read. A hook frame is carried: its blueprint stands behind it as the fallback. */
function record(plan, choice, reports) {
  const pieces = choice.beats.map((b, i) => ({ id: `b${i + 1}`, asset: b.asset, at: plan?.times?.[i] ?? 0 }));
  return {
    hook_frame: choice.id,
    manifest: { pieces, labels: [], marks: [], arrows: [], speech: [], hook: null, camera: { move: 'hook', stops: [] } },
    reports,
    plain: false,
    cues: {},
    names_held_back: [],
    in_turn: [],
    closer_cuts: false,
    known_names: [],
    custom: [],
  };
}

export function compiledHook(spec, customModules = {}) {
  let draw = null;
  let plainFrame = null;
  let plainHost = null;
  let canvas = null;
  let failed = false;
  let rec = null;

  const fail = (err) => {
    failed = true;
    rec.plain = true;
    rec.reports.push(`hook_failed: ${err?.message ?? err}; this frame shows its first picture, plain`);
    if (canvas) canvas.style.display = 'none';
    if (plainHost) plainHost.style.display = '';
  };

  return {
    treatment: spec.treatment,
    build(root, ctx) {
      const doc = root.ownerDocument;
      const choice = spec.hook;
      const reports = [];
      // Built first and kept hidden: if the hook can't draw, this is what shows. Its cues aren't the hook's, so they come off.
      plainHost = doc.createElement('div');
      plainHost.style.cssText = 'position:absolute;inset:0;display:none';
      root.append(plainHost);
      plainFrame = compiledFrame({ ...spec.frame, plain: true }, customModules);
      plainFrame.build(plainHost, ctx);
      for (const el of plainHost.querySelectorAll('[data-cues]')) el.removeAttribute('data-cues');
      rec = record(null, choice ?? { id: 'unknown', beats: [] }, reports);
      (doc.__compiled ??= {})[ctx.id] = rec;
      try {
        const words = ctx.timing?.words ?? [];
        const plan = planHook(choice, { media: ctx.media ?? {}, words, duration: ctx.duration, cueAt: ctx.nk.cueAt, years: spec.years ?? {} });
        reports.push(...plan.reports);
        canvas = doc.createElement('canvas');
        canvas.width = W;
        canvas.height = H;
        canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
        root.append(canvas);
        const holder = doc.createElement('div');
        holder.style.display = 'none';
        root.append(holder);
        const R = resources(doc, holder, choice, ctx.media ?? {});
        const g = canvas.getContext('2d');
        const template = TEMPLATES[choice.id];
        draw = (t) => template(g, Math.max(0, t), plan, R);
        const times = choice.beats.map((b) => ctx.nk.cueAt(words, b.on) ?? 0);
        rec.manifest.pieces = choice.beats.map((b, i) => ({ id: `b${i + 1}`, asset: b.asset, at: times[i] }));
      } catch (err) {
        fail(err);
      }
    },
    render(t) {
      if (!failed && draw) {
        try {
          draw(t);
          return;
        } catch (err) {
          fail(err);
        }
      }
      plainFrame.render(t);
    },
  };
}
