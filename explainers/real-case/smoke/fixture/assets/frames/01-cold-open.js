// Fixture frame 1 (board): the clipping lands and is pinned; "2,300" is circled as the voice says it.
// The sting plays in the hold (the mount adds it).
let nk, S, clip, pins, circle, rig, cue;

const cueOf = (ctx, word, fallback) => ctx.timing.words.find((w) => w.text.replace(/[^\w,]/g, '').toLowerCase() === word)?.end ?? fallback;

export default {
  ground: 'board',
  build(root, ctx) {
    nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.board(doc);
    root.append(S.el);
    clip = nk.clipping(doc, {
      x: 70, y: 640, w: 940, rot: -2, masthead: 'The Harbor City Ledger', kicker: 'Metro',
      headline: 'Trip assistant sent [[2,300]] riders to a closed station',
      deck: 'The city’s new AI planner pointed weekend riders to Pier Street',
      body: ['About 2,300 riders went to the closed station on the first weekend.'],
    });
    S.stage.append(clip);
    pins = [0.12, 0.88].map((dx) => nk.pushPin(doc, { x: clip.offsetLeft + clip.offsetWidth * dx, y: clip.offsetTop + 14, color: 'red' }));
    S.stage.append(...pins);
    circle = nk.markerCircle(doc, nk.inkLayer(doc, S.stage), nk.markOf(clip, 0));
    cue = cueOf(ctx, '2,300', 1.6);
    rig = nk.cameraRig(S).key(0, 540, 960, 1).push(0.5, cue, { x: clip.offsetLeft, y: clip.offsetTop, w: clip.offsetWidth, h: clip.offsetHeight }, { fill: 0.95 });
  },
  render(t) {
    const { seg } = nk.geo;
    nk.motion.arrive(clip, seg(t, 0, 0.35));
    pins.forEach((p, i) => nk.motion.pin(p, seg(t, 0.35 + i * 0.08, 0.42 + i * 0.08)));
    circle.progress(seg(t, cue - 0.55, cue));
    rig.apply(t);
  },
};
