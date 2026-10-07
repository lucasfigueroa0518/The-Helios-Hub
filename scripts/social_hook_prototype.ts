/**
 * Helios Social: Hook pass PROTOTYPE on a saved daily run (Tommy approved,
 * 2026-10-06; cap $0.25). Per post, from the saved Editor draft:
 *
 *   budgets (offline renders) → Hook pass (Claude) → Fact-checker (Claude)
 *   → mechanical → render with the run's saved photos (no photo search)
 *
 * Stops after rendering, for Lucas's review. No database, no Instagram,
 * no web search. Live Claude calls go through one RunBudget guard.
 *
 *   npx tsx scripts/social_hook_prototype.ts runs/daily-<ts> [--cap-usd 0.25] [--offline]
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

import { runFactCheck } from '@/lib/social/factcheck/factcheck';
import { measureHookBudgets } from '@/lib/social/hook/budget';
import { runHookPass } from '@/lib/social/hook/hook';
import { checkDroppedText } from '@/lib/social/mechanical/checks';
import { createRunBudget } from '@/lib/social/pipeline/live-stages';
import { createMechanicalStage } from '@/lib/social/pipeline/mechanical-stage';
import type { Photo } from '@/lib/social/photos/find';
import { pickStarter } from '@/lib/social/photos/starter-set';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { toSlug, writeGeneratedPost } from '@/lib/social/render/local-store';
import { liveMessagesCreate } from '@/lib/social/reporter/reporter';
import { fillDraft, type DraftSlide, type DraftSubmission } from '@/lib/social/writer/draft';

const sameSlide = (a: DraftSlide, b: DraftSlide) =>
  a.type === b.type && a.quote_id === b.quote_id && a.number_ids.join() === b.number_ids.join() && a.image.kind === b.image.kind && a.image.value === b.image.value;

/** For each slide of `later` (same order, some slides dropped, text maybe fixed), the index of its slide in `earlier`. */
function alignSlides(earlier: DraftSlide[], later: DraftSlide[]): number[] {
  let from = 0;
  return later.map((s) => {
    let i = earlier.findIndex((e, k) => k >= from && e.headline.text === s.headline.text);
    if (i === -1) i = earlier.findIndex((e, k) => k >= from && sameSlide(e, s));
    if (i === -1) return -1;
    from = i + 1;
    return i;
  });
}

async function main() {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('usage: <runs/daily-dir> [--cap-usd 0.25]');
  const capArg = process.argv.indexOf('--cap-usd');
  const capUsd = capArg > 0 ? Number(process.argv[capArg + 1]) : 0.25;
  // --offline: budgets and photo alignment only, no Claude call.
  const offline = process.argv.includes('--offline');
  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const out = path.join(runDir, `hook-prototype-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(out, { recursive: true });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  // Reserve per call: a Hook or Fact-checker call is ≈$0.03–0.06; the guard refuses a call that could pass the cap.
  const budget = createRunBudget({ capUsd, otherSpendUsd: () => 0, reserveUsd: 0.05 });
  const create = budget.guard(liveMessagesCreate(new Anthropic()));
  const report: any[] = [];

  for (const [storyId, l] of Object.entries<any>(run.stories)) {
    if (!l.design || !l.editor?.at(-1)?.ok) continue;
    const brief = l.reporter.brief;
    const edited: DraftSubmission = l.editor.at(-1).draft;
    const savedFinal: DraftSubmission = l.factCheck.at(-1).outcome.draft;
    const traces = l.design.photos;
    // The run's photos, as the re-render uses them: story-slide starter photos dropped (cover-only set).
    const savedPhotos: Array<Photo | null> = traces.map((t: any, i: number) => (t.via === 'starter' ? (i > 0 ? null : (pickStarter(new Set(), { request: t.request.value, brief })?.photo ?? t.photo)) : t.photo));
    const coverPhoto = savedPhotos[0] ?? null;
    const editedToSaved = edited.slides.map(() => -1);
    const savedToEdited = alignSlides(edited.slides, savedFinal.slides);
    savedToEdited.forEach((e, s) => { if (e >= 0) editedToSaved[e] = s; });
    const editedPhotos = edited.slides.map((_, i) => (editedToSaved[i]! >= 0 ? savedPhotos[editedToSaved[i]! + 1] ?? null : null));
    const meta = { source: brief.sources[0]?.outlet ?? '', sourceUrl: brief.sources[0]?.url ?? '', publishedAt: run.startedAt };
    const entry: any = { storyId, cover: fillDraft(edited, brief).cover };
    report.push(entry);
    console.log(`\n${entry.cover}`);

    // 1. Budgets, measured on the render (offline).
    const b = await measureHookBudgets(fillDraft(edited, brief), { cover: coverPhoto, slides: editedPhotos }, meta, checkRenderFit);
    entry.budgets = b;
    entry.photos = editedPhotos.map((p, i) => `S${i + 2} ${p ? p.url.split('/').pop() : '—'}`);
    console.log(`  photos: ${entry.photos.join(' · ')}`);
    console.log(`  budgets: ${b.budgets.map((n, i) => `S${i + 2} ${n}`).join(' · ')} (${b.renders} renders${b.baselineFailures.length ? `; failing with no line: ${b.baselineFailures.join(', ')}` : ''})`);

    if (offline) continue;

    // 2. Hook pass (live).
    const hook = await runHookPass(brief, edited, b.budgets, { create });
    entry.hook = { ok: hook.ok, costUsd: hook.costUsd, retries: hook.retries, retryErrors: hook.retryErrors, ...(hook.ok ? { hooks: hook.hooks, dropped: hook.dropped } : { reason: hook.reason, detail: hook.detail }), turnUsage: hook.turnUsage };
    if (!hook.ok) { console.log(`  Hook pass FAILED: ${hook.reason} ${hook.detail}`); continue; }
    hook.hooks.forEach((h, i) => h && console.log(`  S${i + 2} ${h.kind} [${h.facts.join(',')}]: ${h.text}`));
    for (const d of hook.dropped) console.log(`  ${d}`);
    console.log(`  Hook pass: $${hook.costUsd.toFixed(4)}, ${hook.retries} retr${hook.retries === 1 ? 'y' : 'ies'}`);

    // 3. Fact-checker (live), reading the hook lines as slide text.
    const fc = await runFactCheck(brief, { submission: hook.draft, filled: hook.filled }, { create });
    entry.factCheck = { ok: fc.ok, costUsd: fc.costUsd, ...(fc.ok ? { flags: fc.flags, outcome: fc.outcome } : { reason: fc.reason, detail: fc.detail }) };
    if (!fc.ok) { console.log(`  Fact-checker FAILED: ${fc.reason} ${fc.detail}`); continue; }
    if (fc.outcome.kind !== 'ok') { console.log(`  Fact-checker: ${fc.outcome.kind} — ${fc.outcome.why}`); continue; }
    console.log(`  Fact-checker: $${fc.costUsd.toFixed(4)}, ${fc.flags.flags.length} flag(s)${fc.outcome.applied.length ? `: ${fc.outcome.applied.join(' | ')}` : ''}`);
    const checked = fc.outcome.draft;

    // 4. Mechanical, then 5. render with the saved photos.
    const mech = await createMechanicalStage()({ storyId, submission: checked, filled: fillDraft(checked, brief) }, { storyId, parsed: brief, raw: '', pages: [] });
    if (!mech.ok) { entry.mechanical = { ok: false, reason: mech.reasonCode, detail: mech.detail }; console.log(`  mechanical: SET ASIDE ${mech.reasonCode}: ${mech.detail}`); continue; }
    const filled = mech.value.filled;
    entry.mechanical = { ok: true, warnings: mech.value.mechanical?.warnings, fixes: mech.value.mechanical?.fixes };
    const finalPhotos = alignSlides(edited.slides, checked.slides).map((e) => (e >= 0 ? editedPhotos[e] ?? null : null));
    const post = toRenderPost(filled, { cover: coverPhoto, slides: finalPhotos }, meta);
    const name = toSlug(filled.cover).slice(0, 40);
    const fit = await checkRenderFit(post, { screenshotDir: out, name });
    for (const f of fit.focus ?? []) if (f.focus && post.slides[f.slide - 1]?.photoUrl === f.photo) post.slides[f.slide - 1]!.photoFocus = f.focus;
    const c7 = checkDroppedText(filled, fit.slideText);
    const slug = toSlug(`hook-${name}`);
    await writeGeneratedPost(slug, post);
    entry.render = { ok: fit.ok, problems: fit.problems, violations: fit.violations, c7, previewSlug: slug };
    console.log(`  mechanical warnings: ${JSON.stringify((mech.value.mechanical?.warnings ?? []).map((w) => `${w.id} ${w.where}: ${w.detail}`))}`);
    console.log(`  render check: ${fit.ok ? 'PASS' : `FAILED ${JSON.stringify([...fit.problems, ...fit.violations.map((v) => `slide ${v.slide} ${v.element}`)])}`} · C7: ${c7.length ? `FAILED ${JSON.stringify(c7)}` : 'PASS'}`);
    console.log(`  preview: http://localhost:3000/social/render/preview?generated=${slug}&all=1`);
  }

  await fsp.writeFile(path.join(out, 'hook-prototype.json'), JSON.stringify({ capUsd, spentUsd: budget.spent(), capRefused: budget.exhausted(), posts: report }, null, 2));
  console.log(`\nClaude spend: $${budget.spent().toFixed(4)} of $${capUsd} cap${budget.exhausted() ? ' (the guard refused a call)' : ''}`);
  console.log(`Screenshots + log: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
