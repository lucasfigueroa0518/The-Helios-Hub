// 10 · Lights Out: half a second of the room with the music loud, then a hard cut to black and
// total silence; a light-switch CLICK and one spotlight finds the shivering critter while chalk
// writes "AI BRAIN BREAK" in the dark; then the lights come up full with a hit.
import { T, g, el, id, ref, defs, scope, E, seg, lerp, room, title, wordmark, fill, burst, toScreen, SUBJECTS, VOICE } from './shared.js';

const DARK = 0.5;
const CLICK = 0.85;
const LIGHTS = 1.45;
const VOICE_AT = CLICK;
export const META = { duration: +(VOICE_AT + VOICE + 0.2).toFixed(3), voiceAt: VOICE_AT, breakAt: DARK, clickAt: CLICK, lightsAt: LIGHTS, chalk: [CLICK + 0.05, LIGHTS - 0.05] };

export default {
  ground: 'paper',
  shots: [],
  draw(t) {
    scope('f10-', 'paper');
    if (t < DARK) return room(t, { local: t });
    if (t < CLICK) return defs() + fill(T.ink);
    const scene = room(t, { local: t - CLICK });
    const [cx, cy] = toScreen(SUBJECTS.thermostat, t - CLICK);
    const up = seg(t, LIGHTS, LIGHTS + 0.12, (x) => x);
    const parts = [scene];
    if (up < 1) {
      // the dark with one soft-edged spotlight on the critter
      parts.push(el('defs', {}, el('radialGradient', { id: id('spot'), gradientUnits: 'userSpaceOnUse', cx: cx.toFixed(1), cy: (cy - 40).toFixed(1), r: 380 }, [
        el('stop', { offset: 0.55, 'stop-color': T.ink, 'stop-opacity': 0 }),
        el('stop', { offset: 0.72, 'stop-color': T.ink, 'stop-opacity': 0.97 }),
        el('stop', { offset: 1, 'stop-color': T.ink, 'stop-opacity': 0.97 }),
      ].join(''))));
      parts.push(el('rect', { x: -50, y: -50, width: 1180, height: 2020, fill: ref('spot'), opacity: (1 - up).toFixed(3) }));
      // a cone of light from the top
      parts.push(el('polygon', { points: `${(cx - 60).toFixed(1)},-20 ${(cx + 60).toFixed(1)},-20 ${(cx + 300).toFixed(1)},${(cy + 120).toFixed(1)} ${(cx - 300).toFixed(1)},${(cy + 120).toFixed(1)}`, fill: T['paper-lit'], opacity: (0.08 * (1 - up)).toFixed(3) }));
    }
    // chalk on the dark, then it stays as ink once the lights are up
    const chalk = seg(t, META.chalk[0], META.chalk[1], (x) => x);
    const gone = seg(t, VOICE_AT + 1.4, VOICE_AT + 1.7, E.in);
    if (gone < 1) parts.push(g({ opacity: (1 - gone).toFixed(3) }, wordmark(540, 470, 96, chalk, { color: up < 1 ? T['paper-lit'] : T.ink, weight: 1.6, plate: up >= 1 })));
    parts.push(burst(540, 960, seg(t, LIGHTS, LIGHTS + 0.4, (x) => x), 4));
    parts.push(title(t, VOICE_AT + 1.5, VOICE_AT));
    return parts.join('');
  },
};
