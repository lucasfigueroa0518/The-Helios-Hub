import { MusicScreen } from '@/components/social-hub/content/MusicScreen';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { FIXTURE_NOW } from '@/tests/fixtures/social-hub/preview-dataset';
import { previewLibraries } from '@/tests/fixtures/social-hub/preview-libraries';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Preview · Music pool · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  return <MusicScreen music={previewLibraries().music} base={PREVIEW_BASE} params={toParams(await searchParams)} now={FIXTURE_NOW} playable={false} />;
}
