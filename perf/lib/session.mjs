// Mints an Auth.js session cookie for the seeded perf user, signed with the
// local throwaway AUTH_SECRET from perf/env.sh. Never use a real secret here.
import { encode } from 'next-auth/jwt';

export const PERF_USER = {
  id: '00000000-0000-4000-8000-00000000f001',
  email: 'perf.tester@heliosgroup.ai',
};

const COOKIE_NAME = 'authjs.session-token';

export async function mintSessionCookie({ secret = process.env.AUTH_SECRET, user = PERF_USER } = {}) {
  if (!secret) throw new Error('AUTH_SECRET is not set (source perf/env.sh)');
  const value = await encode({
    secret,
    salt: COOKIE_NAME,
    maxAge: 60 * 60 * 24,
    token: { sub: user.id, email: user.email, userId: user.id, name: 'Perf Tester' },
  });
  return `${COOKIE_NAME}=${value}`;
}
