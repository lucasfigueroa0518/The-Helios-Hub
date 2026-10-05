/**
 * Helios Social — LIVE basic photos (M5) on saved fact-checked drafts, then
 * the local preview post (M6). Tommy's OK required; --jev-cap-usd required.
 *
 * Live calls: Jev identity checks (one per subject, fractions of a cent),
 * and free public APIs: Wikidata, Wikidata query service, Commons,
 * Openverse. No Claude, no database, no Storage, no Instagram.
 *
 * Saved briefs carry no page-reader data, so article photos are checked
 * against the Reporter's ARTICLE PHOTOS copy (caption + credit).
 *
 *   npx tsx scripts/social_photos_run.ts --jev-cap-usd 0.01 <name>=<edit-check.json> …
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

process.loadEnvFile(path.join(process.cwd(), '.env.local'));

async function main() {
  const at = process.argv.indexOf('--jev-cap-usd');
  const cap = at > 0 ? Number(process.argv[at + 1]) : NaN;
  const inputs = process.argv.slice(2).filter((a) => a.includes('=')).map((a) => a.split('=') as [string, string]);
  if (!Number.isFinite(cap) || cap <= 0 || inputs.length === 0) throw new Error('usage: --jev-cap-usd <amount> <name>=<edit-check.json> …');

  const { createJevAsk, createJevTally, capped, tallied } = await import('@/lib/social/jev/client');
  const { validateBrief } = await import('@/lib/social/reporter/brief');
  const { fillDraft } = await import('@/lib/social/writer/draft');
  const { photosForDraft } = await import('@/lib/social/photos/design');
  const { toRenderPost } = await import('@/lib/social/render/from-draft');
  const { writeGeneratedPost, toSlug } = await import('@/lib/social/render/local-store');

  const tally = createJevTally();
  const jev = capped(tallied(createJevAsk(), tally), tally, cap);
  const dir = path.join(process.cwd(), 'runs', `photos-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  await fsp.mkdir(dir, { recursive: true });

  for (const [name, file] of inputs) {
    const saved = JSON.parse(await fsp.readFile(file, 'utf8'));
    if (!saved.final) {
      console.log(`${name}: no final draft (${saved.stop ?? 'unknown'}), skipped`);
      continue;
    }
    const brief = validateBrief(JSON.parse(await fsp.readFile(saved.brief, 'utf8')));
    const draft = fillDraft(saved.final, brief);
    const photos = await photosForDraft(draft, brief, [], { jev });
    const src = brief.sources[0];
    const post = toRenderPost(
      draft,
      { cover: photos.cover.photo, slides: photos.slides.map((t) => t.photo) },
      { source: src?.outlet ?? '', sourceUrl: src?.url ?? '', publishedAt: new Date().toISOString() },
    );
    const slug = toSlug(`photos-${name}`);
    await writeGeneratedPost(slug, post);
    await fsp.writeFile(path.join(dir, `${name}.json`), JSON.stringify({ draftFile: file, slug, photos }, null, 2));
    console.log(`\n${name} → /social/render/preview?generated=${slug}&all=1`);
    [photos.cover, ...photos.slides].forEach((t, i) => {
      console.log(`  ${i === 0 ? 'cover' : `slide ${i + 1}`} ${t.request.kind}: ${t.request.value}`);
      console.log(`    ${t.photo ? `${t.photo.source} · ${t.photo.credit}` : 'NO PHOTO'} | ${t.steps.join(' → ')}`);
    });
  }
  console.log(`\nJev: ${tally.calls} calls, $${tally.costUsd.toFixed(5)}. Log: ${dir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
