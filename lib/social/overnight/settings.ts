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

/** A person approves every carousel before it posts (docs/social-overnight.md). On unless set to false. */
export async function requireApproval(): Promise<boolean> {
  return (await getSocialSetting<boolean>('require_approval')) !== false;
}

/** Scheduling and auto-publishing. Off until a human turns it on. */
export async function publishingLive(): Promise<boolean> {
  return (await getSocialSetting<boolean>('publishing_live')) === true;
}
