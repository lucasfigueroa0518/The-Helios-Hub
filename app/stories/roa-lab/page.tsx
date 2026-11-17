import { redirect } from 'next/navigation';

import { withQuery } from '@/lib/content-type/redirect-query';

export const dynamic = 'force-dynamic';

/** The Real or AI? swipe lab moved to /real-or-ai/lab (SS-1); its API stays at /api/stories/roa-lab. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(withQuery('/real-or-ai/lab', await searchParams));
}
