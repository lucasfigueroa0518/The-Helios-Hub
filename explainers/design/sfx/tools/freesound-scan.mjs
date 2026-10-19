// Scan Freesound's CC0-filtered search pages (HTML only, no audio) and list candidates per category.
import { writeFileSync } from 'node:fs';
const CATS = {
  'pencil-write': ['pencil writing', 'pencil scribble', 'pencil drawing paper', 'pencil sketching'],
  'pencil-handle': ['pencil tap desk', 'pencil drop table', 'pencil put down'],
  'pencil-sharpener': ['pencil sharpener'],
  'pen-write': ['pen writing paper', 'ballpoint pen writing', 'fountain pen writing', 'pen signature'],
  'pen-click': ['pen click', 'ballpoint pen click'],
  'pen-cap': ['pen cap'],
  'marker-write': ['marker writing', 'whiteboard marker', 'felt tip pen', 'highlighter'],
  'marker-cap': ['marker cap'],
  'chalk-write': ['chalk chalkboard writing', 'chalk'],
  'eraser': ['eraser rubbing', 'pencil eraser'],
  'crayon': ['crayon drawing'],
  'paper-crumple': ['paper crumple', 'crumpling paper ball'],
  'paper-tear': ['paper tear', 'paper rip'],
  'paper-fold': ['paper fold', 'folding paper'],
  'page-turn': ['page turn', 'book page flip'],
  'paper-slide': ['paper slide table', 'paper sliding'],
  'paper-rustle': ['paper rustle', 'paper handling'],
  'paper-drop': ['paper drop table', 'sheet of paper', 'paper put down'],
  'paper-shuffle': ['paper shuffle stack', 'shuffling papers'],
  'paper-flutter': ['paper flutter', 'paper flap'],
  'paper-throw': ['paper ball throw', 'paper plane'],
  'cardboard': ['cardboard', 'cardboard box'],
  'envelope': ['envelope open', 'envelope'],
  'sticky-note': ['sticky note', 'post it note'],
  'scissors': ['scissors cut paper', 'scissors'],
  'tape': ['tape dispenser', 'scotch tape', 'tape rip'],
  'stapler': ['stapler'],
  'hole-punch': ['hole punch'],
  'stamp': ['rubber stamp', 'stamp paper'],
  'clipboard': ['clipboard'],
  'notebook': ['notebook spiral', 'notebook close', 'notebook open'],
  'pushpin': ['thumbtack', 'push pin corkboard'],
  'paper-clip': ['paper clip', 'binder clip'],
  'ruler': ['ruler desk'],
  'typewriter': ['typewriter key', 'typewriter bell', 'typewriter carriage'],
};
const PER = 10;
const attr = (block, name) => (block.match(new RegExp(`data-${name}="([^"]*)"`)) || [])[1];
async function search(q) {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=${encodeURIComponent('license:"Creative Commons 0"')}&s=${encodeURIComponent('Downloads (most first)')}`;
  const html = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  const blocks = html.split('class="bw-player"').slice(1);
  return blocks.map((b) => {
    const tail = b;
    return {
      id: Number(attr(b, 'sound-id')), user: attr(b, 'username'), userId: attr(b, 'user-id'),
      title: attr(b, 'title'), duration: Number(attr(b, 'duration')), downloads: Number(attr(b, 'num-downloads')),
      rating: Number((tail.match(/Average rating of ([0-9.]+)/) || [])[1] || 0),
      cc0: /License: Creative Commons 0/.test(tail),
      mp3: (attr(b, 'mp3') || '').replace('-lq.mp3', '-hq.mp3'),
    };
  }).filter((s) => s.id);
}
const out = {};
for (const [cat, qs] of Object.entries(CATS)) {
  const seen = new Map();
  for (const q of qs) for (const s of await search(q)) if (!seen.has(s.id)) seen.set(s.id, { ...s, query: q });
  out[cat] = [...seen.values()];
  process.stderr.write(`${cat}: ${out[cat].length}\n`);
  await new Promise((r) => setTimeout(r, 400));
}
writeFileSync(process.argv[2], JSON.stringify(out, null, 1));
