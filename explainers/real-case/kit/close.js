// The close (RC-31; reference 13-close.png): frame 8, 2.5s, no voice. The case folder lands, the Helios
// mark is set down on it (never recolored, clear space kept: nothing within a quarter of its width),
// and the stamp AI NEWS EXPLAINED hits beneath it. Code-built, the same in every reel; the project's
// close module is one line written by frames.mjs. Sounds: close-timing.js CLOSE_EVENTS.
import { CLOSE } from './close-timing.js';
import { stampScene } from './sting.js';
import { seg, arrive } from './geometry.js';

export const GROUND = 'board';
export const MARK = { x: 440, y: 230, w: 280 };

let scene = null;

export default {
  ground: GROUND,
  build(root, ctx) {
    const { nk } = ctx;
    const doc = root.ownerDocument;
    const s = nk.board(doc);
    root.append(s.el);
    s.front.style.zIndex = '60';
    const mark = doc.createElement('img');
    mark.src = `${ctx.assets}Helios-mark.png`;
    mark.alt = '';
    mark.dataset.role = 'logo';
    Object.assign(mark.style, { position: 'absolute', left: `${MARK.x}px`, top: `${MARK.y}px`, width: `${MARK.w}px`, height: `${MARK.w}px`, borderRadius: '50%', boxShadow: '0 18px 30px -10px rgba(0,0,0,0.5)' });
    const extra = {
      el: mark,
      render(local) {
        const m = arrive(seg(local, CLOSE.markIn[0], CLOSE.markIn[1]), { from: [0, -60], lift: 0.04, settle: 1 });
        mark.style.visibility = m.visible ? '' : 'hidden';
        mark.style.transform = `translate(0, ${m.y.toFixed(2)}px) scale(${m.scale.toFixed(4)})`;
      },
    };
    scene = stampScene(doc, nk, s.stage, {
      at: 0,
      timing: CLOSE,
      folder: { x: -40, y: 480, w: 1160, h: 1060, rot: 0 },
      stamp: { x: 250, y: 600, rot: -4, size: 66, text: 'AI NEWS EXPLAINED' },
      tab: null,
      extra,
    });
  },
  render(t) {
    scene?.render(t);
  },
};
