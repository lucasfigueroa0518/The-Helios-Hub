import type { Queryable } from '@/lib/explainers/db';
import { DRAMA_WINDOWS } from '@/lib/reel-ai-drama/publish/config';
import { scheduleApprovedDrama } from '@/lib/reel-ai-drama/publish/schedule';
import { inTransaction, loadSettings } from '@/lib/reel-ai-drama/settings';

/**
 * AI Drama posting settings, read and written for lib/content-type/posting.ts (HUB-WIRING-CONTRACT.md §4.4). The
 * state is the pair `auto` + `publishing_live` (settings standard D16). Every post needs a person's approval, so there
 * is no Auto-publish: require_approval is never read here and never written false.
 */
export type DramaPosting = { generate: boolean; live: boolean; perDay: number; maxPerDay: number; dailyRenderCap: number; dailySpendCapUsd: number };

export async function readDramaPosting(db: Queryable): Promise<DramaPosting> {
  const s = await loadSettings(db);
  return {
    generate: s.auto,
    live: s.publishing_live,
    perDay: s.posts_per_day,
    maxPerDay: DRAMA_WINDOWS.length,
    dailyRenderCap: s.daily_render_cap,
    dailySpendCapUsd: s.daily_spend_cap_usd,
  };
}

export class DramaPostingError extends Error {
  readonly status = 400;
}

/**
 * One transaction: generate → auto, live → publishing_live, perDay (1..max) also raises daily_render_cap to at least
 * perDay. require_approval is not writable (always true, D16). Turning live on then books the approved reels (scheduleApprovedDrama).
 */
export async function writeDramaPosting(db: Queryable, patch: { generate?: boolean; live?: boolean; perDay?: number }): Promise<DramaPosting> {
  const writes: Array<[string, unknown]> = [];
  const bool = (name: string, v: unknown) => {
    if (typeof v !== 'boolean') throw new DramaPostingError(`${name} must be true or false.`);
    return v;
  };
  if (patch.generate !== undefined) writes.push(['auto', bool('generate', patch.generate)]);
  if (patch.live !== undefined) writes.push(['publishing_live', bool('live', patch.live)]);
  if (patch.perDay !== undefined) {
    const n = patch.perDay;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > DRAMA_WINDOWS.length) {
      throw new DramaPostingError(`Posts per day must be a whole number from 1 to ${DRAMA_WINDOWS.length}.`);
    }
    writes.push(['posts_per_day', n]);
    const current = await loadSettings(db);
    if (current.daily_render_cap < n) writes.push(['daily_render_cap', n]);
  }
  if (writes.length) {
    await inTransaction(db, async (tx) => {
      for (const [key, value] of writes) {
        await tx.query(
          `INSERT INTO reel_ai_drama.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
          [key, JSON.stringify(value)],
        );
      }
    });
  }
  if (patch.live === true) await scheduleApprovedDrama(db);
  return readDramaPosting(db);
}
