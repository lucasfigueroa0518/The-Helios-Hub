/**
 * Harvest the golden set (planning/Memes/GOLDEN_SET.md G1): real captioned
 * memes for every catalog template from Imgflip's public pages, plus memes
 * from tech tag pages, plus each format's Know Your Meme write-up. Pages are
 * cached raw under .memes-local/golden/raw/ so a re-run re-parses without
 * re-fetching. One request a second. No model calls.
 *
 *   npx tsx scripts/memes_golden_harvest.ts [--only drake,two-buttons] [--skip-tech] [--skip-kym] [--tech-only]
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import {
  GOLDEN_DIR, parseListing, templateFromTags, unescapeHtml,
  type GoldenListing, type GoldenPost, type GoldenTechPost, type GoldenTemplateFile,
} from '@/lib/memes/golden';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.includes(n);
const only = (() => {
  const i = argv.indexOf('--only');
  return i >= 0 ? new Set(argv[i + 1]!.split(',')) : null;
})();

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const RAW = path.join(GOLDEN_DIR, 'raw');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(path.join(GOLDEN_DIR, 'imgflip'), { recursive: true });
fs.mkdirSync(path.join(GOLDEN_DIR, 'kym'), { recursive: true });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fetched = 0;

/**
 * Imgflip throttles its sorted Top listings and tag pages (HTTP 429) far
 * sooner than its default "hot" and Latest listings. A throttled kind of page
 * is skipped for ten minutes instead of waited on; a later run picks it up
 * from where the cache stops.
 */
const blockedUntil = new Map<string, number>();
const kindOf = (url: string) => (/[?&]sort=top|\/tag\//.test(url) ? 'throttled' : 'open');

/** GET a page, from the raw cache when we have it. Returns the final URL too (Imgflip redirects ids to slugs). */
async function get(url: string): Promise<{ html: string; url: string } | null> {
  const key = crypto.createHash('sha1').update(url).digest('hex').slice(0, 16);
  const f = path.join(RAW, `${key}.json`);
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')) as { html: string; url: string };
  const kind = kindOf(url);
  if ((blockedUntil.get(kind) ?? 0) > Date.now()) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(attempt ? 20_000 * attempt : 1500);
    try {
      const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(20000) });
      fetched += 1;
      if (res.status === 404) return null;
      if (res.status === 429 && kind === 'throttled') {
        blockedUntil.set(kind, Date.now() + 10 * 60_000);
        console.log(`  429 on ${url}; skipping Top and tag pages for 10 minutes`);
        return null;
      }
      if (!res.ok) {
        console.log(`  ${res.status} on ${url}; backing off`);
        continue;
      }
      const out = { html: await res.text(), url: res.url };
      fs.writeFileSync(f, JSON.stringify(out));
      return out;
    } catch {
      /* retry */
    }
  }
  return null;
}

/** Template page listings: the winners (hot and Top, by upvotes) and the contrast set (Latest). */
const TEMPLATE_LISTINGS: GoldenListing[] = [
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((page) => ({ sort: 'hot', page })),
  ...[1, 2, 3].map((page) => ({ sort: 'top-century-21', page })),
  ...[1].map((page) => ({ sort: 'top-2025', page })),
  ...[1].map((page) => ({ sort: 'top-2026', page })),
  ...[1, 2, 3].map((page) => ({ sort: 'latest', page })),
];

const TECH_TAGS = [
  'chatgpt', 'artificial intelligence', 'ai', 'openai', 'ai art', 'robots', 'gemini', 'claude', 'copilot',
  'programming', 'programmer', 'programmers', 'coding', 'computer science', 'software', 'developer', 'javascript', 'python',
  'technology', 'tech', 'computers', 'computer', 'internet', 'google', 'apple', 'iphone', 'microsoft', 'windows', 'linux',
  'elon musk', 'tesla', 'twitter', 'facebook', 'meta', 'mark zuckerberg', 'nvidia', 'amazon', 'crypto', 'bitcoin', 'startup',
];
const TAG_LISTINGS: GoldenListing[] = [
  ...[1, 2, 3].map((page) => ({ sort: 'hot', page })),
  ...[1, 2, 3].map((page) => ({ sort: 'top-century-21', page })),
];

const listingUrl = (base: string, l: GoldenListing) => {
  const q = [l.sort === 'hot' ? '' : `sort=${l.sort}`, l.page > 1 ? `page=${l.page}` : ''].filter(Boolean).join('&');
  return q ? `${base}?${q}` : base;
};

async function harvestTemplate(t: (typeof TEMPLATE_CATALOG)[number]): Promise<GoldenTemplateFile | null> {
  const first = await get(`https://imgflip.com/meme/${t.imgflipId}`);
  if (!first) return null;
  const base = first.url.replace(/\?.*$/, '');
  // The id URL redirects to the template's hot listing, page 1: cache it under that URL too.
  const hot1 = crypto.createHash('sha1').update(base).digest('hex').slice(0, 16);
  if (!fs.existsSync(path.join(RAW, `${hot1}.json`))) fs.writeFileSync(path.join(RAW, `${hot1}.json`), JSON.stringify(first));
  const slug = base.split('/meme/')[1] ?? '';
  const byId = new Map<string, GoldenPost & { seen: GoldenListing[] }>();
  const exhausted = new Set<string>();
  for (const l of TEMPLATE_LISTINGS) {
    if (exhausted.has(l.sort)) continue;
    const page = await get(listingUrl(base, l));
    if (!page) continue;
    const posts = parseListing(page.html);
    for (const p of posts) {
      const had = byId.get(p.id);
      if (had) had.seen.push(l);
      else byId.set(p.id, { ...p, seen: [l] });
    }
    // A short page means the listing ran out; later pages of the same sort are empty.
    if (posts.length < 10) exhausted.add(l.sort);
  }
  return { templateId: t.id, imgflipSlug: slug, fetchedAt: new Date().toISOString(), posts: [...byId.values()] };
}

/** Imgflip streams about tech (open to scripted reads, unlike tag pages), with how many pages to read. */
const TECH_STREAMS: Array<[string, number]> = [['programming', 80], ['ChatGPT', 20], ['Technology', 40], ['linux', 10], ['computers', 4], ['science', 10]];

async function harvestTech(): Promise<GoldenTechPost[]> {
  const names = TEMPLATE_CATALOG.map((t) => ({ id: t.id, name: t.name }));
  const byId = new Map<string, GoldenTechPost>();
  for (const [stream, pages] of TECH_STREAMS) {
    for (let page = 1; page <= pages; page++) {
      const got = await get(`https://imgflip.com/m/${stream}${page > 1 ? `?page=${page}` : ''}`);
      if (!got) continue;
      const posts = parseListing(got.html);
      const l = { sort: 'stream', page, tag: `stream:${stream}` };
      for (const p of posts) {
        const had = byId.get(p.id);
        if (had) had.seen.push(l);
        else byId.set(p.id, { ...p, seen: [l], templateId: templateFromTags(p.tags, names) });
      }
      if (!posts.length) break;
    }
    console.log(`  stream ${stream}: ${byId.size} posts so far`);
  }
  for (const tag of TECH_TAGS) {
    const base = `https://imgflip.com/tag/${encodeURIComponent(tag).replace(/%20/g, '+')}`;
    for (const l of TAG_LISTINGS) {
      const page = await get(listingUrl(base, l));
      if (!page) continue;
      const posts = parseListing(page.html);
      for (const p of posts) {
        const had = byId.get(p.id);
        if (had) had.seen.push({ ...l, tag });
        else byId.set(p.id, { ...p, seen: [{ ...l, tag }], templateId: templateFromTags(p.tags, names) });
      }
    }
    console.log(`  tag ${tag}: ${byId.size} posts so far`);
  }
  return [...byId.values()];
}

const kymSlug = (family: string) =>
  family.toLowerCase().replace(/['’?,.!]/g, '').replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** The About / Origin / Spread sections of a Know Your Meme entry, as plain text. */
function kymText(html: string): string {
  const start = html.indexOf('<h2 id="about">');
  if (start < 0) return '';
  const ends = ['<h2 id="search-interests">', '<h2 id="external-references">', '<h2> Sub-entries', '<h2> Recent Videos']
    .map((m) => html.indexOf(m, start)).filter((i) => i > 0);
  const body = html.slice(start, ends.length ? Math.min(...ends) : start + 40000);
  return unescapeHtml(
    body
      .replace(/<script[\s\S]*?<\/script>/g, '')
      .replace(/<style[\s\S]*?<\/style>/g, '')
      .replace(/<h2[^>]*>/g, '\n\n## ')
      .replace(/<\/(p|h2|li)>/g, '\n')
      .replace(/<[^>]+>/g, ''),
  ).replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim().slice(0, 8000);
}

async function main() {
  const templates = flag('--tech-only') ? [] : TEMPLATE_CATALOG.filter((t) => !only || only.has(t.id));
  const summary: string[] = [];
  for (const t of templates) {
    const file = await harvestTemplate(t);
    if (!file) {
      summary.push(`${t.id}: NOT FOUND`);
      console.log(`${t.id}: not found`);
      continue;
    }
    fs.writeFileSync(path.join(GOLDEN_DIR, 'imgflip', `${t.id}.json`), JSON.stringify(file, null, 1));
    const withText = file.posts.filter((p) => p.boxes.length).length;
    summary.push(`${t.id}: ${file.posts.length} posts, ${withText} with box text`);
    console.log(`${t.id} (${file.imgflipSlug}): ${file.posts.length} posts, ${withText} with box text  [fetched ${fetched}]`);

    if (!flag('--skip-kym')) {
      const kymFile = path.join(GOLDEN_DIR, 'kym', `${t.id}.md`);
      if (!fs.existsSync(kymFile)) {
        let page = await get(`https://knowyourmeme.com/memes/${kymSlug(t.family)}`);
        if (!page || !kymText(page.html)) {
          // Fall back to Know Your Meme's own search: its first entry result.
          const search = await get(`https://knowyourmeme.com/search?q=${encodeURIComponent(t.family)}`);
          const NAV = /^(submissions|confirmed|popular|researching|deadpool|trending|newsworthy|all|random|cultures|events|people|sites|subcultures|page)$/;
          const slug = [...(search?.html ?? '').matchAll(/href="\/memes\/([a-z0-9-]+)"/g)].map((m) => m[1]!).find((x) => !NAV.test(x));
          if (slug) page = await get(`https://knowyourmeme.com/memes/${slug}`);
        }
        if (page && kymText(page.html)) fs.writeFileSync(kymFile, `# ${t.family}\n\nSource: ${page.url}\n\n${kymText(page.html)}\n`);
        else console.log(`  KYM ${t.family}: not found at ${kymSlug(t.family)}`);
      }
    }
  }
  if (!flag('--skip-tech') && !only) {
    const tech = await harvestTech();
    fs.writeFileSync(path.join(GOLDEN_DIR, 'tech.json'), JSON.stringify(tech, null, 1));
    const matched = tech.filter((p) => p.templateId).length;
    summary.push(`tech: ${tech.length} posts, ${tech.filter((p) => p.boxes.length).length} with box text, ${matched} on one of our templates`);
  }
  if (flag('--tech-only')) {
    console.log(summary.join('\n'));
    return;
  }
  fs.writeFileSync(path.join(GOLDEN_DIR, 'harvest-summary.txt'), `${new Date().toISOString()}\n${summary.join('\n')}\n`);
  console.log(`\nDone. ${fetched} pages fetched.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
