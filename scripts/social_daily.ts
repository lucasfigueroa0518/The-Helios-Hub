/**
 * Helios Social — the daily run, end to end (checkpoint, Tommy 2026-10-06):
 *
 *   fetch feeds → selection (Jev) → Reporter → Writer → Editor →
 *   Fact-checker → mechanical (text fixes + checks) → design (basic
 *   photos, credit check, render-fit and dropped-text checks) → local preview
 *
 * LIVE: Claude (Sonnet 5.5), web search, Jev, Wikidata / Commons /
 * Openverse. Needs Tommy's OK. --cap-usd (default $2.00) is a hard total
 * cap on Claude (tokens + web search fees) + Jev: no call starts that
 * could pass it. No database, no Storage, no Instagram.
 *
 *   npx tsx scripts/social_daily.ts --stories 2            (cap $2.00)
 *   npx tsx scripts/social_daily.ts --cap-usd 1.50 --stories 2
 *   npx tsx scripts/social_daily.ts --stories 3 --hook --preview
 *
 * --hook: the Hook pass for this run only (prototype; never the daily
 * default). --preview: run.json is labelled PREVIEW (not an acceptance
 * batch), the used-photo log is not written (so the acceptance batch's
 * 7-day rule isn't spent on a preview), and preview-report.md lists per
 * post: photo source and layout per slide, spreads, hook lines,
 * Fact-checker flags and cost.
 *
 * Writes runs/daily-<ts>/: run.json (selection, every stage's result,
 * costs), brief-<n>.json, post-<n>.md (text + photos + identity + fit),
 * screenshots/ (every rendered post, including ones that failed the fit
 * check); posts to exports/social/generated/ for the preview page; the
 * set-aside log in Claude outputs/.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

const DEFAULT_CAP_USD = 2;

async function main() {
  const arg = (name: string) => {
    const i = process.argv.indexOf(name);
    return i > 0 ? Number(process.argv[i + 1]) : undefined;
  };
  // Default total cap $2.00 (Tommy, 2026-10-06; spec allows $5/day).
  const capUsd = arg('--cap-usd') ?? DEFAULT_CAP_USD;
  if (!Number.isFinite(capUsd) || capUsd <= 0) throw new Error('--cap-usd must be a positive amount');
  const stories = arg('--stories') ?? 2;
  const hookOn = process.argv.includes('--hook');
  const preview = process.argv.includes('--preview');

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const { HELIOS_SOCIAL_FEEDS } = await import('@/lib/social/feeds');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  const { createFileFeedHealthLog, fetchFeeds } = await import('@/lib/social/ingest/select/feed-health');
  const { createFilePosted } = await import('@/lib/social/ingest/select/posted');
  const { createCostMeter } = await import('@/lib/social/pipeline/cost-meter');
  const { createLiveStages, createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { runDay } = await import('@/lib/social/pipeline/orchestrator');
  const { createSelectionStage } = await import('@/lib/social/pipeline/selection-stage');
  const { createFileSetAsideLog } = await import('@/lib/social/pipeline/set-aside-log');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { toSlug, writeGeneratedPost } = await import('@/lib/social/render/local-store');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const layoutRotation = await import('@/lib/social/render/layout-rotation');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { hasPhotoLive, isWellKnownLive } = await import('@/lib/social/writer/well-known');
  const { createFileUsedPhotoLog } = await import('@/lib/social/photos/used-photos');
  const { loadBank } = await import('@/lib/social/photos/bank');
  const usedLog = createFileUsedPhotoLog();
  const bank = await loadBank();
  type Selection = import('@/lib/social/ingest/select/select').Selection;
  type FitResult = import('@/lib/social/render/fit-check').FitResult;
  type PostObject = import('@/lib/social/pipeline/types').PostObject;

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(process.cwd(), 'runs', `daily-${stamp}`);
  const shotDir = path.join(runDir, 'screenshots');
  await fsp.mkdir(runDir, { recursive: true });

  const articles = await fetchFeeds(HELIOS_SOCIAL_FEEDS);

  const jevTally = createJevTally();
  const jev = capped(tallied(createJevAsk(), jevTally), jevTally, capUsd);
  const budget = createRunBudget({ capUsd, otherSpendUsd: () => jevTally.costUsd });
  let selection: Selection | null = null;

  // Screenshots and fit results per story: the design stage doesn't know the story name, so the wrapper sets it.
  let currentStory = '';
  const fitResults = new Map<string, FitResult>();
  const titles = new Map<string, string>();
  const { stages, logs } = createLiveStages({
    score: createSelectionStage({
      feeds: HELIOS_SOCIAL_FEEDS,
      jev,
      posted: createFilePosted(),
      fetchBody: fetchBodyLive,
      feedHealthLog: createFileFeedHealthLog(),
      onSelection: (s) => {
        selection = s;
      },
    }),
    create: liveMessagesCreate(new Anthropic()),
    jev,
    budget,
    readPage,
    isWellKnown: isWellKnownLive,
    hasPhoto: hasPhotoLive,
    fitCheck: async (post) => {
      const r = await checkRenderFit(post, { screenshotDir: shotDir, name: currentStory });
      fitResults.set(currentStory, r);
      return r;
    },
    now,
    usedLog,
    bank,
    reporterCapUsd: 0.45,
    maxReporterRuns: stories + 2,
    // Hook pass for this run only (--hook); its budget renders take no screenshots.
    ...(hookOn ? { hook: { fitCheck: checkRenderFit } } : {}),
  });
  const design = stages.design;
  stages.design = async (draft, brief, story) => {
    currentStory = toSlug(story.title).slice(0, 40);
    titles.set(story.id, currentStory);
    return design(draft, brief, story);
  };

  const result = await runDay({
    articles,
    stages,
    // The meter stops the day between stages at the full cap; only the Claude-call guard keeps a per-call reserve.
    meter: createCostMeter({ capUsd }),
    log: createFileSetAsideLog(),
    now,
    targetPosts: stories,
  });

  // 7-day rule: a photo counts as used once its post reaches the review queue (today: the preview).
  // A PREVIEW run doesn't count (Tommy, 2026-10-06: not the acceptance batch).
  if (!preview) await usedLog.record(result.posts.flatMap((p) => p.render.slides.flatMap((sl, i) => (sl.photoUrl ? [{ url: sl.photoUrl, usedAt: now.toISOString(), storyId: p.storyId, slide: i + 1 }] : []))));
  const starterShare = (() => {
    const all = result.posts.flatMap((p) => p.photos.filter((t) => t.photo));
    return all.length ? all.filter((t) => t.via === 'starter').length / all.length : 0;
  })();

  // ── Outputs ──────────────────────────────────────────────────────────
  const storyLogs = Object.fromEntries(logs);
  let n = 0;
  for (const [storyId, l] of logs) {
    n++;
    if (l.reporter?.ok) await fsp.writeFile(path.join(runDir, `brief-${n}.json`), JSON.stringify(l.reporter.brief, null, 2));
    if (l.reporter?.raw) await fsp.writeFile(path.join(runDir, `brief-${n}.raw.json`), l.reporter.raw);
    const post = result.posts.find((p) => p.storyId === storyId) ?? l.design;
    if (post) {
      const shipped = result.posts.some((p) => p.storyId === storyId);
      const slug = `checkpoint-${stamp.slice(0, 10)}-${n}`;
      if (shipped) await writeGeneratedPost(slug, post.render);
      await fsp.writeFile(path.join(runDir, `post-${n}.md`), readable(post, fitResults.get(titles.get(storyId) ?? ''), shipped ? slug : null));
    }
  }
  // Selection: the already-posted score for every candidate (Tommy, 2026-10-06; no threshold change).
  type Scored = { representative: { headline: string }; answers?: Record<string, number>; status?: string };
  const sel = selection as { scored?: Scored[] } | null;
  const alreadyPosted = (sel?.scored ?? [])
    .map((g) => ({ headline: g.representative.headline, score: g.answers?.already_posted ?? null, status: g.status ?? null }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  // M8 handoff criterion: the Writer's IMAGE request mix per post (after the Editor), and spreads.
  const requestMix = [...logs.entries()].map(([storyId, l]) => {
    const d = l.editor.at(-1)?.ok ? (l.editor.at(-1) as { draft: import('@/lib/social/writer/draft').DraftSubmission }).draft : null;
    if (!d) return { storyId, mix: null };
    const reqs = [d.cover_options[d.chosen_cover - 1]!.image, ...d.slides.map((s) => s.image)];
    const mix = Object.fromEntries(['subject', 'article', 'stock', 'none'].map((k) => [k, reqs.filter((r) => r.kind === k).length]));
    return { storyId, mix, spreads: d.slides.filter((s) => s.spread_with_next).length };
  });

  await fsp.writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify({ ...(preview ? { label: 'PREVIEW', note: 'Preview run, not the acceptance batch; the used-photo log was not written.' } : {}), hookPass: hookOn, startedAt: now.toISOString(), capUsd, alreadyPosted, requestMix, articles: articles.length, jev: jevTally, claudeUsd: budget.claudeUsd(), totalUsd: budget.spent(), result, selection, stories: storyLogs, fit: Object.fromEntries(fitResults) }, null, 2),
  );
  if (preview) await fsp.writeFile(path.join(runDir, 'preview-report.md'), previewReport());
  console.log(JSON.stringify({
    runDir: path.relative(process.cwd(), runDir),
    articles: articles.length,
    stopReason: result.stopReason,
    posts: result.posts.map((p) => p.title),
    setAsides: result.setAsides,
    freshDrafts: result.freshDrafts,
    costByStage: result.costByStage,
    totalUsd: Number(budget.spent().toFixed(4)),
    // Information only (Tommy, 2026-10-06).
    starterShare: Number(starterShare.toFixed(3)),
    // How often the 7-day rule gave way (Tommy, 2026-10-06).
    starterPoolExhausted: result.posts.flatMap((p) => p.photos).filter((t) => t.steps.some((x) => x.startsWith('starter-pool-exhausted'))).length,
    noTopicMatch: result.posts.flatMap((p) => p.photos).filter((t) => t.steps.some((x) => x.includes('no-topic-match'))).length,
    // Photo rule (Tommy, 2026-10-06): share of story slides with IMAGE none, and spreads used.
    textOnlyShare: (() => {
      const story = result.posts.flatMap((p) => p.photos.slice(1));
      return story.length ? Number((story.filter((t) => t.request.kind === 'none').length / story.length).toFixed(3)) : 0;
    })(),
    spreadCount: result.posts.flatMap((p) => p.render.slides).filter((sl) => sl.panoramaSide === 'left').length,
    requestMix,
    // IMAGE requests the Writer check turned to none on the final attempt (Tommy, 2026-10-07).
    imageRequestsDropped: [...logs.entries()].flatMap(([storyId, l]) => l.writer.flatMap((w) => (w.imageRequestsDropped ?? []).map((d) => `${storyId}: ${d}`))),
    // Aggregator-only facts the code removed before the Writer (Tommy, 2026-10-06).
    aggregatorDropped: [...logs.entries()].flatMap(([storyId, l]) => (l.reporter?.ok ? l.reporter.aggregatorDropped.map((d) => `${storyId}: ${d}`) : [])),
    alreadyPostedTop: alreadyPosted.slice(0, 5),
    capUsd,
  }, null, 2));

  /** Per post (PREVIEW): photo source and layout per slide, spreads, hook lines, Fact-checker flags, cost. */
  function previewReport(): string {
    const { layoutOf } = layoutRotation;
    let o = `# PREVIEW run ${stamp} (not the acceptance batch)\n\nHook pass: ${hookOn ? 'on (this run only)' : 'off'} · total $${budget.spent().toFixed(4)} of $${capUsd} · stop: ${result.stopReason}\n`;
    for (const sa of result.setAsides) o += `- Set aside: ${sa.storyId} at ${sa.stage}: ${sa.reasonCode} (${sa.detail.slice(0, 200)})\n`;
    for (const post of result.posts) {
      const l = logs.get(post.storyId)!;
      const source = (t: PostObject['photos'][number] | undefined) => {
        if (!t || !t.photo) return t?.via === 'none' ? 'none (IMAGE none)' : 'none (text-only: nothing usable)';
        return t.via === 'subject' ? 'subject' : t.via === 'article' ? 'article' : t.via === 'stock' ? 'stock' : t.via === 'starter' ? 'starter' : t.via === 'bank' ? 'bank' : String(t.via);
      };
      o += `\n## ${post.title}\n\nCost: $${post.costUsd.toFixed(4)} (by stage: ${post.stages.join(' → ')})\n\n| Slide | Layout | Photo source | Request | Vision $ |\n|---|---|---|---|---|\n`;
      post.render.slides.forEach((sl, i) => {
        const t = post.photos[i];
        o += `| ${i + 1} | ${layoutOf(sl)}${sl.panoramaSide ? ` (${sl.panoramaSide})` : ''} | ${sl.layoutVariant === 'follow' ? '—' : source(t)} | ${t ? `${t.request.kind}${t.request.value ? `: ${t.request.value.slice(0, 50)}` : ''}` : '—'} | ${t?.visionUsd ? t.visionUsd.toFixed(4) : '—'} |\n`;
      });
      const spreads = post.render.slides.filter((sl) => sl.panoramaSide === 'left').length;
      o += `\nSpreads: ${spreads}\n\nHook lines:\n`;
      const hk = l.hook?.at(-1);
      if (!hookOn) o += '- (Hook pass off)\n';
      else if (!hk?.ok) o += `- Hook pass failed: ${hk ? `${hk.reason} ${hk.detail}` : 'no result'}\n`;
      else {
        o += `- Budgets: ${hk.budgets.map((b, i) => `S${i + 2} ${b}`).join(' · ')}\n`;
        hk.hooks.forEach((h, i) => { if (h) o += `- S${i + 2} ${h.kind} [${h.facts.join(', ')}]: ${h.text}\n`; });
        for (const d of hk.dropped) o += `- ${d}\n`;
        if (!hk.hooks.some(Boolean)) o += '- (no lines added)\n';
      }
      o += '\nFact-checker flags:\n';
      const fcs = l.factCheck;
      if (!fcs.length) o += '- (none run)\n';
      fcs.forEach((fc, k) => {
        if (!fc.ok) { o += `- run ${k + 1}: failed (${fc.reason})\n`; return; }
        if (!fc.flags.flags.length) o += `- run ${k + 1}: none\n`;
        for (const f of fc.flags.flags) o += `- run ${k + 1}: ${f.where.part}${f.where.number ? ` ${f.where.number}` : ''} · type ${f.type} · ${f.fix.kind.toUpperCase()}${f.fix.replacement ? ` "${f.fix.replacement}"` : ''}: "${f.quoted_text}"\n`;
        if (fc.outcome.kind !== 'ok') o += `- run ${k + 1} outcome: ${fc.outcome.kind}: ${fc.outcome.why}\n`;
      });
    }
    return o;
  }

  function readable(post: PostObject, fit: FitResult | undefined, slug: string | null): string {
    const txt = (r: Array<{ text: string }> | undefined) => (r ?? []).map((s) => s.text).join('');
    const p = post.render;
    let o = `# ${post.title}\n\nSource: ${p.source} — ${p.sourceUrl}\n`;
    o += slug ? `Preview: /social/render/preview?generated=${slug}&all=1\n` : 'Not shipped (see run.json for why).\n';
    o += `Render fit: ${fit ? (fit.ok ? 'PASS' : `FAILED: ${[...fit.problems, ...fit.violations.map((v) => `slide ${v.slide} ${v.element} ${JSON.stringify(v.over)} "${v.text}"`)].join('; ')}`) : 'not run'}\n\n`;
    p.slides.forEach((s, i) => {
      o += `## Slide ${i + 1} · ${s.layoutVariant}${s.photoPlacement === 'top' ? ' (photo top)' : ''}\n`;
      if (s.headline) o += `- Headline: ${txt(s.headline)}\n`;
      if (s.title) o += `- Big number: ${txt(s.title)}${s.numberNote ? ` — ${s.numberNote}` : ''}\n`;
      if (s.secondNumber) o += `- Second number: ${s.secondNumber} — ${s.secondNote}\n`;
      if (s.quoteText) o += `- Quote: "${txt(s.quoteText)}" — ${s.quoteBy}\n`;
      if (s.body) o += `- Body: ${txt(s.body)}\n`;
      if (s.storySpecificLine) o += `- Follow line: ${s.storySpecificLine}\n`;
      const t = post.photos[i];
      if (t) {
        o += `- Image request: ${t.request.kind}: ${t.request.value}\n`;
        o += `- Photo: ${t.photo ? `${t.photo.url} (via ${t.via}${t.via !== t.request.kind ? ', fallback' : ''})\n- Credit: ${t.photo.credit}` : 'NONE'}\n`;
        if (t.identity) {
          const sc = t.identity.scores;
          o += `- Identity (${t.identity.subject}): ${t.identity.ok ? 'ok' : 'FAILED'} — ${t.identity.detail}${sc ? ` · is_person ${sc.person.toFixed(2)} · ${sc.matches.map((m) => `${m.id} ${m.p.toFixed(2)}`).join(', ')}` : ''}\n`;
        }
        o += `- Steps: ${t.steps.join(' → ')}\n`;
      }
      o += '\n';
    });
    return `${o}## Caption\n\n${p.caption}\n\n${p.attributionBlock ?? '(no photo credits)'}\n`;
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.stack : err);
    process.exit(1);
  },
);
