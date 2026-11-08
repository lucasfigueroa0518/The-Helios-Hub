// The sting (RC-31; reference 03-sting.png): in frame 1's hold, a manila case folder lands over the
// board and a rubber stamp hits it: AI NEWS EXPLAINED in Helios orange, ink-distressed. Code-built,
// the same in every reel; mount.mjs lays it over frame 1 from its voice end. Sounds: close-timing.js.
import { STING } from './close-timing.js';
import { seg, easeOut, easeInOut, arrive } from './geometry.js';

/** The stamp's wooden block and knob, seen from above, as it comes down and lifts. */
export function stampBlock(doc, { w, h }) {
  const el = doc.createElement('div');
  el.className = 'abs';
  Object.assign(el.style, { width: `${w + 40}px`, height: `${h + 40}px`, borderRadius: '16px', background: 'linear-gradient(160deg,#8a5a34,#5e3a1f 70%)', boxShadow: '0 0 0 6px #3b2414 inset, 0 30px 40px -10px rgba(0,0,0,0.6)' });
  el.innerHTML = '<div style="position:absolute;left:50%;top:50%;width:180px;height:180px;margin:-90px 0 0 -90px;border-radius:50%;background:radial-gradient(circle at 38% 34%,#b07a4c,#6d4424 70%);box-shadow:0 10px 18px rgba(0,0,0,0.45)"></div>';
  return el;
}

/**
 * Build the stamp-on-folder moment inside `host`. `at` = frame time the folder starts landing.
 * Returns { el, render(t) } (render is a pure function of frame time). Shared with close.js.
 */
export function stampScene(doc, nk, host, { at = 0, timing = STING, folder = { x: -40, y: 520, w: 1160, h: 980, rot: -3 }, stamp = { x: 150, y: 300, rot: -7, size: 112 }, tab = 'CASE FILE', extra = null } = {}) {
  const layer = doc.createElement('div');
  Object.assign(layer.style, { position: 'absolute', inset: '0', zIndex: '45', pointerEvents: 'none' });
  const f = nk.caseFolder(doc, { ...folder, tab });
  const mark = nk.stamp(doc, { x: stamp.x, y: stamp.y, rot: stamp.rot, size: stamp.size, text: stamp.text ?? 'AI NEWS\nEXPLAINED' });
  mark.style.padding = '30px 40px 34px';
  mark.style.borderWidth = `${Math.round(stamp.size / 11)}px`;
  f.append(mark);
  if (extra) f.append(extra.el);
  layer.append(f);
  host.append(layer);
  // Measured once fonts are in: the block covers the impression exactly.
  const block = stampBlock(doc, { w: mark.offsetWidth, h: mark.offsetHeight });
  block.style.left = `${stamp.x - 20}px`;
  block.style.top = `${stamp.y - 20}px`;
  block.style.transformOrigin = '50% 50%';
  f.append(block);
  const render = (t) => {
    const local = t - at;
    layer.style.visibility = local >= 0 ? '' : 'hidden';
    if (local < 0) return;
    const m = arrive(seg(local, timing.folderIn[0], timing.folderIn[1]), { from: [0, 1400], lift: 0.02, settle: 2, rot: 2 });
    f.style.transform = `translate(${m.x}px, ${m.y.toFixed(2)}px) rotate(${(folder.rot + m.rot).toFixed(3)}deg) scale(${m.scale.toFixed(4)})`;
    if (extra) extra.render(local);
    const down = easeInOut(seg(local, timing.stampDown[0], timing.stampDown[1]));
    const up = easeOut(seg(local, timing.stampUp[0], timing.stampUp[1]));
    const hit = local >= timing.stampDown[1];
    mark.style.visibility = hit ? '' : 'hidden';
    const lifted = 1 - down + up; // 1 = in the air, 0 = on the paper
    block.style.visibility = down > 0 && up < 1 ? '' : 'hidden';
    block.style.transform = `translate(${(160 * up).toFixed(1)}px, ${(-900 * up).toFixed(1)}px) rotate(${stamp.rot}deg) scale(${(1 + 0.45 * lifted).toFixed(4)})`;
    block.style.opacity = String(Math.min(1, down * 3));
  };
  render(at - 1);
  return { el: layer, render };
}

/** The sting over frame 1. */
export function buildSting(host, nk, { at }) {
  return stampScene(host.ownerDocument, nk, host, { at, timing: STING });
}
