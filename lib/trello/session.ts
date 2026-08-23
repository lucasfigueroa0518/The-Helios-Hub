import { redirect } from 'next/navigation';

import { getSession, type SessionPayload } from '@/lib/session';

export async function requireTrelloSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/');
  return session;
}

export function hueFromString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return h % 360;
}

export function slugify(name: string, userId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${userId.slice(0, 8)}`;
}
