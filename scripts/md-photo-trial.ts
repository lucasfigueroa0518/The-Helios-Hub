/**
 * Morning Download end-to-end trial (planning/MD-LFD Revisions D16–D19, 2026-11-23). Lab only: Lucas's go-ahead.
 * Per day: the Opus rerank output → cleanup (duplicates, crowding groups) → top 7 → Haiku photo brief →
 * candidates (article images, merged duplicates' article images, one Serper image search) → Jev grades →
 * best good photo → Haiku lenient AI check on the pick → choosePosts with the photo verdicts.
 *
 *   npx tsx scripts/md-photo-trial.ts <rerank.json>... --yes
 */
import fs from 'node:fs';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';
import { choice, image, noul, TypeSafeClient, type Questions } from '@typesafe-ai/sdk';
import sharp from 'sharp';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { jevCostUsd } from '@/lib/social/jev/client';
import { readPage } from '@/lib/social/reporter/read-page';

import { choosePosts, PHOTO_CHECK_DEPTH, type PhotoVerdict } from './news-ranker-rerank';
import { BRIEF_SYSTEM, PHOTO_QUESTIONS, REAL_CHECK_SYSTEM, tier } from './photo-vision-test';

const OUT = path.join(process.cwd(), process.env.MD_TRIAL_OUT ?? '.memes-local/news-ranker-lab/md-trial');
const LEDGER = path.join(process.cwd(), '.memes-local/news-ranker-lab/tourney/ledger.json');
const CAP_USD = 6.5; // Lucas: held-out Morning Download run on two new days (~$0.35), 2026-11-23
const HAIKU = 'claude-haiku-5-5';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36';
const SOURCE_RANK = { article: 0, other_outlet: 1, search: 2 } as const;

type Ranked = { id: string; headline: string; cool: number; value: number; duplicate_of: string | null; top_tier: boolean | null; crowds: string | null };
type Brief = { kind: string; subject: string; good_if: string };
type Cand = { file: string; src: string; source: keyof typeof SOURCE_RANK; a?: Record<string, number>; tier?: 'good' | 'usable' | 'none' };

const BRIEF_TOOL: Anthropic.Tool = {
  name: 'photo_brief', description: 'The photo brief for this story.',
  input_schema: { type: 'object', properties: { kind: { type: 'string', enum: ['object', 'screen_output', 'person', 'powerful_figure', 'discovery', 'civic', 'incident'] }, subject: { type: 'string' }, good_if: { type: 'string' } }, required: ['kind', 'subject', 'good_if'] },
};
const REAL_TOOL: Anthropic.Tool = { name: 'real_check', description: 'Whether the picture is blatantly AI-made.', input_schema: { type: 'object', properties: { blatantly_ai: { type: 'boolean' } }, required: ['blatantly_ai'] } };

let haikuMsgs: Anthropic.Message[] = [];
let jevUsd = 0, serperUsd = 0;
const anthropic = new Anthropic();
const jev = new TypeSafeClient({ defaultHeaders: { 'TypeSafe-Danger-Zone-Images': 'true' } });

async function toJpeg(url: string, file: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return false;
    const img = sharp(Buffer.from(await res.arrayBuffer())).flatten({ background: '#ffffff' });
    const m = await img.metadata();
    if ((m.width ?? 0) < 400 || (m.height ?? 0) < 250) return false;
    let pipe = img.resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true });
    const w = Math.min(m.width!, 1024), h = Math.round((m.height! * w) / m.width!);
    if (w / h > 3.5) pipe = pipe.extend({ top: Math.ceil((w / 3.5 - h) / 2), bottom: Math.ceil((w / 3.5 - h) / 2), background: '#ffffff' });
    await pipe.jpeg({ quality: 85 }).toFile(file);
    return true;
  } catch { return false; }
}

async function brief(headline: string, text: string): Promise<Brief | null> {
  const m = await anthropic.messages.create({ model: HAIKU, max_tokens: 1500, system: cachedSystemText(BRIEF_SYSTEM), tools: [withToolCache(BRIEF_TOOL)], messages: [{ role: 'user', content: `<headline>${headline}</headline>\n<text>${text.slice(0, 1200)}</text>` }] });
  haikuMsgs.push(m);
  const u = m.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  return (u?.input as Brief) ?? null;
}

async function serper(q: string): Promise<string[]> {
  serperUsd += 0.001;
  const res = await fetch('https://google.serper.dev/images', { method: 'POST', headers: { 'X-API-KEY': process.env.SERPER_API_KEY!, 'content-type': 'application/json' }, body: JSON.stringify({ q, num: 10 }) });
  if (!res.ok) return [];
  const j = (await res.json()) as { images?: { imageUrl?: string }[] };
  return (j.images ?? []).map((x) => x.imageUrl).filter((x): x is string => Boolean(x)).slice(0, 5);
}

async function grade(c: Cand, headline: string, b: Brief) {
  const scale: Record<string, string> = {};
  for (let k = 1; k <= 10; k++) scale[String(k)] = k === 1 ? 'Unreadable at phone size' : k === 10 ? 'Instantly clear' : `Clarity ${k} of ten`;
  const qs = {
    logo: noul(PHOTO_QUESTIONS.logo, { true: 'A logo or brand mark is the main content', false: 'A scene, person, object or screen' }),
    thumbnail: noul(PHOTO_QUESTIONS.thumbnail, { true: 'A click-bait thumbnail graphic', false: 'A photo, screenshot or plain image' }),
    overlay: noul(PHOTO_QUESTIONS.overlay, { true: 'Carries a watermark, channel logo or another outlet’s text', false: 'Clean' }),
    specific: noul(PHOTO_QUESTIONS.specific, { true: "Shows the brief's subject itself", false: "Does not show the brief's subject" }),
    related: noul(PHOTO_QUESTIONS.related, { true: 'Related to the story', false: 'Unrelated to the story' }),
    clarity: choice(PHOTO_QUESTIONS.clarity, scale),
  } as unknown as Questions;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await jev.systemOne({ state: { context: `Story headline: ${headline}\nPhoto brief: ${b.subject} (${b.good_if})`, picture: image(fs.readFileSync(c.file)) }, questions: qs });
      jevUsd += jevCostUsd({ input_tokens: res.usage.input_tokens ?? 0, output_tokens: res.usage.output_tokens ?? 0 });
      const r = res.answers as Record<string, { noul?: number; probabilities?: Record<string, number> }>;
      let tot = 0, ev = 0;
      for (const [k, p] of Object.entries(r.clarity!.probabilities ?? {})) { tot += p; ev += Number(k) * p; }
      const a = { logo: r.logo!.noul!, overlay: r.overlay!.noul!, thumbnail: r.thumbnail!.noul!, specific: r.specific!.noul!, related: r.related!.noul!, clarity: tot ? ev / tot : 0 };
      c.a = a;
      c.tier = tier({ ...a, ai_made: 0 }); // Jev isn't asked ai_made (D19); Haiku's lenient check covers it
      return;
    } catch { /* retry */ }
  }
  c.tier = 'none';
}

async function blatantlyAi(file: string): Promise<boolean> {
  const m = await anthropic.messages.create({ model: HAIKU, max_tokens: 1000, system: cachedSystemText(REAL_CHECK_SYSTEM), tools: [withToolCache(REAL_TOOL)], messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: fs.readFileSync(file).toString('base64') } }] }] });
  haikuMsgs.push(m);
  const u = m.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
  return Boolean((u?.input as { blatantly_ai?: boolean })?.blatantly_ai);
}

/** Same cleanup as choosePosts: drop duplicates, keep the top story of each crowding group. */
function cleanup(ranked: Ranked[]): Ranked[] {
  const list = ranked.filter((s) => !s.duplicate_of);
  const parent = new Map<string, string>();
  const root = (x: string): string => { const p = parent.get(x); if (!p || p === x) return x; const r = root(p); parent.set(x, r); return r; };
  for (const s of list) if (s.crowds && list.some((t) => t.id === s.crowds)) parent.set(root(s.id), root(s.crowds));
  const seen = new Set<string>();
  return list.filter((s) => { const r = root(s.id); if (seen.has(r)) return false; seen.add(r); return true; });
}

async function main() {
  if (!process.argv.includes('--yes')) return console.log('dry run: add --yes');
  const pool = new Map<string, { url: string; body: string }>();
  for (const s of JSON.parse(fs.readFileSync(process.env.POOL_JSON!, 'utf8'))) pool.set(String(s.id).slice(0, 8), { url: String(s.url ?? ''), body: s.body ?? '' });
  const days: Record<string, Ranked[]> = {};
  for (const f of process.argv.slice(2).filter((a) => a.endsWith('.json'))) Object.assign(days, JSON.parse(fs.readFileSync(f, 'utf8')).days);
  const want = (process.env.DAYS ?? '').split(',').filter(Boolean);
  const result: Record<string, unknown> = {};
  for (const day of Object.keys(days).filter((d) => !want.length || want.includes(d)).sort()) {
    const ranked = days[day]!;
    const top = cleanup(ranked).slice(0, PHOTO_CHECK_DEPTH);
    const dir = path.join(OUT, day);
    fs.mkdirSync(dir, { recursive: true });
    const per: Record<string, { brief: Brief | null; cands: Cand[]; pick: Cand | null; verdict: PhotoVerdict; aiRejected: string[] }> = {};
    await Promise.all(top.map(async (s) => {
      const p = pool.get(s.id);
      const b = await brief(s.headline, p?.body ?? s.headline).catch(() => null);
      const cands: Cand[] = [];
      const seen = new Set<string>();
      const add = async (src: string, source: Cand['source']) => {
        if (seen.has(src) || /\.(svg|gif)(?:$|[?#])/i.test(src)) return;
        seen.add(src);
        const file = path.join(dir, `${s.id}-${cands.length}.jpg`);
        if (await toJpeg(src, file)) cands.push({ file, src, source });
      };
      const pagePhotos = async (url: string, n: number, source: Cand['source']) => {
        if (!url || url.startsWith('search:')) return;
        const page = await readPage(url).catch(() => null);
        if (page?.ok) for (const ph of page.photos.slice(0, n)) if (ph.src) await add(ph.src, source);
      };
      await pagePhotos(p?.url ?? '', 4, 'article');
      for (const d of ranked.filter((r) => r.duplicate_of === s.id).slice(0, 2)) await pagePhotos(pool.get(d.id)?.url ?? '', 2, 'other_outlet');
      if (b) for (const u of await serper(b.subject).catch(() => [])) await add(u, 'search');
      if (b) await Promise.all(cands.map((c) => grade(c, s.headline, b)));
      const order = (t: string) => cands.filter((c) => c.tier === t).sort((x, y) => Math.round(y.a!.clarity) - Math.round(x.a!.clarity) || SOURCE_RANK[x.source] - SOURCE_RANK[y.source]);
      const aiRejected: string[] = [];
      let pick: Cand | null = null, verdict: PhotoVerdict = 'none';
      for (const t of ['good', 'usable'] as const) {
        for (const c of order(t)) { if (await blatantlyAi(c.file)) { aiRejected.push(path.basename(c.file)); continue; } pick = c; verdict = t; break; }
        if (pick) break;
      }
      per[s.id] = { brief: b, cands, pick, verdict, aiRejected };
      console.log(`${day} ${s.id}: ${cands.length} candidates, ${verdict}${aiRejected.length ? `, ${aiRejected.length} AI-rejected` : ''}  ${s.headline.slice(0, 50)}`);
    }));
    const posts = choosePosts(ranked, (s) => per[s.id]?.verdict ?? 'none');
    result[day] = {
      posts: posts.map((id) => { const s = ranked.find((r) => r.id === id)!; const x = per[id]!; return { id, headline: s.headline, cool: s.cool, value: s.value, top_tier: s.top_tier, verdict: x.verdict, brief: x.brief, photo: x.pick ? { file: path.relative(OUT, x.pick.file), src: x.pick.src, source: x.pick.source, clarity: Math.round(x.pick.a!.clarity * 10) / 10 } : null, candidates: x.cands.length }; }),
      top7: top.map((s) => ({ id: s.id, headline: s.headline, cool: s.cool, value: s.value, top_tier: s.top_tier, verdict: per[s.id]?.verdict, posted: posts.includes(s.id), candidates: per[s.id]?.cands.length, aiRejected: per[s.id]?.aiRejected })),
    };
  }
  const haikuUsd = Number(priceAnthropicMessages(haikuMsgs, { modelId: HAIKU }).costUsd);
  const cost = haikuUsd + jevUsd + serperUsd;
  const l = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  if (l.spent + cost > CAP_USD) console.warn('over cap');
  l.spent += cost; l.runs.push({ spec: 'md-photo-trial', cost, at: new Date().toISOString() });
  fs.writeFileSync(LEDGER, JSON.stringify(l, null, 1));
  fs.writeFileSync(path.join(OUT, 'final.json'), JSON.stringify({ costUsd: { haiku: haikuUsd, jev: jevUsd, serper: serperUsd }, days: result }, null, 1));
  console.log(`cost haiku $${haikuUsd.toFixed(4)} jev $${jevUsd.toFixed(4)} serper $${serperUsd.toFixed(3)}`);
  haikuMsgs = [];
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
