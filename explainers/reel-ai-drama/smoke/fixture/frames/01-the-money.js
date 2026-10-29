// Smoke fixture frame 1 (photo + number): the hook on screen from the first frame (MD-34).
let shot = null;
let num = null;
export default {
  treatment: 'photo',
  build(root, ctx) {
    const doc = root.ownerDocument;
    const v = ctx.media.V1;
    shot = ctx.nk.photo(doc, { media: v, focus: [0.5, 0.24], move: 'push', amount: 0.14, duration: ctx.duration, credit: v.credit });
    const cue = ctx.timing.words.find((w) => /million/i.test(w.text))?.start ?? 0.6;
    num = ctx.nk.number(doc, { value: '$4M', label: 'into a lab he helped start', labelTone: 'muted', at: Math.min(cue, 1.2) });
    shot.el.append(num.el);
    root.append(shot.el);
  },
  render(t) { shot.render(t); num.render(t); },
};
