/**
 * The shared finder's live deps, wired as lib/lfd/live.ts wires the builder harvest: fetch, the harvest's streaming
 * Haiku look, its prompt loader, SERPER_API_KEY, and the hub's photo bank. Every network module loads only inside
 * livePhotoDeps; tests never call it (CLAUDE.md Rule 1).
 *
 * `bankWrites: false` (the comparison script): the bank is still read (lookup, fetchStored) but never written
 * (offer and flush are no-ops).
 *
 * `used`: the used-photo ledger (CI-32) on the hub's database (lib/db.ts, DATABASE_URL), the same pool the photo bank
 * uses; read once per post by findPhotos.
 */
import type { HarvestPhotoBank } from '@/lib/reel-ai-drama/harvest/types';

import type { PhotoDeps } from './types';
import { liveUsedLedger } from './used-guard';

/** The bank, read only: lookups and stored copies pass through; offers are dropped. */
export function readOnlyPhotoBank(bank: HarvestPhotoBank): HarvestPhotoBank {
  return {
    lookup: (q) => bank.lookup(q),
    fetchStored: (masterPath) => bank.fetchStored(masterPath),
    offer: () => undefined,
    flush: async () => undefined,
  };
}

export async function livePhotoDeps(env: NodeJS.ProcessEnv = process.env, opts: { bankWrites?: boolean } = {}): Promise<PhotoDeps> {
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { streamingCreate } = await import('@/lib/reel-ai-drama/reporting/llm');
  const { loadPrompt } = await import('@/lib/reel-ai-drama/prompts');
  const { liveHarvestPhotoBank } = await import('@/lib/reel-ai-drama/harvest/photo-bank-live');
  const { bank, note } = liveHarvestPhotoBank(env);
  if (note) console.log(`shared photos: ${note}`);
  const photoBank = bank && opts.bankWrites === false ? readOnlyPhotoBank(bank) : bank;
  return {
    harvest: {
      http: fetch,
      create: streamingCreate(newAnthropic()),
      loadPrompt: (name) => loadPrompt(name),
      serperKey: env.SERPER_API_KEY ?? null,
      photoBank,
      cutouts: [],
    },
    now: () => new Date(),
    used: liveUsedLedger(env),
  };
}
