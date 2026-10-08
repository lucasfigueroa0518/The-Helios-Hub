import { redirect } from 'next/navigation';

import { getSession } from '@/lib/session';

/**
 * Auth wrapper for Helios Social server actions. Mirrors `lib/trello/session.ts`.
 * Returns the current session or redirects the caller to the sign-in page,
 * which lives at `/` (the app root renders the Google login form when the
 * viewer isn't signed in — there is no dedicated `/login` route).
 */
export async function requireSocialSession() {
  const session = await getSession();
  if (!session) redirect('/');
  return session;
}
