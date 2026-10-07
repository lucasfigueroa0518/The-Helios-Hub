/**
 * Helios Social — LIVE re-run of the photo step only, on the fact-checked
 * drafts saved by a daily run (runs/daily-<ts>/run.json). Jev identity
 * checks (--jev-cap-usd required) + free Wikidata / Commons / Openverse.
 * No Claude. Renders each post (render-fit check + screenshots) and writes
 * a per-slide photo report.
 *
 *   npx tsx scripts/social_checkpoint_photos.ts --jev-cap-usd 0.01 runs/daily-<ts>
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const at = process.argv.indexOf('--jev-cap-usd');
  const cap = at > 0 ? Number(process.argv[at + 1]) : NaN;
  const runDir = process.argv.slice(2).find((a, i, all) => !a.startsWith('--') && all[i - 1] !== '--jev-cap-usd');
  if (!Number.isFinite(cap) || cap <= 0 || !runDir) throw new Error('usage: --jev-cap-usd <amount> <runs/daily-dir>');

  const { createJevAsk, createJevTally, capped, tallied } = await import('@/lib/social/jev/client');
  const { fillDraft } = await import('@/lib/social/writer/draft');
  const { photosForDraft } = await import('@/lib/social/photos/design');
  const { toRenderPost } = await import('@/lib/social/render/from-draft');
  const { checkRenderFit } = await import('@/lib/social/render/fit-check');
  const { toSlug, writeGeneratedPost } = await import('@/lib/social/render/local-store');

  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, cap);
  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const outDir = path.join(runDir, `photos-rerun-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(outDir, { recursive: true });

  for (const [storyId, l] of Object.entries<any>(run.stories)) {
    const fc = l.factCheck.at(-1);
    if (!l.reporter?.ok || !fc?.ok || fc.outcome.kind !== 'ok') continue;
    const brief = l.reporter.brief;
    const draft = fillDraft(fc.outcome.draft, brief);
    const photos = await photosForDraft(draft, brief, l.reporter.pages ?? [], { jev });
    const src = brief.sources[0];
    const post = toRenderPost(draft, { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo) }, { source: src?.outlet ?? '', sourceUrl: src?.url ?? storyId, publishedAt: run.startedAt });
    const name = toSlug(draft.cover).slice(0, 40);
    const fit = await checkRenderFit(post, { screenshotDir: path.join(outDir, 'screenshots'), name });
    await writeGeneratedPost(toSlug(`rerun-${name}`), post);
    await fsp.writeFile(path.join(outDir, `${name}.json`), JSON.stringify({ storyId, photos, fit }, null, 2));
    console.log(`\n${draft.cover}\n  render fit: ${fit.ok ? 'PASS' : `FAILED (${fit.violations.length} elements; ${fit.problems.join('; ')})`}`);
    [photos.cover, ...photos.slides].forEach((t, i) => {
      const id = t.identity ? ` · identity ${t.identity.subject}: ${t.identity.ok ? 'ok' : 'FAILED'} (${t.identity.detail}${t.identity.scores ? `; ${t.identity.scores.matches.map((m) => `${m.id} ${m.p.toFixed(2)}`).join(', ')}` : ''})` : '';
      console.log(`  ${i === 0 ? 'cover' : `slide ${i + 1}`} [${post.slides[i]?.layoutVariant}] ${t.request.kind}: "${t.request.value}" → ${t.via} · ${t.photo?.credit ?? 'none'}${id}`);
      console.log(`      ${t.steps.join(' → ')}`);
    });
  }
  console.log(`\nJev: ${tally.calls} calls, $${tally.costUsd.toFixed(5)}. Out: ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
