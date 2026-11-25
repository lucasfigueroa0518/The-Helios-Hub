/** Review page for the vertical-fit test (story-crop.ts output). Free. */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { renderStory } from './story-crop';

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab/story-crop');
const TRIAL = path.join(process.cwd(), '.memes-local/news-ranker-lab/md-trial');
const OUT = process.argv[2]!;
const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(LAB, f), 'utf8'));
const picks: { file: string; w: number; h: number }[] = rd('picks.json');
const ref = rd('ref-opus.json');
const dj = rd('decisions-jev-v3.json');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const b64 = async (buf: Buffer, w: number) => `data:image/jpeg;base64,${(await sharp(buf).resize({ width: w }).jpeg({ quality: 74 }).toBuffer()).toString('base64')}`;
const call = (d: { mode: string }) => (d.mode === 'crop' ? 'Crop' : 'Blur-fit');

async function main() {
  let rows = '';
  let agreeJ = 0;
  for (const p of picks) {
    const src = fs.readFileSync(path.join(TRIAL, p.file));
    const o = ref[p.file], jv = dj[p.file];
    const opus = o.croppable ? 'crop' : 'blur';
    if (jv.mode === opus) agreeJ++;
    const frames = [`<figure><img src="${await b64(fs.readFileSync(path.join(LAB, 'render-jev-v3', p.file.replace('/', '_'))), 300)}" alt=""><figcaption>Jev's frame (shipped)</figcaption></figure>`];
    if (o.croppable && jv.mode !== 'crop') {
      const win = (p.h * 9) / 16 / p.w;
      const left = Math.min(Math.max(o.centre - win / 2, 0), 1 - win);
      frames.push(`<figure><img src="${await b64(await renderStory(src, { mode: 'crop', left, width: win }), 300)}" alt=""><figcaption>Opus's crop, for comparison</figcaption></figure>`);
    }
    const tag = (who: string, m: string) => `<span class="chip ${m === opus ? 'ok' : 'miss'}">${who}: ${m === 'crop' ? 'Crop' : 'Blur-fit'}</span>`;
    rows += `<article class="row"><div class="orig"><img src="${await b64(src, 520)}" alt=""><p class="why">Opus: <b>${opus === 'crop' ? 'Crop' : 'Blur-fit'}</b>. ${esc(o.why)}</p>
      <div class="chips">${tag('Jev', jv.mode)}</div></div><div class="frames">${frames.join('')}</div></article>`;
  }
  const cost = rd('ask-jev-v3.json').costUsd;
  const crops = Object.values(dj).filter((d) => (d as { mode: string }).mode === 'crop').length;
  const html = `<title>Story Vertical Fit</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
:root{--bg:#f6f5f1;--paper:#fff;--ink:#17191c;--muted:#5d6168;--rule:#dcd9d1;--accent:#c4501d;--ok:#1f7a4d;--miss:#a33a3a;--display:"Archivo",system-ui,sans-serif;--body:"Source Serif 4",Georgia,serif;--mono:"IBM Plex Mono",ui-monospace,monospace}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ee7a45;--ok:#4fc08a;--miss:#e07a7a;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ee7a45;--ok:#4fc08a;--miss:#e07a7a;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:var(--body);padding:28px 16px 48px}
.wrap{max-width:1080px;margin:0 auto;display:grid;gap:24px}
.mast{border-bottom:3px solid var(--ink);padding-bottom:14px;display:grid;gap:8px}
h1{font-family:var(--display);font-weight:800;font-size:clamp(28px,5vw,42px);margin:0;letter-spacing:-.02em}
.mast p{margin:0;color:var(--muted);max-width:70ch;line-height:1.5}
.stats{font-family:var(--mono);font-size:12px;color:var(--muted)}
.row{background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:14px;display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;align-items:start}
@media (max-width:700px){.row{grid-template-columns:1fr}}
.orig img{width:100%;display:block;border-radius:3px}
.why{margin:10px 0 8px;font-size:14px;color:var(--muted);line-height:1.4}.why b{color:var(--ink)}
.frames{display:flex;gap:10px;flex-wrap:wrap}
figure{margin:0;flex:1 1 140px;max-width:200px}
figure img{width:100%;aspect-ratio:9/16;object-fit:cover;display:block;border-radius:6px;border:1px solid var(--rule)}
figcaption{font-family:var(--mono);font-size:11px;color:var(--muted);margin-top:4px}
.chips{display:flex;gap:6px;flex-wrap:wrap}
.chip{font-family:var(--mono);font-size:11px;padding:2px 7px;border:1px solid;border-radius:99px}
.ok{color:var(--ok);border-color:var(--ok)}.miss{color:var(--miss);border-color:var(--miss)}
</style>
<div class="wrap"><div class="mast"><h1>Story vertical fit</h1>
<p>Forty landscape photos from the five-day trial. Jev boxes each photo's main subject and says whether it carries text that must be read in full. Code crops to a full-height 9:16 slice when the slice holds most of the subject (at least 45%) and no such text would be cut. If not, the whole photo sits in the middle over a blurred, enlarged copy of itself. Green chips agree with Opus's call and red chips don't. Where Opus would have cropped and Jev didn't, Opus's crop is shown beside Jev's frame.</p>
<p class="stats">Crops ${crops}/40 · Jev matches Opus on ${agreeJ}/40 · Jev cost for 40 photos $${cost.toFixed(4)}</p></div>
${rows}</div>`;
  fs.writeFileSync(OUT, html);
  console.log(`page ${(html.length / 1024).toFixed(0)} KB, jev ${agreeJ}`);
}
main();
