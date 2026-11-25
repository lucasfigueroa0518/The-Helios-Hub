/**
 * LFD AI cover lab (2026-11-23): renders full cover slides from the AI images in
 * .memes-local/news-ranker-lab/covers/ with the real LFD template (local Chromium, no AI, no spend).
 * The images were made on Higgsfield from each window's story photos; the prompts are in COVERS below.
 * Usage: npx tsx scripts/lfd-ai-cover-page.ts <out.html>
 */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

const DIR = path.join(process.cwd(), '.memes-local/news-ranker-lab/covers');

type Cover = { file: string; direction: string; window: string; stories: string[]; idea: string; hook: string; accent: string; canvas: 'black' | 'green' | 'orange' | 'white' };
const W1 = 'Nov 11–14', W2 = 'Nov 14–18', W3 = 'Nov 17–19';
const S1 = ['A joystick-flown car could sell in China for $300,000', 'Anthropic’s CEO says AI could end cancer within a decade', 'Google’s strongest AI now takes on long jobs by itself', 'Google’s AI glasses in Warby Parker frames start at $395', 'Google’s AI spots disease mutations in DNA’s hidden 98%'];
const S2 = ['Jensen Huang quit Nvidia over a relationship he hid', 'Nonprofits ask a judge to freeze AI at its Nov. 12 level', 'Ex-Nvidia CEO in spy affair would return if board asks', 'Uber Eats food arrives by drone in Texas, at up to 70 mph', 'School AI mistook a Doritos bag for a gun, and 4 teens sue'];
const S3 = ['Ex-Nvidia boss’s affair may have been with a suspected spy', 'The company behind Claude is now worth over $1.5 trillion', 'Google will send AI computers to space on Bezos’s rocket', 'GTA VI could keep a wave of students and workers home', 'Uber Eats food arrives by drone in Texas, at up to 70 mph', 'School AI mistook a Doritos bag for a gun, and 4 teens sue', 'Google pays $500M+ for power from rock-vaporizing drills'];

// Round 2 (d1–d4: Unaware, Standoff). Round 3 (Eye contact, The weight) rejected 2026-11-23. Hooks rotate through LFD_COVER_HOOKS.
const COVERS: Cover[] = [
  { file: 'd1', direction: 'Unaware', window: W3, stories: S3, idea: 'Jensen and Dario lean over a sleeping viewer while a rocket launches outside.', hook: 'Do you realize what just happened in AI in the last few days?', accent: 'in the last few days?', canvas: 'black' },
  { file: 'd2', direction: 'Unaware', window: W1, stories: S1, idea: 'A commuter in AI glasses scrolls while Dario sits beside her holding a DNA helix and a flying car fills the window.', hook: '5 things happened in AI you need to know.', accent: '5 things', canvas: 'green' },
  { file: 'd3', direction: 'Standoff', window: W2, stories: S2, idea: 'Jensen and Lady Justice face off chest-up across a glowing GPU.', hook: 'Everyone in AI is talking about this. Are you?', accent: 'Are you?', canvas: 'orange' },
  { file: 'd4', direction: 'Standoff', window: W3, stories: S3, idea: 'Dario and Jensen eye to eye over a chessboard of GPUs.', hook: 'AI changed this week. Most people haven’t noticed yet.', accent: 'haven’t noticed yet.', canvas: 'white' },
];

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: lfd-ai-cover-page.ts <out.html>');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { buildPost } = await import('@/lib/lfd/post');
  const base = buildPost([], new Date('2026-11-23T12:00:00Z'));
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });

  const cards: string[] = [];
  for (const c of COVERS) {
    const src = path.join(DIR, `${c.file}.png`);
    if (!fs.existsSync(src)) { console.warn('missing', c.file); continue; }
    const art = `data:image/jpeg;base64,${(await sharp(src).resize({ width: 1080 }).jpeg({ quality: 88 }).toBuffer()).toString('base64')}`;
    const cover = { ...base.slides[0]!, canvas: c.canvas, lfdCover: { photos: [], image: { url: art }, hook: { text: c.hook, accent: c.accent } } };
    const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'aic-'));
    const fit = await checkRenderFit({ ...base, slides: [cover] } as never, { screenshotDir: dir, name: 'slide' });
    if (fit.problems?.length) console.warn(c.file, fit.problems.slice(0, 3));
    const png = fs.readdirSync(dir).find((f) => /^slide-slide-\d+\.png$/.test(f))!;
    const jpg = `data:image/jpeg;base64,${(await sharp(path.join(dir, png)).resize({ width: 720 }).jpeg({ quality: 84, mozjpeg: true }).toBuffer()).toString('base64')}`;
    fs.copyFileSync(path.join(dir, png), path.join(DIR, `${c.file}-cover.png`));
    fs.rmSync(dir, { recursive: true, force: true });
    cards.push(`<article class="card"><img src="${jpg}" alt="Cover ${c.file}">
<div class="meta"><p class="dir">${c.direction} <span>${c.window} · ${c.canvas}</span></p><p class="idea">${c.idea}</p>
<details><summary>Stories in this window</summary><ul>${c.stories.map((s) => `<li>${s}</li>`).join('')}</ul></details></div></article>`);
  }

  const html = `<title>LFD AI Covers</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Source+Serif+4:opsz,wght@8..60,400&family=IBM+Plex+Mono&display=swap">
<style>
:root{--bg:#f4f3ef;--paper:#fff;--ink:#17191c;--muted:#5d6168;--rule:#dcd9d1;--accent:#c4501d}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111214;--paper:#1a1c1f;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ff7a3d;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111214;--paper:#1a1c1f;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;--accent:#ff7a3d;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Source Serif 4",Georgia,serif;padding:28px 16px 56px}
.wrap{max-width:1180px;margin:0 auto;display:grid;gap:24px}
h1{font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:clamp(28px,5vw,42px);margin:0;letter-spacing:-.02em}
.lede{color:var(--muted);max-width:75ch;line-height:1.5;margin:6px 0 0}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.card{background:var(--paper);border:1px solid var(--rule);border-radius:8px;overflow:hidden;display:grid;min-width:0}
.card img{display:block;width:100%;height:auto}
.meta{padding:12px 14px 14px;display:grid;gap:6px}
.dir{margin:0;font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:16px;color:var(--accent)}
.dir span{font-family:"IBM Plex Mono",monospace;font-weight:400;font-size:11px;color:var(--muted);margin-left:6px}
.idea{margin:0;font-size:14px;line-height:1.45}
details summary{cursor:pointer;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted)}
details ul{margin:6px 0 0;padding-left:18px;font-size:13px;line-height:1.4;color:var(--muted)}
</style>
<div class="wrap"><div><h1>LFD AI Covers</h1>
<p class="lede">The two kept directions, Unaware and Standoff, on the revised cover: the photo fades smoothly into the ground, a new Helios mark, and a hook sized to fill the lower half. Each cover comes from a real three-day window of the new ranker’s picks, with the image generated from those stories’ own photos. Hooks and colours rotate in their production order.</p></div>
<div class="grid">${cards.join('')}</div></div>`;
  fs.writeFileSync(out, html);
  console.log(`page ${(html.length / 1024 / 1024).toFixed(1)} MB, ${cards.length} covers`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
