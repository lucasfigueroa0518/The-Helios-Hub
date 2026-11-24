/** Review page for the upscale test (story-upscale.ts, v2 = native input, stretch ≥ 1.25). Free. */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const DIR = path.join(process.cwd(), '.memes-local/news-ranker-lab/upscale');
const rd = (f: string) => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8'));
const items: { id: string; stretch: number }[] = rd('items.json');
const ref = rd('ref-opus-v2.json'), key = rd('pair-key-v2.json');
const b64 = async (f: string) => `data:image/jpeg;base64,${(await sharp(f).resize({ width: 520 }).jpeg({ quality: 80 }).toBuffer()).toString('base64')}`;
const LABEL: Record<string, string> = { helps: 'Upscale is cleaner', same: 'No visible difference', hurts: 'Plain is better', unfaithful: 'Sharper but unfaithful' };

async function main() {
  let rows = '';
  const tally: Record<string, number> = {};
  for (const id of Object.keys(ref).sort()) {
    const it = items.find((x) => x.id === id)!;
    const upSide = key[id].left === 'up' ? 'left' : 'right';
    const o = ref[id];
    const v = o.better === 'same' ? 'same' : o.better === upSide ? (o.faithful ? 'helps' : 'unfaithful') : 'hurts';
    tally[v] = (tally[v] ?? 0) + 1;
    // Re-cut the pair into plain | upscaled so the page is never blind.
    const pair = sharp(path.join(DIR, 'pairs-v2', `${id}.jpg`));
    const L = await pair.clone().extract({ left: 0, top: 0, width: 720, height: 720 }).jpeg().toBuffer();
    const R = await pair.clone().extract({ left: 736, top: 0, width: 720, height: 720 }).jpeg().toBuffer();
    const [plain, up] = upSide === 'left' ? [R, L] : [L, R];
    const tmpP = path.join(DIR, 'tmp', `${id}-p.jpg`), tmpU = path.join(DIR, 'tmp', `${id}-u.jpg`);
    fs.writeFileSync(tmpP, plain); fs.writeFileSync(tmpU, up);
    rows += `<article class="row"><header><b>${LABEL[v]}</b><span>stretched ${it.stretch.toFixed(2)}×</span></header>
      <div class="pair"><figure><img src="${await b64(tmpP)}" alt=""><figcaption>Plain resize</figcaption></figure><figure><img src="${await b64(tmpU)}" alt=""><figcaption>Real-ESRGAN</figcaption></figure></div></article>`;
  }
  const html = `<title>Story Upscale Test</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Source+Serif+4:opsz,wght@8..60,400&family=IBM+Plex+Mono:wght@400&display=swap">
<style>
:root{--bg:#f6f5f1;--paper:#fff;--ink:#17191c;--muted:#5d6168;--rule:#dcd9d1}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#121315;--paper:#1b1d20;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;color-scheme:dark}
body{background:var(--bg);color:var(--ink);font-family:"Source Serif 4",Georgia,serif;padding:28px 16px 48px}
.wrap{max-width:1080px;margin:0 auto;display:grid;gap:20px}
h1{font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:clamp(28px,5vw,40px);margin:0}
.lede{color:var(--muted);max-width:70ch;line-height:1.5;margin:6px 0 0}
.stats{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted)}
.row{background:var(--paper);border:1px solid var(--rule);border-radius:6px;padding:12px}
.row header{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px;font-family:Archivo,system-ui,sans-serif}
.row header span{font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted)}
.pair{display:grid;grid-template-columns:1fr 1fr;gap:10px}
figure{margin:0}img{width:100%;display:block;border-radius:3px}
figcaption{font-family:"IBM Plex Mono",monospace;font-size:11px;color:var(--muted);margin-top:4px}
</style>
<div class="wrap"><div><h1>Story upscale test</h1>
<p class="lede">The 20 photos that get stretched 1.25× or more to fill the story frame. Each pair is the same 720 px patch at full size, a plain resize next to Real-ESRGAN. Opus judged every pair blind.</p>
<p class="stats">Cleaner ${tally.helps ?? 0} · no difference ${tally.same ?? 0} · plain better ${tally.hurts ?? 0} · sharper but unfaithful ${tally.unfaithful ?? 0}</p></div>
${rows}</div>`;
  fs.writeFileSync(process.argv[2]!, html);
  console.log(`page ${(html.length / 1024).toFixed(0)} KB`, tally);
}
main();
