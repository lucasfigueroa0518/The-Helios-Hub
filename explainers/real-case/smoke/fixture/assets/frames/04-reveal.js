// Fixture frame 4 (whiteboard): everything in dry-erase marker. "learned: Feb." is written, an arrow runs
// to "closed: March", and "never saw it" is written under it. The phone is drawn first, in marker.
let nk, S, phone, learned, closed, arrow, never, rig, c1, c2, c3;

const cueOf = (ctx, word, fallback) => ctx.timing.words.find((w) => w.text.replace(/[^\w,]/g, '').toLowerCase() === word)?.end ?? fallback;

export default {
  ground: 'whiteboard',
  build(root, ctx) {
    nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.whiteboard(doc, { framing: 'wide' });
    root.append(S.el);
    const ink = nk.inkLayer(doc, S.stage, { kind: 'dry' });
    phone = nk.markerDrawing(doc, ink, ctx.objects.drawing.smartphone, { x: 640, y: 330, w: 280, color: nk.COLORS.dry.black });
    learned = nk.markerNote(doc, ink, 'learned: Feb.', { x: 70, y: 420, size: 96, rot: -3, color: nk.COLORS.dry.blue });
    closed = nk.markerNote(doc, ink, 'closed: March', { x: 300, y: 820, size: 96, rot: 2, color: nk.COLORS.dry.red });
    arrow = nk.markerArrow(doc, ink, learned.el, closed.el, { bend: 140, color: nk.COLORS.dry.black });
    never = nk.markerNote(doc, ink, 'never saw it', { x: 160, y: 1080, size: 84, rot: -4, color: nk.COLORS.dry.black });
    c1 = cueOf(ctx, 'learned', 1.2);
    c2 = cueOf(ctx, 'closure.', 2.6);
    c3 = cueOf(ctx, 'change.', 4.2);
    rig = nk.cameraRig(S).key(0, 540, 1000, 1.06).key(c2, 540, 1060, 1.04).key(c3, 540, 1080, 1.04);
  },
  render(t) {
    const { seg, writeSeconds } = nk.geo;
    phone.progress(seg(t, 0.2, 0.2 + Math.min(phone.seconds, c1 - 0.9)));
    learned.progress(seg(t, c1 - 0.6, c1 - 0.6 + writeSeconds('learned: Feb.')));
    arrow.progress(seg(t, c2 - 1.1, c2 - 0.5));
    closed.progress(seg(t, c2 - 0.5, c2 - 0.5 + writeSeconds('closed: March')));
    never.progress(seg(t, c3 - 1.2, c3 - 1.2 + writeSeconds('never saw it')));
    rig.apply(t);
  },
};
