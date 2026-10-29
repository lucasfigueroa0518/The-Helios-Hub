// Smoke fixture frame 6 (photo + lower third).
let shot = null;
let l3 = null;
export default {
  treatment: 'photo',
  build(root, ctx) {
    const doc = root.ownerDocument;
    shot = ctx.nk.photo(doc, { media: ctx.media.V7, focus: [0.5, 0.32], move: 'push', grade: 'warm', duration: ctx.duration, credit: ctx.media.V7.credit });
    l3 = ctx.nk.lowerThird(doc, { name: 'The chipmaker', role: 'Co-founder and chief executive', at: 0.5 });
    shot.el.append(l3.el);
    root.append(shot.el);
  },
  render(t) { shot.render(t); l3.render(t); },
};
