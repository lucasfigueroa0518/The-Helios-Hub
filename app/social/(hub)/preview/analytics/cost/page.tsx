import { CostScreen } from '@/components/social-hub/cost/CostScreen';
import { costModel } from '@/lib/social-hub/cost-page/model';
import { parseCostParams } from '@/lib/social-hub/cost-page/params';
import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { previewCost } from '@/tests/fixtures/social-hub/cost-fixture';
import { FIXTURE_NOW } from '@/tests/fixtures/social-hub/preview-dataset';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Cost · Preview · Social Hub', robots: { index: false, follow: false } };

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  const parsed = parseCostParams(new URLSearchParams(toParams(await searchParams) as Record<string, string>), FIXTURE_NOW);
  const fixture = previewCost();
  // The fixture's own range unless the person picked custom dates; type and mode always come from the URL.
  const params = parsed.range === 'custom' ? parsed : { ...parsed, from: fixture.from, to: fixture.to };
  const input = { ...fixture, vertical: params.vertical, mode: params.mode, from: params.from, to: params.to };
  return <CostScreen model={costModel(input)} params={params} posts={input.posts} base={PREVIEW_BASE} />;
}
