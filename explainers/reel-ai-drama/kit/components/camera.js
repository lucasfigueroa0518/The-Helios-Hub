// The camera rig: one per frame. It moves the scene's `cam` layer (never the lamp or the grain) through
// keys with the brand ease-out, and racks focus by softening every item except the focal one.
// Moves are motivated: push into what the voice names, ride a cord or arrow, follow a marker tip.
import { cameraAt, cameraTransform, pointAt, clamp, FRAME } from '../geometry.js';

export function cameraRig(scene) {
  const keys = [];
  const rig = {
    /** Add a key: at time t, bring (x, y) to centre at `scale`. ease: 'out' (camera) | 'inOut'. */
    key(t, x, y, scale = 1, ease = 'out') { keys.push({ t, x, y, scale, ease }); keys.sort((a, b) => a.t - b.t); return rig; },
    /** Push into a box over [t0, t1]: frames it at `fill` of the frame width. */
    push(t0, t1, box, { fill = 0.8, from = null } = {}) {
      const scale = clamp((FRAME.w * fill) / Math.max(box.w, 1), 1, 2.4);
      const start = from ?? rig.at(t0);
      rig.key(t0, start.x, start.y, start.scale).key(t1, box.x + box.w / 2, box.y + box.h / 2, scale);
      return rig;
    },
    /** Ride along a polyline (a cord, an arrow shaft) over [t0, t1] at a fixed scale. */
    ride(t0, t1, pts, scale = 1.15, steps = 6) {
      for (let i = 0; i <= steps; i++) { const [x, y] = pointAt(pts, i / steps); rig.key(t0 + ((t1 - t0) * i) / steps, x, y, scale, 'inOut'); }
      return rig;
    },
    /** Follow a marker tip: pass a function u → [x, y] and the stroke's window. */
    follow(t0, t1, tipAt, scale = 1.2, steps = 6) {
      for (let i = 0; i <= steps; i++) { const [x, y] = tipAt(i / steps); rig.key(t0 + ((t1 - t0) * i) / steps, x, y, scale, 'inOut'); }
      return rig;
    },
    at: (t) => cameraAt(t, keys),
    keys,
    /** Apply the camera at time t. */
    apply(t) { scene.cam.style.transform = keys.length ? cameraTransform(cameraAt(t, keys)) : ''; },
  };
  return rig;
}

/** Rack focus: amount 0–1 softens every other item (blur + dim); the focal item stays sharp. */
export function rackFocus(items, focal, amount) {
  const a = clamp(amount);
  for (const el of items) {
    el.style.filter = el === focal || a === 0 ? '' : `blur(${(5 * a).toFixed(2)}px) brightness(${(1 - 0.2 * a).toFixed(3)})`;
  }
}
