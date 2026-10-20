/**
 * Calibrate meme-judges@3 on Lucas's graded set (UPGRADE_PLAN U5). Runs the
 * new Jev questions over every rated meme whose story has a brief, then
 * reports for each question how well it orders memes the way Lucas did
 * (within a slate) and separates good from bad (AUC), and whether a bar
 * exists that removes most bad memes while keeping nearly all good ones.
 *
 * Live Jev calls (about $0.01 for the 2026-10-14 set), capped at $0.10.
 * Run only with Lucas's go-ahead (CLAUDE.md Rule 1).
 *
 *   npx tsx scripts/memes_calibrate.ts [graded-set.json]
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

import { EVAL_DIR, latestEvalFile, loadEvalSet, slateConcordance, type EvalMeme, type Rating } from '@/lib/memes/eval';
import { resolveMeme } from '@/lib/memes/fill';
import { judgeCandidates, rankScore, type Candidate, type JudgeScores } from '@/lib/memes/judges';
import type { MemeStory } from '@/lib/memes/story';
import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';

loadEnvConfig(process.cwd());

const QUESTIONS = ['turn_visible', 'legible', 'format_true', 'punch_last', 'accurate', 'ad_copy', 'off_limits'] as const;

function auc(good: number[], bad: number[]): number {
  let wins = 0;
  for (const g of good) for (const b of bad) wins += g > b ? 1 : g === b ? 0.5 : 0;
  return good.length && bad.length ? wins / (good.length * bad.length) : 0.5;
}

async function main() {
  const file = process.argv[2] ?? latestEvalFile();
  if (!file) throw new Error('no graded set; run scripts/memes_eval_export.ts');
  const set = loadEvalSet(file);
  const stories = new Map(set.stories.map((s) => [s.id, s]));
  const rated = set.memes.filter((m): m is EvalMeme & { rating: Rating } => m.rating != null && m.storyIds.length === 1 && Boolean(stories.get(m.storyIds[0]!)?.brief));
  console.log(`${rated.length} rated memes with a brief (of ${set.memes.filter((m) => m.rating != null).length} rated).`);

  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, 0.1);
  const byStory = new Map<string, Array<EvalMeme & { rating: Rating }>>();
  for (const m of rated) byStory.set(m.storyIds[0]!, [...(byStory.get(m.storyIds[0]!) ?? []), m]);
  const scores = new Map<string, JudgeScores>();
  for (const [storyId, memes] of byStory) {
    const s = stories.get(storyId)!;
    const story: MemeStory = { postId: storyId, title: memes[0]!.headline || s.headline, status: 'eval', createdAt: '', brief: s.brief! };
    const cands: Candidate[] = memes.map((m, index) => {
      const fill = { templateId: m.templateId, fills: m.fills };
      return { index, mapping: { templateId: m.templateId, situationId: m.situationId, relation: m.relation, fill, why: m.why }, spec: resolveMeme(fill) };
    });
    const judged = await judgeCandidates(jev, story, cands);
    memes.forEach((m, i) => scores.set(m.id, judged.get(i)!));
    process.stdout.write('.');
  }
  console.log(`\nJev: ${tally.calls} calls, $${tally.costUsd.toFixed(4)}.`);

  const rows = rated.map((m) => ({ m, s: scores.get(m.id)! }));
  const good = (r: (typeof rows)[number]) => r.m.rating >= 3;
  const report: Record<string, unknown> = {};
  console.log('\nQuestion        AUC   within-slate   mean good / bad   best bar (removes bad, keeps good)');
  for (const q of [...QUESTIONS, 'score' as const]) {
    const val = (r: (typeof rows)[number]) => (q === 'score' ? rankScore(r.s, { templateId: r.m.templateId, situationId: null, relation: '', fill: { templateId: r.m.templateId, fills: r.m.fills }, why: {} }) : r.s[q]);
    const g = rows.filter(good).map(val);
    const b = rows.filter((r) => !good(r)).map(val);
    const a = auc(g, b);
    const flip = q === 'ad_copy' || q === 'off_limits';
    const conc = slateConcordance(rated, (m) => {
      const r = rows.find((x) => x.m.id === m.id)!;
      return flip ? -val(r) : val(r);
    });
    let bar: { at: number; removesBad: number; keepsGood: number } | null = null;
    for (let t = 0.05; t < 1; t += 0.05) {
      const keepsGood = g.filter((v) => (flip ? v < t : v >= t)).length / g.length;
      const removesBad = b.filter((v) => (flip ? v >= t : v < t)).length / b.length;
      if (keepsGood >= 0.9 && removesBad >= 0.7 && (!bar || removesBad > bar.removesBad)) bar = { at: Number(t.toFixed(2)), removesBad, keepsGood };
    }
    const mean = (xs: number[]) => xs.reduce((x, y) => x + y, 0) / (xs.length || 1);
    report[q] = { auc: flip ? 1 - a : a, agree: conc.agree, pairs: conc.pairs, meanGood: mean(g), meanBad: mean(b), bar };
    console.log(`${q.padEnd(14)} ${(flip ? 1 - a : a).toFixed(2)}   ${String(conc.agree).padStart(3)}/${String(conc.pairs).padEnd(3)} (${conc.pairs ? Math.round((conc.agree / conc.pairs) * 100) : 0}%)   ${mean(g).toFixed(2)} / ${mean(b).toFixed(2)}        ${bar ? `${bar.at}: removes ${Math.round(bar.removesBad * 100)}%, keeps ${Math.round(bar.keepsGood * 100)}%` : 'none'}`);
  }
  const out = path.join(EVAL_DIR, `calibration-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify({ file, judged: rows.length, jev: { calls: tally.calls, costUsd: tally.costUsd }, report, scores: rows.map((r) => ({ id: r.m.id, rating: r.m.rating, ...r.s })) }, null, 1));
  console.log(`\nWrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
