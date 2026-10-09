import { redirect } from 'next/navigation';

import { HUB_BASE, toParams, type RawSearchParams } from '@/lib/social-hub/links';
import { legacyHouseRedirect } from '@/lib/social-hub/views/legacy-routes';

/** Content House moved: Needs you and today's lineup are the Content page; ideas are pools; analysis is Analytics. */
export default async function Page({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  redirect(legacyHouseRedirect(HUB_BASE, toParams(await searchParams)));
}
