import { CompareScreen } from '@/components/social-hub/analytics/CompareScreen';
import { PREVIEW_BASE, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { previewDataset } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Compare · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const raw = (await searchParams).ids;
  const ids = (Array.isArray(raw) ? raw.join(',') : raw ?? '').split(',').map((s) => s.trim()).filter(Boolean).slice(0, 6);
  return <CompareScreen dataset={previewDataset()} base={PREVIEW_BASE} ids={ids} />;
}
