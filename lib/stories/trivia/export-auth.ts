import { timingSafeEqual } from 'node:crypto';

/** Constant-time token check; false when the server has no token set. The token is never logged. */
export function exportAuthorized(header: string | null, token: string | undefined): boolean {
  if (!token) return false;
  const m = /^Bearer (.+)$/.exec(header ?? '');
  if (!m) return false;
  const a = Buffer.from(m[1]!.trim());
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
