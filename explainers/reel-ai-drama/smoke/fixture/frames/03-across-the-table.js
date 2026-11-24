// Smoke fixture frame 3 (cutout_lift): the character cutout lifts off a dark ground; name on his name.
let c = null;
export default {
  treatment: 'cutout_lift',
  build(root, ctx) {
    const doc = root.ownerDocument;
    c = ctx.nk.cutoutLift(doc, { cutout: ctx.media.V2.file, name: 'The co-founder', role: 'Chief executive, the lab', at: [0.05, 0.6], duration: ctx.duration, credit: ctx.media.V2.credit });
    root.append(c.el);
  },
  render(t) { c.render(t); },
};
