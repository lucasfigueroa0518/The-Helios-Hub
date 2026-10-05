/**
 * Helios Social — S1 Jev calibration (plan Step 0).
 *
 *   npx tsx scripts/social_s1.ts snapshot           fetch feeds (free, no AI) → runs/s1-<day>/articles.json
 *   npx tsx scripts/social_s1.ts sheet <dir> <n,…>  pick articles by index; fetch their full text (free,
 *                                                     no AI); write picked.json + labels.csv to fill in
 *   npx tsx scripts/social_s1.ts score <dir>        LIVE Jev: one story-scoring call per picked article
 *                                                     (needs Tommy's OK; refuses above the cost cap)
 *   npx tsx scripts/social_s1.ts compare <dir>      Tommy's labels vs Jev's scores (no calls)
 *
 * Scores single articles (no grouping), the same way selection scores a
 * one-outlet group, so the answers calibrate story-scoring@1 directly.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { HELIOS_SOCIAL_FEEDS } from '@/lib/social/feeds';
import { createJevAsk, createJevTally, tallied, JEV_INPUT_USD_PER_MTOK } from '@/lib/social/jev/client';
import * as Scoring from '@/lib/social/jev/questions/story-scoring.v1';
import { fetchBodyLive, THIN_BODY_CHARS } from '@/lib/social/ingest/select/enrich';
import { fetchFeeds } from '@/lib/social/ingest/select/feed-health';
import { buildGroup } from '@/lib/social/ingest/select/group';
import { outletName } from '@/lib/social/ingest/select/outlets';
import { judge } from '@/lib/social/ingest/select/score';
import type { IngestArticle } from '@/lib/social/ingest/select/types';
import { dayKey } from '@/lib/social/pipeline/set-aside-log';

/** Tommy's approval for the S1 Jev run (2026-10-04). */
const COST_CAP_USD = 0.01;

type Stored = Omit<IngestArticle, 'publishedAt'> & { publishedAt: string; fullText?: string | null };

const revive = (a: Stored): IngestArticle & { fullText?: string | null } => ({ ...a, publishedAt: new Date(a.publishedAt) });

const readJson = async <T>(p: string) => JSON.parse(await fsp.readFile(p, 'utf8')) as T;

const BOILERPLATE = /skip to main content|^credit:|published .*\d{4}|we know products|sign up|subscribe/i;

const words = (s: string) =>
  new Set(s.toLowerCase().replace(/[^a-z0-9\s]+/g, ' ').split(/\s+/).filter((w) => w.length >= 4));

/**
 * One line from the article, as written (extractive; no paraphrase): the
 * first sentence that shares at least two words with the headline and
 * isn't page boilerplate; else the first non-boilerplate sentence; else
 * the headline.
 */
function summaryLine(text: string, headline: string): string {
  const clean = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
  const sentences = clean.match(/[^.!?]{30,400}[.!?](?=\s|$)/g)?.map((s) => s.trim()) ?? [];
  const usable = sentences.filter((s) => !BOILERPLATE.test(s));
  const hw = words(headline);
  const onTopic = usable.find((s) => [...words(s)].filter((w) => hw.has(w)).length >= 2);
  return onTopic ?? usable[0] ?? headline;
}

const csvCell = (v: string) => `"${v.replace(/"/g, '""')}"`;

/** Minimal CSV reader (quoted cells, commas, newlines in quotes). */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((x) => x.trim()));
}

async function snapshot() {
  const now = new Date();
  const articles = await fetchFeeds(HELIOS_SOCIAL_FEEDS);
  const dir = path.join(process.cwd(), 'runs', `s1-${dayKey(now)}`);
  await fsp.mkdir(dir, { recursive: true });
  await fsp.writeFile(path.join(dir, 'articles.json'), JSON.stringify({ fetchedAt: now.toISOString(), articles }, null, 2));
  articles.forEach((a, i) => console.log(`${String(i).padStart(3)} | ${a.source} | ${a.headline}`));
  console.log(`\n${articles.length} articles → ${path.relative(process.cwd(), dir)}/articles.json`);
}

async function sheet(dir: string, picks: number[]) {
  const { articles } = await readJson<{ articles: Stored[] }>(path.join(dir, 'articles.json'));
  const picked: Stored[] = [];
  for (const i of picks) {
    const a = articles[i];
    if (!a) throw new Error(`no article at index ${i}`);
    const fullText = a.body.length < THIN_BODY_CHARS ? await fetchBodyLive(a.sourceUrl).catch(() => null) : null;
    picked.push({ ...a, fullText });
    console.log(`${picked.length}. ${fullText ? `full text ${fullText.length} chars` : 'RSS body only'} | ${a.headline}`);
  }
  await fsp.writeFile(path.join(dir, 'picked.json'), JSON.stringify(picked, null, 2));
  await writeCsv(dir, picked);
}

/** Headline without Google News' " - Outlet" suffix. */
const cleanTitle = (a: Stored) => a.headline.replace(/\s+-\s+[^-]+$/, (m) => (a.feedKind === 'google-news' ? '' : m));

async function writeCsv(dir: string, picked: Stored[]) {
  const header = ['#', 'title', 'outlet', 'link', 'summary (first sentence of the article)', 'Would I post this? (yes/no)', 'note (optional)'];
  const lines = [header.map(csvCell).join(',')];
  picked.forEach((a, i) => {
    const text = a.fullText && a.fullText.length > a.body.length ? a.fullText : a.body;
    lines.push([String(i + 1), cleanTitle(a), outletName(a), a.sourceUrl, summaryLine(text, a.headline), '', ''].map(csvCell).join(','));
  });
  await fsp.writeFile(path.join(dir, 'labels.csv'), `${lines.join('\n')}\n`);
  console.log(`\nSheet → ${path.relative(process.cwd(), dir)}/labels.csv`);
}

function groupFor(a: Stored) {
  const art = revive(a);
  const g = buildGroup([art]);
  const body = a.fullText && a.fullText.length > a.body.length ? a.fullText : a.body;
  return { ...g, body };
}

async function score(dir: string) {
  const picked = await readJson<Stored[]>(path.join(dir, 'picked.json'));
  const questions = Scoring.buildQuestions([]);
  // Estimate first (≈4 chars/token) and refuse above the approved cap.
  const estTokens = picked.reduce(
    (s, a) => s + Math.ceil(JSON.stringify({ state: Scoring.buildState(groupFor(a), []), questions }).length / 4),
    0,
  );
  const estUsd = (estTokens * JEV_INPUT_USD_PER_MTOK) / 1_000_000;
  console.log(`Estimate: ${picked.length} calls, ~${estTokens} input tokens, ≈ $${estUsd.toFixed(4)} (cap $${COST_CAP_USD})`);
  if (estUsd * 2 > COST_CAP_USD) throw new Error('estimate too close to the approved cap; not running');

  const tally = createJevTally();
  const jev = tallied(createJevAsk(), tally);
  const results = [];
  for (const a of picked) {
    if (tally.costUsd >= COST_CAP_USD) throw new Error(`cost cap reached at $${tally.costUsd.toFixed(4)}`);
    const g = groupFor(a);
    const res = await jev({ state: Scoring.buildState(g, []), questions }, { version: Scoring.VERSION, subjectId: a.sourceUrl });
    const answers = Object.fromEntries(Object.entries(res.answers).map(([k, v]) => [k, v.noul]));
    const j = judge(g, answers);
    results.push({ url: a.sourceUrl, headline: a.headline, answers, status: j.status, reason: j.reason ?? null, passes: j.passes, probSum: j.probSum });
  }
  await fsp.writeFile(
    path.join(dir, 'jev.json'),
    JSON.stringify({ version: Scoring.VERSION, thresholds: Scoring.THRESHOLDS, calls: tally.calls, inputTokens: tally.inputTokens, costUsd: tally.costUsd, results }, null, 2),
  );
  console.log(`Jev: ${tally.calls} calls, ${tally.inputTokens} input tokens, $${tally.costUsd.toFixed(5)} → jev.json`);
}

async function compare(dir: string) {
  const rows = parseCsv(await fsp.readFile(path.join(dir, 'labels.csv'), 'utf8')).slice(1);
  const jev = await readJson<{ results: Array<{ url: string; answers: Record<string, number>; status: string; reason: string | null; passes: number }> }>(path.join(dir, 'jev.json'));
  const byUrl = new Map(jev.results.map((r) => [r.url, r]));
  const p = (n: number | undefined) => (n ?? 0).toFixed(2);
  const out = ['| # | title | Tommy | Jev status | passes | ai_main | substance | max skip | note |', '|---|---|---|---|---|---|---|---|---|'];
  let agree = 0;
  let labelled = 0;
  for (const [n, title, , link, , label, note] of rows) {
    const r = byUrl.get(link ?? '');
    if (!r) continue;
    const tommy = (label ?? '').trim().toLowerCase();
    const jevYes = r.status === 'qualified';
    if (tommy === 'yes' || tommy === 'no') {
      labelled++;
      if ((tommy === 'yes') === jevYes) agree++;
    }
    const maxSkip = Math.max(...Scoring.SKIP_IDS.map((id) => r.answers[id] ?? 0));
    out.push(`| ${n} | ${title} | ${tommy || '—'} | ${r.status}${r.reason ? ` (${r.reason})` : ''} | ${r.passes} | ${p(r.answers.ai_main_subject)} | ${p(r.answers.substance)} | ${maxSkip.toFixed(2)} | ${note ?? ''} |`);
  }
  out.push('', `Agreement (Tommy yes ⇔ Jev qualified): ${agree} of ${labelled} labelled.`);
  await fsp.writeFile(path.join(dir, 'compare.md'), `${out.join('\n')}\n`);
  console.log(out.join('\n'));
}

async function main() {
  const [cmd, dir, list] = process.argv.slice(2);
  if (cmd === 'snapshot') return snapshot();
  if (!dir) throw new Error('usage: social_s1.ts <snapshot|sheet|score|compare> <dir> [picks]');
  if (cmd === 'sheet') return sheet(dir, (list ?? '').split(',').map(Number));
  if (cmd === 'csv') return writeCsv(dir, await readJson<Stored[]>(path.join(dir, 'picked.json')));
  if (cmd === 'score') return score(dir);
  if (cmd === 'compare') return compare(dir);
  throw new Error(`unknown command ${cmd}`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  },
);
