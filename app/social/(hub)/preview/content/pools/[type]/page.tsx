import { notFound, permanentRedirect } from 'next/navigation';

import { PREVIEW_BASE } from '@/lib/social-hub/links';
import { assertPreviewAllowed } from '@/lib/social-hub/preview';
import { isVertical, typeHref } from '@/lib/social-hub/verticals';

/** The old fixture pool page: redirects to the fixture mirror of the type's own page. Unknown types still 404. */
export default async function Page({ params }: { params: Promise<{ type: string }> }) {
  assertPreviewAllowed();
  const { type } = await params;
  if (!isVertical(type)) notFound();
  permanentRedirect(typeHref(type, PREVIEW_BASE));
}
