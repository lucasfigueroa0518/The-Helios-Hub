// Smoke fixture frame 8 (photo + counting number): the music starts again.
let shot = null;
let num = null;
export default {
  treatment: 'photo',
  build(root, ctx) {
    const doc = root.ownerDocument;
    shot = ctx.nk.photo(doc, { media: ctx.media.V8, focus: [0.5, 0.3], move: 'hold', grade: 'mono', duration: ctx.duration, credit: ctx.media.V8.credit });
    num = ctx.nk.number(doc, { value: '$12M', label: 'in damages, demanded', tone: 'orange', labelTone: 'muted', countUp: true, at: 0.4 });
    shot.el.append(num.el);
    root.append(shot.el);
  },
  render(t) { shot.render(t); num.render(t); },
};
