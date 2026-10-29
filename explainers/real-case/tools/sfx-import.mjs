// Add the sounds AI News Explained needs and the shared library lacks (N4c-5): a magnet clack, a cord
// pulled taut, and a whiteboard marker squeak. Same method as explainers/design/sfx/tools/freesound-*
// (Freesound's CC0 search pages, the HQ preview, silence-split one-shots), but it only ADDS entries:
// existing catalog entries and files are never changed (that library is shared with Explainer Reels).
// New entries carry only tags no existing sound uses, so Explainer picks are unaffected.
//
//   node explainers/real-case/tools/sfx-import.mjs            (writes)
//   node explainers/real-case/tools/sfx-import.mjs --dry-run  (lists the picks)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SFX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'sfx');
const DRY = process.argv.includes('--dry-run');
const PER = 4;

export const CATS = {
  magnet: { queries: ['magnet whiteboard', 'magnet snap', 'fridge magnet', 'magnet click'], keep: /magnet/i, drop: /field|hum|drone|ambien|music|loop/i, tags: ['magnet', 'clack'] },
  'cord-taut': { queries: ['rope taut', 'rope pull tight', 'rope tension', 'string pulled tight'], keep: /rope|cord|string/i, drop: /guitar|violin|bass|swing|jump|ship|creak|music|loop/i, tags: ['cord', 'rope', 'taut'] },
  'whiteboard-squeak': { queries: ['whiteboard marker squeak', 'marker squeak', 'whiteboard squeak'], keep: /whiteboard|marker|sharpie|\bpen\b/i, drop: /door|shoe|floor|mouse|toy|music|loop/i, tags: ['squeak', 'dryerase'] },
};

const attr = (block, name) => (block.match(new RegExp(`data-${name}="([^"]*)"`)) || [])[1];
async function search(q) {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=${encodeURIComponent('license:"Creative Commons 0"')}&s=${encodeURIComponent('Downloads (most first)')}`;
  const html = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0' } })).text();
  return html.split('class="bw-player"').slice(1).map((b) => ({
    id: Number(attr(b, 'sound-id')), user: attr(b, 'username'), title: (attr(b, 'title') ?? '').replace(/&amp;/g, '&'),
    duration: Number(attr(b, 'duration')), downloads: Number(attr(b, 'num-downloads')),
    cc0: /License: Creative Commons 0/.test(b), mp3: (attr(b, 'mp3') || '').replace('-lq.mp3', '-hq.mp3'),
  })).filter((s) => s.id && s.mp3);
}

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
const r3 = (n) => Math.round(n * 1000) / 1000;
function duration(file) {
  const m = ff(['-i', file, '-f', 'null', '-']).stderr.match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
function levels(file) {
  const e = ff(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']).stderr;
  return { peakDb: Number((e.match(/max_volume: (-?[0-9.]+)/) || [])[1]), meanDb: Number((e.match(/mean_volume: (-?[0-9.]+)/) || [])[1]) };
}
/** Sound runs between silences: [[from, to]]. */
function regions(file, total) {
  const e = ff(['-i', file, '-af', 'silencedetect=noise=-38dB:d=0.12', '-f', 'null', '-']).stderr;
  const events = [...[...e.matchAll(/silence_start: ([0-9.]+)/g)].map((m) => ['s', Number(m[1])]), ...[...e.matchAll(/silence_end: ([0-9.]+)/g)].map((m) => ['e', Number(m[1])])].sort((a, b) => a[1] - b[1]);
  const out = [];
  let from = 0;
  let quiet = false;
  for (const [k, t] of events) {
    if (k === 's' && !quiet) { if (t - from > 0.04) out.push([from, t]); quiet = true; }
    if (k === 'e' && quiet) { from = t; quiet = false; }
  }
  if (!quiet && total - from > 0.04) out.push([from, total]);
  return out;
}
function cut(src, dst, from, len, fadeOut) {
  const af = `afade=t=in:d=0.01,afade=t=out:st=${Math.max(0, len - fadeOut).toFixed(3)}:d=${fadeOut}`;
  const r = ff(['-y', '-v', 'error', '-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', src, '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '5', dst]);
  if (r.status !== 0) throw new Error(r.stderr);
}

const main = JSON.parse(readFileSync(join(SFX, 'catalog.json'), 'utf8'));
const known = new Set(main.map((s) => s.source).filter(Boolean));
const tmp = join(SFX, '.rc-import-raw');
const added = [];
const credits = [];
for (const [cat, c] of Object.entries(CATS)) {
  const seen = new Map();
  for (const q of c.queries) {
    for (const s of await search(q)) if (!seen.has(s.id)) seen.set(s.id, s);
    await new Promise((r) => setTimeout(r, 400));
  }
  const picks = [...seen.values()]
    .filter((s) => s.cc0 && s.duration >= 0.15 && s.duration <= 20 && c.keep.test(s.title) && !c.drop.test(s.title) && !known.has(`https://freesound.org/people/${s.user}/sounds/${s.id}/`))
    .sort((a, b) => b.downloads - a.downloads).slice(0, PER);
  console.log(`${cat}: ${picks.map((s) => `${s.id} "${s.title}" ${s.duration}s`).join(' | ') || 'none'}`);
  if (DRY) continue;
  mkdirSync(tmp, { recursive: true });
  const dir = join(SFX, 'freesound', cat);
  mkdirSync(dir, { recursive: true });
  for (const s of picks) {
    const src = join(tmp, `${s.id}.mp3`);
    writeFileSync(src, Buffer.from(await (await fetch(s.mp3, { headers: { 'user-agent': 'Mozilla/5.0' } })).arrayBuffer()));
    const runs = regions(src, duration(src)).filter((r) => r[1] - r[0] >= 0.05).slice(0, 3);
    const source = `https://freesound.org/people/${s.user}/sounds/${s.id}/`;
    let n = 0;
    runs.forEach((r, i) => {
      const name = `${s.id}-${i + 1}`;
      const file = join('freesound', cat, `${name}.mp3`);
      cut(src, join(SFX, file), Math.max(0, r[0] - 0.02), Math.min(3, r[1] - r[0] + 0.12), 0.04);
      const lv = levels(join(SFX, file));
      if (!(lv.peakDb > -45)) { rmSync(join(SFX, file)); return; }
      added.push({ id: `freesound/${cat}/${name}`, file, pack: 'freesound', group: `freesound/${cat}`, tags: [...c.tags, 'freesound', 'oneshot'], duration: r3(duration(join(SFX, file))), peakDb: lv.peakDb, meanDb: lv.meanDb, source });
      n += 1;
    });
    if (n) credits.push(`| ${cat} | [${s.title.replace(/\|/g, '/')}](${source}) | ${s.user} |`);
  }
}
if (!DRY) {
  rmSync(tmp, { recursive: true, force: true });
  const fsFile = join(SFX, 'freesound', 'catalog.json');
  writeFileSync(fsFile, JSON.stringify([...JSON.parse(readFileSync(fsFile, 'utf8')), ...added], null, 1));
  writeFileSync(join(SFX, 'catalog.json'), `${JSON.stringify([...main, ...added], null, 1)}\n`);
  if (credits.length) appendFileSync(join(SFX, 'freesound', 'CREDITS.md'), `${credits.join('\n')}\n`);
}
console.log(JSON.stringify({ added: added.length, sources: credits.length }));
