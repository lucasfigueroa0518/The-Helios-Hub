/** Builds the review page for the Morning Download end-to-end trial (md-photo-trial.ts output). Free. */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const DIR = path.join(process.cwd(), '.memes-local/news-ranker-lab/md-trial');
const OUT = process.argv[2]!;
const f = JSON.parse(fs.readFileSync(path.join(DIR, 'final.json'), 'utf8'));
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const clean = (h: string) => h.replace(/\s+-\s+[^-]{2,40}$/, '');
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
const SOURCE: Record<string, string> = { article: 'From the article', other_outlet: 'From another outlet', search: 'From image search' };
const HELD: Record<string, string> = { '2026-11-12': 'used before', '2026-11-18': 'used before' };

async function main() {
  let body = '';
  for (const [d, x] of Object.entries(f.days) as [string, { posts: any[]; top7: any[] }][]) {
    let cards = '';
    for (const p of x.posts) {
      let img = '<div class="noimg">No photo</div>';
      if (p.photo) {
        const buf = await sharp(path.join(DIR, p.photo.file)).resize({ width: 720, withoutEnlargement: true }).jpeg({ quality: 78 }).toBuffer();
        img = `<img src="data:image/jpeg;base64,${buf.toString('base64')}" alt="${esc(p.brief?.subject ?? '')}">`;
      }
      let host = '';
      try { host = new URL(p.photo?.src ?? '').hostname.replace(/^www\./, ''); } catch { /* none */ }
      cards += `<article class="post"><figure>${img}</figure><div class="meta">
        <h3>${esc(clean(p.headline))}</h3>
        <div class="chips"><span class="chip grade-${p.verdict}">Photo: ${p.verdict}</span><span class="chip">Cool ${p.cool} · Value ${p.value}</span>${p.top_tier ? '' : '<span class="chip warn">Filled to reach 2</span>'}</div>
        <p class="brief"><b>Brief:</b> ${esc(p.brief?.subject ?? '')}</p>
        <p class="src">${SOURCE[p.photo?.source] ?? ''}${host ? ` · ${esc(host)}` : ''} · clarity ${p.photo?.clarity ?? '–'}/10</p>
      </div></article>`;
    }
    const skipped = x.top7.filter((s) => !s.posted).map((s) => {
      const why = s.top_tier ? (s.verdict === 'good' ? 'top tier, not reached' : `top tier, skipped: photo ${s.verdict}`) : 'below the bar';
      return `<li><span>${esc(clean(s.headline))}</span><em class="${s.top_tier ? 'skip' : ''}">${why}${s.aiRejected?.length ? ` · ${s.aiRejected.length} AI photo rejected` : ''}</em></li>`;
    }).join('');
    body += `<section class="day"><header><h2>${day(d)}</h2><span class="tag">${HELD[d] ?? 'held out'}</span><span class="count">${x.posts.length} posted</span></header>
      <div class="posts">${cards}</div>
      <details><summary>Rest of the top 7 (${x.top7.length - x.posts.length})</summary><ul class="rest">${skipped}</ul></details></section>`;
  }
  const cost = f.costUsd;
  const html = `<title>Morning Download Trial</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* Layout: a morning paper's daily stack. One column of days; each day's posts as photo-led cards in a responsive grid. */
:root{--bg:#f6f5f1;--paper:#ffffff;--ink:#17191c;--muted:#5d6168;--rule:#dcd9d1;--accent:#c4501d;--good:#1f7a4d;--usable:#9a6a00;--none:#a33a3a;
--display:"Archivo",system-ui,sans-serif;--body:"Source Serif 4",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ee7a45;--good:#4fc08a;--usable:#e0b24a;--none:#e07a7a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ee7a45;--good:#4fc08a;--usable:#e0b24a;--none:#e07a7a;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:var(--body);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:28px 48px}
.wrap{max-width:1080px;margin:0 auto;display:grid;gap:40px}
.mast{display:grid;gap:8px;border-bottom:3px solid var(--ink);padding-bottom:14px}
.mast h1{font-family:var(--display);font-weight:800;font-size:clamp(28px,5vw,44px);letter-spacing:-.02em;margin:0;text-wrap:balance}
.mast p{margin:0;color:var(--muted);max-width:68ch;line-height:1.5}
.mast .cost{font-family:var(--mono);font-size:12px;color:var(--muted)}
.day header{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;border-bottom:1px solid var(--rule);padding-bottom:8px;margin-bottom:16px}
.day h2{font-family:var(--display);font-weight:700;font-size:24px;margin:0}
.tag{font-family:var(--mono);font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--accent)}
.count{margin-left:auto;font-family:var(--mono);font-size:12px;color:var(--muted)}
.posts{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px}
.post{background:var(--paper);border:1px solid var(--rule);border-radius:6px;overflow:hidden;display:flex;flex-direction:column;min-width:0}
.post figure{margin:0;aspect-ratio:4/3;background:var(--rule);max-width:100%}
.post img{width:100%;height:100%;object-fit:cover;display:block}
.noimg{display:grid;place-items:center;height:100%;color:var(--muted);font-family:var(--mono);font-size:12px}
.meta{padding:14px 14px 16px;display:grid;gap:8px;min-width:0}
.meta h3{font-family:var(--display);font-weight:700;font-size:17px;line-height:1.25;margin:0;text-wrap:balance}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip{font-family:var(--mono);font-size:11px;padding:2px 7px;border:1px solid var(--rule);border-radius:99px;color:var(--muted);font-variant-numeric:tabular-nums}
.grade-good{color:var(--good);border-color:var(--good)}.grade-usable{color:var(--usable);border-color:var(--usable)}.grade-none{color:var(--none);border-color:var(--none)}
.warn{color:var(--usable);border-color:var(--usable)}
.brief,.src{margin:0;font-size:14px;line-height:1.45;color:var(--muted)}
.brief b{color:var(--ink);font-weight:600}
.src{font-family:var(--mono);font-size:11px;overflow-wrap:anywhere}
details{margin-top:14px}
summary{cursor:pointer;font-family:var(--mono);font-size:12px;color:var(--muted)}
summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.rest{list-style:none;padding:0;margin:10px 0 0;display:grid;gap:6px}
.rest li{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;border-bottom:1px dotted var(--rule);padding-bottom:6px;font-size:14px}
.rest em{font-style:normal;font-family:var(--mono);font-size:11px;color:var(--muted)}
.rest em.skip{color:var(--usable)}
</style>
<div class="wrap">
<div class="mast"><h1>Morning Download trial</h1>
<p>Five days through the full flow: B shortlists, Opus picks the posted set, Haiku writes each photo brief, Jev grades article, outlet and image-search photos, and Haiku removes only blatantly AI picks. Top-tier stories without a good photo are skipped; a short day fills to 2.</p>
<p class="cost">Photo step: Haiku $${cost.haiku.toFixed(3)} · Jev $${cost.jev.toFixed(3)} · Serper $${cost.serper.toFixed(3)}</p></div>
${body}
</div>`;
  fs.writeFileSync(OUT, html);
  console.log(`page ${(html.length / 1024).toFixed(0)} KB`);
}
main();
