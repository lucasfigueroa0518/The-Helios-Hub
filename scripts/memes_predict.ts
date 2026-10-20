/**
 * The pre-generation predictor's report (lib/memes/predict.ts,
 * planning/Memes/PREDICTOR.md). It reads the newest eval export, keeps only
 * the runs of one regime (the current one by default), and prints:
 * - how many graded runs that regime has;
 * - each feature's AUC on its own (exploration);
 * - the leave-one-out score of the fixed model at both stages (story, and
 *   story plus turns) against the base rate;
 * - whether the model may predict yet.
 *
 * With the Hub's story scores (.memes-local/predict/hub-scores-*.json) and the
 * story probe (story-probe-*.json) when present, it also prints those
 * exploratory signals; with a held-out list (--split, default the v5 new
 * stories) it checks each signal on both halves, and it prints screening
 * rules as precision and coverage.
 *
 * Writes .memes-local/predict/<regime>-<date>.json. Offline; no model calls.
 *
 *   npx tsx scripts/memes_predict.ts [--regime <id>] [--eval <file>] [--split <ids.json>]
 */
import fs from 'node:fs';
import path from 'node:path';

import { latestEvalFile, loadEvalSet } from '@/lib/memes/eval';
import {
  EXPLORATORY_FEATURES, looEvaluate, predictRows, readiness, screen, splitSignals, STORY_FEATURES, TURN_FEATURES, univariate, type PredictRow,
} from '@/lib/memes/predict';
import { regimeId, regimeParts, runRegime } from '@/lib/memes/regime';

const argv = process.argv.slice(2);
const arg = (n: string) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);
const file = arg('--eval') ?? latestEvalFile();
if (!file) throw new Error('No eval export; run scripts/memes_eval_export.ts');
const set = loadEvalSet(file);
const current = regimeId();
const regime = arg('--regime') ?? current;

const counts = new Map<string, number>();
for (const r of set.runs) {
  const id = runRegime(r) ?? '(none recorded)';
  counts.set(id, (counts.get(id) ?? 0) + 1);
}
console.log(`Eval set: ${file}`);
console.log(`Current regime: ${current} ${JSON.stringify(regimeParts())}`);
console.log(`Runs by regime: ${[...counts].map(([k, n]) => `${k} ${n}`).join(', ')}`);
if (regime !== current) console.log(`Reporting on ${regime}, which is NOT the current regime: its model may not predict for today's system.`);

// Exploratory joins: the newest Hub scores and story probe in .memes-local/predict/, by story id.
const PREDICT_DIR = path.join(process.cwd(), '.memes-local', 'predict');
const newest = (prefix: string) => {
  const files = fs.existsSync(PREDICT_DIR) ? fs.readdirSync(PREDICT_DIR).filter((f) => f.startsWith(prefix)).sort() : [];
  return files.length ? path.join(PREDICT_DIR, files[files.length - 1]!) : null;
};
const extra: Record<string, Record<string, number | null>> = {};
const hubFile = newest('hub-scores-');
if (hubFile) {
  for (const [id, h] of Object.entries(JSON.parse(fs.readFileSync(hubFile, 'utf8')) as Record<string, { net: number | null; blockbuster: number | null; carouselRank: number | null }>)) {
    extra[id] = { ...extra[id], hubNet: h.net, hubBlockbuster: h.blockbuster, carouselRank: h.carouselRank };
  }
}
const probeFile = newest('story-probe-');
if (probeFile) {
  const probe = JSON.parse(fs.readFileSync(probeFile, 'utf8')) as { scores: Record<string, Record<string, number>> };
  for (const [id, p] of Object.entries(probe.scores)) {
    extra[id] = { ...extra[id], probeKnownEntities: p.known_entities ?? null, probeTwist: p.headline_twist ?? null, probeHarm: p.harm_to_people ?? null, probeNiche: p.niche_technical ?? null };
  }
}
const splitFile = arg('--split') ?? path.join(process.cwd(), '.memes-local', 'eval', 'v5-new-stories.json');
const heldOut = new Set<string>(fs.existsSync(splitFile) ? (JSON.parse(fs.readFileSync(splitFile, 'utf8')) as Array<{ id: string }>).map((x) => x.id) : []);
const inB = (r: PredictRow) => heldOut.has(r.storyId);

const rows = predictRows(set, regime, extra);
const strong = rows.filter((r) => r.strong).length;
console.log(`\nRegime ${regime}: ${rows.length} graded single-story runs, ${strong} strong (≥ 2/3 of the slate good), base rate ${rows.length ? Math.round((100 * strong) / rows.length) : 0}%.`);

const f2 = (x: number | null) => (x == null ? ' n/a' : x.toFixed(2));
console.log(`\nEach feature alone: AUC for a strong slate (below 0.5 means "less likely strong"), all / seen before (${rows.filter((r) => !inB(r)).length}) / held out (${rows.filter(inB).length}).`);
for (const [label, keys] of [['Confirmatory (fixed before these grades)', [...STORY_FEATURES, ...TURN_FEATURES]], ['Exploratory (hypotheses only)', [...EXPLORATORY_FEATURES]]] as const) {
  console.log(`  ${label}:`);
  for (const s of splitSignals(rows, keys, inB)) {
    if (!s.n) continue;
    console.log(`    ${s.feature.padEnd(20)} ${f2(s.all)} / ${f2(s.a)} / ${f2(s.b)}   n=${s.n}${s.consistent ? '   consistent' : ''}`);
  }
}
void univariate;

console.log('\nScreening rules (precision and coverage; 90% intervals):');
const rules: Array<[string, (r: PredictRow) => boolean]> = [
  ['headline ≤ 60 characters', (r) => r.story.headlineChars <= 60],
  ['headline ≤ 70 characters', (r) => r.story.headlineChars <= 70],
  ['headline ≤ 80 characters', (r) => r.story.headlineChars <= 80],
  ['headline ≤ 70, no unknown names in it', (r) => r.story.headlineChars <= 70 && r.story.headlineUnknownNames === 0],
];
const pct = (x: number) => `${Math.round(100 * x)}%`;
for (const [name, pass] of rules) {
  for (const [half, sub] of [['all', rows], ['seen', rows.filter((r) => !inB(r))], ['held out', rows.filter(inB)]] as const) {
    const s = screen(sub, name, pass);
    console.log(`  ${name.padEnd(38)} ${half.padEnd(8)} passes ${s.passes}/${s.of} (${pct(s.passes / (s.of || 1))}); strong ${s.strong}/${s.passes} = ${pct(s.strongRate)} [${pct(s.ci[0])}–${pct(s.ci[1])}]; any-good ${s.anyGood}/${s.passes}; base ${pct(s.baseRate)}`);
  }
}

const stages = { story: [...STORY_FEATURES], 'story+turns': [...STORY_FEATURES, ...TURN_FEATURES] };
const report: Record<string, unknown> = {};
for (const [name, keys] of Object.entries(stages)) {
  const ev = looEvaluate(rows, keys);
  const ready = readiness(ev);
  report[name] = { ...ev, ready };
  console.log(`\nModel, stage "${name}" (${keys.length} features, ridge logistic, leave-one-out):`);
  console.log(`  AUC ${ev.looAuc == null ? 'n/a' : ev.looAuc.toFixed(2)}; Brier ${ev.brier.toFixed(3)} vs ${ev.brierBaseRate.toFixed(3)} for the base rate.`);
  console.log(`  May predict: ${ready.ready ? 'yes' : `no (${ready.reason})`}`);
}

const out = path.join(process.cwd(), '.memes-local', 'predict', `${regime}-${new Date().toISOString().slice(0, 10)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ file, regime, current, parts: regimeParts(), rows, report }, null, 1));
console.log(`\nWrote ${out}`);
