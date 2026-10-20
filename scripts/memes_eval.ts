/**
 * Print the graded set's baseline and the lint table (UPGRADE_PLAN U0).
 * Offline: reads .memes-local/eval/, no model calls.
 *
 *   npx tsx scripts/memes_eval.ts [file] [--pipeline v2|v3]
 */
import { baseline, latestEvalFile, lintSplits, loadEvalSet, pctOf } from '@/lib/memes/eval';

const argv = process.argv.slice(2);
const pi = argv.indexOf('--pipeline');
const pipeline = pi >= 0 ? argv[pi + 1] : undefined;
const file = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--pipeline') ?? latestEvalFile();
if (!file) {
  console.error('No graded set. Run: npx tsx scripts/memes_eval_export.ts');
  process.exit(1);
}

const set = loadEvalSet(file);
const b = baseline(set, pipeline);
const pc = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '–');

console.log(`Graded set: ${file}${pipeline ? ` (pipeline ${pipeline})` : ''}`);
console.log(`Rated ${b.rated}: Horrible ${b.ratings[1]}, No ${b.ratings[2]}, Yes ${b.ratings[3]}, Awesome ${b.ratings[4]}. Good ${pctOf(b.good)}.`);
console.log(`Slates ${b.slates}: with a good meme ${b.slatesWithGood} (${pc(b.slatesWithGood, b.slates)}), with an Awesome ${b.slatesWithAwesome} (${pc(b.slatesWithAwesome, b.slates)}).`);
if (b.zeroGoodStories.length) console.log(`Nothing good: ${b.zeroGoodStories.map((h) => h.slice(0, 60)).join(' | ')}`);
console.log(`Good by slate rank: ${Object.entries(b.byRank).map(([r, s]) => `#${r} ${pctOf(s)} (n=${s.n})`).join(', ')}`);
console.log('Judges, within-slate agreement with Lucas (chance is 50%):');
for (const [k, c] of Object.entries(b.judges)) console.log(`  ${k.padEnd(13)} ${c.agree}/${c.pairs} (${pc(c.agree, c.pairs)})`);
console.log(`Good by written characters: ${Object.entries(b.byChars).map(([k, s]) => `${k} ${pctOf(s)} (n=${s.n})`).join(', ')}`);
console.log(`Mean characters: Horrible ${b.meanCharsByRating[1]}, No ${b.meanCharsByRating[2]}, Yes ${b.meanCharsByRating[3]}, Awesome ${b.meanCharsByRating[4]}`);
console.log(`Runs ${b.runs}, mean cost $${b.meanCostUsd.toFixed(3)}, judge drop rate ${Math.round(b.dropRate * 100)}% of drafts.`);
console.log(`Templates by runs that drafted them: ${b.templateRuns.slice(0, 6).map((t) => `${t.templateId} ${t.runs}`).join(', ')}`);
console.log('\nLints (good rate with a hit vs without):');
for (const l of lintSplits(set, pipeline)) {
  console.log(`  ${l.kind.padEnd(38)} hit ${pctOf(l.hit).padStart(4)} (n=${String(l.hit.n).padStart(3)})   clean ${pctOf(l.clean).padStart(4)} (n=${l.clean.n})`);
}

// ── Telemetry for a pipeline's runs (no grades needed) ─────────────────────
if (pipeline) {
  const runs = set.runs.filter((r) => r.pipeline === pipeline && r.kind !== 'landscape');
  const memes = set.memes.filter((m) => m.pipeline === pipeline);
  const slateOf = (runId: string) => memes.filter((m) => m.runId === runId && m.inSlate);
  const ok = runs.filter((r) => r.status === 'ok');
  const sizes = ok.map((r) => slateOf(r.id).length);
  const inSlate = memes.filter((m) => m.inSlate);
  const count = (xs: string[]) => [...xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const templates = count(inSlate.map((m) => m.templateId));
  const turnTypes = count(inSlate.map((m) => m.turnType ?? '').filter(Boolean));
  const drops = count(memes.filter((m) => m.dropped).map((m) => m.dropped!.replace(/\s*\([\d.]+\)/g, '').replace(/^judges: /, '').split(':')[0]!));
  console.log(`\nTelemetry (${pipeline}): ${runs.length} runs, ${ok.length} ok, ${runs.length - ok.length} failed; mean cost $${(ok.reduce((a, r) => a + r.costUsd, 0) / (ok.length || 1)).toFixed(3)}, max $${Math.max(0, ...ok.map((r) => r.costUsd)).toFixed(3)}.`);
  console.log(`Slate sizes: ${count(sizes.map(String)).map(([k, n]) => `${k} memes × ${n}`).join(', ')}. Drafts per run: ${(memes.length / (ok.length || 1)).toFixed(1)}.`);
  console.log(`Templates in slates: ${templates.length} distinct; the most used is in ${templates[0] ? Math.round((templates[0][1] / (ok.length || 1)) * 100) : 0}% of slates (${templates.slice(0, 6).map(([k, n]) => `${k} ${n}`).join(', ')}).`);
  if (turnTypes.length) console.log(`Turn types in slates: ${turnTypes.map(([k, n]) => `${k} ${n}`).join(', ')}.`);
  console.log(`Why drafts were dropped: ${drops.map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}.`);
}
