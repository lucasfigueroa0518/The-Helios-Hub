// The brand close (MD-13, MD-18): the last frame, about 2.5s. A dark graded ground with grain, an orange
// rule, the "Reel AI Drama" wordmark in Pragmatica Extended, and "a Helios series" with the Helios mark
// (never recolored, clear space kept). The comment question is spoken and captioned over it, so the
// whole block sits below the caption band (y 260–560). Code-built, the same in every reel; the project's
// close module is one line written by frames.mjs. Sounds: close-timing.js CLOSE_EVENTS.
import { CLOSE } from './close-timing.js';
import { seg, easeOut, arrive, clamp } from './geometry.js';

export const TREATMENT = 'close';
export const BLOCK = { x: 96, y: 860 };

let draw = null;

export default {
  treatment: TREATMENT,
  build(root, ctx) {
    const { nk } = ctx;
    const doc = root.ownerDocument;
    const el = nk.h(doc, 'div', { class: 'rd rd-close' });
    const block = nk.h(doc, 'div', { class: 'abs', style: { left: `${BLOCK.x}px`, top: `${BLOCK.y}px`, width: '888px', transformOrigin: '0 50%' } });
    const rule = nk.h(doc, 'div', { class: 'abs', style: { left: '0', top: '0', width: '120px', height: '10px', background: 'var(--rd-orange)' } });
    const word = nk.h(doc, 'div', { class: 'abs rd-wordmark', style: { left: '0', top: '44px' } }, 'Reel <span style="color:var(--rd-orange)">AI</span> Drama');
    const by = nk.h(doc, 'div', { class: 'abs', style: { left: '0', top: '200px', display: 'flex', alignItems: 'center', gap: '22px' } });
    const mark = nk.h(doc, 'img', { src: `${ctx.assets}Helios-mark.png`, alt: '', 'data-role': 'logo', style: { width: '76px', height: '76px', borderRadius: '50%', display: 'block' } });
    const series = nk.h(doc, 'div', { class: 'rd-series' }, 'a Helios series');
    by.append(mark, series);
    block.append(rule, word, by);
    el.append(block, nk.h(doc, 'div', { class: 'rd-vignette' }), nk.filmGrain(doc));
    root.append(el);
    const grain = el.querySelector('.nk-grain');
    draw = (t) => {
      const r = easeOut(seg(t, CLOSE.ruleIn[0], CLOSE.ruleIn[1]));
      rule.style.clipPath = `inset(0 ${(100 - 100 * r).toFixed(2)}% 0 0)`;
      const w = easeOut(seg(t, CLOSE.wordIn[0], CLOSE.wordIn[1]));
      word.style.clipPath = `inset(-20px ${(100 - 100 * w).toFixed(2)}% -20px -20px)`;
      const m = arrive(seg(t, CLOSE.markIn[0], CLOSE.markIn[1]), { from: [0, -40], lift: 0.04, settle: 1 });
      by.style.visibility = m.visible ? '' : 'hidden';
      mark.style.transform = `translate(0, ${m.y.toFixed(2)}px) scale(${m.scale.toFixed(4)})`;
      series.style.opacity = String(clamp((t - CLOSE.markIn[0]) / 0.2));
      block.style.transform = `scale(${(1 + 0.03 * seg(t, 0, CLOSE.duration)).toFixed(4)})`;
      grain.style.backgroundPosition = `${(Math.floor(t * 12) * 137) % 512}px ${(Math.floor(t * 12) * 251) % 512}px`;
    };
    draw(0);
  },
  render(t) {
    draw?.(t);
  },
};
