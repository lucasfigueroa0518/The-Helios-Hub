// Smoke fixture frame 2 (map): a printed map, the pin drops on "dinner".
let m = null;
export default {
  treatment: 'map',
  build(root, ctx) {
    const doc = root.ownerDocument;
    const at = ctx.timing.words.find((w) => /dinner/i.test(w.text))?.start ?? 0.6;
    m = ctx.nk.map(doc, { media: ctx.media.V6, label: 'The restaurant', sublabel: 'By the bay · one summer', at, duration: ctx.duration });
    root.append(m.el);
  },
  render(t) { m.render(t); },
};
