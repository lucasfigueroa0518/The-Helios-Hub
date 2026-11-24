// Fixture frame 2 (newspaper): the article is on the page; felt tip underlines "AI trip assistant" and
// why it launched, each as the voice reaches it (a phrase is underlined; only a number or a word is circled).
let nk, S, art, mark1, under, rig, c1, c2;

const cueOf = (ctx, word, fallback) => ctx.timing.words.find((w) => w.text.replace(/[^\w,]/g, '').toLowerCase() === word)?.end ?? fallback;

export default {
  ground: 'newspaper',
  build(root, ctx) {
    nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.newspaper(doc, { masthead: 'The Harbor City Ledger', date: 'Sunday, September 14, 2026' });
    root.append(S.el);
    art = nk.article(doc, {
      x: 30, y: 260, w: 940, headSize: 76,
      headline: 'Transit agency adds an [[AI trip assistant]] to its app',
      body: ['Harbor City Transit launched an AI trip assistant in its app on September 14, 2026. The agency launched the assistant [[to cut calls to its help line]].'],
      fillerLines: 4,
    });
    S.stage.append(art);
    const ink = nk.inkLayer(doc, S.stage);
    mark1 = nk.markerUnderline(doc, ink, nk.markOf(art, 0));
    under = nk.markerUnderline(doc, ink, nk.markOf(art, 1));
    c1 = cueOf(ctx, 'assistant', 2.0);
    c2 = cueOf(ctx, 'line', 4.2);
    rig = nk.cameraRig(S).key(0, 540, 960, 1.02).key(c2, 540, 1040, 1.08);
  },
  render(t) {
    const { seg } = nk.geo;
    mark1.progress(seg(t, c1 - 0.45, c1));
    under.progress(seg(t, c2 - 0.45, c2));
    rig.apply(t);
  },
};
