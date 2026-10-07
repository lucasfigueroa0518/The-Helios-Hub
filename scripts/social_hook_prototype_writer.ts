/**
 * Helios Social: Hook pass PROTOTYPE from the Writer, on a saved daily
 * run's briefs (Tommy approved, 2026-10-06; cap $0.80). Per post:
 *
 *   Writer → Editor (Claude) → photos (the design stage's chain, once, on
 *   the Editor draft) → budgets (offline renders) → Hook pass → Fact-checker
 *   (Claude) → mechanical → render with those photos
 *
 * Stops after rendering, for review. The used-photo log is read (7-day
 * rule), never written; no database, Instagram or web search. Claude and
 * Jev spend share one RunBudget.
 *
 *   npx tsx scripts/social_hook_prototype_writer.ts runs/daily-<ts> [--cap-usd 0.80]
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

import { runFactCheck } from '@/lib/social/factcheck/factcheck';
import { measureHookBudgets } from '@/lib/social/hook/budget';
import { runHookPass } from '@/lib/social/hook/hook';
import { capped, createJevAsk, createJevTally, tallied } from '@/lib/social/jev/client';
import { checkDroppedText } from '@/lib/social/mechanical/checks';
import { createLiveStages, createRunBudget } from '@/lib/social/pipeline/live-stages';
import type { Brief, ScoredCandidate } from '@/lib/social/pipeline/types';
import { createFileUsedPhotoLog } from '@/lib/social/photos/used-photos';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { toSlug, writeGeneratedPost } from '@/lib/social/render/local-store';
import { liveMessagesCreate } from '@/lib/social/reporter/reporter';
import { fillDraft, type DraftSlide, type DraftSubmission } from '@/lib/social/writer/draft';
import { isWellKnownLive } from '@/lib/social/writer/well-known';

const sameSlide = (a: DraftSlide, b: DraftSlide) =>
  a.type === b.type && a.quote_id === b.quote_id && a.number_ids.join() === b.number_ids.join() && a.image.kind === b.image.kind && a.image.value === b.image.value;

/** For each slide of `later` (same order, some dropped, text maybe fixed), the index of its slide in `earlier`. */
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

const mixOf = (d: DraftSubmission) => {
  const reqs = [d.cover_options[d.chosen_cover - 1]!.image, ...d.slides.map((s) => s.image)];
  return Object.fromEntries(['subject', 'article', 'stock', 'none'].map((k) => [k, reqs.filter((r) => r.kind === k).length]));
};

async function main() {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('usage: <runs/daily-dir> [--cap-usd 0.80]');
  const capArg = process.argv.indexOf('--cap-usd');
  const capUsd = capArg > 0 ? Number(process.argv[capArg + 1]) : 0.8;
  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const out = path.join(runDir, `hook-writer-prototype-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(out, { recursive: true });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const jevTally = createJevTally();
  const jev = capped(tallied(createJevAsk(), jevTally), jevTally, capUsd);
  // Reserve per call: a Writer call is the largest (≈$0.10–0.15); the guard refuses a call that could pass the cap.
  const budget = createRunBudget({ capUsd, otherSpendUsd: () => jevTally.costUsd, reserveUsd: 0.15 });
  const create = budget.guard(liveMessagesCreate(new Anthropic()));
  const now = new Date(run.startedAt);
  const { stages, logs } = createLiveStages({
    score: async () => ({ ok: false, reasonCode: 'not-used', detail: 'prototype', costUsd: 0 }) as never,
    create: liveMessagesCreate(new Anthropic()),
    jev,
    budget,
    readPage: async () => { throw new Error('the prototype reads no pages'); },
    isWellKnown: isWellKnownLive,
    fitCheck: checkRenderFit,
    usedLog: createFileUsedPhotoLog(),
    now,
    reporterCapUsd: 0,
    maxReporterRuns: 0,
  });
  const report: any[] = [];

  for (const [storyId, l] of Object.entries<any>(run.stories)) {
    if (!l.reporter?.ok) continue;
    const parsed = l.reporter.brief;
    const brief: Brief = { storyId, parsed, raw: l.reporter.raw ?? '', pages: l.reporter.pages ?? [] };
    const winner = [...(run.selection?.winners ?? []), ...(run.selection?.backups ?? [])].find((w: any) => w.id === storyId);
    const story = { ...(winner ?? { id: storyId, title: parsed.the_news.text, url: storyId, outlets: [], sources: [] }), publishedAt: new Date(winner?.publishedAt ?? run.startedAt) } as ScoredCandidate;
    const entry: any = { storyId };
    report.push(entry);

    // 1. Writer → Editor (live).
    const w = await stages.write(brief);
    const wl = logs.get(storyId)?.writer.at(-1);
    entry.writer = { ok: w.ok, costUsd: w.costUsd, retries: wl?.draftRetries, retryErrors: wl?.retryErrors, ...(w.ok ? {} : { reason: w.reasonCode, detail: w.detail }) };
    if (!w.ok) { console.log(`\n${storyId}\n  Writer FAILED: ${w.reasonCode} ${w.detail}`); continue; }
    entry.writerMix = mixOf(w.value.submission);
    const e = await stages.edit(w.value, brief);
    entry.editor = { ok: e.ok, costUsd: e.costUsd, ...(e.ok ? {} : { reason: e.reasonCode, detail: e.detail }) };
    if (!e.ok) { console.log(`\n${storyId}\n  Editor FAILED: ${e.reasonCode} ${e.detail}`); continue; }
    const edited = e.value.submission;
    entry.cover = e.value.filled.cover;
    entry.requests = [edited.cover_options[edited.chosen_cover - 1]!.image, ...edited.slides.map((s) => s.image)].map((r, i) => `${i === 0 ? 'cover' : `S${i + 1}`} ${r.kind}${r.value ? `: ${r.value}` : ''}`);
    entry.mix = mixOf(edited);
    entry.editNotes = edited.edit_notes;
    console.log(`\n${entry.cover}`);
    console.log(`  Writer $${w.costUsd.toFixed(4)} (${wl?.draftRetries ?? 0} retries) · Editor $${e.costUsd.toFixed(4)}`);
    console.log(`  IMAGE mix after the Editor: ${JSON.stringify(entry.mix)} (Writer: ${JSON.stringify(entry.writerMix)})`);
    for (const r of entry.requests) console.log(`    ${r}`);

    // 2. Photos: the design stage's chain, once, on the Editor draft.
    const pre = await stages.design(e.value, brief, story);
    if (!pre.ok) { entry.design = { ok: false, reason: pre.reasonCode, detail: pre.detail }; console.log(`  design (photos) FAILED: ${pre.reasonCode} ${pre.detail}`); continue; }
    const traces = pre.value.photos;
    entry.photos = traces.map((t, i) => `${i === 0 ? 'cover' : `S${i + 1}`} ${t.via}${t.photo ? ` ${t.photo.url.split('/').pop()?.split('?')[0]}` : ''}`);
    console.log(`  photos: ${entry.photos.join(' · ')}`);
    const coverPhoto = traces[0]!.photo;
    const editedPhotos = traces.slice(1).map((t) => t.photo);
    const meta = { source: parsed.sources[0]?.outlet ?? '', sourceUrl: parsed.sources[0]?.url ?? '', publishedAt: run.startedAt };

    // 3. Budgets (offline), 4. Hook pass (live).
    const b = await measureHookBudgets(fillDraft(edited, parsed), { cover: coverPhoto, slides: editedPhotos }, meta, checkRenderFit);
    entry.budgets = b;
    console.log(`  budgets: ${b.budgets.map((n, i) => `S${i + 2} ${n}`).join(' · ')}`);
    const hook = await runHookPass(parsed, edited, b.budgets, { create });
    entry.hook = { ok: hook.ok, costUsd: hook.costUsd, retries: hook.retries, retryErrors: hook.retryErrors, ...(hook.ok ? { hooks: hook.hooks, dropped: hook.dropped } : { reason: hook.reason, detail: hook.detail }) };
    if (!hook.ok) { console.log(`  Hook pass FAILED: ${hook.reason} ${hook.detail}`); continue; }
    hook.hooks.forEach((h, i) => h && console.log(`  S${i + 2} ${h.kind} [${h.facts.join(',')}]: ${h.text}`));
    for (const d of hook.dropped) console.log(`  ${d}`);
    for (const r of hook.retryErrors) console.log(`  retry: ${r}`);
    console.log(`  Hook pass: $${hook.costUsd.toFixed(4)}, ${hook.retries} retr${hook.retries === 1 ? 'y' : 'ies'}`);

    // 5. Fact-checker (live).
    const fc = await runFactCheck(parsed, { submission: hook.draft, filled: hook.filled }, { create });
    entry.factCheck = { ok: fc.ok, costUsd: fc.costUsd, ...(fc.ok ? { flags: fc.flags, outcome: fc.outcome } : { reason: fc.reason, detail: fc.detail }) };
    if (!fc.ok) { console.log(`  Fact-checker FAILED: ${fc.reason} ${fc.detail}`); continue; }
    for (const f of fc.flags.flags) console.log(`  FLAG ${f.where.part}${f.where.number ? ` ${f.where.number}` : ''} type ${f.type} ${f.fix.kind.toUpperCase()}${f.fix.replacement ? ` "${f.fix.replacement}"` : ''}: "${f.quoted_text}"`);
    if (fc.outcome.kind !== 'ok') { console.log(`  Fact-checker: ${fc.outcome.kind}: ${fc.outcome.why}`); continue; }
    console.log(`  Fact-checker: $${fc.costUsd.toFixed(4)}, ${fc.flags.flags.length} flag(s)`);
    const checked = fc.outcome.draft;

    // 6. Mechanical, 7. render with the same photos.
    const mech = await stages.mechanical({ storyId, submission: checked, filled: fillDraft(checked, parsed) }, brief);
    if (!mech.ok) { entry.mechanical = { ok: false, reason: mech.reasonCode, detail: mech.detail }; console.log(`  mechanical: SET ASIDE ${mech.reasonCode}: ${mech.detail}`); continue; }
    const filled = mech.value.filled;
    entry.mechanical = { ok: true, warnings: mech.value.mechanical?.warnings, fixes: mech.value.mechanical?.fixes };
    const finalPhotos = alignSlides(edited.slides, checked.slides).map((i) => (i >= 0 ? editedPhotos[i] ?? null : null));
    const post = toRenderPost(filled, { cover: coverPhoto, slides: finalPhotos }, meta);
    const name = toSlug(filled.cover).slice(0, 40);
    const fit = await checkRenderFit(post, { screenshotDir: out, name });
    for (const f of fit.focus ?? []) if (f.focus && post.slides[f.slide - 1]?.photoUrl === f.photo) post.slides[f.slide - 1]!.photoFocus = f.focus;
    const c7 = checkDroppedText(filled, fit.slideText);
    const slug = toSlug(`hookw-${name}`);
    await writeGeneratedPost(slug, post);
    entry.render = { ok: fit.ok, problems: fit.problems, violations: fit.violations, c7, previewSlug: slug };
    console.log(`  mechanical warnings: ${JSON.stringify((mech.value.mechanical?.warnings ?? []).map((x) => `${x.id} ${x.where}: ${x.detail}`))}`);
    console.log(`  render check: ${fit.ok ? 'PASS' : `FAILED ${JSON.stringify([...fit.problems, ...fit.violations.map((v) => `slide ${v.slide} ${v.element}`)])}`} · C7: ${c7.length ? `FAILED ${JSON.stringify(c7)}` : 'PASS'}`);
    console.log(`  preview: http://localhost:3000/social/render/preview?generated=${slug}&all=1`);
  }

  await fsp.writeFile(path.join(out, 'hook-writer-prototype.json'), JSON.stringify({ capUsd, claudeUsd: budget.claudeUsd(), jevUsd: jevTally.costUsd, spentUsd: budget.spent(), capRefused: budget.exhausted(), posts: report, logs: Object.fromEntries(logs) }, null, 2));
  console.log(`\nSpend: $${budget.spent().toFixed(4)} of $${capUsd} cap (Claude $${budget.claudeUsd().toFixed(4)}, Jev $${jevTally.costUsd.toFixed(4)})${budget.exhausted() ? ' (the guard refused a call)' : ''}`);
  console.log(`Screenshots + log: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
