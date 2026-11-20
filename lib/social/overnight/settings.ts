import { refillCapUsd as refillCapOf } from '@/lib/content-type/state';
import { dbQuery } from '@/lib/db';

/** social.settings: the switches the worker and (later) the Social page share. */
export async function getSocialSetting<T>(key: string): Promise<T | null> {
  const { rows } = await dbQuery<{ value: T }>(`SELECT value FROM social.settings WHERE key = $1`, [key]);
  return rows[0]?.value ?? null;
}

export async function setSocialSetting(key: string, value: unknown): Promise<void> {
  await dbQuery(
    `INSERT INTO social.settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}

/** The 3:00 AM run. Off until a human turns it on. */
export async function autoRunOn(): Promise<boolean> {
  return (await getSocialSetting<boolean>('auto_run')) === true;
}

/**
 * A person approves every carousel before it posts. Always true (settings standard D16): there is no setting that
 * skips approval, so the stored require_approval row is no longer read.
 */
export async function requireApproval(): Promise<boolean> {
  return true;
}

/** The spend cap of one Carousels pool refill (its intake share; D14): pool_refill_cap_usd, else the default. */
export async function refillCapUsd(): Promise<number> {
  return refillCapOf('carousels', await getSocialSetting<unknown>('pool_refill_cap_usd'));
}

/** Scheduling and auto-publishing. Off until a human turns it on. */
export async function publishingLive(): Promise<boolean> {
  return (await getSocialSetting<boolean>('publishing_live')) === true;
}
