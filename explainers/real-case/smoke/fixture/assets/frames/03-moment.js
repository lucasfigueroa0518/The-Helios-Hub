// Fixture frame 3 (board): the trip-assistant printout and the closure notice are pinned; the red cord
// runs from one to the other as the voice says the station had closed. The phone that showed the reply
// lies on the cork below them.
let nk, S, phone, reply, notice, pins, cord, cordPts, circle, rig, c1, c2;

const cueOf = (ctx, word, fallback) => ctx.timing.words.find((w) => w.text.replace(/[^\w,]/g, '').toLowerCase() === word)?.end ?? fallback;

export default {
  ground: 'board',
  build(root, ctx) {
    nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.board(doc);
    root.append(S.el);
    reply = nk.printout(doc, { x: 90, y: 700, w: 900, rot: -1.5, kind: 'reply', speaker: 'Trip assistant', date: 'Sep 14, 2026', text: 'Take the Blue Line to [[Pier Street station]], then walk two blocks east.' });
    notice = nk.notice(doc, { x: 300, y: 1160, w: 560, rot: 3, title: 'NOTICE', lines: ['Pier Street station', 'is [[closed]].'], foot: 'March 2026' });
    phone = nk.cutout(doc, { src: ctx.assets + 'objects/cutout/smartphone.png', x: 70, y: 1180, w: 200, rot: -9, edge: 'clean' });
    S.stage.append(phone, reply, notice);
    const at = (el, dx) => [el.offsetLeft + el.offsetWidth * dx, el.offsetTop + 14];
    const [p0, p1] = [at(reply, 0.82), at(notice, 0.5)];
    pins = [nk.pushPin(doc, { x: p0[0], y: p0[1], color: 'red' }), nk.pushPin(doc, { x: p1[0], y: p1[1], color: 'yellow' })];
    cordPts = [p0, [940, 1120], p1];
    cord = nk.cord(doc, cordPts);
    S.stage.append(cord.el, ...pins);
    circle = nk.markerCircle(doc, nk.inkLayer(doc, S.stage), nk.markOf(notice, 0), { seed: 4 });
    c1 = cueOf(ctx, 'station.', 2.4);
    c2 = cueOf(ctx, 'march.', 4.4);
    rig = nk.cameraRig(S).key(0, 540, 1000, 1.04).key(c1, 540, 1000, 1).key(c2, 560, 1120, 1.06);
  },
  render(t) {
    const { seg } = nk.geo;
    nk.motion.arrive(phone, seg(t, 0, 0.3), { from: [-60, 40] });
    nk.motion.arrive(reply, seg(t, 0.1, 0.45));
    nk.motion.pin(pins[0], seg(t, 0.46, 0.53));
    nk.motion.arrive(notice, seg(t, c1 - 0.2, c1 + 0.15));
    nk.motion.pin(pins[1], seg(t, c1 + 0.16, c1 + 0.23));
    cord.progress(seg(t, c1 + 0.3, c1 + 0.8), seg(t, c1 + 0.8, c1 + 0.9));
    circle.progress(seg(t, c2 - 0.5, c2));
    rig.apply(t);
  },
};
