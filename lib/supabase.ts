import { createClient } from '@supabase/supabase-js';

/** Browser/client-safe Supabase client — respects row-level security. Lazy so a missing key only errors on use, not at import/build time. Reads env AT CALL TIME so scripts that load .env.local after import still work. */
export function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set');
  return createClient(url, anonKey);
}

/** Server-only client with the service role key — bypasses RLS, never import from client components. */
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are not set');
  return createClient(url, serviceKey);
}
