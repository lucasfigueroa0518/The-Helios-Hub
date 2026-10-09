import { redirect } from 'next/navigation';

import { PREVIEW_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { legacyHouseRedirect } from '@/lib/social-hub/views/legacy-routes';

export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  assertPreviewAllowed();
  redirect(legacyHouseRedirect(PREVIEW_BASE, toParams(await searchParams)));
}
