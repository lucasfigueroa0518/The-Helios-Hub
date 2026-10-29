// Fixture frame 6 (board): the agency's post is pinned; "paused" is underlined as the voice says it.
let nk, S, post, pin, under, rig, cue;

const cueOf = (ctx, word, fallback) => ctx.timing.words.find((w) => w.text.replace(/[^\w,]/g, '').toLowerCase() === word)?.end ?? fallback;

export default {
  ground: 'board',
  build(root, ctx) {
    nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.board(doc);
    root.append(S.el);
    post = nk.printout(doc, { x: 110, y: 760, w: 860, rot: 1.5, kind: 'post', speaker: 'Harbor City Transit', date: 'Sep 16, 2026', text: 'We are [[pausing the trip assistant]] while we fix its station list.' });
    S.stage.append(post);
    pin = nk.pushPin(doc, { x: post.offsetLeft + post.offsetWidth * 0.5, y: post.offsetTop + 14, color: 'white' });
    S.stage.append(pin);
    under = nk.markerUnderline(doc, nk.inkLayer(doc, S.stage), nk.markOf(post, 0));
    cue = cueOf(ctx, 'paused.', 2.2);
    rig = nk.cameraRig(S).key(0, 540, 1000, 1).key(cue, 540, 1020, 1.12);
  },
  render(t) {
    const { seg } = nk.geo;
    nk.motion.arrive(post, seg(t, 0, 0.35));
    nk.motion.pin(pin, seg(t, 0.36, 0.43));
    under.progress(seg(t, cue - 0.45, cue));
    rig.apply(t);
  },
};
