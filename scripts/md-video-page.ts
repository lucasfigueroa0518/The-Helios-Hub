/**
 * Results page for the MD video finder trial (lab, 2026-11-23). Reads <tag>/results.json, copies picked
 * clips into <tag>/page/clips, writes <tag>/page/index.html and prints hit rates. No network, no spend.
 *
 *   npx tsx scripts/md-video-page.ts [tag]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab/video');
const tag = process.argv[2] ?? 'full';
const dir = path.join(LAB, tag);
const out = path.join(dir, 'page');

type Cand = { url: string; source: string; kind: string; title?: string; channel?: string; site?: string; status?: string; tier?: string; clip?: string; poster?: string; duration?: number; window?: { start: number; len: number } };
type Row = { story: { id: string; day: string; headline: string; posted: boolean; url: string }; brief: { plausible: string; footage: string; queries: string[] } | null; cands: Cand[]; pick: Cand | null };

const data = JSON.parse(fs.readFileSync(path.join(dir, 'results.json'), 'utf8')) as { costUsd: { haiku: number; jev: number; serper: number; jevCalls: number }; results: Row[] };
const ledger = JSON.parse(fs.readFileSync(path.join(LAB, 'ledger.json'), 'utf8')) as { spent: number };
const rows = data.results.sort((a, b) => a.story.day.localeCompare(b.story.day) || Number(b.story.posted) - Number(a.story.posted));

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '–');
const hit = (r: Row) => Boolean(r.pick);
const gold = (r: Row) => r.pick?.tier === 'golden';

function rate(label: string, set: Row[]) {
  return { label, n: set.length, hits: set.filter(hit).length, golden: set.filter(gold).length };
}
const plaus = (p: string) => rows.filter((r) => r.brief?.plausible === p);
const rates = [
  rate('All stories', rows),
  rate('Posted stories', rows.filter((r) => r.story.posted)),
  rate('Footage likely', plaus('likely')),
  rate('Footage possible', plaus('possible')),
  rate('Likely + possible', rows.filter((r) => r.brief && r.brief.plausible !== 'unlikely')),
  rate('Footage unlikely', plaus('unlikely')),
];
for (const r of rates) console.log(`${r.label.padEnd(20)} ${r.hits}/${r.n} hit (${pct(r.hits, r.n)}), ${r.golden} golden`);

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'clips'), { recursive: true });
const files: Record<string, string> = {};
for (const r of rows) {
  if (!r.pick?.clip) continue;
  for (const [k, ext] of [['clip', 'mp4'], ['poster', 'jpg']] as const) {
    const src = path.join(LAB, r.pick[k]!);
    const rel = `clips/${r.story.id}.${ext}`;
    if (ext === 'mp4') execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-vf', "scale=-2:'min(540,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', path.join(out, rel)]);
    else fs.copyFileSync(src, path.join(out, rel));
    files[rel] = path.join(out, rel);
  }
}

type Review = { run: string; id: string; verdict: 'golden' | 'near' | 'wrong'; note: string };
const reviewFile = path.join(LAB, 'review.json');
const reviews: Review[] = fs.existsSync(reviewFile) ? JSON.parse(fs.readFileSync(reviewFile, 'utf8')) : [];
const reviewed = reviews.map((rv) => {
  const run = JSON.parse(fs.readFileSync(path.join(LAB, rv.run, 'results.json'), 'utf8')) as { results: Row[] };
  const row = run.results.find((x) => x.story.id === rv.id)!;
  const base = `clips/r-${rv.run}-${rv.id}`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(LAB, row.pick!.clip!), '-vf', "scale=-2:'min(540,ih)'", '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', path.join(out, `${base}.mp4`)]);
  fs.copyFileSync(path.join(LAB, row.pick!.poster!), path.join(out, `${base}.jpg`));
  files[`${base}.mp4`] = path.join(out, `${base}.mp4`); files[`${base}.jpg`] = path.join(out, `${base}.jpg`);
  return { ...rv, row, base };
});
const verdictLabel = { golden: 'Golden', near: 'Near miss', wrong: 'Wrong pick' } as const;
const reviewCards = (['golden', 'near', 'wrong'] as const).map((v) => {
  const set = reviewed.filter((x) => x.verdict === v);
  if (!set.length) return '';
  return `<h3 class="vh v-${v}-h">${verdictLabel[v]} (${set.length})</h3><div class="wall">${set.map((x) => `
  <figure class="clip">
    <video src="${x.base}.mp4" poster="${x.base}.jpg" muted loop playsinline controls preload="metadata"></video>
    <figcaption>
      <span class="day">${x.row.story.day.slice(5)}${x.row.story.posted ? ' · posted' : ''} · run ${x.run} · pipeline said ${x.row.pick!.tier}</span>
      <strong>${esc(x.row.story.headline)}</strong>
      <span class="note">${esc(x.note)}</span>
      <span class="src"><a href="${esc(x.row.pick!.url)}" target="_blank" rel="noopener">${esc(x.row.pick!.channel ?? x.row.pick!.url)}</a></span>
    </figcaption>
  </figure>`).join('')}</div>`;
}).join('');

const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };
const video = (r: Row) => `<video src="clips/${r.story.id}.mp4" poster="clips/${r.story.id}.jpg" muted loop playsinline controls preload="metadata"></video>`;
const srcLine = (c: Cand) => `${esc(c.channel ?? host(c.url))}${c.site ? ` · ${esc(c.site)}` : ''}${c.source === 'article' ? ' · in the article' : ''}`;

const goldenCards = rows.filter(gold).map((r) => `
  <figure class="clip">
    ${video(r)}
    <figcaption>
      <span class="day">${r.story.day.slice(5)}${r.story.posted ? ' · posted' : ''}</span>
      <strong>${esc(r.story.headline)}</strong>
      <span class="src"><a href="${esc(r.pick!.url)}" target="_blank" rel="noopener">${srcLine(r.pick!)}</a> · ${r.pick!.window?.len ?? ''} s from ${r.pick!.window?.start ?? 0} s</span>
    </figcaption>
  </figure>`).join('');

const storyRows = rows.map((r) => {
  const p = r.brief?.plausible ?? 'no brief';
  const verdict = r.pick ? r.pick.tier! : 'none';
  const cands = r.cands.map((c) => `<li><span class="t t-${c.tier ?? 'skip'}">${c.tier ?? '–'}</span> <a href="${esc(c.url)}" target="_blank" rel="noopener">${esc((c.title ?? host(c.url)).slice(0, 80))}</a> <span class="muted">${srcLine(c)}${c.duration ? ` · ${Math.round(c.duration)} s read` : ''} · ${esc(c.status ?? 'not tried')}</span></li>`).join('');
  return `
  <article class="story">
    <div class="media">${r.pick ? video(r) : '<div class="empty">No clip</div>'}</div>
    <div class="body">
      <div class="chips"><span class="chip p-${p}">footage ${esc(p)}</span><span class="chip v-${verdict}">${verdict}</span>${r.story.posted ? '<span class="chip">posted</span>' : ''}<span class="date">${r.story.day}</span></div>
      <h3>${esc(r.story.headline)}</h3>
      ${r.brief ? `<p class="brief">${esc(r.brief.footage)}</p>` : ''}
      ${r.pick ? `<p class="src">Pick: <a href="${esc(r.pick.url)}" target="_blank" rel="noopener">${srcLine(r.pick)}</a></p>` : ''}
      <details><summary>${r.cands.length} candidates</summary><ul>${cands}</ul></details>
    </div>
  </article>`;
}).join('');

const rateRows = rates.map((r) => `<tr><th scope="row">${r.label}</th><td>${r.n}</td><td>${r.hits}</td><td class="big">${pct(r.hits, r.n)}</td><td>${r.golden}</td></tr>`).join('');
const c = data.costUsd;

// Vertical story clips (scripts/md-video-vertical.ts), promotion simulation and cost stats.
type VRow = { run: string; id: string; verdict: string; headline: string; w: number; h: number; mode: string; reason?: string; shots: { start: number; end: number; shown: number }[]; upscaled: boolean; stretch: number; renderSec: number; note?: string; file: string };
const vFile = path.join(LAB, 'vertical', 'results.json');
const vRows: VRow[] = fs.existsSync(vFile) ? (JSON.parse(fs.readFileSync(vFile, 'utf8')) as { results: VRow[] }).results : [];
const GOLDEN_NOW = new Set(['fef3ba99', '837ea71a', '60af6952', 'aedaa7a9', '35938279', 'e7f934d1']);
const vCards = vRows.map((v) => {
  const base = `clips/v-${v.run}-${v.id}`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', path.join(LAB, v.file), '-vf', 'scale=540:960', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', path.join(out, `${base}.mp4`)]);
  fs.copyFileSync(path.join(LAB, v.file.replace(/\.mp4$/, '.jpg')), path.join(out, `${base}.jpg`));
  files[`${base}.mp4`] = path.join(out, `${base}.mp4`); files[`${base}.jpg`] = path.join(out, `${base}.jpg`);
  const shots = v.shots.map((s) => `${Math.round(s.shown * 100)}%`).join(' · ');
  const tag = GOLDEN_NOW.has(v.id) ? 'golden' : 'near';
  return `<figure class="vclip"><video src="${base}.mp4" poster="${base}.jpg" muted loop playsinline controls preload="metadata"></video>
    <figcaption><span class="chips"><span class="chip v-${tag === 'golden' ? 'golden' : 'good'}">${tag}</span><span class="chip">${v.mode === 'crop' ? 'cropped' : v.mode === 'blur' ? 'blur-fit' : 'already vertical'}</span>${v.upscaled ? '<span class="chip">upscaled</span>' : ''}</span>
    <strong>${esc(v.headline)}</strong>
    <span class="src">${v.w}×${v.h} · ${v.shots.length} shot${v.shots.length > 1 ? 's' : ''}, subject shown per shot: ${shots}${v.note ? ` · ${esc(v.note)}` : ''}</span></figcaption></figure>`;
}).join('');

const promoFile = path.join(LAB, 'promotion-sim.json');
const promo = fs.existsSync(promoFile) ? (JSON.parse(fs.readFileSync(promoFile, 'utf8')) as Record<string, { before: string[]; after: { id: string; media: string; promoted: boolean }[] }>) : {};
const headlineOf = new Map<string, string>();
for (const t of ['sharded', 'v2', 'v3', 'v4']) { try { for (const r of (JSON.parse(fs.readFileSync(path.join(LAB, t, 'results.json'), 'utf8')) as { results: Row[] }).results) headlineOf.set(r.story.id, r.story.headline); } catch { /* skip */ } }
const short = (id: string) => esc((headlineOf.get(id) ?? id).replace(/ - [^-]+$/, '').slice(0, 70));
const promoRows = Object.entries(promo).map(([day, p]) => {
  const dropped = p.before.filter((id) => !p.after.some((a) => a.id === id));
  const items = p.after.map((a) => `<li>${a.media === 'video' ? `<span class="t t-golden">${a.promoted ? 'promoted, video' : 'video'}</span> ` : ''}${short(a.id)}</li>`).join('') + dropped.map((id) => `<li class="muted"><s>${short(id)}</s> (photo, bumped by a golden clip)</li>`).join('');
  return `<tr><th scope="row">${day.slice(5)}</th><td><ul class="plain">${items}</ul></td></tr>`;
}).join('');

const ledgerRuns = JSON.parse(fs.readFileSync(path.join(LAB, 'ledger.json'), 'utf8')) as { spent: number };
const costRows = [['Haiku: brief, title match, AI check', 0.0041], ['Jev: about 50 frame grades', 0.004], ['Serper: two video searches', 0.002]] as const;

const html = `<title>MD Video Finder Trial</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;600&family=IBM+Plex+Mono:wght@400;600&family=Archivo:wght@700;800&display=swap">
<style>
/* Layout: lab report. Hit-rate table, golden reel wall, then every story as a row with its clip. */
:root{--bg:#f6f7f5;--panel:#ffffff;--fg:#1b1f1c;--muted:#5f675f;--line:#dde2dc;--accent:#d9480f;--good:#2b8a3e;--gold:#b7791f;--none:#868e96;
--display:'Archivo',system-ui,sans-serif;--text:'IBM Plex Sans',system-ui,sans-serif;--mono:'IBM Plex Mono',ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121513;--panel:#1a1e1b;--fg:#e8ece8;--muted:#9aa39a;--line:#2c322d;--accent:#ff7a3d;--good:#51cf66;--gold:#f0b429;--none:#9aa0a6;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121513;--panel:#1a1e1b;--fg:#e8ece8;--muted:#9aa39a;--line:#2c322d;--accent:#ff7a3d;--good:#51cf66;--gold:#f0b429;--none:#9aa0a6;color-scheme:dark}
body{background:var(--bg);color:var(--fg);font:15px/1.5 var(--text);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:24px 48px}
.wrap{max-width:1100px;margin:0 auto;display:grid;gap:36px}
h1{font:800 clamp(28px,5vw,44px)/1.05 var(--display);margin:0;letter-spacing:-.01em;text-wrap:balance}
h2{font:700 20px/1.2 var(--display);margin:0 0 12px;text-transform:uppercase;letter-spacing:.04em}
h3{font:600 16px/1.35 var(--text);margin:4px 0;text-wrap:balance}
a{color:inherit;text-decoration-color:var(--accent)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.lede{color:var(--muted);max-width:68ch;margin:8px 0 0}
.tablebox{overflow-x:auto}
table{border-collapse:collapse;font:14px var(--mono);font-variant-numeric:tabular-nums;min-width:440px}
th,td{padding:8px 14px;border-bottom:1px solid var(--line);text-align:right}
th[scope=row],thead th:first-child{text-align:left;font-family:var(--text);font-weight:600}
thead th{color:var(--muted);font-weight:400;font-size:12px;text-transform:uppercase;letter-spacing:.06em}
td.big{font-weight:600;color:var(--accent)}
.cost{font:13px var(--mono);color:var(--muted)}
.wall{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:18px}
.clip{margin:0;display:grid;gap:8px;min-width:0}
video{width:100%;max-width:100%;aspect-ratio:16/9;object-fit:contain;background:#000;border-radius:6px;display:block}
figcaption{display:grid;gap:2px;font-size:14px;min-width:0}
.day,.date{font:12px var(--mono);color:var(--muted)}
.src{font-size:13px;color:var(--muted);margin:0}
.story{display:grid;grid-template-columns:minmax(0,280px) minmax(0,1fr);gap:18px;padding:16px 0;border-top:1px solid var(--line)}
@media (max-width:640px){.story{grid-template-columns:1fr}}
.body{min-width:0}
.empty{aspect-ratio:16/9;border:1px dashed var(--line);border-radius:6px;display:grid;place-items:center;color:var(--muted);font:13px var(--mono)}
.chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.chip{font:12px var(--mono);padding:2px 8px;border-radius:99px;border:1px solid var(--line)}
.p-likely{border-color:var(--good);color:var(--good)}.p-possible{border-color:var(--gold);color:var(--gold)}.p-unlikely{color:var(--none)}
.v-golden{background:var(--gold);border-color:var(--gold);color:var(--bg);font-weight:600}.v-good{background:var(--good);border-color:var(--good);color:var(--bg)}.v-none{color:var(--none)}
.brief{color:var(--muted);margin:4px 0;font-size:14px}
details{margin-top:6px;font-size:13px}
summary{cursor:pointer;color:var(--muted)}
ul{padding-left:18px;margin:6px 0;display:grid;gap:4px}
li{overflow-wrap:anywhere}
.muted{color:var(--muted)}\n.vwall{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:18px}.vclip{margin:0;display:grid;gap:8px;min-width:0}.vclip video{aspect-ratio:9/16}.vclip figcaption{display:grid;gap:4px;font-size:14px}ul.plain{list-style:none;padding:0;margin:0;display:grid;gap:4px;text-align:left}table.promo td{text-align:left}\n.verdict{display:grid;gap:8px;max-width:72ch;margin-top:14px;padding:14px 16px;border:1px solid var(--line);border-radius:8px;background:var(--panel)}.verdict p{margin:0}\n.note{font-size:13px}\n.vh{font:700 15px var(--display);text-transform:uppercase;letter-spacing:.05em;margin:18px 0 10px}.v-golden-h{color:var(--gold)}.v-near-h{color:var(--good)}.v-wrong-h{color:var(--none)}
.t{font:11px var(--mono);text-transform:uppercase}.t-golden{color:var(--gold)}.t-good{color:var(--good)}.t-none,.t-skip{color:var(--none)}
</style>
<div class="wrap">
  <header>
    <h1>Morning Download video finder</h1>
    <p class="lede">Final full run (v3) on the ${rows.length} top-7 stories from the five-day MD photo trial (${rows[0]?.story.day} to ${rows.at(-1)?.story.day}). A hit is a raw-footage clip of the story itself that passed frame grading; golden means most sampled frames and every frame inside the trimmed clip show the story's own subject. News reports, reaction and commentary videos are rejected. Clips play muted here; the files keep their lowered audio.</p>
    <div class="verdict">
      <p><strong>Where it stands.</strong> The final run picked a clip for 10 of 35 stories, but checking the clips cut that to 6 real hits (17%), or 4 of the 15 posted stories (27%). Across all runs there are 6 golden clips (my four plus the Blue Origin and Tesla clips you upgraded) and 4 near misses.</p>
      <p><strong>Talking-head rerun (v4).</strong> Rejecting videos that show people talking removed every wrong pick, but recall collapsed to 2 of 35, both near misses. Two reasons: a news package with 2 reporter frames and 6 frames of raw bodycam lost its whole video, and actors speaking in the trailer counted as talking heads. Downloads also failed more often (36 against 20), including every Tesla clip. Next step: judge the trimmed clip rather than the whole source video, and download fewer videos at once. Replaying that rule offline on v4's grades gives 4 stories, so Jev's subject score is the other limit.</p>
      <p><strong>The 50% target.</strong> It holds only for stories with something to film: launches, demos, vehicles, trailers and discoveries hit about 6 times in 10. On the full Morning Download mix it does not hold, because about a third of the stories are lawsuits, policy, money or statements. For those, the only clips that exist are news reports and interviews, and those are the false hits shown below. Set the target on footage-able stories only, or on stories where a clip is a plus rather than a promise.</p>
    </div>
  </header>
  <section>
    <h2>Story-ready clips (1080×1920)</h2>
    <p class="lede">Every kept clip, fitted to the story frame. Each shot is checked on its own: the clip is cropped to vertical only when every shot keeps at least half of its subject, otherwise the whole frame sits over a blurred copy. Clips stretched 1.25× or more go through the same Real-ESRGAN model as the photos.</p>
    <div class="vwall">${vCards || '<p class="muted">Not rendered yet.</p>'}</div>
  </section>
  <section>
    <h2>Golden clips promote stories</h2>
    <p class="lede">The trial days replayed with the new rule: the top 8 are video-checked, and every story there with a golden clip is posted with its clip, ahead of photo-only stories, within the 5-post cap. Good-but-not-golden clips change nothing. Golden here means my four plus the Blue Origin and Tesla clips you upgraded.</p>
    <div class="tablebox"><table class="promo"><tbody>${promoRows}</tbody></table></div>
  </section>
  <section>
    <h2>What it costs</h2>
    <div class="tablebox"><table><thead><tr><th>Item</th><th>Cost</th></tr></thead><tbody>
      ${costRows.map(([k, v]) => `<tr><th scope="row">${k}</th><td>$${v.toFixed(4)}</td></tr>`).join('')}
      <tr><th scope="row">Per story checked</th><td class="big">$0.010</td></tr>
      <tr><th scope="row">Per day (top 8 stories)</th><td class="big">$0.08</td></tr>
      <tr><th scope="row">Per 30 days</th><td class="big">$2.40</td></tr>
      <tr><th scope="row">Vertical fit (Jev subject boxes, per clip)</th><td>$0.0005</td></tr>
      <tr><th scope="row">Upscale and render (local, per clip)</th><td>$0 · minutes of CPU</td></tr>
    </tbody></table></div>
    <p class="cost">Measured on the last two 35-story runs: $0.35 each, about 1,750 Jev frame grades ($0.00008 each), 70 Serper searches. Wall time about 10 minutes for 35 stories with 15 in parallel; a day's 8 stories take about 4 minutes. All lab spend for this finder so far: $${ledgerRuns.spent.toFixed(2)}.</p>
  </section>
  <section>
    <h2>Reviewed picks, all runs</h2>
    <p class="lede">Every clip the finder picked across the three runs, checked by watching frames inside the clip. The pipeline's own golden label is not reliable yet: talking heads and one news interview got through.</p>
    ${reviewCards}
  </section>
  <section>
    <h2>Hit rates, final run (pipeline labels)</h2>
    <div class="tablebox"><table><thead><tr><th>Set</th><th>Stories</th><th>Hits</th><th>Hit rate</th><th>Golden</th></tr></thead><tbody>${rateRows}</tbody></table></div>
    <p class="cost">Spend this run: Haiku $${c.haiku.toFixed(3)} · Jev $${c.jev.toFixed(3)} (${c.jevCalls} frame grades) · Serper $${c.serper.toFixed(3)}. All video-finder runs so far: $${ledger.spent.toFixed(3)}.</p>
  </section>
  <section>
    <h2>Pipeline golden, final run (${rows.filter(gold).length})</h2>
    <div class="wall">${goldenCards || '<p class="muted">None this run.</p>'}</div>
  </section>
  <section>
    <h2>Every story</h2>
    ${storyRows}
  </section>
</div>`;
fs.writeFileSync(path.join(out, 'index.html'), html);
fs.writeFileSync(path.join(out, 'files.json'), JSON.stringify(files, null, 1));
console.log(`page: ${path.relative(process.cwd(), path.join(out, 'index.html'))}, ${Object.keys(files).length} files, ${(Object.values(files).reduce((s, f) => s + fs.statSync(f).size, 0) / 1e6).toFixed(1)} MB`);
