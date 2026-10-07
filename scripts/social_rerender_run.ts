/**
 * Helios Social — OFFLINE re-render of a daily run's posts under the current
 * rules: the saved final drafts and photo traces, re-applied without any AI
 * call or photo search. Story-slide starter photos are dropped (the starter
 * set is cover-only), and a cover starter photo is re-picked with the current
 * topic lists. Then the mechanical stage, the render adapter and the full
 * render check (text fit, bounds, contrast, faces, framing with the zoom cap,
 * C7) run, with screenshots.
 *
 *   npx tsx scripts/social_rerender_run.ts runs/daily-<ts>
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { checkDroppedText } from '@/lib/social/mechanical/checks';
import { createMechanicalStage } from '@/lib/social/pipeline/mechanical-stage';
import { pickCoverStarter } from '@/lib/social/photos/starter-set';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { toSlug, writeGeneratedPost } from '@/lib/social/render/local-store';
import { fillDraft } from '@/lib/social/writer/draft';

async function main() {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('usage: <runs/daily-dir>');
  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const out = path.join(runDir, `rerender-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  for (const [storyId, l] of Object.entries<any>(run.stories)) {
    if (!l.design) continue;
    const brief = l.reporter.brief;
    const sub = l.factCheck.at(-1).outcome.draft;
    const mech = await createMechanicalStage()({ storyId, submission: sub, filled: fillDraft(sub, brief) }, { storyId, parsed: brief, raw: '', pages: [] });
    const filled = mech.ok ? mech.value.filled : fillDraft(sub, brief);
    const traces = l.design.photos;
    const photos = traces.map((t: any, i: number) => {
      if (t.via !== 'starter') return t.photo;
      if (i > 0) return null; // story slide: text-only
      return pickCoverStarter(new Set()).photo;
    });
    const coverChange = photos[0]?.url !== traces[0].photo?.url ? `cover starter → ${photos[0]?.url}` : 'cover unchanged';
    const post = toRenderPost(filled, { cover: photos[0], slides: photos.slice(1) }, { source: brief.sources[0]?.outlet ?? '', sourceUrl: brief.sources[0]?.url ?? '', publishedAt: run.startedAt });
    const name = toSlug(filled.cover).slice(0, 40);
    const fit = await checkRenderFit(post, { screenshotDir: out, name });
    for (const f of fit.focus ?? []) if (f.focus && post.slides[f.slide - 1]?.photoUrl === f.photo) post.slides[f.slide - 1]!.photoFocus = f.focus;
    const c7 = checkDroppedText(filled, fit.slideText);
    await writeGeneratedPost(toSlug(`rerender-${name}`), post);
    const story = photos.slice(1);
    console.log(`\n${filled.cover}\n  ${coverChange}`);
    console.log(`  story slides with a photo: ${story.filter(Boolean).length} of ${story.length}`);
    console.log(`  mechanical: ${mech.ok ? `pass · warnings ${JSON.stringify(mech.value.mechanical!.warnings.map((w) => `${w.id} ${w.where}: ${w.detail}`))}` : `SET ASIDE ${mech.reasonCode}: ${mech.detail}`}`);
    console.log(`  render check: ${fit.ok ? 'PASS' : `FAILED ${JSON.stringify([...fit.problems, ...fit.violations.map((v) => v.element)])}`} · C7: ${c7.length ? 'FAILED' : 'PASS'}`);
    for (const f of fit.focus ?? []) if (f.faces.length) console.log(`  slide ${f.slide}: ${f.faces.length} face(s) → crop ${Math.round((f.focus?.x ?? 0.5) * 100)}% ${Math.round((f.focus?.y ?? 0.5) * 100)}%, face ${Math.round((f.focus?.faceShare ?? 0) * 100)}% of the window height${f.focus?.windowW ? `, window narrowed to ${f.focus.windowW}px` : ''}`);
  }
  console.log(`\nScreenshots: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
