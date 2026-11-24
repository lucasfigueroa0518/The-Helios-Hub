/**
 * Hashing an image for the used-photo ledger (CI-32). Server only: it loads sharp. Kept out of ./used.ts so browser
 * code can import the ledger's pure helpers.
 */
export async function hashesOf(bytes: Buffer): Promise<{ phash: string; dhash: string }> {
  const [{ phash }, { dhashOf }] = await Promise.all([import('@/lib/reel-ai-drama/harvest/filters'), import('@/lib/media-library/ingest')]);
  const [p, d] = await Promise.all([phash(bytes), dhashOf(bytes)]);
  return { phash: p, dhash: d };
}
