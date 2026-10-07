/**
 * Re-render a saved daily run under Photo chain v1 (spec §5.1) from saved
 * data, with NO AI calls:
 *   - covers: recomputed through the v1 cover chain (article → person's P18
 *     → logo card → stock → starter). Jev is unavailable (any call throws);
 *     identities come from verified results already saved in earlier runs
 *     (identity ok: Q… lines in runs/*). Logos and P18 come from Wikidata /
 *     Commons (network, no AI). The stock step returns nothing here (its
 *     pre-screen and vision check are AI); the saved run's covers had no
 *     stock photo either.
 *   - story slides: the saved results, except stock picks, which come from
 *     the accepted (frozen) stock link's outcome for the same request
 *     (fixtures/social/photo-bench), so a pick made before a fix doesn't
 *     survive; stat slides on their v1 background: plain dark until Tommy
 *     approves the designed set.
 * Then the render check with screenshots. Nothing is written to the
 * used-photo log.
 *
 *   npx tsx scripts/social_rerender_chain_v1.ts runs/daily-<ts>
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { findPhoto, newPhotoContext } from '@/lib/social/photos/find';
import type { IdentityResult } from '@/lib/social/photos/identity';
import { checkRenderFit } from '@/lib/social/render/fit-check';
import { photoKindOf, LOGO_WIDE_ASPECT } from '@/lib/social/render/from-draft';
import { toSlug, writeGeneratedPost } from '@/lib/social/render/local-store';
import type { Post } from '@/lib/social/render/types';

/** Verified identities already saved in earlier runs (trace steps "identity ok: Q… "Label" (type, via)"). */
async function savedIdentities(): Promise<Map<string, IdentityResult>> {
  const out = new Map<string, IdentityResult>();
  const re = /identity ok: (Q\d+) "([^"]+)" \((organization|person), (resolver|jev-pick)\)/g;
  for (const dir of await fsp.readdir('runs')) {
    for (const f of ['run.json', 'bench.json']) {
      const text = await fsp.readFile(path.join('runs', dir, f), 'utf8').catch(() => '');
      for (const m of text.replaceAll('\\"', '"').matchAll(re)) {
        out.set(m[2]!, { ok: true, scores: { person: 0, matches: [] }, qid: m[1]!, label: m[2]!, description: '', type: m[3] as 'organization' | 'person', via: m[4] as 'resolver' | 'jev-pick' });
      }
    }
  }
  return out;
}

async function main() {
  const runDir = process.argv[2];
  if (!runDir) throw new Error('usage: <runs/daily-dir>');
  const run = JSON.parse(await fsp.readFile(path.join(runDir, 'run.json'), 'utf8'));
  const out = path.join(runDir, `rerender-chain-v1-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  const known = await savedIdentities();
  const bench = JSON.parse(await fsp.readFile('fixtures/social/photo-bench/requests.json', 'utf8'));
  const accepted = new Map<string, { outcome: string }>((JSON.parse(await fsp.readFile('fixtures/social/photo-bench/accepted-stock.json', 'utf8')).requests as Array<{ id: string; outcome: string }>).map((a) => [a.id, a]));
  const noAi = (async () => { throw new Error('no AI calls in this re-render'); }) as never;
  const used = new Set<string>();

  for (const p of run.result.posts) {
    const story = run.stories[p.storyId];
    const brief = story.reporter.brief;
    const pages = story.reporter.pages ?? [];
    const post: Post = structuredClone(p.render);
    const ctx = newPhotoContext(brief, pages, { recent: used });
    // Seed identities for this story's SUBJECTS from saved verified results (matched by exact name).
    for (const s of brief.subjects) {
      const id = known.get(s.name);
      if (id) ctx.identities.set(s.name, Promise.resolve(id));
    }
    const coverTrace = p.photos[0];
    // No AI: the stock step finds nothing (the saved run's covers had no stock photo either).
    const t = await findPhoto(coverTrace.request, ctx, { jev: noAi, stock: async () => [] }, { text: [p.title], speaker: null, slot: 'split', cover: true });
    const cover = post.slides[0]!;
    for (const k of ['photoUrl', 'photoCredit', 'photoKind', 'photoFocus', 'logoPlate', 'logoWide', 'coverCard'] as const) delete cover[k];
    if (t.photo) {
      Object.assign(cover, { photoUrl: t.photo.url, photoCredit: t.photo.credit, photoKind: photoKindOf(t.photo) });
      if (t.photo.plate) cover.logoPlate = t.photo.plate;
      if (t.photo.source === 'logo' && t.photo.width && t.photo.height && t.photo.width / t.photo.height > LOGO_WIDE_ASPECT) cover.logoWide = true;
      used.add(t.photo.url);
    }
    // Story-slide stock picks: what the accepted (frozen) stock link picks for this exact request
    // (fixtures/social/photo-bench: same story, same request), not the saved pick, which may predate a fix.
    const kept: string[] = [];
    for (const [i, tr] of p.photos.slice(1).entries()) {
      if (tr.request.kind !== 'stock') continue;
      const r = bench.requests.find((x: any) => x.story === p.storyId && x.request.kind === 'stock' && x.request.value === tr.request.value);
      const a = r ? accepted.get(r.id) : undefined;
      if (!a) continue;
      const sl = post.slides[i + 1]!;
      if (a.outcome === 'no stock photo' && sl.photoUrl) {
        kept.push(`slide ${i + 2}: saved stock pick ${sl.photoUrl.split('/').pop()?.slice(0, 40)} → none (accepted stock link, ${r.id})`);
        for (const k of ['photoUrl', 'photoCredit', 'photoKind', 'photoFocus'] as const) delete sl[k];
      } else {
        kept.push(`slide ${i + 2}: stock as accepted (${r.id}: ${a.outcome === 'no stock photo' ? 'none' : a.outcome.split('/').pop()?.slice(0, 40)})`);
      }
    }
    // Stat slides: plain dark until the designed backgrounds are approved.
    for (const sl of post.slides) {
      if (sl.layoutVariant === 'stat' || sl.layoutVariant === 'split_stat') {
        for (const k of ['photoUrl', 'photoCredit', 'photoKind', 'photoFocus'] as const) delete sl[k];
      }
    }
    const name = toSlug(p.title).slice(0, 40);
    const fit = await checkRenderFit(post, { screenshotDir: out, name });
    for (const f of fit.focus ?? []) if (f.focus && post.slides[f.slide - 1]?.photoUrl === f.photo) post.slides[f.slide - 1]!.photoFocus = f.focus;
    const slug = toSlug(`v1-${name}`);
    await writeGeneratedPost(slug, post);
    console.log(`\n${p.title}`);
    console.log(`  cover: was ${coverTrace.via} (${coverTrace.photo?.url?.split('/').pop() ?? 'none'}) → now ${t.via}${t.photo ? ` (${t.photo.url.split('/').pop()})` : ''}`);
    for (const s of t.steps) console.log(`    ${s}`);
    for (const k of kept) console.log(`  ${k}`);
    console.log(`  stat slides: ${post.slides.filter((sl) => sl.layoutVariant === 'stat' || sl.layoutVariant === 'split_stat').length} on plain dark (designed backgrounds not approved yet)`);
    console.log(`  render check: ${fit.ok ? 'PASS' : `FAILED ${JSON.stringify([...fit.problems, ...fit.violations.map((v) => `slide ${v.slide} ${v.element}`)])}`}`);
    console.log(`  preview: http://localhost:3000/social/render/preview?generated=${slug}&all=1`);
  }
  console.log(`\nScreenshots: ${out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
