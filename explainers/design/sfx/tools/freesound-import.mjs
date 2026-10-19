// Explainers 3.1: turn the downloaded Freesound CC0 previews (freesound/sources.json, picked by
// freesound-scan.mjs + freesound-select.mjs) into library sounds: one-shot hits cut on silence, and
// sustained beds for continuous actions (writing, erasing, rustling). Writes the files, the catalog
// entries (tagged by kind and by the source title's words), and CREDITS.md; then run
// merge-catalog.mjs. Needs ffmpeg with libmp3lame.
//   node tools/freesound-import.mjs freesound/sources.json <raw dir of <id>.mp3> .
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [pickFile, rawDir, sfxDir] = process.argv.slice(2);
const pick = JSON.parse(readFileSync(pickFile, 'utf8'));

const TAGS = {
  'pencil-write': ['pencil', 'write', 'writing', 'scribble', 'draw', 'sketch', 'stroke', 'graphite'],
  'pencil-handle': ['pencil', 'tap', 'drop', 'desk', 'put'],
  'pen-write': ['pen', 'write', 'writing', 'scribble', 'signature', 'sign', 'ink', 'stroke', 'ballpoint'],
  'pen-click': ['pen', 'click', 'ballpoint', 'clicky'],
  'pen-cap': ['pen', 'cap', 'uncap', 'marker'],
  'marker-write': ['marker', 'write', 'writing', 'sharpie', 'whiteboard', 'highlighter', 'draw', 'stroke', 'felt'],
  'marker-cap': ['marker', 'cap', 'uncap'],
  'chalk-write': ['chalk', 'chalkboard', 'blackboard', 'write', 'writing', 'stroke'],
  eraser: ['eraser', 'erase', 'rub', 'pencil'],
  crayon: ['crayon', 'draw', 'color', 'colour'],
  'paper-crumple': ['paper', 'crumple', 'crinkle', 'ball', 'scrunch'],
  'paper-tear': ['paper', 'tear', 'rip'],
  'paper-fold': ['paper', 'fold', 'unfold', 'crease', 'grab'],
  'page-turn': ['paper', 'page', 'turn', 'flip', 'book'],
  'paper-slide': ['paper', 'slide', 'sheet', 'push'],
  'paper-rustle': ['paper', 'rustle', 'handle', 'sheet'],
  'paper-drop': ['paper', 'drop', 'land', 'sheet', 'place', 'lay', 'put', 'down'],
  'paper-shuffle': ['paper', 'shuffle', 'stack', 'pile', 'papers'],
  'paper-flutter': ['paper', 'flutter', 'flap', 'wave', 'shake'],
  'paper-throw': ['paper', 'plane', 'throw', 'airplane'],
  cardboard: ['cardboard', 'box', 'carton'],
  envelope: ['envelope', 'letter', 'mail', 'open'],
  'sticky-note': ['sticky', 'note', 'peel', 'postit'],
  scissors: ['scissors', 'cut', 'snip', 'scissor'],
  tape: ['tape', 'stick', 'pull', 'sellotape'],
  stapler: ['stapler', 'staple'],
  'hole-punch': ['punch', 'hole', 'puncher'],
  stamp: ['stamp', 'seal', 'press', 'thump'],
  clipboard: ['clipboard', 'board'],
  notebook: ['notebook', 'book', 'spiral', 'close', 'open'],
  pushpin: ['pin', 'tack', 'thumbtack', 'pushpin'],
  'paper-clip': ['clip', 'binder', 'paperclip'],
  ruler: ['ruler', 'flick', 'twang'],
  typewriter: ['typewriter', 'type', 'typing'],
};
/** Continuous actions: each file gives one bed (up to 10s) plus a few short strokes. */
const SUSTAIN = new Set(['pencil-write', 'pen-write', 'marker-write', 'chalk-write', 'eraser', 'crayon', 'paper-rustle', 'paper-shuffle', 'paper-crumple', 'scissors', 'tape', 'paper-flutter']);

const TITLE_STOP = new Set(['wav', 'mp3', 'aif', 'aiff', 'flac', 'm4a', 'ogg', 'the', 'and', 'with', 'for', 'int', 'ext', 'foley', 'sound', 'sounds', 'sfx', 'effect', 'amp', 'some', 'into', 'from', 'one', 'two']);
/** Plain words of a source title ("Typewriter Bell.wav" → typewriter, bell). */
const titleWords = (title) => [...new Set(title.replace(/&amp;/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !TITLE_STOP.has(w)))];

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
const r3 = (n) => Math.round(n * 1000) / 1000;

function regions(file, total) {
  const res = ff(['-i', file, '-af', 'silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-']);
  const starts = [...res.stderr.matchAll(/silence_start: ([0-9.]+)/g)].map((m) => Number(m[1]));
  const ends = [...res.stderr.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => Number(m[1]));
  // sound runs between silence_end[i-1] (or 0) and silence_start[i] (or total)
  const out = [];
  let from = 0;
  let si = 0;
  const events = [...starts.map((t) => ['s', t]), ...ends.map((t) => ['e', t])].sort((a, b) => a[1] - b[1]);
  let inSilence = false;
  for (const [k, t] of events) {
    if (k === 's' && !inSilence) { if (t - from > 0.04) out.push([from, t]); inSilence = true; }
    if (k === 'e' && inSilence) { from = t; inSilence = false; }
  }
  if (!inSilence && total - from > 0.04) out.push([from, total]);
  void si;
  return out;
}
function duration(file) {
  const m = ff(['-i', file, '-f', 'null', '-']).stderr.match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
function levels(file) {
  const e = ff(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']).stderr;
  return { peakDb: Number((e.match(/max_volume: (-?[0-9.]+)/) || [])[1]), meanDb: Number((e.match(/mean_volume: (-?[0-9.]+)/) || [])[1]) };
}
function cut(src, dst, from, len, fadeOut) {
  const af = `afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - fadeOut).toFixed(3)}:d=${fadeOut}`;
  const r = ff(['-y', '-v', 'error', '-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', src, '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '5', dst]);
  if (r.status !== 0) throw new Error(r.stderr);
}

const catalog = [];
const credits = [];
for (const [cat, list] of Object.entries(pick)) {
  const dir = join(sfxDir, 'freesound', cat);
  mkdirSync(dir, { recursive: true });
  for (const s of list) {
    const src = join(rawDir, `${s.id}.mp3`);
    if (!existsSync(src)) continue;
    const total = duration(src);
    const runs = regions(src, total);
    const pieces = [];
    if (SUSTAIN.has(cat)) {
      // merge runs with gaps under 0.35s, keep the longest stretch as the bed
      const merged = [];
      for (const r of runs) {
        const last = merged.at(-1);
        if (last && r[0] - last[1] < 0.35) last[1] = r[1];
        else merged.push([...r]);
      }
      const bed = [...merged].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]))[0];
      if (bed && bed[1] - bed[0] >= 0.6) pieces.push({ kind: 'sustain', from: Math.max(0, bed[0] - 0.02), len: Math.min(10, bed[1] - bed[0] + 0.02) });
      runs.filter((r) => r[1] - r[0] >= 0.15 && r[1] - r[0] <= 2.5).slice(0, 3).forEach((r) => pieces.push({ kind: 'oneshot', from: Math.max(0, r[0] - 0.02), len: r[1] - r[0] + 0.1 }));
    } else {
      runs.filter((r) => r[1] - r[0] >= 0.05).slice(0, 6).forEach((r) => pieces.push({ kind: 'oneshot', from: Math.max(0, r[0] - 0.02), len: Math.min(3, r[1] - r[0] + 0.12) }));
    }
    pieces.forEach((p, i) => {
      const name = `${s.id}-${i + 1}${p.kind === 'sustain' ? '-bed' : ''}`;
      const file = join('freesound', cat, `${name}.mp3`);
      cut(src, join(sfxDir, file), p.from, p.len, p.kind === 'sustain' ? 0.12 : 0.04);
      const lv = levels(join(sfxDir, file));
      if (!(lv.peakDb > -45)) return; // near-silent piece
      catalog.push({ id: `freesound/${cat}/${name}`, file, pack: 'freesound', group: `freesound/${cat}${p.kind === 'sustain' ? '-bed' : ''}`, tags: [...new Set([...TAGS[cat], ...titleWords(s.title), 'freesound', p.kind])], duration: r3(duration(join(sfxDir, file))), peakDb: lv.peakDb, meanDb: lv.meanDb, source: `https://freesound.org/people/${s.user}/sounds/${s.id}/` });
    });
    credits.push(`| ${cat} | [${s.title.replace(/\|/g, '/').replace(/&amp;/g, '&')}](https://freesound.org/people/${s.user}/sounds/${s.id}/) | ${s.user} |`);
  }
  process.stderr.write(`${cat} done\n`);
}
writeFileSync(join(sfxDir, 'freesound', 'catalog.json'), JSON.stringify(catalog, null, 1));
writeFileSync(join(sfxDir, 'freesound', 'CREDITS.md'), `# Freesound paper, pen and writing sounds\n\nEvery sound here is cut from a [Freesound](https://freesound.org) recording released under\n[Creative Commons 0](https://creativecommons.org/publicdomain/zero/1.0/) (public domain). No attribution\nis required; the sources are listed for transparency. Files are cut into one-shots (silence-split) and\nsustained beds (the longest continuous stretch, up to 10s) by the Explainers 3.1 import.\n\n| Kind | Source | Author |\n|---|---|---|\n${credits.join('\n')}\n`);
console.log(JSON.stringify({ sounds: catalog.length, sources: credits.length, beds: catalog.filter((c) => c.tags.includes('sustain')).length }));
