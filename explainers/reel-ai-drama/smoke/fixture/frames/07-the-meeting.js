// Smoke fixture frame 7 (headline): a typed paper strip slams onto a softened photo; the music drops.
let hl = null;
export default {
  treatment: 'headline',
  build(root, ctx) {
    const doc = root.ownerDocument;
    hl = ctx.nk.headline(doc, { text: 'The board [[meets]] in private', publication: 'Fixture Ledger', date: 'Smoke test', over: { media: ctx.media.V8, focus: [0.5, 0.3], move: 'hold', grade: 'mono' }, at: 0.1, markAt: Math.max(0.6, ctx.duration - 0.4), duration: ctx.duration });
    root.append(hl.el);
  },
  render(t) { hl.render(t); },
};
