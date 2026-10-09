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
 * could pass it. No Storage, no Instagram.
 *
 * Storage (spec 2026-10-08-social-storage.md): with DATABASE_URL set (and
 * SOCIAL_STORE not "file"), the used-photo log, posted stories, set-asides
 * and feed health live in the Postgres `social` schema, and the run and its
 * shipped posts are recorded there too. Otherwise the local files, as before.
 *
 *   npx tsx scripts/social_daily.ts --stories 2            (cap $2.00)
 *   npx tsx scripts/social_daily.ts --cap-usd 1.50 --stories 2
 *   npx tsx scripts/social_daily.ts --stories 3 --preview
 *   npx tsx scripts/social_daily.ts --stories 2 --preview --review   (the render review on; before/after under the run folder, render-review)
 *
 * The social worker passes --run-id for its queued runs, plus --rerun-post
 * <post id> for a one-story rerun (Social Hub Regenerate, D51): no feeds, no
 * selection, no Reporter; that post's story from its saved brief, Writer
 * onward, one post, under the same cap.
 *
 * The Hook pass is gone (Lucas 2026-10-08): the Writer writes the pull
 * itself. --preview: run.json is labelled PREVIEW (not an acceptance
 * batch), the used-photo log is not written (so the acceptance batch's
 * 7-day rule isn't spent on a preview), and preview-report.md lists per
 * post: photo source and layout per slide, spreads,
 * Fact-checker flags and cost.
 *
 * Writes runs/daily-<ts>/: run.json (selection, every stage's result,
 * costs), brief-<n>.json, post-<n>.md (text + photos + identity + fit),
 * screenshots/ (every rendered post, including ones that failed the fit
 * check); posts to exports/social/generated/ for the preview page; the
 * set-aside log in Claude outputs/.
 *
 * Photo bank (DECISIONS_LOG D49): with the Postgres store, the design stage
 * offers every vetted photo to the bank (media_library; nothing happens
 * while its `capture` switch is off) and the run drains the bank's queue for
 * up to 90 s before it exits. Preview runs store too; they just don't mark
 * anything used.
 */
import { promises as fsp } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// On the social worker VM the environment comes from systemd (worker.env); there is no .env.local.
try {
  process.loadEnvFile(path.join(process.cwd(), '.env.local'));
} catch (err) {
  if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
}

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
  // Diagnostic only: run just the Nth ranked story (1-based), so parallel
  // processes can each take a different story. Absent, the day runs as usual.
  const onlyRank = arg('--only-rank');
  if (onlyRank !== undefined && (!Number.isInteger(onlyRank) || onlyRank < 1)) throw new Error('--only-rank must be a positive integer');
  // The render review (photo spec §5b), fixes on, before/after saved (Tommy, 2026-10-07: the first end-to-end run is its calibration).
  const reviewOn = process.argv.includes('--review');
  const preview = process.argv.includes('--preview');
  // --run-id: the social worker's queued run (lib/social/overnight/runs.ts); its posts are `pipeline`.
  // A run started by hand is recorded as before and its posts are `dev`.
  const runIdArg = (() => {
    const i = process.argv.indexOf('--run-id');
    return i > 0 ? process.argv[i + 1] : undefined;
  })();
  if (runIdArg !== undefined && !/^[0-9a-f-]{36}$/i.test(runIdArg)) throw new Error('--run-id must be a run id');
  if (runIdArg && preview) throw new Error('--run-id runs are never previews');
  // --rerun-post: a queued one-story rerun (Social Hub Regenerate, D51): that post's story, from its saved brief.
  const rerunPostArg = (() => {
    const i = process.argv.indexOf('--rerun-post');
    return i > 0 ? process.argv[i + 1] : undefined;
  })();
  if (rerunPostArg !== undefined && (!runIdArg || !/^[0-9a-f-]{36}$/i.test(rerunPostArg))) throw new Error('--rerun-post needs a post id and a --run-id');

  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { HELIOS_SOCIAL_FEEDS } = await import('@/lib/social/feeds');
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { fetchBodyLive } = await import('@/lib/social/ingest/select/enrich');
  const { fetchFeeds } = await import('@/lib/social/ingest/select/feed-health');
  const { createSocialStore } = await import('@/lib/social/store');
  const { finishRun, insertRun, recordShipList, storedPostFor, storyOnCalendar, upsertPost } = await import('@/lib/social/store/pg');
  const { createCostMeter } = await import('@/lib/social/pipeline/cost-meter');
  const { createLiveStages, createRunBudget } = await import('@/lib/social/pipeline/live-stages');
  const { runDay } = await import('@/lib/social/pipeline/orchestrator');
  const { createSelectionStage } = await import('@/lib/social/pipeline/selection-stage');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { toSlug, writeGeneratedPost } = await import('@/lib/social/render/local-store');
  const { readPage } = await import('@/lib/social/reporter/read-page');
  const layoutRotation = await import('@/lib/social/render/layout-rotation');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
  const { isWellKnownLive } = await import('@/lib/social/writer/well-known');
  const { detectFacesLive } = await import('@/lib/social/photos/faces');
  const { createSecondPhotos } = await import('@/lib/social/photos/second-photo');
  const store = await createSocialStore();
  const usedLog = store.usedPhotos;
  const { createPhotoBank } = await import('@/lib/media-library/bank');
  const bank = store.query ? createPhotoBank({ query: store.query, log: (line) => console.log(`photo bank: ${line}`) }) : undefined;
  type Selection = import('@/lib/social/ingest/select/select').Selection;
  type FitResult = import('@/lib/social/render/fit-check').FitResult;
  type PostObject = import('@/lib/social/pipeline/types').PostObject;

  const now = new Date();
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  const runDir = path.join(process.cwd(), 'runs', `daily-${stamp}`);
  const shotDir = path.join(runDir, 'screenshots');
  await fsp.mkdir(runDir, { recursive: true });

  if (runIdArg && !store.query) throw new Error('--run-id needs the Postgres store (DATABASE_URL)');
  if (rerunPostArg && !store.query) throw new Error('--rerun-post needs the Postgres store (DATABASE_URL)');
  const rerunLib = rerunPostArg ? await import('@/lib/social/overnight/rerun') : null;
  const rerun = rerunPostArg && rerunLib ? await rerunLib.loadRerunStory(store.query!, rerunPostArg) : null;
  if (rerunPostArg && !rerun) throw new Error(`--rerun-post ${rerunPostArg}: no such post with a saved brief`);
  // A rerun reads no feeds: its one story is the stored post's.
  const articles = rerun ? [] : await fetchFeeds(HELIOS_SOCIAL_FEEDS);

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
      posted: store.posted,
      fetchBody: fetchBodyLive,
      feedHealthLog: store.feedHealth,
      onSelection: (s) => {
        selection = s;
      },
    }),
    create: liveMessagesCreate(newAnthropic()),
    jev,
    budget,
    readPage,
    isWellKnown: isWellKnownLive,
    // A caller's own screenshot place (the render review's before/after) wins; otherwise the run's screenshots.
    fitCheck: async (post, opts) => {
      if (opts?.screenshotDir) return checkRenderFit(post, opts);
      const r = await checkRenderFit(post, { screenshotDir: shotDir, name: currentStory });
      fitResults.set(currentStory, r);
      return r;
    },
    faces: detectFacesLive,
    secondPhotos: createSecondPhotos(),
    ...(reviewOn ? { renderReview: { dir: path.join(runDir, 'render-review') } } : {}),
    now,
    usedLog,
    ...(bank ? { bank } : {}),

    reporterCapUsd: 0.45,
    maxReporterRuns: stories + 2,
  });
  if (onlyRank !== undefined) {
    const score = stages.score;
    stages.score = async (articles, now) => {
      const res = await score(articles, now);
      if (!res.ok) return res;
      const one = res.value[onlyRank - 1];
      if (!one) {
        return { ok: false, reasonCode: 'service-error', detail: `--only-rank ${onlyRank} but selection returned ${res.value.length} stories`, costUsd: res.costUsd };
      }
      console.error(`[helios-social] only-rank ${onlyRank}: ${one.title}`);
      return { ...res, value: [one] };
    };
  }
  const design = stages.design;
  stages.design = async (draft, brief, story) => {
    currentStory = toSlug(story.title).slice(0, 40);
    titles.set(story.id, currentStory);
    return design(draft, brief, story);
  };

  const result = await runDay({
    articles,
    // A rerun: selection is the stored story and the Reporter's work its saved brief (no spend); the rest runs as usual.
    stages: rerun && rerunLib ? rerunLib.rerunStages(stages, rerun, rerunLib.rereadPages(rerun, readPage)) : stages,
    // The meter stops the day between stages at the full cap; only the Claude-call guard keeps a per-call reserve.
    meter: createCostMeter({ capUsd }),
    log: store.setAsides,
    now,
    targetPosts: rerun ? 1 : stories,
    // The worker's runs reuse a story's finished post instead of making it again (SH-60, P2-M4); a rerun makes it again on purpose.
    // A story whose post already holds a slot (a person placed it) is passed over: the daily fill counted it (D54).
    ...(runIdArg && store.query && !rerun
      ? { stored: (storyId: string) => storedPostFor(store.query!, storyId), onCalendar: (storyId: string) => storyOnCalendar(store.query!, storyId) }
      : {}),
  });

  // 7-day rule: a photo counts as used once its post reaches the review queue (today: the preview).
  // A PREVIEW run doesn't count (Tommy, 2026-10-06: not the acceptance batch).
  // Each entry carries its bank tags (photo spec §2): source, verified subject, credit, and a stock photo's scene.
  if (!preview) {
    await usedLog.record(result.posts.flatMap((p) => p.render.slides.flatMap((sl, i) => {
      if (!sl.photoUrl) return [];
      const t = p.photos.find((x) => x.photo?.url === sl.photoUrl);
      return [{ url: sl.photoUrl, usedAt: now.toISOString(), storyId: p.storyId, slide: i + 1, source: t?.photo?.source, qid: t?.photo?.qid ?? null, subject: t?.photo?.subject ?? null, credit: sl.photoCredit, ...(t?.photo?.source === 'stock' ? { scene: t.request.query } : {}) }];
    })));
  }
  const iconShare = (() => {
    const all = result.posts.flatMap((p) => p.photos);
    return all.length ? all.filter((t) => !t.photo).length / all.length : 0;
  })();

  // ── Outputs ──────────────────────────────────────────────────────────
  const storyLogs = Object.fromEntries(logs);
  // Shipped posts for the database: slug, brief and final draft (after the Hook pass and the Fact-checker).
  const shippedPosts: Array<{ slug: string; storyId: string; title: string; brief: unknown; draft: unknown; render: PostObject['render'] }> = [];
  let n = 0;
  for (const [storyId, l] of logs) {
    n++;
    if (l.reporter?.ok) await fsp.writeFile(path.join(runDir, `brief-${n}.json`), JSON.stringify(l.reporter.brief, null, 2));
    if (l.reporter?.raw) await fsp.writeFile(path.join(runDir, `brief-${n}.raw.json`), l.reporter.raw);
    const post = result.posts.find((p) => p.storyId === storyId) ?? l.design;
    if (post) {
      const shipped = result.posts.some((p) => p.storyId === storyId);
      // Unique per run (the old checkpoint-<date>-N let two runs on one day overwrite each other).
      const slug = `post-${stamp.toLowerCase()}-${n}`;
      if (shipped) {
        await writeGeneratedPost(slug, post.render);
        const finalDraft = (l.factCheck.at(-1) as { outcome?: { draft?: unknown } } | undefined)?.outcome?.draft ?? null;
        shippedPosts.push({ slug, storyId, title: post.title, brief: l.reporter?.ok ? l.reporter.brief : (rerun?.brief ?? null), draft: finalDraft, render: post.render });
      }
      await fsp.writeFile(path.join(runDir, `post-${n}.md`), readable(post, fitResults.get(titles.get(storyId) ?? ''), shipped ? slug : null));
    }
  }
  // Selection: the already-posted score for every candidate (Tommy, 2026-10-06; no threshold change).
  type Scored = { representative: { headline: string }; answers?: Record<string, number>; status?: string };
  const sel = selection as { scored?: Scored[] } | null;
  const alreadyPosted = (sel?.scored ?? [])
    .map((g) => ({ headline: g.representative.headline, score: g.answers?.already_posted ?? null, status: g.status ?? null }))
    .sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  // The Writer's visual request mix per post (after the Editor; photo spec §4, sixth round).
  const { VISUAL_KINDS } = await import('@/lib/social/writer/draft');
  const requestMix = [...logs.entries()].map(([storyId, l]) => {
    const d = l.editor.at(-1)?.ok ? (l.editor.at(-1) as { draft: import('@/lib/social/writer/draft').DraftSubmission }).draft : null;
    if (!d) return { storyId, mix: null };
    const reqs = [d.cover_options[d.chosen_cover - 1]!.visual, ...d.slides.map((s) => s.visual)];
    return { storyId, mix: Object.fromEntries(VISUAL_KINDS.map((k) => [k, reqs.filter((r) => r.kind === k).length])) };
  });

  await fsp.writeFile(
    path.join(runDir, 'run.json'),
    JSON.stringify({ ...(preview ? { label: 'PREVIEW', note: 'Preview run, not the acceptance batch; the used-photo log was not written.' } : {}), ...(rerun ? { rerunOf: rerun.postId } : {}), hookPass: false, startedAt: now.toISOString(), capUsd, alreadyPosted, requestMix, articles: articles.length, jev: jevTally, claudeUsd: budget.claudeUsd(), totalUsd: budget.spent(), result, selection, stories: storyLogs, fit: Object.fromEntries(fitResults) }, null, 2),
  );
  if (preview) await fsp.writeFile(path.join(runDir, 'preview-report.md'), previewReport());
  // The database record (spec 2026-10-08-social-storage.md): written after the files, so a database failure loses nothing.
  if (store.query) {
    try {
      const finished = {
        finishedAt: new Date().toISOString(), hookPass: false,
        claudeUsd: budget.claudeUsd(), totalUsd: budget.spent(), stopReason: result.stopReason ?? null,
        runDir: path.relative(process.cwd(), runDir), machine: os.hostname(),
        record: JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8')),
      };
      let runId: string;
      if (runIdArg) {
        await finishRun(store.query, runIdArg, { ...finished, status: result.shipped.length > 0 ? 'ok' : 'partial' });
        runId = runIdArg;
      } else {
        runId = await insertRun(store.query, { kind: preview ? 'preview' : 'daily', startedAt: now.toISOString(), capUsd, ...finished });
      }
      const newIds = new Map<string, string>();
      for (const p of shippedPosts) newIds.set(p.storyId, await upsertPost(store.query, { runId, ...p, status: preview ? 'preview' : 'review', origin: runIdArg ? 'pipeline' : 'dev' }));
      if (runIdArg) {
        const shipList = result.shipped.flatMap((e) => {
          const id = e.reusedPostId ?? newIds.get(e.storyId);
          return id ? [id] : [];
        });
        await recordShipList(store.query, runId, shipList);
      }
      const reusedCount = result.shipped.filter((e) => e.reusedPostId).length;
      console.log(`Database: run ${runId}, ${shippedPosts.length} post(s) in social.posts${reusedCount ? `, ${reusedCount} stored post(s) reused` : ''}`);
    } catch (err) {
      const text = `Database write failed (the run folder is complete): ${err instanceof Error ? err.message : String(err)}`;
      console.error(text);
      // A worker-queued run must not exit 0 still `running`: the worker then marks it
      // failed with an empty note, and the next click sits behind that dead row.
      if (runIdArg) throw new Error(text);
    }
  }
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
    iconShare: Number(iconShare.toFixed(3)),
    // How often the 7-day rule gave way (Tommy, 2026-10-06).
    starterPoolExhausted: result.posts.flatMap((p) => p.photos).filter((t) => t.steps.some((x) => x.startsWith('starter-pool-exhausted'))).length,
    // Share of story slides without a photo (Tommy, 2026-10-07: a photo on every slide), and spreads used.
    noPhotoShare: (() => {
      const story = result.posts.flatMap((p) => p.photos.slice(1));
      return story.length ? Number((story.filter((t) => !t.photo).length / story.length).toFixed(3)) : 0;
    })(),
    spreadCount: result.posts.flatMap((p) => p.render.slides).filter((sl) => sl.panoramaSide === 'left').length,
    requestMix,
    // Visual requests the Writer check replaced on the final attempt (Tommy, 2026-10-07).
    visualsDropped: [...logs.entries()].flatMap(([storyId, l]) => l.writer.flatMap((w) => (w.visualsDropped ?? []).map((d: string) => `${storyId}: ${d}`))),
    // Aggregator-only facts the code removed before the Writer (Tommy, 2026-10-06).
    aggregatorDropped: [...logs.entries()].flatMap(([storyId, l]) => (l.reporter?.ok ? l.reporter.aggregatorDropped.map((d) => `${storyId}: ${d}`) : [])),
    // Subject tags the edited words no longer name, removed right after the Editor (Tommy, 2026-10-07).
    tagsDroppedAfterEditor: [...logs.entries()].flatMap(([storyId, l]) => l.editor.flatMap((e) => (e.ok ? e.tagsDropped.map((d) => `${storyId}: ${d}`) : []))),
    // Quote speakers still missing from SUBJECTS after the Reporter's retry (Tommy, 2026-10-07).
    speakersNotInSubjects: [...logs.entries()].flatMap(([storyId, l]) => (l.reporter?.ok ? (l.reporter.speakersNotInSubjects ?? []).map((d) => `${storyId}: ${d}`) : [])),
    alreadyPostedTop: alreadyPosted.slice(0, 5),
    capUsd,
  }, null, 2));
  // The photo bank's queue (D49): at most 90 s; what isn't done stays in its outbox for the next run.
  await bank?.drain(90_000);

  /** Per post (PREVIEW): photo source and layout per slide, spreads, Fact-checker flags, cost. */
  function previewReport(): string {
    const { layoutOf } = layoutRotation;
    let o = `# PREVIEW run ${stamp} (not the acceptance batch)\n\nTotal $${budget.spent().toFixed(4)} of $${capUsd} · stop: ${result.stopReason}\n`;
    for (const sa of result.setAsides) o += `- Set aside: ${sa.storyId} at ${sa.stage}: ${sa.reasonCode} (${sa.detail.slice(0, 200)})\n`;
    for (const post of result.posts) {
      const l = logs.get(post.storyId)!;
      // The chain step that supplied the slide (photo spec §4).
      const source = (t: PostObject['photos'][number] | undefined) => {
        if (!t) return '—';
        if (t.via === 'icon') return `icon background (${t.icon ?? 'default'})`;
        if (t.via === 'type-led') return `type-led quote (${t.icon ?? 'default'})`;
        return String(t.via);
      };
      o += `\n## ${post.title}\n\nCost: $${post.costUsd.toFixed(4)} (by stage: ${post.stages.join(' → ')})\n\n| Slide | Layout | Photo source | Request | Vision $ |\n|---|---|---|---|---|\n`;
      post.render.slides.forEach((sl, i) => {
        const t = post.photos[i];
        o += `| ${i + 1} | ${layoutOf(sl)}${sl.panoramaSide ? ` (${sl.panoramaSide})` : ''} | ${sl.layoutVariant === 'follow' ? '—' : source(t)} | ${t ? `${t.request.kind}${t.request.query ? `: ${t.request.query.slice(0, 50)}` : ''}${t.tags?.length ? ` [${t.tags.join(', ')}]` : ''}` : '—'} | ${t?.visionUsd ? t.visionUsd.toFixed(4) : '—'} |\n`;
      });
      const spreads = post.render.slides.filter((sl) => sl.panoramaSide === 'left').length;
      // Jev's layout log: the spread decision and each slide's variant (slide buckets spec).
      const layoutLog = (post.checks as { layout?: string[] }).layout ?? [];
      o += `\nSpreads: ${spreads}\n\nLayout (Jev):\n${layoutLog.map((x) => `- ${x}`).join('\n') || '- (none logged)'}\n`;
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
        o += `- Visual request: ${t.request.kind}: ${t.request.query}\n`;
        o += `- Photo: ${t.photo ? `${t.photo.url} (via ${t.via})\n- Credit: ${t.photo.credit}` : 'NONE'}${t.tags?.length ? `\n- Tags: ${t.tags.join(', ')}` : ''}\n`;
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
