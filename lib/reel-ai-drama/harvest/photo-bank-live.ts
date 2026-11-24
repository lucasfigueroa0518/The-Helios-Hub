import { dbQuery } from '@/lib/db';
import { mediaBucket } from '@/lib/media-bucket';
import { createPhotoBank } from '@/lib/media-library/bank';
import { lookupForDrama } from '@/lib/media-library/drama';
import { PHOTO_BANK_BUCKET, type Query } from '@/lib/media-library/types';

import { guardedPhotoBank } from './photo-bank';
import type { HarvestPhotoBank } from './types';

/**
 * The live photo bank for the harvest (never used by tests). Reel AI Drama's own database is local
 * (EXPLAINERS_DATABASE_URL); the bank lives in the hub's Supabase, so this is a second connection, used
 * only for the bank: lib/db.ts's pool on DATABASE_URL (the transaction pooler; plain statements only, no
 * session SET). The bank copies live in the private photo-bank bucket.
 *
 * No DATABASE_URL, or no Supabase storage keys (the bank's ingest uploads its copies): no bank, and the
 * harvest runs as before.
 */
export function liveHarvestPhotoBank(env: NodeJS.ProcessEnv = process.env, opts: { log?: (line: string) => void } = {}): { bank: HarvestPhotoBank | null; note: string | null } {
  if (!env.DATABASE_URL?.trim()) return { bank: null, note: 'photo bank: DATABASE_URL not set; not used' };
  if (!env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return { bank: null, note: 'photo bank: Supabase storage keys not set; not used' };
  const log = opts.log ?? ((line: string) => console.log(`photo bank: ${line}`));
  try {
    const query: Query = (text, params) => dbQuery(text, params);
    const bucket = mediaBucket(PHOTO_BANK_BUCKET);
    const bank = createPhotoBank({ query, bucket, log });
    return {
      bank: guardedPhotoBank(
        {
          settings: () => bank.settings(),
          lookup: (q) => lookupForDrama(query, q),
          download: (masterPath) => bucket.download(masterPath),
          offer: (input) => bank.offerDrama(input),
          drain: (ms) => bank.drain(ms),
        },
        { log },
      ),
      note: null,
    };
  } catch (error) {
    return { bank: null, note: `photo bank: not used (${error instanceof Error ? error.message.slice(0, 120) : String(error)})` };
  }
}
