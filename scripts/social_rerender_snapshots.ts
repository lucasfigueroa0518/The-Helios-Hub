/**
 * Helios Social — re-render saved photo-run snapshots offline (plan M6).
 * No network, no models: reuses the saved drafts and photo traces. A slide
 * the live run left empty goes to the last chain step, the offline starter
 * set, exactly as the chain now does when every online step fails. Then
 * the render adapter (with layout rotation) writes the preview posts, and
 * the render-fit check measures every slide and writes screenshots to
 * <run dir>/screenshots. A post that doesn't fit is reported as FAILED.
 *
 *   npx tsx scripts/social_rerender_snapshots.ts runs/photos-<ts> <name> …
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import type { PhotoTrace } from '@/lib/social/photos/find';
import { pickCoverStarter } from '@/lib/social/photos/starter-set';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import { draftSlides, toRenderPost } from '@/lib/social/render/from-draft';
import { rotateLayouts } from '@/lib/social/render/layout-rotation';
import { toSlug, writeGeneratedPost } from '@/lib/social/render/local-store';
import { validateBrief } from '@/lib/social/reporter/brief';
import { fillDraft } from '@/lib/social/writer/draft';

async function main() {
  const [runDir, ...names] = process.argv.slice(2);
  if (!runDir || names.length === 0) throw new Error('usage: <runs/photos-dir> <name> …');
  for (const name of names) {
    const log = JSON.parse(await fsp.readFile(path.join(runDir, `${name}.json`), 'utf8')) as { draftFile: string; photos: { cover: PhotoTrace; slides: PhotoTrace[] } };
    const saved = JSON.parse(await fsp.readFile(log.draftFile, 'utf8'));
    const brief = validateBrief(JSON.parse(await fsp.readFile(saved.brief, 'utf8')));
    const draft = fillDraft(saved.final, brief);
    const traces = [log.photos.cover, ...log.photos.slides];
    const used = new Set(traces.flatMap((t) => (t.photo ? [t.photo.url] : [])));
    for (const [i, t] of traces.entries()) {
      // Logs written before photos carried `subject`: take it from the identity check that verified the photo.
      if (t.photo && t.photo.subject === undefined) t.photo.subject = t.photo.qid && t.identity?.ok ? t.identity.subject : null;
      // The daily run's rule (spec §5.1 Photo chain v1): only the cover gets a starter photo (AI-compute set); story slides stay text-only.
      if (t.photo || i > 0) continue;
      const p = pickCoverStarter(used).photo;
      used.add(p.url);
      t.photo = p;
      t.via = 'starter';
      t.steps.push(`starter set (offline re-render): ${p.url}`);
    }
    const src = brief.sources[0];
    const meta = { source: src?.outlet ?? '', sourceUrl: src?.url ?? '', publishedAt: new Date().toISOString() };
    const photos = { cover: traces[0]!.photo, slides: traces.slice(1).map((t) => t.photo) };
    const post = toRenderPost(draft, photos, meta);
    const rotation = rotateLayouts(draftSlides(draft, photos));
    await writeGeneratedPost(toSlug(`photos-${name}`), post);
    await fsp.writeFile(path.join(runDir, `${name}.rerender.json`), JSON.stringify({ ...log, photos: { cover: traces[0], slides: traces.slice(1) } }, null, 2));

    console.log(`\n${name} → /social/render/preview?generated=photos-${name}&all=1`);
    post.slides.forEach((s, i) => {
      const t = traces[i];
      console.log(`  ${i + 1}. ${s.layoutVariant}${s.photoPlacement === 'top' ? ' (photo top)' : ''} · ${t ? `${t.via ?? 'NONE'} · ${t.photo?.credit ?? 'no photo'}` : '-'}`);
    });
    const fit = await checkRenderFit(post, { screenshotDir: path.join(runDir, 'screenshots'), name });
    console.log(`  render fit: ${fit.ok ? 'PASS' : 'FAILED'}`);
    for (const p of fit.problems) console.log(`    problem: ${p}`);
    for (const v of fit.violations) console.log(`    slide ${v.slide} ${v.element} outside by ${JSON.stringify(v.over)}: "${v.text}"`);
    console.log(`  rotation: ${rotation.changes.join('; ') || 'no changes'}${rotation.unresolved.length ? ` · UNRESOLVED: ${rotation.unresolved.join('; ')}` : ''}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
