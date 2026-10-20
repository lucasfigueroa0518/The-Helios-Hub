// 11 · Fog Wipe: the screen is fogged over, as if breathed on, with the critter's face blurred
// right up against it. Its mitten wipes two clear stripes (squeak, squeak), it writes "AI BRAIN
// BREAK" in the fog with a finger, then the fog clears and the camera pulls back to the room.
import { T, g, el, id, ref, defs, scope, E, seg, lerp, room, title, wordmark, fill, shake, focus, blendCamera, SUBJECTS, VOICE } from './shared.js';

const WIPES = [[0.18, 0.4], [0.44, 0.66]];
const VOICE_AT = 0.44;
const WRITE = [0.72, 1.3];
const CLEAR = [1.75, 2.25];
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: WIPES[1][1] - 0.04, wipes: WIPES, writeAt: WRITE, clearAt: CLEAR };

const CLOSE = 4.2;
// each wipe is a wavy stroke across the glass, left to right then back
const STROKES = [
  [[-80, 980], [200, 900], [460, 960], [720, 890], [1160, 950]],
  [[1160, 1250], [880, 1310], [600, 1240], [300, 1300], [-80, 1230]],
];
const pathOf = (pts) => `M ${pts[0][0]} ${pts[0][1]} ` + pts.slice(1).map(([x, y], i) => { const [px, py] = pts[i]; return `Q ${px + (x - px) / 2} ${py + (i % 2 ? 50 : -50)} ${x} ${y}`; }).join(' ');
/** The mitten's spot along a stroke at u (a straight walk between the points is close enough). */
function along(pts, u) {
  const f = u * (pts.length - 1);
  const i = Math.min(pts.length - 2, Math.floor(f));
  const k = f - i;
  return [lerp(pts[i][0], pts[i + 1][0], k), lerp(pts[i][1], pts[i + 1][1], k)];
}

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f11-', 'paper');
    const close = focus(t, SUBJECTS.thermostatFace, CLOSE, [540, 1080]);
    const camera = t < CLEAR[0] ? close : blendCamera(t, close, {}, seg(t, CLEAR[0], CLEAR[1], E.inOut));
    const [sx, sy] = shake(t, WIPES[1][1] - 0.04, 16, 0.25);
    const scene = room(t, { local: t, camera, pose: t > WIPES[0][1] && t < CLEAR[0] ? { arms: t < WIPES[1][1] ? 'wave' : 'point', look: [0, 0] } : {} });
    const fog = 1 - seg(t, CLEAR[0], CLEAR[1] - 0.1, E.in);
    const parts = [defs(), g({ transform: `translate(${sx.toFixed(1)} ${sy.toFixed(1)})` }, scene)];
    if (fog > 0) {
      const wiped = STROKES.map((pts, i) => {
        const u = seg(t, WIPES[i][0], WIPES[i][1], E.inOut);
        return u > 0 ? el('path', { d: pathOf(pts), fill: 'none', stroke: '#000', 'stroke-width': 270, 'stroke-linecap': 'round', pathLength: 1, 'stroke-dasharray': 1, 'stroke-dashoffset': (1 - u).toFixed(4) }) : '';
      }).join('');
      parts.push(el('defs', {}, [
        el('filter', { id: id('blur'), x: -0.1, y: -0.1, width: 1.2, height: 1.2 }, el('feGaussianBlur', { stdDeviation: 22 })),
        el('mask', { id: id('fog'), maskUnits: 'userSpaceOnUse', x: -60, y: -60, width: 1200, height: 2040 }, el('rect', { x: -60, y: -60, width: 1200, height: 2040, fill: '#fff' }) + wiped),
      ].join('')));
      // the fogged glass: the scene blurred, under a milky film, everywhere the mitten hasn't been
      parts.push(g({ mask: ref('fog'), opacity: fog.toFixed(3) }, [g({ filter: ref('blur') }, scene), fill(T['paper-lit'], 0.72), fill(T['paper-shade'], 0.1)]));
      // the letters, wiped in the fog with a finger: the glass shows through them darker
      if (t >= WRITE[0]) parts.push(g({ opacity: (0.62 * fog).toFixed(3) }, wordmark(540, 400, 96, seg(t, WRITE[0], WRITE[1], (x) => x), { color: T['ink-lit'], termColor: T['orange-dark'], weight: 1.8 })));
      // the mitten, pressed to the glass as it wipes
      WIPES.forEach(([a, b], i) => {
        if (t < a - 0.04 || t > b + 0.04) return;
        const [mx, my] = along(STROKES[i], seg(t, a, b, E.inOut));
        parts.push(el('circle', { cx: mx.toFixed(1), cy: (my + 40).toFixed(1), r: 132, fill: T.ink, stroke: T['paper-lit'], 'stroke-width': 6, filter: ref('wobble') }));
      });
    }
    parts.push(title(t, CLEAR[1] - 0.2, VOICE_AT));
    return parts.join('');
  },
};
