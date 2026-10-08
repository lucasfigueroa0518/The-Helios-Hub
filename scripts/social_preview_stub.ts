/**
 * Helios Social — offline stub post for the local preview (plan M6).
 * No network, no models: the fixture brief + draft, with photos from the
 * icon backgrounds (no photos). Writes exports/social/generated/stub-sif.json.
 *
 *   npx tsx scripts/social_preview_stub.ts
 *   then open /social/render/preview?generated=stub-sif&all=1
 */
import { briefSuperIntelligenceForce, TC_URL } from '@/fixtures/social/briefs';
import { sifDraft } from '@/fixtures/social/drafts';
import type { Photo } from '@/lib/social/photos/find';
import { toRenderPost } from '@/lib/social/render/from-draft';
import { writeGeneratedPost } from '@/lib/social/render/local-store';
import { fillDraft } from '@/lib/social/writer/draft';

// No photos: every slide shows its icon background (the starter set is out, photo spec §6).
const photo = (_i: number): Photo | null => null;

async function main() {
  const draft = fillDraft(sifDraft(), briefSuperIntelligenceForce());
  const post = toRenderPost(
    draft,
    { cover: photo(0), slides: draft.slides.map((_, i) => photo(i + 1)) },
    { source: 'TechCrunch', sourceUrl: TC_URL, publishedAt: '2026-10-04T12:00:00Z' },
  );
  console.log(await writeGeneratedPost('stub-sif', post));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
