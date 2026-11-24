import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/** The old settings link (SS-1): Morning Download's page opens on its settings. */
export default function Page() {
  redirect('/morning-download?tab=settings');
}
