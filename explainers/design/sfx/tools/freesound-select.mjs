import { readFileSync, writeFileSync } from 'node:fs';
const scan = JSON.parse(readFileSync(process.argv[2], 'utf8'));
// keep: title must match; drop: title must not match
const RULES = {
  'pencil-write': [/pencil|scribbl|writ|draw|sketch|stroke/i], 'pencil-handle': [/pencil/i], 'pencil-sharpener': [/sharpen/i],
  'pen-write': [/\bpen\b|writ|scribbl|stroke|signat|ballpoint|fountain/i], 'pen-click': [/pen|ballpoint/i], 'pen-cap': [/cap/i, /spark/i],
  'marker-write': [/marker|sharpie|whiteboard|felt|highlight/i], 'marker-cap': [/cap/i], 'chalk-write': [/chalk/i],
  'eraser': [/eras/i], 'crayon': [/crayon|pencil on paper/i], 'paper-crumple': [/crump|crumbl|crinkl/i, /fire/i],
  'paper-tear': [/tear|rip/i, /cloth|duct/i], 'paper-fold': [/fold|paper/i, /pocket/i], 'page-turn': [/page|flip/i],
  'paper-slide': [/slid/i], 'paper-rustle': [/rustl|paper/i, /bag/i], 'paper-drop': [/paper|news|sheet/i, /wax|metallic|box/i],
  'paper-shuffle': [/shuffl|paper/i], 'paper-flutter': [/paper|flutter|flap/i, /wing/i], 'paper-throw': [/paper plane|plane blow|avion de pap/i],
  'cardboard': [/cardboard|box/i, /burn/i], 'envelope': [/envelope|letter/i], 'sticky-note': [/sticky note|notes/i, /fender|roland/i],
  'scissors': [/scissor|cutting.paper/i, /hair/i], 'tape': [/tape/i], 'stapler': [/stapl/i], 'hole-punch': [/hole|perforator|puncher/i, /press/i],
  'stamp': [/stamp|seal/i], 'clipboard': [/clipboard/i], 'notebook': [/notebook|spiral|page|sign/i], 'pushpin': [/thumbtack|thumb.?tack/i],
  'paper-clip': [/clip/i, /scroll/i], 'ruler': [/rule/i], 'typewriter': [/typewriter|type writing/i],
};
const pick = {}; const used = new Set(); let n = 0, sec = 0;
for (const [cat, list] of Object.entries(scan)) {
  const [keep, drop] = RULES[cat];
  const p = list.filter((s) => s.cc0 && s.duration >= 0.15 && s.duration <= 45 && keep.test(s.title) && !(drop && drop.test(s.title)) && !used.has(s.id))
    .sort((a, b) => b.downloads - a.downloads).slice(0, 8);
  p.forEach((s) => used.add(s.id));
  pick[cat] = p; n += p.length; sec += p.reduce((t, s) => t + s.duration, 0);
  console.log(cat.padEnd(17), String(p.length).padStart(2), p.map((s) => s.title.slice(0, 22)).join(' | ').slice(0, 200));
}
console.log('files', n, 'seconds', Math.round(sec), 'MB~', (sec * 16 / 1024).toFixed(1));
writeFileSync(process.argv[3], JSON.stringify(pick, null, 1));
