/**
 * Helios Social photo experiment (Lucas, 2026-10-08): one arm = one set of
 * photo settings (photos/tuning.ts), run on the SAME saved final drafts
 * (words and visual requests held constant), so arms differ only in the
 * photo technique. Re-runs the photo step and Jev's layout, renders, and
 * writes metrics.json + contact sheets for the arm.
 *
 *   npx tsx scripts/social_photo_experiment.ts --arm B --tuning '{"ladder":"deep"}' --out runs/photo-experiment-X \
 *     --cap-usd 0.30 runs/daily-<ts> runs/daily-<ts> …
 *
 * Costs: Wikidata, Commons, Openverse free; Jev a fraction of a cent; Claude
 * (sheet tags, close-up checks) a few cents, under --cap-usd.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};

async function main() {
  const arm = arg('--arm') ?? 'X';
  const tuningPatch = JSON.parse(arg('--tuning') ?? '{}');
  const outRoot = arg('--out') ?? `runs/photo-experiment-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  const capUsd = Number(arg('--cap-usd') ?? 0.3);
  const flags = new Set(['--arm', '--tuning', '--out', '--cap-usd']);
  const runDirs = process.argv.slice(2).filter((a, i, all) => !a.startsWith('--') && !flags.has(all[i - 1] ?? ''));

  const { setTuning } = await import('@/lib/social/photos/tuning');
  const tuning = setTuning(tuningPatch, true);
  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { photosForDraft } = await import('@/lib/social/photos/design');
  const { detectFacesLive } = await import('@/lib/social/photos/faces');
  const { createSecondPhotos } = await import('@/lib/social/photos/second-photo');
  const { createTagSheet } = await import('@/lib/social/photos/tag-sheet');
  const { createVisionCheck } = await import('@/lib/social/photos/vision');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { toRenderPost } = await import('@/lib/social/render/from-draft');
  const { chooseLayout } = await import('@/lib/social/render/layout');
  const { toSlug } = await import('@/lib/social/render/local-store');
  const { fillDraft } = await import('@/lib/social/writer/draft');
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');

  const jevTally = createJevTally();
  const jev = capped(tallied(createJevAsk(), jevTally), jevTally, capUsd);
  let claudeUsd = 0;
  const live = liveMessagesCreate(newAnthropic());
  const create: typeof live = async (params) => {
    if (claudeUsd + jevTally.costUsd + 0.007 > capUsd) throw new Error(`cap $${capUsd} reached`);
    return live(params);
  };
  const vision0 = createVisionCheck({ create });
  const tag0 = createTagSheet({ create });
  const vision: typeof vision0 = async (input) => { const r = await vision0(input); claudeUsd += r.costUsd; return r; };
  const tagSheet: typeof tag0 = async (png, n) => { const r = await tag0(png, n); claudeUsd += r.costUsd; return r; };

  const out = path.join(outRoot, arm);
  await fsp.mkdir(out, { recursive: true });
  const SUBJECT = new Set(['headshot', 'second', 'ceo', 'logo', 'hq']);
  const posts: unknown[] = [];
  for (const dir of runDirs) {
    const run = JSON.parse(await fsp.readFile(path.join(dir, 'run.json'), 'utf8'));
    for (const [storyId, l] of Object.entries<any>(run.stories)) {
      if (!l.design) continue;
      const brief = l.reporter.brief;
      const sub = structuredClone(l.factCheck.at(-1).outcome.draft);
      const filled = fillDraft(sub, brief);
      const storyDate = run.startedAt.slice(0, 10);
      const photos = await photosForDraft(filled, brief, l.reporter.pages ?? [], { jev, http: fetch, faces: detectFacesLive, secondPhotos: createSecondPhotos(), vision, tagSheet }, { storyDate });
      const layout = await chooseLayout(filled, photos, jev);
      const post = toRenderPost(filled, { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo), icons: [photos.cover, ...photos.slides].map((t) => t.icon) }, { source: brief.sources[0]?.outlet ?? '', sourceUrl: brief.sources[0]?.url ?? storyId, publishedAt: run.startedAt }, layout);
      const name = toSlug(filled.cover).slice(0, 40);
      const fit = await checkRenderFit(post, { screenshotDir: out, name });
      const traces = [photos.cover, ...photos.slides];
      const slides = traces.map((t, i) => {
        const check = t.steps.find((x) => x.startsWith('slide check'));
        const scored = check ? [...check.matchAll(/(\w[\w-]*) "([^"]*)" fit ([\d.]+) repeat ([\d.]+)(?: best ([\d.]+))?/g)].map((m) => ({ lane: m[1], title: m[2], fit: Number(m[3]), repeat: Number(m[4]), best: m[5] ? Number(m[5]) : null })) : [];
        const winner = t.photo as any;
        return {
          slide: i + 1,
          kind: i === 0 ? 'cover' : filled.slides[i - 1]!.type,
          headline: i === 0 ? filled.cover : filled.slides[i - 1]!.headline.text,
          request: `${t.request.kind}: ${t.request.query}`,
          photo: Boolean(winner),
          lane: winner ? t.via : null,
          subjectPhoto: winner ? SUBJECT.has(t.via) : false,
          title: winner?.title ?? winner?.credit ?? null,
          via: t.via,
          fromIconScene: t.steps.some((x) => x.startsWith('icon scene')) && Boolean(winner),
          fromLadder: t.steps.some((x) => x.startsWith('ladder →')) && Boolean(winner),
          tags: t.tags ?? [],
          scored,
          rejectedByJev: t.steps.filter((x) => /doesn't belong|reads as a repeat/.test(x)).length,
          rejectedByVision: t.steps.filter((x) => /^close-up .* → fail/.test(x)).length,
        };
      });
      posts.push({ story: filled.cover, run: path.basename(dir), contactSheet: `${name}-contact-sheet.png`, renderOk: fit.ok, spread: layout.spreadAt, spreadLog: layout.log.filter((x) => x.startsWith('spread')), slides });
      console.log(`[${arm}] ${filled.cover.slice(0, 60)}: ${slides.filter((s) => s.photo).length}/${slides.length} photos`);
    }
  }
  const all = (posts as Array<{ slides: Array<{ photo: boolean; subjectPhoto: boolean }>; spread: number | null }>);
  const slidesAll = all.flatMap((p) => p.slides);
  const summary = {
    arm,
    tuning,
    posts: all.length,
    slides: slidesAll.length,
    withPhoto: slidesAll.filter((s) => s.photo).length,
    coverage: Number((slidesAll.filter((s) => s.photo).length / slidesAll.length).toFixed(3)),
    subjectPhotos: slidesAll.filter((s) => s.subjectPhoto).length,
    spreads: all.filter((p) => p.spread !== null).length,
    costUsd: { jev: Number(jevTally.costUsd.toFixed(4)), claude: Number(claudeUsd.toFixed(4)) },
  };
  await fsp.writeFile(path.join(out, 'metrics.json'), JSON.stringify({ summary, posts }, null, 2));
  console.log(JSON.stringify(summary));
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
