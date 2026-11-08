// Fixture frame 7 (whiteboard, close framing): "check it's open" is written and underlined.
let nk, S, note, under, rig, c1, c2;

const cueOf = (ctx, word, fallback) => ctx.timing.words.find((w) => w.text.replace(/[^\w,]/g, '').toLowerCase() === word)?.end ?? fallback;

export default {
  ground: 'whiteboard',
  build(root, ctx) {
    nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.whiteboard(doc, { framing: 'close' });
    root.append(S.el);
    const ink = nk.inkLayer(doc, S.stage, { kind: 'dry' });
    note = nk.markerNote(doc, ink, 'check it’s open', { x: 160, y: 380, size: 110, rot: -3, color: nk.COLORS.dry.blue });
    under = nk.markerUnderline(doc, ink, note.el, { color: nk.COLORS.dry.red });
    c1 = cueOf(ctx, 'check', 2.6);
    c2 = cueOf(ctx, 'open.', 4.2);
    rig = nk.cameraRig(S).key(0, 540, 900, 1).key(c2, 560, 880, 1.08);
  },
  render(t) {
    const { seg, writeSeconds } = nk.geo;
    note.progress(seg(t, c1 - 0.2, c1 - 0.2 + writeSeconds('check its open')));
    under.progress(seg(t, c2 - 0.35, c2));
    rig.apply(t);
  },
};
