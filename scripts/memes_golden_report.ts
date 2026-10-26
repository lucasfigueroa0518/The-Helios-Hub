/**
 * How real memes are written vs how ours are (planning/Memes/GOLDEN_SET.md
 * G2). Reads the harvested golden set and the newest eval export; prints the
 * writing profile of Imgflip winners, flops, tech-tag memes, Lucas's graded
 * memes and our latest pipeline; writes per-template numbers to
 * .memes-local/golden/features.json. Offline, no model calls.
 *
 *   npx tsx scripts/memes_golden_report.ts [--pipeline v3] [--eval file]
 */
import fs from 'node:fs';
import path from 'node:path';

import { BLUE_CHIP_PLAYERS } from '@/lib/social-hub/blue-chip-players';
import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import { latestEvalFile, loadEvalSet, type EvalMeme } from '@/lib/memes/eval';
import {
  GOLDEN_DIR, isNoise, loadGoldenTemplate, memeFeatures, pct, splitWinnersFlops, summarize,
  type FeatureSummary, type GoldenTechPost,
} from '@/lib/memes/golden';

const argv = process.argv.slice(2);
const arg = (n: string) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
const pipeline = arg('--pipeline') ?? 'v3';
const evalFile = arg('--eval') ?? latestEvalFile();

const playerName = new Map(BLUE_CHIP_PLAYERS.map((p) => [p.id, p.name]));
/** What a meme of ours prints, box by box (a logo slot prints the player's name). */
const ourBoxes = (m: EvalMeme) =>
  m.fills.map((f) => (f.kind === 'entity' ? playerName.get(f.playerId) ?? f.playerId : f.text ?? '')).filter((x) => x.trim());

const winners: string[][] = [];
const flops: string[][] = [];
const perTemplate: Record<string, unknown> = {};
for (const t of TEMPLATE_CATALOG) {
  const file = loadGoldenTemplate(t.id);
  if (!file) continue;
  const { winners: w, flops: f } = splitWinnersFlops(file.posts);
  winners.push(...w.map((p) => p.boxes));
  flops.push(...f.map((p) => p.boxes));
  const boxCounts = w.map((p) => p.boxes.length);
  const mode = [...boxCounts.reduce((m, n) => m.set(n, (m.get(n) ?? 0) + 1), new Map<number, number>())].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
  const byIndex = Array.from({ length: Math.max(0, ...boxCounts) }, (_, i) => {
    const xs = w.map((p) => p.boxes[i]?.trim() ?? '').filter(Boolean).map((x) => x.length);
    return { box: i + 1, n: xs.length, p50: pct(xs, 50), p75: pct(xs, 75), p90: pct(xs, 90) };
  }).filter((b) => b.n >= 3);
  perTemplate[t.id] = {
    posts: file.posts.length, clean: file.posts.filter((p) => !isNoise(p)).length, winners: w.length, flops: f.length, usualBoxes: mode, byIndex,
    winnersProfile: summarize(w.map((p) => p.boxes)), flopsProfile: summarize(f.map((p) => p.boxes)),
  };
}

const techFile = path.join(GOLDEN_DIR, 'tech.json');
const tech = fs.existsSync(techFile) ? (JSON.parse(fs.readFileSync(techFile, 'utf8')) as GoldenTechPost[]).filter((p) => !isNoise(p)) : [];

const set = evalFile ? loadEvalSet(evalFile) : null;
const ours = set ? newestSlates(set.memes.filter((m) => m.pipeline === pipeline)) : [];
const graded = set ? set.memes.filter((m) => m.rating != null) : [];
const good = graded.filter((m) => m.rating! >= 3);
const bad = graded.filter((m) => m.rating! <= 2);

/** The in-slate memes of the newest run per story. */
function newestSlates(memes: EvalMeme[]): EvalMeme[] {
  const runOf = new Map<string, string>();
  const order = new Map(set!.runs.map((r, i) => [r.id, i]));
  for (const m of memes) {
    const key = m.storyIds.join(',');
    const had = runOf.get(key);
    if (!had || (order.get(m.runId) ?? 0) > (order.get(had) ?? 0)) runOf.set(key, m.runId);
  }
  const keep = new Set(runOf.values());
  return memes.filter((m) => m.inSlate && keep.has(m.runId));
}

const cols: Array<[string, FeatureSummary]> = [
  ['winners', summarize(winners)],
  ['flops', summarize(flops)],
  ['tech', summarize(tech.map((p) => p.boxes))],
  ['Lucas good', summarize(good.map(ourBoxes))],
  ['Lucas bad', summarize(bad.map(ourBoxes))],
  [`ours ${pipeline}`, summarize(ours.map(ourBoxes))],
];

const pc = (x: number) => `${Math.round(x * 100)}%`;
const row = (label: string, f: (s: FeatureSummary) => string) => console.log(`${label.padEnd(26)}${cols.map(([, s]) => f(s).padStart(12)).join('')}`);
console.log(`Golden set vs ours (${pipeline}); eval ${evalFile ?? 'none'}`);
row('', () => '');
console.log(`${''.padEnd(26)}${cols.map(([k]) => k.padStart(12)).join('')}`);
row('memes', (s) => String(s.n));
row('chars per box p50/p90', (s) => `${s.chars.p50}/${s.chars.p90}`);
row('chars per meme p50/p90', (s) => `${s.totalChars.p50}/${s.totalChars.p90}`);
row('one-box memes', (s) => pc(s.meme.oneBox));
for (const k of Object.keys(cols[0]![1].box) as Array<keyof FeatureSummary['box']>) row(`box: ${k}`, (s) => pc(s.box[k]));
for (const k of Object.keys(cols[0]![1].meme) as Array<keyof FeatureSummary['meme']>) row(`meme: ${k}`, (s) => pc(s.meme[k]));
const openerKeys = [...new Set(cols.flatMap(([, s]) => Object.keys(s.openers)))];
for (const k of openerKeys) row(`opener: ${k}`, (s) => pc(s.openers[k] ?? 0));

const out = {
  generatedAt: new Date().toISOString(), pipeline, evalFile,
  overall: Object.fromEntries(cols),
  techByTemplate: Object.fromEntries(
    [...tech.reduce((m, p) => (p.templateId ? m.set(p.templateId, (m.get(p.templateId) ?? 0) + 1) : m), new Map<string, number>())].sort((a, b) => b[1] - a[1]),
  ),
  perTemplate,
  oursByTemplate: Object.fromEntries(
    TEMPLATE_CATALOG.map((t) => [t.id, ours.filter((m) => m.templateId === t.id).map((m) => ({ boxes: ourBoxes(m), features: memeFeatures(ourBoxes(m)), rating: m.rating }))]).filter(([, xs]) => (xs as unknown[]).length),
  ),
};
fs.writeFileSync(path.join(GOLDEN_DIR, 'features.json'), JSON.stringify(out, null, 1));
console.log(`\nTech memes on our templates: ${Object.entries(out.techByTemplate).slice(0, 12).map(([k, n]) => `${k} ${n}`).join(', ')}`);
console.log(`Wrote ${path.join(GOLDEN_DIR, 'features.json')}`);
