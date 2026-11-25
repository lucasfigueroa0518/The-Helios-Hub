/**
 * News Ranker lab, stage 2 (planning/MD-LFD Revisions, 2026-11-22).
 * The cheap Jev pass (build B R8) shortlists each day; one Sonnet call per day
 * grades the shortlist against Lucas's taste and merges same-event write-ups.
 * Lab only: run by hand on Lucas's go-ahead; spend lands in the tourney ledger.
 *
 *   npx tsx scripts/news-ranker-rerank.ts <jev-results.json> <out.json> [--top 25] [--yes]
 */
import fs from 'node:fs';
import path from 'node:path';

import Anthropic from '@anthropic-ai/sdk';

import { cachedSystemText, withToolCache } from '@/lib/anthropic-cache';
import { priceAnthropicMessages } from '@/lib/anthropic-pricing';
import { RERANK_SYSTEM, RERANK_TOOL } from '@/lib/news-ranker/rerank';

const DIR = path.join(process.cwd(), '.memes-local/news-ranker-lab/tourney');
const LEDGER = path.join(DIR, 'ledger.json');
const CAP_USD = 6.5; // Lucas: held-out Morning Download run on two new days (~$0.35), 2026-11-23
const MODEL = process.env.RERANK_MODEL ?? 'claude-sonnet-5-5';
const EFFORT = process.env.RERANK_EFFORT as 'low' | 'medium' | 'high' | undefined;

/** Prompt and grade tool live in lib (WC8 wording, `angle` field); the lab imports them so it never drifts. */
export { RERANK_SYSTEM };
const TOOL = RERANK_TOOL;

type Grade = { id: string; cool: number; value: number; duplicate_of: string | null; top_tier: boolean; crowds: string | null };

const MIN_POSTS = 2;
const MAX_POSTS = 5;
/** How many cleaned stories get the photo check; only these can be posted. */
export const PHOTO_CHECK_DEPTH = 7;

/** Photo check result: a good photo, only a usable fallback photo, or none at all. The photo lab will supply it; the lab stub says 'good'. */
export type PhotoVerdict = 'good' | 'usable' | 'none';

/**
 * Lucas's posting logic (2026-11-22; photo rule revised 2026-11-23).
 * Before the walk:
 *   1. Drop duplicates. Group stories linked by "crowds" (transitively) and keep the highest-ranked story of each group.
 *   2. Photo-check the top PHOTO_CHECK_DEPTH stories left. Only these can be posted.
 * The walk, over those stories in rank order:
 *   - stop at the first story that is not top tier;
 *   - skip a top-tier story without a good photo (it stays unposted, so it may compete again on a later day), so deep
 *     days stay visually strong;
 *   - stop at MAX_POSTS.
 * If fewer than MIN_POSTS: add the best remaining checked stories in rank order, any with a good or usable photo.
 *   Story strength comes before photo strength here (Lucas, 2026-11-23: "in a case when we have to meet the minimum
 *   threshold of 2 stories I'd rather prioritize the strength of story over the strength of image").
 */
export function choosePosts<T extends { id: string; duplicate_of: string | null; top_tier: boolean | null; crowds: string | null }>(
  ranked: T[],
  photo: (s: T) => PhotoVerdict = () => 'good',
): string[] {
  const list = ranked.filter((s) => !s.duplicate_of);
  const parent = new Map<string, string>();
  const root = (x: string): string => { const p = parent.get(x); if (!p || p === x) return x; const r = root(p); parent.set(x, r); return r; };
  for (const s of list) if (s.crowds && list.some((t) => t.id === s.crowds)) parent.set(root(s.id), root(s.crowds));
  const seen = new Set<string>();
  const clean = list.filter((s) => { const r = root(s.id); if (seen.has(r)) return false; seen.add(r); return true; });
  const checked = clean.slice(0, PHOTO_CHECK_DEPTH).map((s) => ({ s, photo: photo(s) }));
  const kept: T[] = [];
  for (const { s, photo: p } of checked) {
    if (kept.length >= MAX_POSTS || !s.top_tier) break;
    if (p === 'good') kept.push(s);
  }
  for (const { s, photo: p } of checked) {
    if (kept.length >= MIN_POSTS) break;
    if (p !== 'none' && !kept.includes(s)) kept.push(s);
  }
  return kept.map((s) => s.id);
}

async function main() {
  const [inPath, outPath] = process.argv.slice(2);
  const topN = Number(process.argv[process.argv.indexOf('--top') + 1]) || 25;
  const yes = process.argv.includes('--yes');
  const full = new Map<string, { text: string; eventDate: string | null }>();
  for (const s of JSON.parse(fs.readFileSync(process.env.TOURNEY_DATA ?? path.join(DIR, 'days5.json'), 'utf8'))) full.set(s.storyId.slice(0, 8), s);
  const rows: { id: string; headline: string; final: number }[] = JSON.parse(fs.readFileSync(inPath!, 'utf8')).stories;
  const byDay: Record<string, typeof rows> = {};
  for (const r of rows) (byDay[full.get(r.id)?.eventDate ?? 'unknown'] ??= []).push(r);
  const ledger = JSON.parse(fs.readFileSync(LEDGER, 'utf8'));
  const estimate = Object.keys(byDay).length * (MODEL.includes('opus') ? 0.055 : 0.025);
  console.log(`${Object.keys(byDay).length} days x top ${topN}, est $${estimate.toFixed(3)}; lab spent $${ledger.spent.toFixed(4)} of $${CAP_USD}`);
  if (ledger.spent + estimate > CAP_USD) throw new Error('would pass the lab cap');
  if (!yes) return;
  const client = new Anthropic();
  const out: Record<string, unknown> = {};
  const messages: Anthropic.Message[] = [];
  for (const day of Object.keys(byDay).sort()) {
    const short = byDay[day]!.sort((a, b) => b.final - a.final).slice(0, topN);
    const list = short.map((s) => `<story id="${s.id}">\n<headline>${s.headline.toWellFormed()}</headline>\n<text>${(full.get(s.id)?.text ?? '').slice(0, 700).toWellFormed()}</text>\n</story>`).join('\n');
    const msg = await client.messages.create({
      model: MODEL,
      max_tokens: 8000,
      ...(EFFORT ? { output_config: { effort: EFFORT } } : {}),
      system: cachedSystemText(RERANK_SYSTEM),
      tools: [withToolCache(TOOL)],
      messages: [{ role: 'user', content: `Shortlist for ${day}:\n${list}` }],
    });
    messages.push(msg);
    const use = msg.content.find((c): c is Anthropic.ToolUseBlock => c.type === 'tool_use');
    const grades = ((use?.input as { grades?: Grade[] })?.grades ?? []);
    const g = new Map(grades.map((x) => [x.id, x]));
    out[day] = short.map((s, i) => ({ jevRank: i + 1, id: s.id, headline: s.headline, cool: g.get(s.id)?.cool ?? null, value: g.get(s.id)?.value ?? null, duplicate_of: g.get(s.id)?.duplicate_of ?? null, top_tier: g.get(s.id)?.top_tier ?? null, crowds: g.get(s.id)?.crowds ?? null, posted: false }))
      .sort((a, b) => Number(!!a.duplicate_of) - Number(!!b.duplicate_of) || (b.cool ?? -1) + (b.value ?? -1) - ((a.cool ?? -1) + (a.value ?? -1)) || (b.cool ?? 0) - (a.cool ?? 0));
    const ranked = out[day] as { id: string; posted: boolean; duplicate_of: string | null; top_tier: boolean | null; crowds: string | null }[];
    const posts = new Set(choosePosts(ranked));
    for (const r of ranked) r.posted = posts.has(r.id);
    console.log(`${day}: ${grades.length}/${short.length} graded, ${posts.size} posted`);
  }
  const cost = Number(priceAnthropicMessages(messages, { modelId: MODEL }).costUsd);
  ledger.spent += cost; ledger.runs.push({ spec: `rerank ${MODEL} ${inPath}`, cost, at: new Date().toISOString() });
  fs.writeFileSync(LEDGER, JSON.stringify(ledger, null, 1));
  fs.writeFileSync(outPath!, JSON.stringify({ model: MODEL, costUsd: cost, days: out }, null, 1));
  console.log(`cost $${cost.toFixed(4)}`);
}

if (process.argv[1]?.endsWith('news-ranker-rerank.ts')) main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; });
