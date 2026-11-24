import { notFound, permanentRedirect } from 'next/navigation';

import { isVertical, typeHref } from '@/lib/social-hub/verticals';

/** The old per-type pool page: each content type's own page now holds its pool. Unknown types still 404. */
export default async function Page({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  if (!isVertical(type)) notFound();
  permanentRedirect(typeHref(type));
}
