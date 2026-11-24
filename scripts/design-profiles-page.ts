/**
 * Design profiles lab (2026-11-23): renders Morning Download frames and Last Few Days slides on all four
 * backdrops, plus three orange directions, with the real renderers (local Chromium, no AI, no spend).
 * Usage: npx tsx scripts/design-profiles-page.ts <out.html>
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

// Orange directions B and C (A is in the CSS files). Injected by appending CSS when a renderer reads its stylesheet.
const ORANGE: Record<string, { name: string; ground: string }> = {
  a: { name: 'A · Sunrise', ground: '' },
};
let extraCss = '';
let useHeadCss = false;
const realRead = fs.promises.readFile.bind(fs.promises);
(fs.promises as { readFile: unknown }).readFile = async (p: fs.PathLike, ...rest: unknown[]) => {
  const file = String(p);
  if (file.endsWith('lib/stories/render/stories.css') || file.endsWith('app/social/render/preview/preview.css')) {
    const rel = path.relative(process.cwd(), file);
    const base = useHeadCss ? execSync(`git show HEAD:${rel}`, { encoding: 'utf8', maxBuffer: 1 << 24 }) : String(await realRead(file, 'utf8'));
    return base + '\n' + extraCss;
  }
  return realRead(p as string, ...(rest as []));
};

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error('usage: design-profiles-page.ts <out.html>');
  const { openRenderer } = await import('@/lib/stories/render/render');
  const { MORNING_DOWNLOAD, MORNING_DOWNLOAD_TYPE, asSet } = await import('@/lib/stories/render/fixtures/m1');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { buildPost } = await import('@/lib/lfd/post');

  const thumb = async (b: Buffer | string) => `data:image/jpeg;base64,${(await sharp(b).resize({ width: 540 }).jpeg({ quality: 82, mozjpeg: true }).toBuffer()).toString('base64')}`;

  // Morning Download: opener, a photo story, a type-only story.
  const mdData = [MORNING_DOWNLOAD[0]!, MORNING_DOWNLOAD[2]!, MORNING_DOWNLOAD_TYPE.find((d) => d.role === 'story')!];
  const renderer = await openRenderer();
  async function md(backdrop: 'black' | 'white' | 'orange' | 'green'): Promise<string[]> {
    const frames = asSet('morning_download', backdrop, mdData);
    const res = await renderer.render(frames);
    return Promise.all(res.frames.map((f) => thumb(f.jpeg)));
  }

  // Last Few Days: cover + one story slide, from the MD fixture photos.
  const credits = JSON.parse(fs.readFileSync('lib/stories/render/fixtures/photos/credits.json', 'utf8')) as Record<string, { file: string }>;
  const dataUri = (key: string) => `data:image/jpeg;base64,${fs.readFileSync(path.join('lib/stories/render/fixtures/photos', credits[key]!.file)).toString('base64')}`;
  const stories = [
    { key: 'amodei', setup: '', headline: 'Claude now does 26% of Anthropic’s own R&D.', highlight: '26%', names: ['Anthropic'], body: 'The company says its AI is helping build the next version of itself, from running experiments to writing the code that trains it' },
    { key: 'newsom', setup: '', headline: 'California wants a kill switch on frontier AI.', highlight: 'kill switch', names: ['California'], body: 'Gov. Gavin Newsom signed an executive order on Sept. 18, and a state working group has two months to turn it into rules' },
    { key: 'datacenter', setup: '', headline: 'Crusoe tripled its value to $30.9B in 10 months.', highlight: '$30.9B', names: ['Crusoe'], body: 'The AI data center builder raised $3.9 billion this week; OpenAI rents one of its biggest sites, in Abilene, Texas' },
    { key: 'capitol', setup: '', headline: 'Congress is still split on AI rules.', highlight: '', names: [], body: 'Lawmakers left town without a deal' },
  ].filter((s) => credits[s.key]);
  const ready = stories.map((s, i) => ({
    pick: { key: s.key, refs: [], origin: 'reels', headline: s.headline, sourceName: 'Outlet', url: 'https://example.com', body: '', publishedAt: '2026-11-20T00:00:00Z', net: 1, blockbuster: 0, firstSeen: null, alsoFrom: [], major: null, builder: null, eventDate: null, lane: i === 0 ? 'major' : 'rundown' },
    copy: { key: s.key, setup: s.setup, headline: s.headline, highlight: s.highlight, names: s.names, body: s.body, photo: { kind: 'scene', query: '', subjects: [], alts: [] } },
    photo: { src: dataUri(s.key), credit: 'Wikimedia Commons', kind: 'scene', focus: { x: 0.5, y: s.key === 'amodei' || s.key === 'newsom' ? 0.15 : 0.5 } },
  }));
  const basePost = buildPost(ready as never, new Date('2026-11-23T12:00:00Z'));
  async function lfd(canvas: 'black' | 'white' | 'orange' | 'green'): Promise<string[]> {
    const post = { ...basePost, slides: basePost.slides.slice(0, 2).map((s) => ({ ...s, canvas })) };
    const dir = fs.mkdtempSync(path.join(process.cwd(), 'tmp', 'dp-'));
    const fit = await checkRenderFit(post as never, { screenshotDir: dir, name: 'slide' });
    if (fit.problems?.length) console.warn(canvas, fit.problems.slice(0, 3));
    const pngs = fs.readdirSync(dir).filter((f) => /^slide-slide-\d+\.png$/.test(f)).sort();
    const shots = await Promise.all(pngs.map((f) => thumb(path.join(dir, f))));
    fs.rmSync(dir, { recursive: true, force: true });
    return shots;
  }
  fs.mkdirSync(path.join(process.cwd(), 'tmp'), { recursive: true });

  const before: Record<string, string[]> = {};
  useHeadCss = true;
  for (const b of ['black', 'white', 'orange'] as const) before[b] = await md(b);
  useHeadCss = false;

  const now: Record<string, { md: string[]; lfd: string[] }> = {};
  for (const b of ['black', 'green', 'white'] as const) now[b] = { md: await md(b), lfd: await lfd(b) };
  const orange: Record<string, { md: string[]; lfd: string[] }> = {};
  for (const [k, o] of Object.entries(ORANGE)) {
    extraCss = o.ground ? `.st-bd-orange .st-bg { --md-orange-ground: ${o.ground}; } .helios-slide[data-canvas="orange"] { --lfd-orange-ground: ${o.ground}; }` : '';
    orange[k] = { md: await md('orange'), lfd: await lfd('orange') };
  }
  extraCss = '';
  await renderer.close();

  const imgs = (xs: string[], cls: string) => xs.map((x) => `<img class="${cls}" src="${x}" alt="">`).join('');
  const row = (title: string, note: string, r: { md: string[]; lfd: string[] }, was?: string[]) => `
<section><h2>${title}</h2><p class="note">${note}</p>
<div class="pair"><div><div class="lab">Morning Download</div><div class="strip md">${imgs(r.md, 'st')}</div>
${was ? `<details><summary>Morning Download before</summary><div class="strip md">${imgs(was, 'st')}</div></details>` : ''}</div>
<div><div class="lab">Last Few Days</div><div class="strip lfd">${imgs(r.lfd, 'sl')}</div></div></div></section>`;

  const html = `<title>Design Profiles</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;800&family=Source+Serif+4:opsz,wght@8..60,400&family=IBM+Plex+Mono&display=swap">
<style>
:root{--bg:#f4f3ef;--paper:#fff;--ink:#17191c;--muted:#5d6168;--rule:#dcd9d1;--accent:#FF5E1A}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){--bg:#111214;--paper:#1a1c1f;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;color-scheme:dark}}
:root[data-theme="dark"]{--bg:#111214;--paper:#1a1c1f;--ink:#ecebe7;--muted:#a3a6ab;--rule:#2e3135;color-scheme:dark}
body{margin:0;background:var(--bg);color:var(--ink);font-family:"Source Serif 4",Georgia,serif;padding:28px 16px 56px}
.wrap{max-width:1200px;margin:0 auto;display:grid;gap:36px}
h1{font-family:Archivo,system-ui,sans-serif;font-weight:800;font-size:clamp(28px,5vw,42px);margin:0;letter-spacing:-.02em}
h2{font-family:Archivo,system-ui,sans-serif;font-size:22px;margin:0}
.lede,.note{color:var(--muted);max-width:75ch;line-height:1.5;margin:6px 0 0}
section{background:var(--paper);border:1px solid var(--rule);border-radius:8px;padding:18px;display:grid;gap:12px;min-width:0}
.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:20px;align-items:start}
.lab{font-family:"IBM Plex Mono",monospace;font-size:12px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);margin-bottom:8px}
.strip{display:flex;gap:8px;overflow-x:auto}
.strip img{display:block;border-radius:6px;border:1px solid var(--rule);flex:none}
.strip.md img{width:150px}.strip.lfd img{width:230px}
details summary{cursor:pointer;font-family:"IBM Plex Mono",monospace;font-size:12px;color:var(--muted);margin:10px 0 8px}
.dirs{display:grid;gap:14px}
.dir h3{font-family:Archivo,system-ui,sans-serif;font-size:16px;margin:0 0 4px;color:var(--accent)}
</style>
<div class="wrap"><div><h1>Design Profiles</h1>
<p class="lede">Morning Download and Last Few Days on the same four profiles, rendered by the real renderers with sample copy. Last Few Days shows its cover and one story slide. Last Few Days rotates through them post by post: black, green, orange, white. The Helios pill is gone from its story slides.</p></div>
${row('Black', 'Morning Download now uses Last Few Days’ light: charcoal with a faint warm glow top right, and the same soft photo shadow in place of the orange halo.', now.black!, before.black)}
${row('Green', 'Last Few Days takes Morning Download’s flooded green: white type, white highlight underline, white names, the last hook line in orange.', now.green!)}
${row('White', 'Both get the Explainers’ drafting grid, made easier to see: 72 px squares in ink at 10% (Explainers use 4.5%). Orange highlight, green names.', now.white!, before.white)}
<section><h2>Orange</h2><p class="note">Direction A, Sunrise: lighter at the top, warming to red at the bottom, even where the text sits. Off-black type, white accents. The old Morning Download orange is under “before”.</p>
<div class="dirs">${Object.entries(ORANGE).map(([k, o]) => `<div class="dir"><h3>${o.name}</h3><div class="pair"><div><div class="lab">Morning Download</div><div class="strip md">${imgs(orange[k]!.md, 'st')}</div></div><div><div class="lab">Last Few Days</div><div class="strip lfd">${imgs(orange[k]!.lfd, 'sl')}</div></div></div></div>`).join('')}
<details><summary>Morning Download orange before</summary><div class="strip md">${imgs(before.orange!, 'st')}</div></details></div></section>
</div>`;
  fs.writeFileSync(out, html);
  console.log(`page ${(html.length / 1024 / 1024).toFixed(1)} MB`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
