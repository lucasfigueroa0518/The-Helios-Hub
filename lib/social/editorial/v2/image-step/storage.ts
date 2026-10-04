/**
 * Supabase Storage upload for the image step.
 *
 * Per docs/IMAGES-V1-HANDOFF.md: download the chosen Commons image into
 * our own bucket and use OUR URL, not a Wikimedia hotlink. Reasons:
 *   1. Renders stay stable if a file gets renamed / deleted on Commons.
 *   2. No Wikimedia hotlinking policy risk on high-traffic posts.
 *   3. Reviewer sees the exact bytes that will ship, not whatever the
 *      live URL happens to return that second.
 *
 * Bucket: helios-social-images (public read, provisioned by the same
 * script as the SQL migration).
 * Path:   wikidata/<Q-id>/<sha1-8>.<ext>
 */

import { createHash } from 'node:crypto';
import { supabaseAdmin } from '@/lib/supabase';

const BUCKET = 'helios-social-images';

export type UploadInput = {
  wikidataId: string;
  sourceUrl: string;
  mime: 'image/jpeg' | 'image/png';
  /** Injectable http for tests. */
  http?: typeof fetch;
  /** Injectable client for tests. */
  client?: ReturnType<typeof supabaseAdmin>;
};

export type UploadResult = {
  storagePath: string;
  storageUrl: string;
  bytes: number;
};

/**
 * Download the image bytes, hash a stable 8-char prefix so re-runs
 * dedupe, and upload to the bucket. Idempotent: if the object already
 * exists at the same path, returns the existing URL without re-uploading.
 */
export async function downloadAndStore(input: UploadInput): Promise<UploadResult> {
  const http = input.http ?? fetch;

  // Test-run safety: --no-persist sets HELIOS_V2_NO_STORAGE_UPLOAD=1 in
  // the test runner. When set, skip the upload to the production Supabase
  // bucket entirely and return the Commons hotlink URL. Reviewers still
  // see a working preview; production bytes stay untouched.
  const noStorageUpload = process.env.HELIOS_V2_NO_STORAGE_UPLOAD === '1';

  const res = await http(input.sourceUrl, {
    headers: {
      'User-Agent': 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)',
    },
  });
  if (!res.ok) throw new Error(`image download failed: HTTP ${res.status} for ${input.sourceUrl}`);
  const arrayBuffer = await res.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const ext = input.mime === 'image/png' ? 'png' : 'jpg';
  const sha = createHash('sha1').update(bytes).digest('hex').slice(0, 8);
  const storagePath = `wikidata/${input.wikidataId}/${sha}.${ext}`;

  if (noStorageUpload) {
    return {
      storagePath: `no-upload:${storagePath}`,
      storageUrl: input.sourceUrl,
      bytes: bytes.length,
    };
  }

  const client = input.client ?? supabaseAdmin();

  const { error: uploadError } = await client.storage
    .from(BUCKET)
    .upload(storagePath, bytes, {
      contentType: input.mime,
      cacheControl: '31536000', // one year — same bytes forever behind this SHA
      upsert: true,             // idempotent re-runs are safe
    });
  if (uploadError) throw new Error(`Supabase upload failed: ${uploadError.message}`);

  const { data: publicData } = client.storage.from(BUCKET).getPublicUrl(storagePath);

  return {
    storagePath,
    storageUrl: publicData.publicUrl,
    bytes: bytes.length,
  };
}

/** Download the image bytes only, without uploading. Used by the vision check. */
export async function downloadBytes(
  sourceUrl: string,
  opts: { http?: typeof fetch } = {},
): Promise<Buffer> {
  const http = opts.http ?? fetch;
  const res = await http(sourceUrl, {
    headers: {
      'User-Agent': 'HeliosHub/1.0 (+https://heliosgroup.ai; helios@heliosgroup.ai)',
    },
  });
  if (!res.ok) throw new Error(`image download failed: HTTP ${res.status} for ${sourceUrl}`);
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}
