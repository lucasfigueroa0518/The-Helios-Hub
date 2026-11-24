// Smoke fixture frame 4 (collision): the two meet over the company as the music changes.
let c = null;
export default {
  treatment: 'collision',
  build(root, ctx) {
    const doc = root.ownerDocument;
    c = ctx.nk.collision(doc, {
      left: { src: ctx.media.V3.file, height: 800 }, right: { src: ctx.media.V2.file, height: 760 },
      center: { src: ctx.media.V4.file, w: 240, light: true }, at: [0.1, 0.8],
      credit: 'Photos: Gage Skidmore; Steve Jurvetson · Logo: fixture',
    });
    root.append(c.el);
  },
  render(t) { c.render(t); },
};
