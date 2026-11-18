// A beach ball (moulded, so drawn). Rigid: no joints. Six gores meet at a small cap on the pole,
// which leans up, left and toward the camera, so the gores sweep across the ball as curved panels
// (never a hub with spokes). Red and mustard gores alternate with white; the whole ball shades to
// the lower right. Units: 120 tall (resting on 0), 30 cm real.
import { smooth } from './path.js';

const R = 58;
const CY = -R - 1;
const TILT = (45 * Math.PI) / 180; // the pole toward the camera
const ROLL = (28 * Math.PI) / 180; // the pole toward the left
const DEG = Math.PI / 180;

/** A sphere point at latitude/longitude (degrees) → [screen x, screen y, depth toward camera]. */
function proj(lat, lon) {
  const [a, b] = [lat * DEG, lon * DEG];
  const x0 = Math.cos(a) * Math.sin(b);
  const y0 = Math.sin(a);
  const z0 = Math.cos(a) * Math.cos(b);
  const y1 = y0 * Math.cos(TILT) - z0 * Math.sin(TILT);
  const z1 = y0 * Math.sin(TILT) + z0 * Math.cos(TILT);
  const x2 = x0 * Math.cos(ROLL) - y1 * Math.sin(ROLL);
  const y2 = x0 * Math.sin(ROLL) + y1 * Math.cos(ROLL);
  return [x2 * R, CY - y2 * R, z1];
}

/** The visible run of a meridian from the cap down to the ball's edge. */
function meridian(lon, from = 80) {
  const out = [];
  let prev = null;
  for (let lat = from; lat >= -90; lat -= 2) {
    const p = proj(lat, lon);
    if (p[2] < 0) {
      // where it crosses the edge: the last visible point pushed out onto the outline
      const [x, y] = prev ?? p;
      const m = Math.hypot(x, y - CY) || 1;
      out.push([(x * R) / m, CY + ((y - CY) * R) / m]);
      break;
    }
    out.push(p);
    prev = p;
  }
  return out;
}

/** One gore between two longitudes: down one meridian, along the edge, up the other. */
function gore(lon0, lon1) {
  const edge = [];
  for (let lon = lon0 + 3; lon < lon1; lon += 3) edge.push(meridian(lon).at(-1));
  const pts = [...meridian(lon0), ...edge, ...meridian(lon1).reverse()];
  return 'M' + pts.map(([x, y]) => `${Math.round(x * 10) / 10},${Math.round(y * 10) / 10}`).join(' L') + ' Z';
}

const ring = (r, n = 28) => Array.from({ length: n }, (_, i) => [Math.cos((i / n) * 2 * Math.PI) * r, CY + Math.sin((i / n) * 2 * Math.PI) * r]);
const BALL = smooth(ring(R), true);
const CAP = smooth(Array.from({ length: 16 }, (_, i) => proj(80, i * 22.5)), true);
// the shade: the ball's lower right, outside a circle nudged up and left (opposite windings cut it)
const k = R * 1.04;
const SHADE = `M-80,-140 L80,-140 L80,10 L-80,10 Z M${-k - 14},${CY - 14} A${k},${k} 0 1 0 ${k - 14},${CY - 14} A${k},${k} 0 1 0 ${-k - 14},${CY - 14} Z`;

const LON0 = 10;
const panel = (i, fill) => ({ z: 1, fill, pivot: [0, CY], d: gore(LON0 + i * 60, LON0 + (i + 1) * 60), shade: SHADE });

export const BALL_SPEC = {
  kind: 'ball', cm: 30, units: 120,
  tones: { panel: 'white', a: 'red', b: 'mustard' },
  views: {
    front: {
      foot: [-46, 46],
      parts: {
        ball: { z: 0, fill: 'panel', pivot: [0, CY], d: BALL, shade: SHADE },
        // the gores facing the camera; the white ones are the ball itself
        gore0: panel(0, 'a'),
        gore2: panel(2, 'a'),
        gore4: panel(4, 'b'),
        cap: { z: 2, fill: 'panel', pivot: [0, CY], d: CAP },
      },
      poses: { rest: {} },
    },
  },
};
