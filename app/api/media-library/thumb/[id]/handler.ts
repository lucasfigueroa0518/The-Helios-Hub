import { photoObjectPath } from '@/lib/media-library/read';
import type { Query } from '@/lib/media-library/types';

/**
 * A photo bank image (DECISIONS_LOG D49) through a short signed URL: the
 * `photo-bank` bucket stays private. Pure: the session, the query and the
 * signer come in as dependencies (route.ts passes the live ones).
 *
 *   401  no session
 *   400  not a photo id (uuid)
 *   404  unknown, removed, or the schema isn't applied
 *   302  to a 10-minute signed URL; the browser may keep it 5 minutes
 *
 * `?v=master` serves the master (long side ≤ 2560) instead of the thumbnail.
 */
export type ThumbDeps = {
  session: () => Promise<unknown>;
  query: Query;
  sign: (objectPath: string, expiresIn: number) => Promise<string>;
};

export const THUMB_SIGN_SECONDS = 600;
export const THUMB_CACHE_CONTROL = 'private, max-age=300';

const json = (status: number, error: string) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

export async function thumbResponse(deps: ThumbDeps, id: string, variant: string | null): Promise<Response> {
  if (!(await deps.session())) return json(401, 'Unauthorized');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json(400, 'Bad request');
  const path = await photoObjectPath(deps.query, id, variant === 'master' ? 'master' : 'thumb');
  if (!path) return json(404, 'Not in the photo bank.');
  let url: string;
  try {
    url = await deps.sign(path, THUMB_SIGN_SECONDS);
  } catch {
    return json(502, 'Could not sign the image.');
  }
  return new Response(null, { status: 302, headers: { location: url, 'cache-control': THUMB_CACHE_CONTROL } });
}
