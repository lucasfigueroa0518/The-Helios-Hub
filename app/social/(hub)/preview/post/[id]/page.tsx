import { PostScreen } from '@/components/social-hub/screens/PostScreen';
import { PREVIEW_BASE } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  assertPreviewAllowed();
  return <PostScreen dataset={previewDataset()} base={PREVIEW_BASE} id={(await params).id} />;
}
