/** Photo vision lab, step 4: compare Jev, Haiku and the Opus reference. Free (reads files only). */
import fs from 'node:fs';
import path from 'node:path';

const LAB = path.join(process.cwd(), '.memes-local/news-ranker-lab/photo-test');
const items: { file: string; group: string }[] = JSON.parse(fs.readFileSync(path.join(LAB, 'items.json'), 'utf8'));
const load = (w: string) => JSON.parse(fs.readFileSync(path.join(LAB, `grade-${w}.json`), 'utf8'));
const jev = load('jev'), haiku = load('haiku'), opus = load('opus');
const KEYS = ['logo', 'ai_made', 'overlay', 'specific', 'related'] as const;
const yes = (v: unknown) => (typeof v === 'boolean' ? v : Number(v) >= 0.5);
const files = items.map((i) => i.file).filter((f) => jev.results[f] && haiku.results[f] && opus.results[f]);
const pct = (n: number, d: number) => `${Math.round((100 * n) / Math.max(d, 1))}%`;

const tierOf = (src: { results: Record<string, { tier: string }> }, f: string) => src.results[f]!.tier;
const agree = (a: (f: string) => unknown, b: (f: string) => unknown, fs2 = files) => pct(fs2.filter((f) => a(f) === b(f)).length, fs2.length);

console.log(`images compared: ${files.length} of ${items.length}`);
console.log(`\nTier agreement (good/usable/none):`);
console.log(`  Jev vs Opus   ${agree((f) => tierOf(jev, f), (f) => tierOf(opus, f))}`);
console.log(`  Haiku vs Opus ${agree((f) => tierOf(haiku, f), (f) => tierOf(opus, f))}`);
console.log(`  Jev vs Haiku  ${agree((f) => tierOf(jev, f), (f) => tierOf(haiku, f))}`);
const cand = files.filter((f) => items.find((i) => i.file === f)!.group === 'candidate');
console.log(`  candidates only: Jev-Opus ${agree((f) => tierOf(jev, f), (f) => tierOf(opus, f), cand)}, Haiku-Opus ${agree((f) => tierOf(haiku, f), (f) => tierOf(opus, f), cand)}`);

console.log(`\nPer question, agreement with Opus (Jev / Haiku):`);
for (const k of KEYS) console.log(`  ${k.padEnd(9)} ${agree((f) => yes(jev.results[f].answers[k]), (f) => yes(opus.results[f][k]))} / ${agree((f) => yes(haiku.results[f].answers[k]), (f) => yes(opus.results[f][k]))}`);
const mae = (src: typeof jev) => (files.reduce((s, f) => s + Math.abs(Number(src.results[f].answers.clarity) - Number(opus.results[f].clarity)), 0) / files.length).toFixed(2);
console.log(`  clarity mean abs diff from Opus: Jev ${mae(jev)}, Haiku ${mae(haiku)}`);

console.log(`\nControls caught:`);
for (const [g, k] of [['logo', 'logo'], ['ai', 'ai_made']] as const) {
  const fsx = files.filter((f) => items.find((i) => i.file === f)!.group === g);
  console.log(`  ${g}: Jev ${fsx.filter((f) => yes(jev.results[f].answers[k])).length}/${fsx.length}, Haiku ${fsx.filter((f) => yes(haiku.results[f].answers[k])).length}/${fsx.length}, Opus ${fsx.filter((f) => yes(opus.results[f][k])).length}/${fsx.length}`);
}

console.log(`\nTier confusion vs Opus (rows Opus, cols model):`);
for (const [name, src] of [['Jev', jev], ['Haiku', haiku]] as const) {
  console.log(`  ${name}`);
  for (const r of ['good', 'usable', 'none']) console.log(`    ${r.padEnd(6)} ` + ['good', 'usable', 'none'].map((c) => String(files.filter((f) => tierOf(opus, f) === r && tierOf(src, f) === c).length).padStart(4)).join(''));
}

const ms = (src: typeof jev) => Math.round(files.reduce((s, f) => s + src.results[f].ms, 0) / files.length);
console.log(`\nCost: Jev $${jev.costUsd.toFixed(4)} ($${(jev.costUsd / files.length).toFixed(5)}/image), Haiku $${haiku.costUsd.toFixed(4)} ($${(haiku.costUsd / files.length).toFixed(5)}/image)`);
console.log(`Mean latency: Jev ${ms(jev)} ms, Haiku ${ms(haiku)} ms`);

console.log(`\nDisagreements with Opus on tier:`);
for (const f of files) {
  const o = tierOf(opus, f), j = tierOf(jev, f), h = tierOf(haiku, f);
  if (o !== j || o !== h) console.log(`  ${f.padEnd(18)} opus ${o.padEnd(6)} jev ${j.padEnd(6)} haiku ${h.padEnd(6)} ${opus.results[f].note ?? ''}`);
}
