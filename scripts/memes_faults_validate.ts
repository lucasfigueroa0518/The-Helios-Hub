/**
 * Validate the fault scorer (lib/memes/faults.ts, planning/Memes/FAULTS.md)
 * on every meme Lucas has graded, and check whether choosing by fault count
 * would beat the slate's #1 on the graded slates of the current regime (it
 * did not on v5, so the system always uses #1: DECISIONS ME-134).
 *
 * Prints:
 * - each fault's rate on bad memes (rated 1 or 2) and on good ones;
 * - the AUC of the fault count for a bad meme;
 * - within-slate agreement with Lucas's ratings;
 * - a grid of would-be pickers (margins m2, m3; a drop limit) against "always #1".
 *
 * Scores are cached in .memes-local/predict/meme-faults-<version>.json, so a
 * re-run only asks Jev about memes it hasn't scored. Live Jev, one call per
 * meme (about $0.03 for 405), capped at $0.10.
 *
 *   npx tsx scripts/memes_faults_validate.ts [--eval <file>] [--regime <id>]
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

import { latestEvalFile, loadEvalSet, type EvalMeme } from '@/lib/memes/eval';
import { FAULT_IDS, faultSubject, MEME_FAULTS, scoreManyFaults, type FaultScore } from '@/lib/memes/faults';
import { auc } from '@/lib/memes/predict';
import { regimeId, runRegime } from '@/lib/memes/regime';
import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';

loadEnvConfig(process.cwd());

/** A would-be picker, for this check only: keep #1 unless #2 or #3 is cleaner by a margin; drop at a fault limit. */
type PickerSettings = { override: boolean; m2: number; m3: number; dropFaults: number };
type SlateEntry = { memeId: string; rank: number; count: number };
function pickFromSlate(slate: SlateEntry[], s: PickerSettings): { memeId: string | null; dropped: boolean } {
  const [first, second, third] = [...slate].sort((a, b) => a.rank - b.rank);
  if (!first) return { memeId: null, dropped: true };
  const fewest = Math.min(...slate.map((m) => m.count));
  let pick = first;
  if (s.override && third && third.count === fewest && slate.filter((m) => m.count === fewest).length === 1 && first.count - third.count >= s.m3) pick = third;
  else if (s.override && second && first.count - second.count >= s.m2) pick = second;
  return pick.count >= s.dropFaults ? { memeId: null, dropped: true } : { memeId: pick.memeId, dropped: false };
}

const argv = process.argv.slice(2);
const arg = (n: string) => (argv.indexOf(n) >= 0 ? argv[argv.indexOf(n) + 1] : undefined);

async function main() {
  const file = arg('--eval') ?? latestEvalFile();
  if (!file) throw new Error('No eval export; run scripts/memes_eval_export.ts');
  const set = loadEvalSet(file);
  const regime = arg('--regime') ?? regimeId();
  const stories = new Map(set.stories.map((s) => [s.id, s]));
  const graded = set.memes.filter((m) => m.rating != null);

  const cacheFile = path.join(process.cwd(), '.memes-local', 'predict', `meme-faults-${MEME_FAULTS.version.replace(/@/g, '-')}.json`);
  const cache: Record<string, FaultScore> = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, 'utf8')).scores : {};
  const todo = graded.filter((m) => !cache[m.id]);
  const tally = createJevTally();
  if (todo.length) {
    const jev = capped(tallied(createJevAsk(), tally), tally, 0.1);
    const subjects = todo.map((m) => {
      const s = stories.get(m.storyIds[0] ?? '');
      return faultSubject({ templateId: m.templateId, fills: m.fills }, { headline: m.headline ?? s?.headline ?? '', theNews: s?.brief?.the_news?.text ?? '' }, m.id);
    });
    const scored = await scoreManyFaults(jev, subjects);
    for (const [id, f] of scored) cache[id] = f;
    fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
    fs.writeFileSync(cacheFile, JSON.stringify({ version: MEME_FAULTS.version, file, scores: cache }, null, 1));
  }
  console.log(`Scored ${graded.length} graded memes (${todo.length} new; Jev ${tally.calls} calls, $${tally.costUsd.toFixed(4)}).`);

  const bad = graded.filter((m) => m.rating! <= 2);
  const good = graded.filter((m) => m.rating! >= 3);
  const pct = (k: number, n: number) => `${Math.round((100 * k) / (n || 1))}%`.padStart(4);
  console.log(`\nEach fault (flagged at 0.5 or above): on bad memes (${bad.length}) / on good memes (${good.length})`);
  for (const id of FAULT_IDS) {
    const kb = bad.filter((m) => cache[m.id]!.flagged.includes(id)).length;
    const kg = good.filter((m) => cache[m.id]!.flagged.includes(id)).length;
    const a = auc(graded.map((m) => cache[m.id]!.faults[id]), graded.map((m) => m.rating! <= 2));
    console.log(`  ${id.padEnd(20)} bad ${pct(kb, bad.length)}  good ${pct(kg, good.length)}  AUC for bad ${a == null ? 'n/a' : a.toFixed(2)}`);
  }
  const countAuc = auc(graded.map((m) => cache[m.id]!.count + cache[m.id]!.sum / 100), graded.map((m) => m.rating! <= 2));
  console.log(`\nFault count, AUC for a bad meme: ${countAuc?.toFixed(2)} (all versions)`);
  for (const pl of ['v2', 'v3', 'v4', 'v5']) {
    const xs = graded.filter((m) => m.pipeline === pl);
    if (!xs.length) continue;
    const a = auc(xs.map((m) => cache[m.id]!.count + cache[m.id]!.sum / 100), xs.map((m) => m.rating! <= 2));
    console.log(`  ${pl}: ${xs.length} memes, AUC ${a?.toFixed(2)}`);
  }
  console.log('  Good rate by fault count:');
  for (let c = 0; c <= 6; c++) {
    const xs = graded.filter((m) => Math.min(cache[m.id]!.count, 6) === c);
    if (xs.length) console.log(`    ${c === 6 ? '6+' : c} faults: ${xs.filter((m) => m.rating! >= 3).length}/${xs.length} good (${pct(xs.filter((m) => m.rating! >= 3).length, xs.length)})`);
  }

  // Slates of the current regime, ranked and graded.
  const runs = new Map(set.runs.map((r) => [r.id, r]));
  const slates = new Map<string, EvalMeme[]>();
  for (const m of graded) {
    const r = runs.get(m.runId);
    if (!r || r.kind !== 'single' || !m.inSlate || m.rank == null || runRegime(r) !== regime) continue;
    slates.set(m.runId, [...(slates.get(m.runId) ?? []), m]);
  }
  const full = [...slates.values()].filter((xs) => xs.length >= 2).map((xs) => xs.sort((a, b) => a.rank! - b.rank!));
  let agree = 0;
  let pairs = 0;
  for (const xs of full) {
    for (let i = 0; i < xs.length; i++) for (let j = i + 1; j < xs.length; j++) {
      const a = xs[i]!;
      const b = xs[j]!;
      const fa = cache[a.id]!.count;
      const fb = cache[b.id]!.count;
      if (a.rating === b.rating || fa === fb) continue;
      pairs += 1;
      if ((fa - fb) * (a.rating! - b.rating!) < 0) agree += 1;
    }
  }
  console.log(`\nWithin-slate (regime ${regime}, ${full.length} slates): fewer faults = Lucas rated higher in ${agree}/${pairs} pairs (${pct(agree, pairs)}).`);

  const evaluate = (s: PickerSettings) => {
    let kept = 0;
    let keptGood = 0;
    let dropped = 0;
    let droppedBad = 0;
    let switched = 0;
    for (const xs of full) {
      const p = pickFromSlate(xs.map((m) => ({ memeId: m.id, rank: m.rank!, count: cache[m.id]!.count })), s);
      if (p.dropped) {
        dropped += 1;
        if (xs[0]!.rating! <= 2) droppedBad += 1;
        continue;
      }
      const m = xs.find((x) => x.id === p.memeId)!;
      kept += 1;
      if (m.rating! >= 3) keptGood += 1;
      if (m.rank !== 1) switched += 1;
    }
    return { kept, keptGood, dropped, droppedBad, switched };
  };
  const always1 = full.filter((xs) => xs[0]!.rating! >= 3).length;
  console.log(`Always #1: ${always1}/${full.length} good (${pct(always1, full.length)}).`);
  console.log('Picker grid (m2, m3, dropFaults): picked good / kept, switches, drops (of which #1 was bad)');
  for (const dropFaults of [4, 5, 6, 7, 8]) {
    const r = evaluate({ override: false, m2: 2, m3: 3, dropFaults });
    console.log(`  no switching, drop at ${dropFaults}: ${r.keptGood}/${r.kept} (${pct(r.keptGood, r.kept)}), drops ${r.dropped} (${r.droppedBad} bad #1)`);
  }
  for (const m2 of [1, 2, 3]) for (const m3 of [m2 + 1, m2 + 2]) for (const dropFaults of [4, 5, 6, 99]) {
    const r = evaluate({ override: true, m2, m3, dropFaults });
    console.log(`  m2 ${m2} m3 ${m3} drop ${dropFaults === 99 ? 'never' : `at ${dropFaults}`}: ${r.keptGood}/${r.kept} (${pct(r.keptGood, r.kept)}), switches ${r.switched}, drops ${r.dropped} (${r.droppedBad} bad #1)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
