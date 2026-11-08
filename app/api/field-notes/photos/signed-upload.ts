import { bucketSignedUrl } from '@/lib/media-bucket';
import { PHOTO_BANK_BUCKET } from '@/lib/media-library/types';
import { serviceHeaders } from '@/lib/supabase-service-headers';

/**
 * A signed upload URL for one object in the private photo bank bucket. Same Supabase call as
 * `createSignedUpload` in lib/storage.ts (which is fixed to the outreach bucket), with the bucket
 * as a parameter and the URL built by `bucketSignedUrl` from lib/media-bucket.ts.
 */
export async function createPhotoBankSignedUpload(path: string, fetcher: typeof fetch = fetch): Promise<{ uploadUrl: string; token: string }> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!baseUrl || !serviceRole) throw new Error('Supabase Storage is not configured');
  const encoded = path.split('/').map(encodeURIComponent).join('/');
  const res = await fetcher(new URL(`/storage/v1/object/upload/sign/${PHOTO_BANK_BUCKET}/${encoded}`, baseUrl), { method: 'POST', headers: serviceHeaders(serviceRole) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Could not prepare the upload (${res.status}): ${text.slice(0, 200)}`);
  const data = JSON.parse(text) as { url?: string; token?: string };
  if (!data.url || !data.token) throw new Error('Storage returned no upload URL.');
  return { token: data.token, uploadUrl: bucketSignedUrl(baseUrl, data.url) };
}
