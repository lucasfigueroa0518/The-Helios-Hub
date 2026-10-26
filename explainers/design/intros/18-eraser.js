// 18 · Eraser: a dull lecture slide ("Introduction to AI", grey bullets, page 1 of 48), the kind
// every boring AI video opens on. A big eraser scrubs it away in three hard strokes; on the hit the
// room is there and "AI BRAIN BREAK" slams in.
import { T, g, el, id, ref, defs, scope, E, seg, lerp, room, title, wordmark, fill, shake, VOICE } from './shared.js';

const STROKES = [[0.2, 0.44], [0.48, 0.7], [0.74, 0.96]];
const HIT = 1.0;
const VOICE_AT = 0.16;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: HIT, strokes: STROKES };

const PATHS = [
  [[-160, 230], [1240, 640]],
  [[1240, 860], [-160, 1220]],
  [[-160, 1460], [1240, 1880]],
];
const W = 560;

function slide() {
  const grey = T['text-tertiary'];
  const out = [fill(T.canvas)];
  out.push(el('text', { x: 110, y: 430, 'font-family': 'Roboto', 'font-weight': 500, 'font-size': 76, fill: T['text-secondary'] }, 'Introduction to AI'));
  out.push(el('line', { x1: 110, y1: 480, x2: 970, y2: 480, stroke: T['paper-dark'], 'stroke-width': 4 }));
  [640, 600, 720, 520, 660, 580].forEach((w, i) => {
    const y = 640 + i * 170;
    out.push(el('circle', { cx: 132, cy: y, r: 12, fill: grey }));
    out.push(el('rect', { x: 180, y: y - 16, width: w, height: 32, rx: 6, fill: T['paper-shade'] }));
    if (i % 2 === 0) out.push(el('rect', { x: 180, y: y + 34, width: w * 0.6, height: 24, rx: 6, fill: T['paper-shade'], opacity: 0.7 }));
  });
  out.push(el('text', { x: 970, y: 1820, 'text-anchor': 'end', 'font-family': 'Roboto', 'font-weight': 400, 'font-size': 44, fill: grey }, '1 / 48'));
  return out.join('');
}

function eraser(x, y, ang) {
  return g({ transform: `translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${ang.toFixed(2)})`, filter: ref('wobble') }, [
    el('rect', { x: -190, y: -96, width: 380, height: 192, rx: 34, fill: T.ink, opacity: 0.18, transform: 'translate(14 18)' }),
    el('rect', { x: -190, y: -96, width: 380, height: 192, rx: 34, fill: T.orange, stroke: T.ink, 'stroke-width': 7 }),
    el('rect', { x: -30, y: -104, width: 220, height: 208, rx: 12, fill: T['paper-lit'], stroke: T.ink, 'stroke-width': 7 }),
    el('line', { x1: 10, y1: -104, x2: 10, y2: 104, stroke: T.ink, 'stroke-width': 4 }),
  ]);
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f18-', 'paper');
    const parts = [defs()];
    if (t < HIT) {
      const rubbed = PATHS.map(([a, b], i) => {
        const u = seg(t, STROKES[i][0], STROKES[i][1], E.inOut);
        if (u <= 0) return '';
        const x = lerp(a[0], b[0], u);
        const y = lerp(a[1], b[1], u);
        return el('line', { x1: a[0], y1: a[1], x2: x.toFixed(1), y2: y.toFixed(1), stroke: '#000', 'stroke-width': W, 'stroke-linecap': 'round' });
      }).join('');
      parts.push(el('defs', {}, el('mask', { id: id('rub'), maskUnits: 'userSpaceOnUse', x: -60, y: -60, width: 1200, height: 2040 }, el('rect', { x: -60, y: -60, width: 1200, height: 2040, fill: '#fff' }) + rubbed)));
      parts.push(room(t, { local: t }));
      parts.push(g({ mask: ref('rub') }, slide()));
      // crumbs left along each stroke, and the eraser itself, scrubbing
      PATHS.forEach(([a, b], i) => {
        const u = seg(t, STROKES[i][0], STROKES[i][1], E.inOut);
        if (u <= 0) return;
        for (let k = 0; k < 14; k++) {
          const f = (k + 0.5) / 14;
          if (f > u) break;
          const off = ((k * 37) % 9) * 40 - 160;
          parts.push(el('circle', { cx: (lerp(a[0], b[0], f) + off * 0.3).toFixed(1), cy: (lerp(a[1], b[1], f) + off).toFixed(1), r: 7 + (k % 3) * 3, fill: k % 2 ? T['orange-dark'] : T['text-tertiary'], opacity: 0.8 }));
        }
        if (u < 1) {
          const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
          const j = 22 * Math.sin(t * 95);
          const x = lerp(a[0], b[0], u) - Math.sin((ang * Math.PI) / 180) * j;
          const y = lerp(a[1], b[1], u) + Math.cos((ang * Math.PI) / 180) * j;
          parts.push(eraser(x, y, ang + (b[0] < a[0] ? 180 : 0)));
        }
      });
      return parts.join('');
    }
    const [sx, sy] = shake(t, HIT, 26, 0.35);
    parts.push(g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, room(t, { local: t })));
    const w = seg(t, HIT, HIT + 0.24, E.spring);
    const gone = seg(t, HIT + 1.0, HIT + 1.3, E.in);
    if (gone < 1) parts.push(g({ transform: `translate(540 620) scale(${(lerp(2.2, 1, w) * lerp(1, 0.3, gone)).toFixed(3)}) translate(-540 -620)`, opacity: (1 - gone).toFixed(3) }, wordmark(540, 620, 112, 1, { plate: true, tilt: -3 })));
    parts.push(title(t, HIT + 1.1, VOICE_AT));
    return parts.join('');
  },
};
