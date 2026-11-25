import { redirect } from 'next/navigation';

import { withQuery } from '@/lib/content-type/redirect-query';

export const dynamic = 'force-dynamic';

/** "IG Stories" became Morning Download (SS-1): the old page sends its links there, query kept. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(withQuery('/morning-download', await searchParams));
}
