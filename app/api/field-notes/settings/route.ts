import { writePosting } from '@/lib/content-type/posting';
import { dbQuery } from '@/lib/db';
import { getSession } from '@/lib/session';

import { parsePanelSettings, settingsGet, settingsPost, type SettingsEnv } from './handler';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const env: SettingsEnv = {
  session: getSession,
  read: async () => parsePanelSettings((await dbQuery<{ key: string; value: unknown }>(`SELECT key, value FROM field_notes.settings`)).rows),
  writeSwitches: async (patch, email) => {
    await writePosting('field_notes', patch, email);
  },
  writeNumber: async (key, value) => {
    await dbQuery(
      `INSERT INTO field_notes.settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
      [key, JSON.stringify(value)],
    );
  },
};

/** Field Notes' settings: the three switches (through lib/content-type/posting.ts) and the photo rest, pending draft cap and tip expiry. */
export const GET = () => settingsGet(env);
export async function POST(request: Request) {
  return settingsPost(env, await request.json().catch(() => null));
}
