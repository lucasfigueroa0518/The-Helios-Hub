import {
  inferIdentitySlug,
  SENDER_IDENTITY_DEFAULTS,
  type SenderIdentitySlug,
} from '@/lib/agentmail-inboxes';
import { dbQuery } from '@/lib/db';
import {
  getInboxByEmail,
  listInboxes,
  type InboxRow,
} from '@/lib/inboxes/repository';

export type SenderIdentityRow = {
  id: string;
  slug: SenderIdentitySlug;
  display_name: string;
  title: string;
  company_name: string;
  headshot_public_path: string | null;
  voice_notes: string | null;
};

export type SenderInboxRow = {
  id: string;
  identity_id: string;
  identity_slug: SenderIdentitySlug;
  email: string;
  sort_order: number;
  is_primary: boolean;
  enabled: boolean;
};

export const DAILY_INBOX_CAP_DEFAULT = 10;
export const DAILY_INBOX_CAPS = [10, 20] as const;
export type DailyInboxCap = (typeof DAILY_INBOX_CAPS)[number];

export async function getDailyInboxCap(): Promise<DailyInboxCap> {
  const { rows } = await dbQuery<{ value: unknown }>(
    `SELECT value FROM outreach.org_settings WHERE key = 'daily_inbox_cap'`,
  );
  const raw = rows[0]?.value;
  const n = typeof raw === 'number' ? raw : Number(raw);
  return n === 20 ? 20 : DAILY_INBOX_CAP_DEFAULT;
}

export async function setDailyInboxCap(cap: number): Promise<DailyInboxCap> {
  const next: DailyInboxCap = cap === 20 ? 20 : 10;
  await dbQuery(
    `INSERT INTO outreach.org_settings (key, value, updated_at)
     VALUES ('daily_inbox_cap', $1::jsonb, now())
     ON CONFLICT (key) DO UPDATE
        SET value = EXCLUDED.value, updated_at = now()`,
    [JSON.stringify(next)],
  );
  return next;
}

export async function listSenderIdentities(): Promise<SenderIdentityRow[]> {
  const { rows } = await dbQuery<SenderIdentityRow>(
    `SELECT id::text, slug, display_name, title, company_name,
            headshot_public_path, voice_notes
       FROM outreach.sender_identities
      ORDER BY CASE slug WHEN 'lucas' THEN 0 ELSE 1 END`,
  );
  return rows;
}

export async function getSenderIdentityBySlug(
  slug: SenderIdentitySlug,
): Promise<SenderIdentityRow | null> {
  const { rows } = await dbQuery<SenderIdentityRow>(
    `SELECT id::text, slug, display_name, title, company_name,
            headshot_public_path, voice_notes
       FROM outreach.sender_identities
      WHERE slug = $1`,
    [slug],
  );
  return rows[0] ?? null;
}

/**
 * Roster reads now live in `lib/inboxes/repository.ts`, which also owns the
 * lifecycle and Smartlead mirror columns. These two keep the old narrow shape
 * so existing drafting callers need no change.
 */
export async function listSenderInboxes(input: {
  identitySlug?: SenderIdentitySlug | null;
  enabledOnly?: boolean;
} = {}): Promise<SenderInboxRow[]> {
  const rows = await listInboxes({
    identitySlug: input.identitySlug ?? null,
    enabledOnly: input.enabledOnly !== false,
  });
  return rows.map(toNarrowRow);
}

export async function getSenderInboxByEmail(email: string): Promise<SenderInboxRow | null> {
  const row = await getInboxByEmail(email);
  return row?.enabled ? toNarrowRow(row) : null;
}

function toNarrowRow(row: InboxRow): SenderInboxRow {
  return {
    id: row.id,
    identity_id: row.identity_id,
    identity_slug: row.identity_slug,
    email: row.email,
    sort_order: row.sort_order,
    is_primary: row.is_primary,
    enabled: row.enabled,
  };
}

export function identityDefaults(slug: SenderIdentitySlug) {
  return SENDER_IDENTITY_DEFAULTS[slug];
}

export function resolveIdentityFromSnapshot(sender: {
  identitySlug?: string | null;
  workEmail?: string | null;
  displayName?: string | null;
}): SenderIdentitySlug {
  return inferIdentitySlug(sender);
}

export type HeadshotProfileRow = {
  user_id?: string | null;
  work_email?: string | null;
  display_name?: string | null;
  headshot_storage_path?: string | null;
};

/** Prefer the campaign owner's uploaded headshot for this sending profile. */
export function pickIdentityHeadshotPath(
  profiles: HeadshotProfileRow[],
  slug: SenderIdentitySlug,
  ownerId?: string | null,
): string | null {
  const matches = profiles.filter((row) => {
    if (!row.headshot_storage_path?.trim()) return false;
    return inferIdentitySlug({
      workEmail: row.work_email,
      displayName: row.display_name,
    }) === slug;
  });
  const owned = ownerId
    ? matches.filter((row) => row.user_id === ownerId)
    : [];
  return (owned[0] ?? matches[0])?.headshot_storage_path?.trim() || null;
}

export async function resolveIdentityHeadshotStoragePath(input: {
  identitySlug: SenderIdentitySlug;
  ownerId?: string | null;
  campaignId?: string | null;
}): Promise<string | null> {
  let ownerId = input.ownerId?.trim() || null;
  if (!ownerId && input.campaignId?.trim()) {
    const { rows } = await dbQuery<{ owner_id: string }>(
      `SELECT owner_id::text FROM outreach.campaigns WHERE id = $1`,
      [input.campaignId],
    );
    ownerId = rows[0]?.owner_id ?? null;
  }

  const { rows } = await dbQuery<{
    user_id: string;
    work_email: string;
    display_name: string;
    headshot_storage_path: string | null;
  }>(
    `SELECT user_id::text, work_email, display_name, headshot_storage_path
       FROM outreach.sender_profiles
      WHERE headshot_storage_path IS NOT NULL
        AND length(trim(headshot_storage_path)) > 0
      ORDER BY updated_at DESC`,
  );
  return pickIdentityHeadshotPath(rows, input.identitySlug, ownerId);
}
