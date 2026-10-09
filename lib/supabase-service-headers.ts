/**
 * Headers for a Supabase service call over fetch. A legacy service-role key
 * is a JWT and goes in both `apikey` and `Authorization: Bearer`. A new-style
 * secret key (`sb_secret_…`) is not a JWT: it goes in `apikey` only, and
 * sending it as a Bearer token is refused with "Invalid Compact JWS"
 * (a 403 AccessDenied from Storage).
 */
/** A legacy service-role JWT is three base64 segments. Anything else, including `sb_secret_…`, is not. */
export function isServiceJwt(key: string): boolean {
  return /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key);
}

export function serviceHeaders(key: string): Record<string, string> {
  const trimmed = key.trim().replace(/^['"]|['"]$/g, '');
  return isServiceJwt(trimmed) ? { apikey: trimmed, authorization: `Bearer ${trimmed}` } : { apikey: trimmed };
}
