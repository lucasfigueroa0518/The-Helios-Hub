import { redirect } from 'next/navigation';

import { withQuery } from '@/lib/content-type/redirect-query';

export const dynamic = 'force-dynamic';

/** The old history link (SS-1): Morning Download's page, query kept. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  redirect(withQuery('/morning-download', await searchParams));
}
