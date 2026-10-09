/**
 * Headers for a Supabase service call over fetch. A legacy service-role key
 * is a JWT and goes in both `apikey` and `Authorization: Bearer`. A new-style
 * secret key (`sb_secret_…`) is not a JWT: it goes in `apikey` only, and
 * sending it as a Bearer token is refused with "Invalid Compact JWS"
 * (a 403 AccessDenied from Storage).
 */
export function serviceHeaders(key: string): Record<string, string> {
  return key.startsWith('eyJ') ? { apikey: key, authorization: `Bearer ${key}` } : { apikey: key };
}
