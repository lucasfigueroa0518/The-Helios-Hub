/**
 * Photo vision lab, step 1 (planning/MD-LFD Revisions, 2026-11-23): collect the test photos. Free (no model calls).
 * - Candidates: each posted story's article images (og:image + figures), from the News Ranker lab's rerank outputs.
 * - Controls: logos and AI-generated pictures from Wikimedia Commons, where the right answer is known.
 * Every image is converted to JPEG, at most 1024 px on the long side, so both graders see the same bytes.
 *
 *   npx tsx scripts/photo-vision-collect.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import sharp from 'sharp';

import { readPage } from '@/lib/social/reporter/read-page';

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab/photo-test');
const TOURNEY = path.join(process.cwd(), '.memes-local/news-ranker-lab/tourney');
const POOL = process.env.POOL_JSON!;
const PER_STORY = 4;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';

type Item = { file: string; group: 'candidate' | 'logo' | 'ai'; storyId?: string; headline?: string; text?: string; src: string; from?: string };

async function toJpeg(url: string, file: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (!res.ok) return false;
    const buf = Buffer.from(await res.arrayBuffer());
    const img = sharp(buf, { density: 150 }).flatten({ background: '#ffffff' });
    const meta = await img.metadata();
    if ((meta.width ?? 0) < 300 || (meta.height ?? 0) < 200) return false;
    await img.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toFile(file);
    return true;
  } catch { return false; }
}

async function commonsFiles(params: Record<string, string>): Promise<string[]> {
  const u = new URL('https://commons.wikimedia.org/w/api.php');
  for (const [k, v] of Object.entries({ action: 'query', format: 'json', prop: 'imageinfo', iiprop: 'url', iiurlwidth: '800', ...params })) u.searchParams.set(k, v);
  const j = await (await fetch(u, { headers: { 'user-agent': 'helios-photo-lab/1.0' } })).json() as { query?: { pages?: Record<string, { imageinfo?: { thumburl?: string }[] }> } };
  return Object.values(j.query?.pages ?? {}).map((p) => p.imageinfo?.[0]?.thumburl).filter((x): x is string => Boolean(x));
}

async function main() {
  fs.mkdirSync(LAB, { recursive: true });
  const pool = new Map<string, { url: string; body: string; h: string }>();
  for (const s of JSON.parse(fs.readFileSync(POOL, 'utf8'))) pool.set(String(s.id).slice(0, 8), { url: s.url, body: s.body ?? '', h: s.h });
  const days = { ...JSON.parse(fs.readFileSync(path.join(TOURNEY, 'build-b/rerank-opus-post.json'), 'utf8')).days, ...JSON.parse(fs.readFileSync(path.join(TOURNEY, 'build-b/rerank-opus-days3.json'), 'utf8')).days };
  const posted: { id: string; headline: string }[] = [];
  for (const arr of Object.values(days) as { id: string; headline: string; posted: boolean }[][]) posted.push(...arr.filter((s) => s.posted));
  const items: Item[] = [];
  for (const s of posted) {
    const p = pool.get(s.id);
    if (!p?.url || p.url.startsWith('search:')) continue;
    const page = await readPage(p.url).catch(() => null);
    if (!page || !page.ok) { console.log(`skip ${s.id}: page`); continue; }
    const seen = new Set<string>();
    let n = 0;
    for (const ph of page.photos) {
      if (n >= PER_STORY || !ph.src || seen.has(ph.src) || /\.(svg|gif)(?:$|[?#])/i.test(ph.src)) continue;
      seen.add(ph.src);
      const file = `c-${s.id}-${n}.jpg`;
      if (await toJpeg(ph.src, path.join(LAB, file))) { items.push({ file, group: 'candidate', storyId: s.id, headline: s.headline, text: p.body.slice(0, 1200), src: ph.src, from: ph.from }); n++; }
    }
    console.log(`${s.id}: ${n} photos  ${s.headline.slice(0, 60)}`);
  }
  const logos = await commonsFiles({ titles: ['Nvidia logo.svg', 'Google 2015 logo.svg', 'Microsoft logo (2012).svg', 'Amazon logo.svg', 'Meta Platforms Inc. logo.svg', 'OpenAI Logo.svg', 'Adobe Corporate logo.svg', 'Uber logo 2018.svg', 'Netflix 2015 logo.svg', 'Intel logo (2020, dark blue).svg'].map((t) => `File:${t}`).join('|') });
  const ai = await commonsFiles({ generator: 'categorymembers', gcmtitle: 'Category:AI-generated images', gcmtype: 'file', gcmlimit: '30' });
  let li = 0, ai2 = 0;
  for (const u of logos) if (await toJpeg(u, path.join(LAB, `logo-${li}.jpg`))) items.push({ file: `logo-${li++}.jpg`, group: 'logo', src: u });
  for (const u of ai) { if (ai2 >= 10) break; if (/\.(jpe?g|png)/i.test(u) && await toJpeg(u, path.join(LAB, `ai-${ai2}.jpg`))) items.push({ file: `ai-${ai2++}.jpg`, group: 'ai', src: u }); }
  fs.writeFileSync(path.join(LAB, 'items.json'), JSON.stringify(items, null, 1));
  console.log(`candidates ${items.filter((i) => i.group === 'candidate').length}, logos ${li}, ai ${ai2}`);
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
