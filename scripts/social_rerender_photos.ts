/**
 * Helios Social: re-run the photo step and Jev's layout on a saved daily
 * run's final drafts (photo spec §4 and the slide buckets spec, sixth round)
 * and re-render, without the Writer, Editor or Fact-checker. Words never
 * change. Used to judge the photo and layout changes on posts Tommy has seen.
 *
 * Saved drafts that predate the visual requests are converted: a subject
 * IMAGE becomes person: or company: (by the subject's type), a stock scene
 * becomes thematic:, and every fallback (and article/none requests) becomes
 * the post's --concept scene. Old slide types fold into text, stat and quote.
 *
 *   npx tsx scripts/social_rerender_photos.ts runs/daily-<ts> \
 *     --concept 1="data center" --concept 2="smartphone screen" [--vision] [--cap-usd 0.05]
 *
 * Costs: Wikidata, Commons and Openverse are free; Jev (identity, pre-screen,
 * headquarters, fit, layout) is a fraction of a cent. --vision turns on the
 * Claude calls (the sheet tags and the close-up checks), under --cap-usd
 * (default $0.05, the pre-approved re-run limit); without it, no tags, no
 * fit check, no close-up check, and the report says so.
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

type OldImage = { kind: string; value: string };

async function main() {
  const runDir = process.argv[2];
  if (!runDir || runDir.startsWith('--')) throw new Error('usage: <runs/daily-dir> [--concept N="scene"] [--vision] [--cap-usd 0.05]');
  const many = (name: string) => process.argv.flatMap((a, i) => (a === name ? [process.argv[i + 1]!] : []));
  const capArg = process.argv.indexOf('--cap-usd');
  const capUsd = capArg > 0 ? Number(process.argv[capArg + 1]) : 0.05;
  const claudeOn = process.argv.includes('--vision');
  const concepts = new Map(many('--concept').map((v) => { const [n, scene] = v.split('='); return [Number(n), scene!.replace(/^"|"$/g, '')]; }));

  const { capped, createJevAsk, createJevTally, tallied } = await import('@/lib/social/jev/client');
  const { photosForDraft } = await import('@/lib/social/photos/design');
  const { detectFacesLive } = await import('@/lib/social/photos/faces');
  const { createSecondPhotos } = await import('@/lib/social/photos/second-photo');
  const { createTagSheet } = await import('@/lib/social/photos/tag-sheet');
  const { createVisionCheck } = await import('@/lib/social/photos/vision');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { toRenderPost } = await import('@/lib/social/render/from-draft');
  const { chooseLayout } = await import('@/lib/social/render/layout');
  const { layoutOf } = await import('@/lib/social/render/layout-rotation');
  const { toSlug, writeGeneratedPost } = await import('@/lib/social/render/local-store');
  const { fillDraft } = await import('@/lib/social/writer/draft');
  type Visual = import('@/lib/social/writer/draft').VisualRequest;
  type Brief = import('@/lib/social/reporter/brief').Brief;

  const jevTally = createJevTally();
  const jev = capped(tallied(createJevAsk(), jevTally), jevTally, capUsd);
  let claudeUsd = 0;
  const claude = claudeOn
    ? await (async () => {
        const { newAnthropic } = await import('@/lib/anthropic-client');
        const { liveMessagesCreate } = await import('@/lib/social/reporter/reporter');
        const live = liveMessagesCreate(newAnthropic());
        // Room for one more call (about $0.003–0.006) or none: the cap is never passed.
        const create: typeof live = async (params) => {
          if (claudeUsd + jevTally.costUsd + 0.007 > capUsd) throw new Error(`cap $${capUsd} reached`);
          return live(params);
        };
        const vision = createVisionCheck({ create });
        const tagSheet = createTagSheet({ create });
        return {
          vision: (async (input) => { const r = await vision(input); claudeUsd += r.costUsd; return r; }) as typeof vision,
          tagSheet: (async (png, n) => { const r = await tagSheet(png, n); claudeUsd += r.costUsd; return r; }) as typeof tagSheet,
        };
      })()
    : undefined;

  /** An old IMAGE request as a visual request (null: none or an article URL). */
  const toVisual = (img: OldImage | undefined, brief: Brief): Visual | null => {
    if (!img || !img.value) return null;
    if (img.kind === 'subject') return { kind: brief.subjects.find((s) => s.name === img.value)?.type === 'person' ? 'person' : 'company', query: img.value };
    if (img.kind === 'stock') return { kind: 'thematic', query: img.value };
    return null;
  };

  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const out = path.join(runDir, `rerender-photos-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(out, { recursive: true });
  let report = `# Photo + layout re-render of ${path.basename(runDir)} (sixth round)\n\nWords unchanged (the saved final drafts). Claude calls (sheet tags, close-up checks): ${claudeOn ? 'on' : 'OFF (no tags, no fit check, no close-up check)'}.\n`;
  let n = 0;
  for (const [storyId, l] of Object.entries<any>(run.stories)) {
    if (!l.design) continue;
    n++;
    const brief: Brief = l.reporter.brief;
    const sub = structuredClone(l.factCheck.at(-1).outcome.draft);
    const concept: Visual = { kind: 'thematic', query: concepts.get(n) ?? sub.concept ?? 'office building' };
    const convert = (x: any) => {
      if (!x.visual) {
        x.visual = toVisual(x.image, brief) ?? concept;
        x.fallback_visual = x.visual.query === concept.query ? { kind: 'setting', query: 'modern office' } : concept;
      }
      delete x.image;
    };
    sub.cover_options.forEach(convert);
    for (const s of sub.slides) {
      convert(s);
      if (s.type === 'split_stat') s.type = 'stat';
      if (s.type === 'landing' || s.type === 'image') s.type = 'text';
      delete s.spread_with_next;
    }
    delete sub.concept;
    const filled = fillDraft(sub, brief);
    const pages = l.reporter.pages ?? [];
    const storyDate = (run.selection?.winners ?? []).find((w: any) => w.id === storyId || w.representative?.url === storyId)?.publishedAt?.slice(0, 10) ?? run.startedAt.slice(0, 10);
    const photos = await photosForDraft(filled, brief, pages, { jev, http: fetch, faces: detectFacesLive, secondPhotos: createSecondPhotos(), ...(claude ?? {}) }, { storyDate });
    const layout = await chooseLayout(filled, photos, jev);
    const post = toRenderPost(filled, { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo), icons: [photos.cover, ...photos.slides].map((t) => t.icon) }, { source: brief.sources[0]?.outlet ?? '', sourceUrl: brief.sources[0]?.url ?? storyId, publishedAt: run.startedAt }, layout);
    const name = toSlug(filled.cover).slice(0, 40);
    const fit = await checkRenderFit(post, { screenshotDir: out, name });
    for (const f of fit.focus ?? []) if (f.focus && post.slides[f.slide - 1]?.photoUrl === f.photo) post.slides[f.slide - 1]!.photoFocus = f.focus;
    await writeGeneratedPost(toSlug(`rerender-photos-${name}`), post);
    const traces = [photos.cover, ...photos.slides];
    report += `\n## ${filled.cover}\n\nRender check: ${fit.ok ? 'PASS' : `FAILED ${JSON.stringify(fit.problems)}`} · contact sheet: \`${name}-contact-sheet.png\`\n\n| Slide | Template | Layout | Photo | Request | Tags |\n|---|---|---|---|---|---|\n`;
    post.slides.forEach((sl, i) => {
      const t = traces[i];
      report += `| ${i + 1} | ${sl.template ?? '—'} | ${layoutOf(sl)}${sl.panoramaSide ? ` (spread ${sl.panoramaSide})` : ''} | ${t ? (t.photo ? `${t.via}: ${(t.photo.subject ?? t.photo.credit).slice(0, 50)}` : t.via) : '—'} | ${t ? `${t.request.kind}: ${t.request.query.slice(0, 40)}` : '—'} | ${t?.tags?.join(', ') ?? '—'} |\n`;
    });
    report += `\nLayout (Jev):\n${layout.log.map((x) => `- ${x}`).join('\n')}\n\n<details><summary>Photo steps</summary>\n\n${traces.map((t, i) => `- **${i + 1}** ${t.steps.join(' → ')}`).join('\n')}\n\n</details>\n`;
  }
  report += `\nCost: Jev $${jevTally.costUsd.toFixed(4)} (${jevTally.calls} calls) · Claude (tags + close-ups) $${claudeUsd.toFixed(4)} · total $${(jevTally.costUsd + claudeUsd).toFixed(4)} of $${capUsd}\n`;
  await fsp.writeFile(path.join(out, 'report.md'), report);
  console.log(report.replace(/<details>[\s\S]*?<\/details>/g, ''));
  console.log(`\nScreenshots and report: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
