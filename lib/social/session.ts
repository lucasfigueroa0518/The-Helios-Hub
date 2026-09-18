import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

/**
 * Auth wrapper for Helios Social server actions. Mirrors `lib/trello/session.ts`.
 * Returns the current session or redirects the caller to login.
 */
export async function requireSocialSession() {
  const session = await getSession();
  if (!session) redirect('/login');
  return session;
}
