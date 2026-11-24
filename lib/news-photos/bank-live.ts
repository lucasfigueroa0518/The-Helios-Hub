/**
 * The live photo bank for the Social Hub's photo revisions (Morning Download and Last Few Days; never used by tests):
 * one bank per process on lib/db.ts's pool (DATABASE_URL, the hub's Supabase, where media_library lives) and the
 * private photo-bank bucket, as Reel AI Drama's harvest builds it (lib/reel-ai-drama/harvest/photo-bank-live.ts).
 * The revisions run inside the long-lived social worker, so the bank's background writes finish there.
 *
 * No DATABASE_URL, or no Supabase storage keys: null, and the revision runs as before. Never throws.
 */
import type { PhotoBankSink } from './bank-offer';

let made: Promise<PhotoBankSink | null> | null = null;

export function liveNewsPhotoBank(env: NodeJS.ProcessEnv = process.env): Promise<PhotoBankSink | null> {
  made ??= (async () => {
    if (!env.DATABASE_URL?.trim() || !env.NEXT_PUBLIC_SUPABASE_URL?.trim() || !env.SUPABASE_SERVICE_ROLE_KEY?.trim()) return null;
    try {
      const [{ dbQuery }, { mediaBucket }, { createPhotoBank }, { PHOTO_BANK_BUCKET }] = await Promise.all([
        import('@/lib/db'),
        import('@/lib/media-bucket'),
        import('@/lib/media-library/bank'),
        import('@/lib/media-library/types'),
      ]);
      return createPhotoBank({ query: (text, params) => dbQuery(text, params), bucket: mediaBucket(PHOTO_BANK_BUCKET), log: (line) => console.log(`photo bank: ${line}`) });
    } catch (err) {
      console.log(`photo bank: not used (${err instanceof Error ? err.message.slice(0, 120) : String(err)})`);
      return null;
    }
  })();
  return made;
}
