/**
 * MD video finder results page (lab, 2026-11-23): the best reviewed clip per story across runs (best.json), the
 * run-by-run progress and the cost. Writes v3/page/index.html (the published page) and clips/best-*.mp4.
 * No network, no spend.
 *
 *   npx tsx scripts/md-video-best-page.ts
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab/video');
const out = path.join(LAB, 'v3', 'page');
fs.mkdirSync(path.join(out, 'clips'), { recursive: true });

type Best = { id: string; tag: string | null; verdict: 'real' | 'near' | 'miss'; note: string };
type Row = { story: { id: string; day: string; headline: string; posted: boolean }; pick: { clip: string; poster: string; channel?: string; site?: string; kind: string; url: string } | null };

const best = JSON.parse(fs.readFileSync(path.join(LAB, 'best.json'), 'utf8')) as Best[];
const rowOf = (tag: string, id: string) => JSON.parse(fs.readFileSync(path.join(LAB, tag, 'stories', `${id}.json`), 'utf8')) as Row;
const story = new Map<string, Row['story']>();
for (const r of (JSON.parse(fs.readFileSync(path.join(LAB, 'v12', 'results.json'), 'utf8')) as { results: Row[] }).results) story.set(r.story.id, r.story);
const ledger = JSON.parse(fs.readFileSync(path.join(LAB, 'ledger.json'), 'utf8')) as { spent: number };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const short = (h: string) => esc(h.replace(/ - [^-]+$/, ''));
const files: Record<string, string> = {};

function clipCard(b: Best): string {
  const r = rowOf(b.tag!, b.id);
  const src = path.join(LAB, r.pick!.clip);
  const base = `clips/best-${b.id}`;
  const mp4 = path.join(out, `${base}.mp4`);
  if (!fs.existsSync(mp4)) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale='min(640,iw)':-2", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-an', '-movflags', '+faststart', mp4]);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-ss', '1', '-i', mp4, '-frames:v', '1', '-vf', 'scale=480:-2', '-q:v', '5', path.join(out, `${base}.jpg`)]);
  }
  files[`${base}.mp4`] = mp4; files[`${base}.jpg`] = path.join(out, `${base}.jpg`);
  const s = story.get(b.id)!;
  const from = r.pick!.kind === 'x_search' || /x\.com/.test(r.pick!.url) ? 'X' : r.pick!.site || 'YouTube';
  return `<figure class="clip ${b.verdict}"><video src="${base}.mp4" poster="${base}.jpg" muted loop playsinline controls preload="none"></video>
  <figcaption><span class="chips"><span class="chip c-${b.verdict}">${b.verdict === 'real' ? 'real footage' : 'near miss'}</span><span class="chip">${esc(from)}${r.pick!.channel ? ` · ${esc(r.pick!.channel)}` : ''}</span></span>
  <strong>${short(s.headline)}</strong><span class="note">${esc(b.note)}</span></figcaption></figure>`;
}

const real = best.filter((b) => b.verdict === 'real');
const near = best.filter((b) => b.verdict === 'near');
const miss = best.filter((b) => b.verdict === 'miss');
const cards = [...real, ...near].map(clipCard).join('\n');
const missRows = miss.map((b) => `<tr><th scope="row">${short(story.get(b.id)!.headline)}</th><td>${esc(b.note)}</td></tr>`).join('');

const runs: [string, string, string, string][] = [
  ['v5: X search + clip-level golden', '8 / 35', '3', '204 downloads timed out: errors were swallowed, so nobody saw it'],
  ['v6: download fix, same candidates', '18 / 35', '6', 'Shared download slots, retries, a small grading copy: 8 failures in 288'],
  ['v8: whole-video grading', '18 / 35', '15', 'Frames read by seeking anywhere in the video, not only its first 75 s'],
  ['v9: other outlets’ embeds, wider search', '17 / 35', '7', 'YouTube’s bot check cut a third of the run; 6 stories found for the first time'],
  ['v12: brief describes the subject itself', '28 / 35 pass', '–', 'Saved frames re-graded; YouTube still blocked most clip cutting'],
  ['Best reviewed clip per story', '24 / 35', '–', 'Plus 2 near misses; the 9 left are listed below'],
];
const runRows = runs.map(([a, b, c, d]) => `<tr><th scope="row">${a}</th><td class="num">${b}</td><td class="num">${c}</td><td>${d}</td></tr>`).join('');

const html = `<title>MD Video Finder</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;600&family=Archivo:wght@700;800&display=swap">
<style>
/* Layout: lab report. The answer first, then the run table, the clip wall, the misses and the cost. */
:root{--bg:#f6f7f5;--panel:#ffffff;--fg:#1b1f1c;--muted:#5f675f;--line:#dde2dc;--accent:#d9480f;--good:#2b8a3e;--gold:#b7791f;--none:#868e96;
--display:'Archivo',system-ui,sans-serif;--text:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121513;--panel:#1a1e1b;--fg:#e8ece8;--muted:#9aa39a;--line:#2c322d;--accent:#ff7a3d;--good:#51cf66;--gold:#f0b429;--none:#9aa0a6;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121513;--panel:#1a1e1b;--fg:#e8ece8;--muted:#9aa39a;--line:#2c322d;--accent:#ff7a3d;--good:#51cf66;--gold:#f0b429;--none:#9aa0a6;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.5 var(--text);margin:0;padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:24px 48px}
.wrap{max-width:1100px;margin:0 auto;display:grid;gap:40px}
h1{font:800 clamp(28px,5vw,44px)/1.05 var(--display);margin:0;letter-spacing:-.01em;text-wrap:balance}
h2{font:700 20px/1.2 var(--display);margin:0 0 12px}
p{margin:0;max-width:72ch}
.lede{color:var(--muted);margin-top:10px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-top:20px}
.stat{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:14px 16px;display:grid;gap:2px}
.stat b{font:800 34px/1 var(--display);color:var(--accent)}.stat span{color:var(--muted);font-size:14px}
.tablebox{overflow-x:auto;border:1px solid var(--line);border-radius:8px;background:var(--panel)}
table{border-collapse:collapse;width:100%;font-size:14px}
th,td{padding:9px 12px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top}
tr:last-child th,tr:last-child td{border-bottom:0}
thead th{font:600 12px var(--mono);text-transform:uppercase;color:var(--muted)}
td.num{font:600 14px var(--mono);white-space:nowrap}
.wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}
.clip{margin:0;display:grid;gap:8px;align-content:start;min-width:0}
.clip video{width:100%;aspect-ratio:16/9;object-fit:contain;background:#000;border-radius:6px}
.clip figcaption{display:grid;gap:4px;font-size:14px}
.note{color:var(--muted);font-size:13px}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font:12px var(--mono);padding:2px 8px;border-radius:99px;border:1px solid var(--line);overflow-wrap:anywhere}
.c-real{background:var(--good);border-color:var(--good);color:var(--bg)}.c-near{border-color:var(--gold);color:var(--gold)}
ul{margin:8px 0 0;padding-left:18px;display:grid;gap:6px;max-width:72ch}
</style>
<div class="wrap">
  <header>
    <h1>Morning Download video finder</h1>
    <p class="lede">The same 35 top stories from the five-day MD photo trial, run again after fixing what broke. A real hit is footage of the story's own subject that I checked by eye; news reports, commentary and talking heads stay out.</p>
    <div class="stats">
      <div class="stat"><b>24 / 35</b><span>stories with a real clip (69%), up from 8</span></div>
      <div class="stat"><b>24 / 28</b><span>of stories that have any b-roll at all (86%)</span></div>
      <div class="stat"><b>28 / 35</b><span>stories with a candidate that passes grading (80%)</span></div>
      <div class="stat"><b>$0.02</b><span>per story checked, about $0.16 a day for the top 8</span></div>
    </div>
  </header>
  <section>
    <h2>What was broken, and what each fix bought</h2>
    <div class="tablebox"><table><thead><tr><th>Run</th><th>Hits</th><th>Golden</th><th>What changed</th></tr></thead><tbody>${runRows}</tbody></table></div>
    <ul>
      <li><strong>Downloads.</strong> Fifteen stories at once each pulled 75 s of 720p video with sound, so downloads queued past the timeout, and the code hid the errors. Downloads now share 8 slots across all processes, retry with backoff, and record why they failed.</li>
      <li><strong>Only the first 75 seconds were judged.</strong> Frames are now read by seeking into the stream across the whole video, and only the chosen 5 to 10 s window is downloaded at 720p.</li>
      <li><strong>The brief described the wrong thing.</strong> One run asked for "a person speaking on a podcast" for the dwarf-planet story, and another for "a bystander's face blurred" for Android XR, so the right videos failed. The brief now describes the subject itself, as a camera sees it at a glance.</li>
      <li><strong>Where it looks.</strong> Besides YouTube and X, the finder now reads the embeds in other outlets' articles about the same story, and it tries up to 20 candidates in waves of 4.</li>
      <li><strong>YouTube's bot check.</strong> Running 35 stories in one burst triggers YouTube's "confirm you're not a bot" wall. The finder respects it: YouTube calls are paced across processes, and after a wall answer it leaves YouTube alone for 30 minutes while X and the embeds carry on. A day's 8 stories are far below that rate, but the worker VM's datacenter IP will hit the wall sooner than this laptop.</li>
    </ul>
  </section>
  <section>
    <h2>The best clip per story (${real.length} real, ${near.length} near misses)</h2>
    <div class="wall">${cards}</div>
  </section>
  <section>
    <h2>The ${miss.length} stories without one</h2>
    <p class="lede">Seven of these have no footage of their own under the b-roll-only rule: quotes, lawsuits, a private chat, a scam call, a data leak. The Canva toggle and the Korean documentary probably exist but were not found.</p>
    <div class="tablebox" style="margin-top:12px"><table><tbody>${missRows}</tbody></table></div>
  </section>
  <section>
    <h2>Cost</h2>
    <p>A full run with the wider search costs about $0.02 per story: Jev frame grades for most of it, plus a few Serper searches and three short Haiku calls. That is about $0.16 a day for the top 8 and about $5 a month. All lab spend on this finder so far: $${ledger.spent.toFixed(2)}, of which $${(ledger.spent - 1.9).toFixed(2)} came from today's $12 budget.</p>
  </section>
</div>
`;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 1));
console.log(`page: ${real.length} real, ${near.length} near, ${miss.length} misses; ${Object.keys(files).length} files`);
