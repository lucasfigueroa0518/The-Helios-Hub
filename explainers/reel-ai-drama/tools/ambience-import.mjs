// Add recorded ambience beds for the Reel AI Drama kit (kit/sound.mjs looks them up by the tag
// `ambience` plus the description's words, else it synthesizes a procedural bed). Same method as
// explainers/real-case/tools/sfx-import.mjs: Freesound's public CC0 search pages (no account, no API
// key), the HQ preview, ~1 request per second. Instead of one-shots it cuts one steady 25s bed per
// place: the window whose momentary loudness varies least, short fades, mono 44.1kHz MP3 like the rest
// of the library, a static gain to TARGET_LUFS (the level of the kit's procedural beds, so the mix
// balance KINDS.ambience.gain was tuned for holds).
//
// The library (explainers/design/sfx) is shared with Explainer Reels, so this only APPENDS:
// - entries go to ambience-catalog.json only (Reel AI Drama's sound.mjs merges it; Explainer kits never read it), with pack 'freesound-ambience' (tools/merge-catalog.mjs keeps
//   non-'freesound' packs, so a later merge neither drops nor duplicates them);
// - every tag is one no existing sound uses (checked here; colliding words are dropped and printed),
//   and beds carry neither 'freesound' nor 'sustain', so Explainer queries and word weights are unchanged;
// - credits are appended to freesound/CREDITS.md under their own heading.
// Re-running skips places that already have a bed.
//
//   node explainers/reel-ai-drama/tools/ambience-import.mjs            (writes)
//   node explainers/reel-ai-drama/tools/ambience-import.mjs --dry-run  (lists the candidates)
import { spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SFX = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'design', 'sfx');
const DRY = process.argv.includes('--dry-run');
const LEN = 25; // seconds per bed
const FADE = 0.5;
const TARGET_LUFS = -38;
const STEADY = 3.5; // accept the first candidate whose best window scores at most this (dB)
const TRIES = 3; // candidates downloaded per place at most
const NO_TALK = /music|song|band|jazz|piano|guitar|singing|choir|organ|speech|speaking|talk(ing)?\b|interview|announce|lecture|preach|radio|tv\b|voice|vocal|narrat|sci ?-?fi|cello|violin|synth|drone|designed|\bdark\b/i;

/** Places: Freesound queries, title filters, and tags (all new words; `ambience` is added to each). */
export const PLACES = {
  'room-tone': { queries: ['room tone', 'roomtone'], keep: /room ?tone|roomtone|quiet room|empty room|silence/i, drop: /clock|tick|impulse|\bIR\b|fridge|hum\b|fan/i, tags: ['room', 'roomtone', 'interior', 'indoor', 'indoors', 'hush', 'boardroom', 'apartment', 'house', 'home'] },
  office: { queries: ['office ambience', 'office background'], keep: /office/i, drop: /busy|call|printer|phone/i, tags: ['workplace', 'cubicle', 'cubicles', 'coworkers', 'workspace', 'workday'] },
  server: { queries: ['server room', 'data center', 'datacenter'], keep: /server|data ?cent|datacenter|computer room|rack/i, drop: /fan only|start|boot|beep/i, tags: ['server', 'servers', 'datacenter', 'hum', 'humming', 'rack', 'racks', 'mainframe'] },
  street: { queries: ['city street ambience', 'street traffic ambience'], keep: /street|city|traffic|urban|downtown/i, drop: /night|rain|siren|horn|busker|market|parade|protest/i, tags: ['city', 'street', 'streets', 'traffic', 'urban', 'downtown', 'sidewalk', 'road', 'outside', 'town'] },
  crowd: { queries: ['crowd murmur', 'walla crowd', 'conference crowd'], keep: /crowd|murmur|walla|conference|chatter|lobby/i, drop: /\bbar\b|\bpub\b|cheer|applause|clap|stadium|protest|scream|laugh|child|kids|school|sport|riot|chant/i, tags: ['crowd', 'murmur', 'walla', 'chatter', 'conference', 'convention', 'lobby', 'keynote', 'audience', 'expo', 'attendees'] },
  hall: { queries: ['large hall ambience', 'courtroom ambience', 'empty hall reverb'], keep: /hall|court|lobby|atrium|museum|cathedral|church|chamber/i, drop: /bell|concert|mass|footstep|door/i, tags: ['hall', 'courtroom', 'court', 'courthouse', 'hearing', 'atrium', 'auditorium', 'chamber', 'museum', 'reverberant'] },
  wind: { queries: ['wind ambience', 'wind howling'], keep: /wind/i, drop: /chime|turbine|instrument|rain|storm|thunder|windows?\b|whoosh|door/i, tags: ['outdoor', 'outdoors', 'breeze', 'gust', 'gusts', 'gusty', 'windy', 'howling', 'desert', 'coast', 'mountain', 'rooftop', 'cliff'] },
  rain: { queries: ['rain ambience', 'rain on window'], keep: /rain/i, drop: /thunder|umbrella|car\b|tent|drip|forest|bird/i, tags: ['rain', 'rainy', 'raining', 'drizzle', 'downpour', 'rainfall', 'storm', 'wet'] },
  cafe: { queries: ['restaurant ambience', 'cafe ambience'], keep: /restaurant|cafe|café|coffee|diner|bistro|cafeteria/i, drop: /kitchen|espresso machine|grinder/i, tags: ['restaurant', 'cafe', 'coffee', 'coffeeshop', 'diner', 'dinner', 'bistro', 'dining', 'brunch', 'lunch', 'cafeteria'] },
  keyboards: { queries: ['typing office ambience', 'keyboard typing', 'computer keyboard typing'], keep: /typing|keyboard|keys/i, drop: /typewriter|piano|synth|single|one key|mouse|click/i, tags: ['keystrokes', 'typists', 'clacking', 'coding', 'coder', 'programmer', 'hacker', 'devs'] },
  night: { queries: ['night city ambience', 'city at night'], keep: /night/i, drop: /cricket|insect|forest|frog|owl|siren|party|rain/i, also: /city|street|urban|town|traffic|downtown/i, tags: ['night', 'nighttime', 'nocturnal', 'city', 'late', 'evening', 'skyline', 'midnight'] },
  newsroom: { queries: ['busy office', 'open plan office', 'call center ambience'], keep: /office|newsroom|call ?cent|open ?plan|workplace|trading/i, drop: /quiet|printer|door/i, tags: ['newsroom', 'busy', 'bustling', 'openplan', 'plan', 'callcenter', 'trading', 'bullpen', 'staffers'] },
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = { headers: { 'user-agent': 'Mozilla/5.0' } };
const attr = (block, name) => (block.match(new RegExp(`data-${name}="([^"]*)"`)) || [])[1];
const unescape = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
async function search(q) {
  const url = `https://freesound.org/search/?q=${encodeURIComponent(q)}&f=${encodeURIComponent('license:"Creative Commons 0"')}&s=${encodeURIComponent('Downloads (most first)')}`;
  const html = await (await fetch(url, UA)).text();
  await sleep(1000);
  return html.split('class="bw-player"').slice(1).map((b) => ({
    id: Number(attr(b, 'sound-id')), user: attr(b, 'username'), title: unescape(attr(b, 'title') ?? ''),
    duration: Number(attr(b, 'duration')), downloads: Number(attr(b, 'num-downloads')),
    cc0: /License: Creative Commons 0/.test(b), mp3: (attr(b, 'mp3') || '').replace('-lq.mp3', '-hq.mp3'),
  })).filter((s) => s.id && s.mp3);
}

const ff = (args) => spawnSync('ffmpeg', ['-hide_banner', '-nostats', ...args], { encoding: 'utf8', maxBuffer: 256 << 20 });
const r3 = (n) => Math.round(n * 1000) / 1000;
const r1 = (n) => Math.round(n * 10) / 10;
function duration(file) {
  const m = ff(['-i', file, '-f', 'null', '-']).stderr.match(/Duration: (\d+):(\d+):([0-9.]+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}
function levels(file) {
  const e = ff(['-i', file, '-af', 'volumedetect', '-f', 'null', '-']).stderr;
  return { peakDb: Number((e.match(/max_volume: (-?[0-9.]+)/) || [])[1]), meanDb: Number((e.match(/mean_volume: (-?[0-9.]+)/) || [])[1]) };
}
/** Momentary loudness every 0.1s: [[t, M]], plus the integrated loudness. */
function loudness(file, from = 0, len = 0) {
  const e = ff([...(len ? ['-ss', String(from), '-t', String(len)] : []), '-i', file, '-af', 'ebur128', '-f', 'null', '-']).stderr;
  const m = [...e.matchAll(/t:\s*([0-9.]+)\s+TARGET:.*?M:\s*(-?[0-9.]+|-inf)/g)].map((x) => [Number(x[1]), x[2] === '-inf' ? -120 : Number(x[2])]);
  const I = Number((e.match(/I:\s+(-?[0-9.]+) LUFS/g) || []).pop()?.match(/-?[0-9.]+/)?.[0]);
  return { m, I };
}
/** The steadiest LEN-second window: lowest spread of momentary loudness, spikes penalized. */
function steadiest(file, total) {
  const { m } = loudness(file);
  let best = null;
  for (let s = Math.min(1, total - LEN); s + LEN <= total - 0.2; s += 0.5) {
    const v = m.filter(([t]) => t >= s + 0.4 && t <= s + LEN).map(([, x]) => x).sort((a, b) => a - b);
    if (v.length < 50) continue;
    const med = v[v.length >> 1];
    if (med < -60) continue; // near silence
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    const spike = v[v.length - 1] - med;
    const score = sd + Math.max(0, spike - 6) * 0.5;
    if (!best || score < best.score) best = { from: s, score: r1(score), sd: r1(sd), spike: r1(spike) };
  }
  return best;
}
function cut(src, dst, from, len, gainDb) {
  const af = `volume=${gainDb.toFixed(2)}dB,afade=t=in:d=${FADE},afade=t=out:st=${(len - FADE).toFixed(3)}:d=${FADE}`;
  const r = ff(['-y', '-v', 'error', '-ss', from.toFixed(3), '-t', len.toFixed(3), '-i', src, '-af', af, '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-q:a', '5', dst]);
  if (r.status !== 0) throw new Error(r.stderr);
}

const catalogFile = join(SFX, 'ambience-catalog.json'); // its own catalog: Explainer lookups never see the beds
const main = JSON.parse(readFileSync(catalogFile, 'utf8'));
const used = new Set(main.filter((s) => s.pack !== 'freesound-ambience').flatMap((s) => s.tags));
if (used.has('ambience')) throw new Error('an existing sound already uses the tag "ambience"');
const known = new Set(main.map((s) => s.source).filter(Boolean));
const have = new Set(main.filter((s) => s.pack === 'freesound-ambience').map((s) => s.group));
const tmp = join(tmpdir(), `ambience-import-${process.pid}`);
const outDir = join(SFX, 'freesound', 'ambience');
const added = [];
const credits = [];
for (const [place, p] of Object.entries(PLACES)) {
  const group = `freesound/ambience/${place}`;
  if (have.has(group)) { console.log(`${place}: already imported`); continue; }
  const tags = ['ambience', ...p.tags.filter((t) => !used.has(t))];
  const clash = p.tags.filter((t) => used.has(t));
  const seen = new Map();
  for (const q of p.queries) for (const s of await search(q)) if (!seen.has(s.id)) seen.set(s.id, s);
  const cands = [...seen.values()]
    .filter((s) => s.cc0 && s.duration >= LEN + 2 && s.duration <= 400 && p.keep.test(s.title) && (!p.also || p.also.test(s.title)) && !p.drop.test(s.title) && !NO_TALK.test(s.title) && !known.has(`https://freesound.org/people/${s.user}/sounds/${s.id}/`))
    .sort((a, b) => b.downloads - a.downloads);
  console.log(`${place}: ${cands.length} candidates${clash.length ? ` (tags in use, dropped: ${clash.join(', ')})` : ''}; top: ${cands.slice(0, TRIES).map((s) => `${s.id} "${s.title}" ${s.duration}s`).join(' | ') || 'none'}`);
  if (DRY || !cands.length) continue;
  mkdirSync(tmp, { recursive: true });
  mkdirSync(outDir, { recursive: true });
  let pick = null;
  for (const s of cands.slice(0, TRIES)) {
    const src = join(tmp, `${s.id}.mp3`);
    writeFileSync(src, Buffer.from(await (await fetch(s.mp3, UA)).arrayBuffer()));
    await sleep(1000);
    const total = duration(src);
    const w = total >= LEN + 1 ? steadiest(src, total) : null;
    console.log(`  ${s.id}: ${r1(total)}s, steadiest window ${w ? `${w.from}s score ${w.score} (sd ${w.sd}, spike ${w.spike})` : 'none'}`);
    if (w && (!pick || w.score < pick.w.score)) pick = { s, src, w };
    if (pick && pick.w.score <= STEADY) break;
  }
  if (!pick) continue;
  const { s, src, w } = pick;
  const name = `${place}-${s.id}`;
  const file = join('freesound', 'ambience', `${name}.mp3`);
  const { I } = loudness(src, w.from, LEN);
  let gain = TARGET_LUFS - I;
  cut(src, join(SFX, file), w.from, LEN, gain);
  gain += TARGET_LUFS - loudness(join(SFX, file)).I; // the mono fold-down changes loudness: measure the cut, then cut again
  cut(src, join(SFX, file), w.from, LEN, gain);
  const lv = levels(join(SFX, file));
  if (lv.peakDb > -1) { gain -= lv.peakDb + 1; cut(src, join(SFX, file), w.from, LEN, gain); } // keep a dB of headroom
  const out = { ...levels(join(SFX, file)), lufs: loudness(join(SFX, file)).I };
  const source = `https://freesound.org/people/${s.user}/sounds/${s.id}/`;
  known.add(source); // one recording serves one place
  added.push({ id: `freesound/ambience/${name}`, file, pack: 'freesound-ambience', group, tags, duration: r3(duration(join(SFX, file))), peakDb: out.peakDb, meanDb: out.meanDb, lufs: out.lufs, source });
  credits.push(`| ${place} | [${s.title.replace(/\|/g, '/')}](${source}) | ${s.user} | CC0 |`);
  console.log(`  -> ${file} from ${w.from}s, ${out.lufs} LUFS, peak ${out.peakDb} dB`);
}
rmSync(tmp, { recursive: true, force: true });
if (!DRY && added.length) {
  writeFileSync(catalogFile, `${JSON.stringify([...main, ...added], null, 1)}\n`);
  const creditsFile = join(SFX, 'freesound', 'CREDITS.md');
  const head = readFileSync(creditsFile, 'utf8').includes('## Ambience beds') ? '' : '\n## Ambience beds (Reel AI Drama)\n\nSteady 25s beds cut from Freesound recordings released under Creative Commons 0 (public domain),\nby explainers/reel-ai-drama/tools/ambience-import.mjs.\n\n| Place | Source | Author | License |\n|---|---|---|---|\n';
  appendFileSync(creditsFile, `${head}${credits.join('\n')}\n`);
}
console.log(JSON.stringify({ added: added.length }));
