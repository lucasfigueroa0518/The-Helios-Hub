// Smoke fixture frame 5 (page): the real page, its title circled from the measured box on "paper".
let p = null;
export default {
  treatment: 'page',
  build(root, ctx) {
    const doc = root.ownerDocument;
    const cue = ctx.timing.words.find((w) => /paper/i.test(w.text))?.start ?? 1.2;
    p = ctx.nk.page(doc, { media: ctx.media.V5, marks: [{ box: 'Smaller', kind: 'circle', at: cue + 0.3 }], duration: ctx.duration, credit: ctx.media.V5.credit });
    root.append(p.el);
  },
  render(t) { p.render(t); },
};
