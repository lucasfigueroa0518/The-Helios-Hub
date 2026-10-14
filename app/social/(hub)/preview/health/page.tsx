import { HealthScreen } from '@/components/social-hub/health/HealthScreen';
import { healthModel } from '@/lib/social-hub/health/view';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { previewHealth } from '@/tests/fixtures/social-hub/health-fixture';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Health · Preview · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const windowNights = toParams(await searchParams).nights === '30' ? 30 : 14;
  return <HealthScreen model={healthModel({ ...previewHealth(), windowNights })} base={PREVIEW_BASE} />;
}
