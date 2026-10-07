/**
 * Helios Social — OFFLINE re-render of the checkpoint posts (M8 acceptance):
 * the saved fact-checked drafts and their saved photo traces, through the
 * mechanical stage (fixes + text checks), the render adapter and the full
 * render check (text fit, bounds, contrast, faces, framing) plus C7.
 * No AI calls, no photo search; photos load from their saved URLs.
 *
 *   npx tsx scripts/social_rerender_checkpoint.ts runs/daily-<ts> runs/daily-<ts>/photos-rerun-<ts>
 */
import { existsSync, promises as fsp } from 'node:fs';
import path from 'node:path';

import { checkDroppedText } from '@/lib/social/mechanical/checks';
import { createMechanicalStage } from '@/lib/social/pipeline/mechanical-stage';
import { pickCoverStarter } from '@/lib/social/photos/starter-set';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { toSlug, writeGeneratedPost } from '@/lib/social/render/local-store';
import { fillDraft } from '@/lib/social/writer/draft';

async function main() {
  const [runDir, photoDir] = process.argv.slice(2);
  if (!runDir || !photoDir) throw new Error('usage: <runs/daily-dir> <photos-rerun-dir>');
  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const traces = await Promise.all((await fsp.readdir(photoDir)).filter((f) => f.endsWith('.json')).map(async (f) => JSON.parse(await fsp.readFile(path.join(photoDir, f), 'utf8'))));
  const out = path.join(photoDir, `m8-render-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  for (const [storyId, l] of Object.entries<any>(run.stories)) {
    const t = traces.find((x) => x.storyId === storyId);
    const fc = l.factCheck.at(-1);
    if (!t || !fc?.ok || fc.outcome.kind !== 'ok') continue;
    const brief = l.reporter.brief;
    const sub = fc.outcome.draft;
    const name = toSlug(fillDraft(sub, brief).cover).slice(0, 40);
    const mech = await createMechanicalStage()({ storyId, submission: sub, filled: fillDraft(sub, brief) }, { storyId, parsed: brief, raw: '', pages: [] });
    const filled = mech.ok ? mech.value.filled : fillDraft(sub, brief);
    // Saved traces may point at starter photos since removed: swap in the next eligible one, as the chain's last step would.
    const avoid = new Set<string>();
    const photos = [t.photos.cover, ...t.photos.slides].map((x: any, i: number) => {
      const p = x.photo;
      // The daily run's rule (spec §5.1 Photo chain v1): starter photos are for the cover only, AI-compute set.
      if (i > 0 && p?.url?.startsWith('/social/starter/')) return null;
      if (p?.url?.startsWith('/social/starter/') && !existsSync(path.join('public', p.url))) {
        const next = pickCoverStarter(new Set([...avoid, ...[t.photos.cover, ...t.photos.slides].map((y: any) => y.photo?.url)])).photo;
        console.log(`  (starter photo ${p.url} was removed; using ${next.url})`);
        avoid.add(next.url);
        return next;
      }
      return p;
    });
    const post = toRenderPost(filled, { cover: photos[0], slides: photos.slice(1) }, { source: brief.sources[0]?.outlet ?? '', sourceUrl: brief.sources[0]?.url ?? '', publishedAt: run.startedAt });
    const fit = await checkRenderFit(post, { screenshotDir: out, name });
    for (const f of fit.focus ?? []) if (f.focus && post.slides[f.slide - 1]?.photoUrl === f.photo) post.slides[f.slide - 1]!.photoFocus = f.focus;
    const c7 = checkDroppedText(filled, fit.slideText);
    await writeGeneratedPost(toSlug(`m8-${name}`), post);
    console.log(`\n${filled.cover}`);
    console.log(`  mechanical: ${mech.ok ? `pass · warnings ${mech.value.mechanical!.warnings.length}` : `WOULD SET ASIDE (${mech.reasonCode}: ${mech.detail})`}`);
    console.log(`  render check: ${fit.ok ? 'PASS' : 'FAILED'} · C7: ${c7.length ? 'FAILED' : 'PASS'}`);
    for (const v of fit.violations) console.log(`    bounds slide ${v.slide} ${v.element} ${JSON.stringify(v.over)} "${v.text}"`);
    for (const p of fit.problems) console.log(`    ${p}`);
    for (const f of c7) console.log(`    C7 ${f.where}: ${f.detail}`);
    for (const f of fit.focus ?? []) console.log(`    slide ${f.slide} [${f.kind}] faces ${f.faces.length}${f.focus ? ` → crop ${Math.round(f.focus.x * 100)}% ${Math.round(f.focus.y * 100)}%` : ''}`);
  }
  console.log(`\nScreenshots: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
