/** Review page for the shared News Writer, W11 "story framed for a reaction" run. Free. */
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.join(process.cwd(), '.memes-local/news-ranker-lab/writer');
const runs = ['run-frame-2026-11-18.json', 'run-frame-2026-11-11_2026-11-12_2026-11-14_2026-11-19.json'].map((f) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')));
const days: Record<string, any> = Object.assign({}, ...runs.map((r) => r.days));
const cost = runs.reduce((n, r) => n + r.costUsd, 0);
const esc = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const clean = (h: string) => h.replace(/\s+-\s+[^-]{2,40}$/, '');
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });

type W = { key: string; chosen: string; headline: string; body: string };
function format(label: string, f: { written: W[]; rewritten: string[] }, key: string) {
  const w = f.written.find((x) => x.key === key);
  if (!w) return `<div class="fmt"><div class="label">${label}</div><p class="felt">Not written</p></div>`;
  const over = w.headline.length > 60 || w.body.length > 140 ? `<span class="chip warn">over cap ${w.headline.length}/${w.body.length}</span>` : '';
  return `<div class="fmt"><div class="label">${label}</div>
    <p class="copy"><b>${esc(w.headline)}</b> ${esc(w.body)}</p>
    <div class="chips"><span class="chip">${w.chosen === 'editor' ? "Editor's angle" : "Writer's angle"}</span>${f.rewritten?.includes(key) ? '<span class="chip">fact-fixed</span>' : ''}${over}</div></div>`;
}

let body = '';
let n = 0;
for (const [d, x] of Object.entries(days).sort()) {
  let cards = '';
  for (const s of x.stories) {
    n++;
    cards += `<article class="story"><p class="src">${esc(clean(s.source_headline))}</p>
      <div class="fmts">${format('Morning Download', x.md, s.key)}${format('Last Few Days', x.lfd, s.key)}</div></article>`;
  }
  body += `<section><h2>${day(d)}</h2>${cards}</section>`;
}

const html = `<title>News Writer W11</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400&display=swap">
<style>
:root{--bg:#f6f5f1;--paper:#fff;--ink:#17191c;--muted:#5d6168;--rule:#dcd9d1;--accent:#c4501d;--warn:#9a6a00}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ee7a45;--warn:#e0b24a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ee7a45;--warn:#e0b24a;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:"Source Serif 4",Georgia,serif;padding:28px 16px 48px}
.wrap{max-width:1080px;margin:0 auto;display:grid;gap:32px}
h1{font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:clamp(28px,5vw,42px);margin:0;letter-spacing:-.02em}
.lede{color:var(--muted);max-width:72ch;line-height:1.5;margin:8px 0 0}
.stats{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted);margin-top:6px}
h2{font-family:Archivo,system-ui,sans-serif;font-size:22px;border-bottom:1px solid var(--rule);padding-bottom:6px;margin:0 0 14px}
section{display:grid;gap:14px}
.story{background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:16px;display:grid;gap:10px;min-width:0}
.src{margin:0;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted)}
.fmts{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:14px}
.fmt{border-top:3px solid var(--ink);padding-top:8px;display:grid;gap:6px;min-width:0}
.label{font-family:Archivo,system-ui,sans-serif;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)}
.copy{margin:0;font-size:18px;line-height:1.4}.copy b{font-family:Archivo,system-ui,sans-serif;font-weight:800}
.felt{margin:0;font-size:14px;color:var(--muted);font-style:italic}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-family:"IBM Plex Mono",monospace;font-size:11px;padding:2px 7px;border:1px solid var(--rule);border-radius:99px;color:var(--muted)}
.warn{color:var(--warn);border-color:var(--warn)}
</style>
<div class="wrap"><div><h1>News Writer W11</h1>
<p class="lede">The shared writer for Morning Download and Last Few Days. The headline tells the story itself, framed so the reader reacts; the body closes the loop. Each format runs on its own. The grey line on each card is the outlet's original headline. "Over cap" marks copy past 60/140 characters, which production code would send back.</p>
<p class="stats">5 trial days · ${n} stories · $${cost.toFixed(2)} for the whole test</p></div>
${body}</div>`;
fs.writeFileSync(process.argv[2]!, html);
console.log(`page ${(html.length / 1024).toFixed(0)} KB`);
