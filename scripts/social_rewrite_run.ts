/**
 * Helios Social — LIVE Writer → Editor → Fact-checker on the briefs saved by
 * a daily run (no Reporter), with fresh drafts as in runDay. Compares the
 * new posts with the run's originals, headlines in order. --cap-usd is a
 * hard total cap (Claude); no call starts that could pass it.
 *
 *   npx tsx scripts/social_rewrite_run.ts --cap-usd 1.00 runs/daily-<ts>
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const at = process.argv.indexOf('--cap-usd');
  const cap = at > 0 ? Number(process.argv[at + 1]) : NaN;
  const runDir = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--cap-usd');
  if (!Number.isFinite(cap) || cap <= 0 || !runDir) throw new Error('usage: --cap-usd <amount> <runs/daily-dir>');

  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { MAX_FRESH_DRAFTS } = await import('@/lib/social/pipeline/orchestrator');
  const { runWriter } = await import('@/lib/social/writer/writer');
  const { runEditor } = await import('@/lib/social/editor/editor');
  const { runFactCheck } = await import('@/lib/social/factcheck/factcheck');
  const { fillDraft } = await import('@/lib/social/writer/draft');
  const { isWellKnownLive } = await import('@/lib/social/writer/well-known');
  type FilledDraft = import('@/lib/social/writer/draft').FilledDraft;

  const budget = createRunBudget({ capUsd: cap, otherSpendUsd: () => 0 });
  const create = budget.guard(liveMessagesCreate(newAnthropic()));
  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const outDir = path.join(runDir, `rewrite-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(outDir, { recursive: true });

  const lines = (d: FilledDraft) => [
    `COVER: ${d.cover}`,
    ...d.slides.map((s, i) => `${i + 2}. [${s.type}] ${s.headline.text}${s.body ? `\n      ${s.body.text}` : ''}${s.quote ? `\n      "${s.quote.text}" (${s.quote.speaker})` : ''}${s.numbers.length ? `\n      ${s.numbers.map((n) => n.value).join(' | ')}` : ''}`),
    `FOLLOW: ${d.follow}`,
  ];

  let n = 0;
  for (const [storyId, l] of Object.entries<any>(run.stories)) {
    if (!l.reporter?.ok) continue;
    n++;
    const brief = l.reporter.brief;
    const oldFc = l.factCheck.at(-1);
    const old = oldFc?.ok && oldFc.outcome.kind === 'ok' ? fillDraft(oldFc.outcome.draft, brief) : null;
    const costs: Record<string, number> = { writer: 0, editor: 0, 'fact-checker': 0 };
    const attempts: unknown[] = [];
    let final: FilledDraft | null = null;
    let stop: string | null = null;
    for (let attempt = 0; attempt <= MAX_FRESH_DRAFTS && !final && !stop; attempt++) {
      const w = await runWriter(brief, { create, isWellKnown: isWellKnownLive });
      costs.writer! += w.costUsd;
      if (!w.ok) { stop = `writer ${w.reason}: ${w.detail}`; attempts.push({ writer: w }); break; }
      const e = await runEditor(brief, w.draft, { create });
      costs.editor! += e.costUsd;
      if (!e.ok) { stop = `editor ${e.reason}: ${e.detail}`; attempts.push({ writer: w, editor: e }); break; }
      const f = await runFactCheck(brief, { submission: e.draft, filled: e.filled }, { create });
      costs['fact-checker']! += f.costUsd;
      attempts.push({ writer: w, editor: e, factCheck: f });
      if (!f.ok) { stop = `fact-checker ${f.reason}: ${f.detail}`; break; }
      if (f.outcome.kind === 'ok') final = fillDraft(f.outcome.draft, brief);
      else if (f.outcome.kind === 'set-aside') stop = `set aside: ${f.outcome.why}`;
      else if (attempt === MAX_FRESH_DRAFTS) stop = `unfixable: ${f.outcome.why}`;
    }
    await fsp.writeFile(path.join(outDir, `story-${n}.json`), JSON.stringify({ storyId, attempts, final, stop, costs }, null, 2));

    const left = old ? lines(old) : ['(no original post)'];
    const right = final ? lines(final) : [`(no new post: ${stop})`];
    let md = `# ${n}. ${brief.the_news.text.slice(0, 120)}\n\nCost: ${Object.entries(costs).map(([k, v]) => `${k} $${v.toFixed(3)}`).join(' · ')}; attempts ${attempts.length}\n\n`;
    md += `| Before (checkpoint) | After (Writer v2 + Editor check 2) |\n|---|---|\n`;
    for (let i = 0; i < Math.max(left.length, right.length); i++) md += `| ${(left[i] ?? '').replace(/\n\s*/g, '<br>').replace(/\|/g, '\\|')} | ${(right[i] ?? '').replace(/\n\s*/g, '<br>').replace(/\|/g, '\\|')} |\n`;
    const fc = (attempts.at(-1) as any)?.factCheck;
    md += `\nFact-checker: ${fc?.ok ? `${fc.flags.flags.length} flags; ${fc.outcome.kind}${fc.outcome.applied?.length ? `; ${fc.outcome.applied.join('; ')}` : ''}` : 'not reached'}\n`;
    const notes = (attempts.at(-1) as any)?.editor?.draft?.edit_notes;
    if (notes?.length) md += `\nEditor notes:\n${notes.map((x: string) => `- ${x}`).join('\n')}\n`;
    await fsp.writeFile(path.join(outDir, `story-${n}.md`), md);
    console.log(`${n}. ${final ? 'ok' : stop} · $${Object.values(costs).reduce((a, b) => a + b, 0).toFixed(3)}`);
  }
  console.log(`\nTotal $${budget.spent().toFixed(4)} of $${cap}. Out: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
