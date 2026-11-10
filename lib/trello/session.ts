import { redirect } from 'next/navigation';

import { getSession, type SessionPayload } from '@/lib/session';

export async function requireTrelloSession(): Promise<SessionPayload> {
  const session = await getSession();
  if (!session) redirect('/');
  return session;
}

/**
 * Default avatar hues. Neighboring slots are different colors (blue, green,
 * orange, purple…), not adjacent degrees on the wheel. A raw `hash % 360`
 * put Lucas and Tommy six degrees apart, so both circles read as orange.
 * The slot is a pure function of the string, so a user's color stays put.
 */
export const AVATAR_HUES = [
  210, // blue
  142, // green
  25, // orange
  275, // purple
  350, // rose
  175, // teal
  48, // gold
  320, // magenta
  230, // indigo
  88, // lime
  4, // red
  125, // chartreuse — far from both red and the blue that wraps the list
] as const;

export function hueFromString(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return AVATAR_HUES[h % AVATAR_HUES.length];
}

export function slugify(name: string, userId: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `${base || 'workspace'}-${userId.slice(0, 8)}`;
}
