/**
 * Calibrate the golden judges on the golden labels (planning/Memes/
 * GOLDEN_SET.md G4): for each template with a golden card, held-out Imgflip
 * winners (Top-listed posts ranked below the 70 the G3 coders read) against
 * flops (Latest posts with 0–2 upvotes). Asks format_true and real_meme of
 * each, as the meme judges do, and reports how well each separates winners
 * from flops (AUC), overall and per template, next to plain-code baselines
 * (the longest box, the total length).
 *
 * Live Jev calls, about $0.05–0.10, capped at $0.25. Approved with the G5
 * plan (Lucas, 2026-10-15).
 *
 *   npx tsx scripts/memes_calibrate_golden.ts [--per 8]
 */
import fs from 'node:fs';
import path from 'node:path';

import { loadEnvConfig } from '@next/env';

import { mapPool } from '@/lib/async-pool';
import { TEMPLATE_CATALOG } from '@/lib/memes/catalog';
import { goldenCard } from '@/lib/memes/golden-card';
import { GOLDEN_DIR, isNoise, loadGoldenTemplate, splitWinnersFlops } from '@/lib/memes/golden';
import { howItWorks, MEME_JUDGES } from '@/lib/memes/judges';
import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';

loadEnvConfig(process.cwd());

const argv = process.argv.slice(2);
const PER = Number(argv[argv.indexOf('--per') + 1] ?? 8) || 8;
const READ_BY_CODERS = 70;

function auc(pos: number[], neg: number[]): number {
  let wins = 0;
  for (const g of pos) for (const b of neg) wins += g > b ? 1 : g === b ? 0.5 : 0;
  return pos.length && neg.length ? wins / (pos.length * neg.length) : 0.5;
}

type Item = { templateId: string; label: 'winner' | 'flop'; boxes: string[]; upvotes: number };

async function main() {
  const items: Item[] = [];
  for (const t of TEMPLATE_CATALOG) {
    if (!goldenCard(t.id)) continue;
    const file = loadGoldenTemplate(t.id);
    if (!file) continue;
    const clean = file.posts.filter((p) => !isNoise(p));
    const top = clean.filter((p) => p.seen.some((l) => l.sort !== 'latest')).sort((a, b) => b.upvotes - a.upvotes);
    const heldOut = top.slice(READ_BY_CODERS).filter((p) => p.upvotes >= 20).slice(0, PER);
    const { flops } = splitWinnersFlops(file.posts);
    // Flops the coders saw are fine to use: they read them as contrast, not as the answer key.
    const fl = flops.slice(-PER);
    if (!heldOut.length || !fl.length) continue;
    items.push(...heldOut.map((p) => ({ templateId: t.id, label: 'winner' as const, boxes: p.boxes, upvotes: p.upvotes })));
    items.push(...fl.map((p) => ({ templateId: t.id, label: 'flop' as const, boxes: p.boxes, upvotes: p.upvotes })));
  }
  console.log(`${items.length} posts: ${items.filter((i) => i.label === 'winner').length} held-out winners, ${items.filter((i) => i.label === 'flop').length} flops, ${new Set(items.map((i) => i.templateId)).size} templates.`);

  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, 0.25);
  const questions = { format_true: MEME_JUDGES.questions.format_true, real_meme: MEME_JUDGES.questions.real_meme };
  const scored: Array<Item & { format_true: number; real_meme: number }> = [];
  await mapPool(items, 8, async (it, i) => {
    const card = TEMPLATE_CATALOG.find((t) => t.id === it.templateId)!;
    const res = await jev(
      { state: { meme: { template: card.name, ...howItWorks(card.id), printed: it.boxes.filter((b) => b.trim()) } }, questions },
      { version: `${MEME_JUDGES.version}-golden`, subjectId: `golden#${i}` },
    );
    scored.push({ ...it, format_true: res.answers.format_true?.noul ?? 0, real_meme: res.answers.real_meme?.noul ?? 0 });
    if (scored.length % 50 === 0) process.stdout.write(`${scored.length} `);
  });
  console.log(`\nJev: ${tally.calls} calls, $${tally.costUsd.toFixed(4)}.`);

  const longest = (x: Item) => -Math.max(0, ...x.boxes.map((b) => b.length));
  const total = (x: Item) => -x.boxes.reduce((n, b) => n + b.length, 0);
  const measures: Record<string, (x: (typeof scored)[number]) => number> = {
    format_true: (x) => x.format_true, real_meme: (x) => x.real_meme, 'both (mean)': (x) => (x.format_true + x.real_meme) / 2,
    'shorter longest box': longest, 'shorter total': total,
  };
  const report: Record<string, unknown> = {};
  console.log('\nMeasure                 AUC (winners above flops)   per-template AUC ≥ 0.7');
  for (const [k, f] of Object.entries(measures)) {
    const a = auc(scored.filter((x) => x.label === 'winner').map(f), scored.filter((x) => x.label === 'flop').map(f));
    const perT = [...new Set(scored.map((x) => x.templateId))].map((t) => {
      const xs = scored.filter((x) => x.templateId === t);
      return { t, auc: auc(xs.filter((x) => x.label === 'winner').map(f), xs.filter((x) => x.label === 'flop').map(f)) };
    });
    const strong = perT.filter((p) => p.auc >= 0.7).length;
    report[k] = { auc: a, perTemplate: perT };
    console.log(`${k.padEnd(24)}${a.toFixed(2).padStart(6)}                      ${strong}/${perT.length}`);
  }
  const out = path.join(GOLDEN_DIR, `calibration-golden-${new Date().toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(out, JSON.stringify({ per: PER, jev: { calls: tally.calls, costUsd: tally.costUsd }, report, scored }, null, 1));
  console.log(`Wrote ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
