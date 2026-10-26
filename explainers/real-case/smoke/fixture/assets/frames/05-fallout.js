// Fixture frame 5 (newspaper): the agency's statement as a pull quote; the highlighter crosses it as the
// voice reads it.
let nk, S, quote, band, rig, c0, c1;

const cueOf = (ctx, word, fallback) => ctx.timing.words.find((w) => w.text.replace(/[^\w,]/g, '').toLowerCase() === word)?.end ?? fallback;

export default {
  ground: 'newspaper',
  build(root, ctx) {
    nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.newspaper(doc, { masthead: 'The Harbor City Ledger', date: 'Tuesday, September 16, 2026' });
    root.append(S.el);
    quote = nk.pullQuote(doc, { x: 40, y: 260, w: 920, text: 'We are pausing the trip assistant while we fix its station list.', speaker: 'Harbor City Transit' });
    S.stage.append(quote);
    band = nk.highlight(doc, nk.inkLayer(doc, S.stage), quote);
    c0 = cueOf(ctx, 'said:', 1.0);
    c1 = cueOf(ctx, 'list.', 4.2);
    rig = nk.cameraRig(S).key(0, 540, 900, 1).push(c0, c1, { x: 110, y: 700, w: 920, h: 400 }, { fill: 0.9 });
  },
  render(t) {
    band.progress(nk.geo.seg(t, c0, c1));
    rig.apply(t);
  },
};
