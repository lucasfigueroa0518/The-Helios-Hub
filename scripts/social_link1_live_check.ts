/**
 * Helios Social — LIVE check of Step A (every speaker is a SUBJECT; subject
 * types) and photo Link 1 (the Writer's IMAGE request), in one sitting
 * (Tommy's OK, 2026-10-07, capped at $2.00 total including retries and
 * reserves). One run budget for everything: no Claude call starts unless
 * the call reserve still fits under the cap; Jev counts against it too.
 *
 *   1. Reporter re-run on two saved stories (the selection picks of a saved
 *      daily run): every quote's speaker in SUBJECTS, every SUBJECT typed.
 *   2. Writer on saved briefs (with the pages they read): the new handoff,
 *      with the live availability lookup (identity check, Wikidata, Commons).
 *      No photo finder, no render.
 *
 *   npx tsx scripts/social_link1_live_check.ts --cap-usd 2.00 \
 *     --reporter <run.json>:w0,b0 --writer <run.json>
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const at = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
  const cap = Number(at('--cap-usd'));
  const reporterArg = at('--reporter');
  const writerRun = at('--writer');
  if (!Number.isFinite(cap) || cap <= 0 || !reporterArg || !writerRun) throw new Error('usage: --cap-usd <amount> --reporter <run.json>:w0,b0 --writer <run.json>');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { liveMessagesCreate, runReporter } = await import('@/lib/social/reporter/reporter');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const { readableDate } = await import('@/lib/social/pipeline/reporter-stage');
  const { toCandidate } = await import('@/lib/social/pipeline/selection-stage');
  const { createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { quoteSpeakersNotInSubjects } = await import('@/lib/social/reporter/brief');
  const { runWriter, briefForWriter } = await import('@/lib/social/writer/writer');
  const { isWellKnownLive } = await import('@/lib/social/writer/well-known');
  const { createSubjectAvailability } = await import('@/lib/social/photos/availability');

  const tally = createJevTally();
  const budget = createRunBudget({ capUsd: cap, otherSpendUsd: () => tally.costUsd });
  const create = budget.guard(liveMessagesCreate(new Anthropic()));
  const jev = tallied(createJevAsk(), tally);
  const now = new Date();
  const dir = path.join(process.cwd(), 'runs', `link1-live-check-${now.toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(dir, { recursive: true });
  const report: Record<string, unknown> = { capUsd: cap };

  // ── 1. Reporter re-run ──
  const [reporterRun, picksArg] = reporterArg.split(':') as [string, string];
  const selection = JSON.parse(await fsp.readFile(reporterRun, 'utf8')).selection;
  const reporter = [];
  for (const pick of picksArg.split(',')) {
    const group = (pick[0] === 'w' ? selection.winners : selection.backups)[Number(pick.slice(1))];
    const story = toCandidate(group, 1);
    if (budget.exhausted()) { reporter.push({ pick, skipped: 'cap reached' }); continue; }
    const r = await runReporter({ story: story.title, startingSources: story.sources, today: readableDate(now) }, { create, readPage: (u) => readPage(u), costCapUsd: Math.min(0.8, cap) }).catch((e) => ({ ok: false as const, reason: 'cap', detail: String(e), costUsd: 0 }));
    await fsp.writeFile(path.join(dir, `reporter-${pick}.json`), JSON.stringify(r, null, 2));
    if (!r.ok) { reporter.push({ pick, title: story.title, ok: false, reason: r.reason, detail: r.detail, costUsd: r.costUsd }); continue; }
    reporter.push({
      pick,
      title: story.title,
      ok: true,
      costUsd: r.costUsd,
      submitRetries: r.submitRetries,
      retryErrors: r.retryErrors,
      quotes: r.brief.quotes.map((q) => `${q.id} ${q.speaker} → ${q.speaker_id ?? 'NOT IN SUBJECTS'}`),
      speakersMissing: quoteSpeakersNotInSubjects(r.brief),
      speakersNotInSubjectsLog: r.speakersNotInSubjects,
      subjects: r.brief.subjects.map((s) => `${s.id} ${s.name} (${s.type ?? 'NO TYPE'})`),
    });
  }
  report.reporter = reporter;

  // ── 2. Writer on saved briefs ──
  const saved = JSON.parse(await fsp.readFile(writerRun, 'utf8'));
  const identities = new Map<string, import('@/lib/social/photos/p18').IdentityCache>();
  const availability = createSubjectAvailability({ jev }, (b) => {
    const key = b.the_news.text;
    if (!identities.has(key)) identities.set(key, new Map());
    return identities.get(key)!;
  });
  const writer = [];
  for (const [storyId, v] of Object.entries<any>(saved.stories)) {
    const rep = Array.isArray(v.reporter) ? v.reporter.at(-1) : v.reporter;
    if (!rep?.ok) continue;
    if (budget.exhausted()) { writer.push({ storyId, skipped: 'cap reached' }); continue; }
    const brief = rep.brief;
    const pages = rep.pages ?? [];
    const forWriter = await briefForWriter(brief, isWellKnownLive, availability, pages);
    const r = await runWriter(brief, { create, isWellKnown: isWellKnownLive, availability, pages });
    await fsp.writeFile(path.join(dir, `writer-${writer.length + 1}.json`), JSON.stringify({ storyId, forWriter: { subjects: forWriter.subjects, article_photos: forWriter.article_photos }, result: r }, null, 2));
    const d = r.ok ? r.draft : null;
    writer.push({
      storyId: storyId.slice(0, 90),
      ok: r.ok,
      reason: r.ok ? null : r.reason,
      detail: r.ok ? null : r.detail,
      costUsd: r.costUsd,
      draftRetries: r.draftRetries,
      retryErrors: r.retryErrors,
      dropped: r.imageRequestsDropped,
      subjects: forWriter.subjects.map((s) => `${s.id} ${s.name}: ${s.type ?? '?'}${s.headshot_available ? ' headshot' : ''}${s.logo_available ? ' logo' : ''}`),
      articlePhotos: forWriter.article_photos.map((p) => `${p.official_of ? `official ${p.official_of}` : `names ${p.subject_ids.join(',')}`}: ${p.url.slice(-50)}`),
      cover: d ? `${d.cover_options[d.chosen_cover - 1]!.image.kind}: ${d.cover_options[d.chosen_cover - 1]!.image.value.slice(-50)} [${d.cover_options[d.chosen_cover - 1]!.subject_ids?.join(',') ?? '-'}]` : null,
      slides: d ? d.slides.map((s, i) => `${i + 2} ${s.type}: ${s.image.kind}${s.image.value ? ` ${s.image.value.slice(-45)}` : ''} [${s.subject_ids?.join(',') ?? '-'}]`) : null,
    });
  }
  report.writer = writer;
  report.spend = { claudeUsd: Number(budget.claudeUsd().toFixed(4)), jevUsd: Number(tally.costUsd.toFixed(5)), jevCalls: tally.calls, totalUsd: Number(budget.spent().toFixed(4)), capReached: budget.exhausted() };
  await fsp.writeFile(path.join(dir, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ dir: path.relative(process.cwd(), dir), ...report }, null, 2));
}
main().then(() => process.exit(0), (e) => { console.error(e instanceof Error ? e.stack : e); process.exit(1); });
