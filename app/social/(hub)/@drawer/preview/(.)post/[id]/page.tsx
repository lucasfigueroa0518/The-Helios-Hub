import { PostDrawerScreen } from '@/components/social-hub/post/PostScreen';
import { PREVIEW_BASE, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { FIXTURE_NOW, previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

/** Fixture mirror of the post drawer (development only; no database, no session). */
export default async function DrawerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const from = (await searchParams).from;
  return <PostDrawerScreen dataset={previewDataset()} base={PREVIEW_BASE} id={(await params).id} from={typeof from === 'string' ? from : undefined} now={FIXTURE_NOW} />;
}
