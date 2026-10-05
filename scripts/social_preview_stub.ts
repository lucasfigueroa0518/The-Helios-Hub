/**
 * Helios Social — offline stub post for the local preview (plan M6).
 * No network, no models: the fixture brief + draft, with stand-in photos
 * from public/social/stock. Writes exports/social/generated/stub-sif.json.
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

const STAND_INS = ['server-racks', 'circuit-macro', 'newspapers-stack', 'dashboard', 'earth-from-space', 'macbook-glow'];
const photo = (i: number): Photo => ({
  url: `/social/stock/${STAND_INS[i % STAND_INS.length]}.jpg`,
  credit: `Stub photo ${i + 1} · stand-in`,
  source: 'stock',
  width: null,
  height: null,
  qid: null,
  subject: null,
});

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
