/**
 * `sender_inboxes` reads and writes, including the Smartlead mirror columns.
 *
 * Absorbs the roster helpers that used to live in
 * `lib/drafting/sender-identities.ts`; that module re-exports them so existing
 * callers keep working.
 */
import type { IdentitySlug, LifecycleStage } from '@/lib/delivery-states';
import { dbQuery } from '@/lib/db';

export type InboxRow = {
  id: string;
  identity_id: string;
  identity_slug: IdentitySlug;
  identity_display_name: string;
  email: string;
  domain: string;
  sort_order: number;
  is_primary: boolean;
  enabled: boolean;
  lifecycle_stage: LifecycleStage;
  stage_entered_at: string;
  stage_plan: Record<string, unknown>;
  rest_reason: string | null;
  rest_cycles: number;
  from_name: string | null;
  signature_html: string | null;
  provisioning_checklist: Record<string, unknown>;
  smartlead_email_account_id: number | null;
  sl_status: string | null;
  sl_max_email_per_day: number | null;
  sl_warmup_enabled: boolean | null;
  sl_warmup_total_per_day: number | null;
  sl_warmup_reply_rate: number | null;
  sl_warmup_reputation: number | null;
  sl_synced_at: string | null;
  sl_raw: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

const SELECT_INBOX = `
  SELECT ib.id::text,
         ib.identity_id::text,
         i.slug AS identity_slug,
         i.display_name AS identity_display_name,
         lower(ib.email) AS email,
         ib.domain,
         ib.sort_order,
         ib.is_primary,
         ib.enabled,
         ib.lifecycle_stage,
         ib.stage_entered_at,
         ib.stage_plan,
         ib.rest_reason,
         ib.rest_cycles,
         ib.from_name,
         ib.signature_html,
         ib.provisioning_checklist,
         ib.smartlead_email_account_id,
         ib.sl_status,
         ib.sl_max_email_per_day,
         ib.sl_warmup_enabled,
         ib.sl_warmup_total_per_day,
         ib.sl_warmup_reply_rate,
         ib.sl_warmup_reputation,
         ib.sl_synced_at,
         ib.sl_raw,
         ib.created_at,
         ib.updated_at
    FROM outreach.sender_inboxes ib
    JOIN outreach.sender_identities i ON i.id = ib.identity_id`;

const ROSTER_ORDER = `ORDER BY CASE i.slug WHEN 'lucas' THEN 0 ELSE 1 END, ib.sort_order ASC`;

export async function listInboxes(
  filter: {
    identitySlug?: IdentitySlug | null;
    stages?: LifecycleStage[];
    enabledOnly?: boolean;
    withSmartleadAccount?: boolean;
  } = {},
): Promise<InboxRow[]> {
  const params: unknown[] = [];
  const clauses: string[] = [];
  if (filter.identitySlug) {
    params.push(filter.identitySlug);
    clauses.push(`i.slug = $${params.length}`);
  }
  if (filter.stages?.length) {
    params.push(filter.stages);
    clauses.push(`ib.lifecycle_stage = ANY($${params.length}::text[])`);
  }
  if (filter.enabledOnly) clauses.push('ib.enabled = true');
  if (filter.withSmartleadAccount) clauses.push('ib.smartlead_email_account_id IS NOT NULL');

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const { rows } = await dbQuery<InboxRow>(`${SELECT_INBOX} ${where} ${ROSTER_ORDER}`, params);
  return rows;
}

export async function getInboxById(id: string): Promise<InboxRow | null> {
  const { rows } = await dbQuery<InboxRow>(`${SELECT_INBOX} WHERE ib.id = $1`, [id]);
  return rows[0] ?? null;
}

export async function getInboxByEmail(email: string): Promise<InboxRow | null> {
  const { rows } = await dbQuery<InboxRow>(`${SELECT_INBOX} WHERE lower(ib.email) = lower($1)`, [
    email,
  ]);
  return rows[0] ?? null;
}

export async function getInboxBySmartleadAccountId(accountId: number): Promise<InboxRow | null> {
  const { rows } = await dbQuery<InboxRow>(
    `${SELECT_INBOX} WHERE ib.smartlead_email_account_id = $1`,
    [accountId],
  );
  return rows[0] ?? null;
}

/** Mailboxes eligible to be attached to a lane for one identity. */
export async function listSendingInboxes(identitySlug: IdentitySlug): Promise<InboxRow[]> {
  return listInboxes({
    identitySlug,
    stages: ['ramping', 'production'],
    enabledOnly: true,
    withSmartleadAccount: true,
  });
}

export async function createInbox(input: {
  email: string;
  identitySlug: IdentitySlug;
  fromName?: string | null;
  signatureHtml?: string | null;
}): Promise<InboxRow> {
  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO outreach.sender_inboxes
       (identity_id, email, sort_order, is_primary, enabled, lifecycle_stage,
        stage_entered_at, from_name, signature_html)
     SELECT i.id,
            lower($1),
            coalesce(
              (SELECT max(sort_order) + 1 FROM outreach.sender_inboxes WHERE identity_id = i.id),
              1),
            false, true, 'provisioning', now(), $3, $4
       FROM outreach.sender_identities i
      WHERE i.slug = $2
     RETURNING id::text`,
    [input.email.trim(), input.identitySlug, input.fromName ?? null, input.signatureHtml ?? null],
  );
  const id = rows[0]?.id;
  if (!id) throw new Error(`Unknown sender identity: ${input.identitySlug}`);
  const created = await getInboxById(id);
  if (!created) throw new Error('Inbox insert did not return a row');
  return created;
}

export type InboxPatch = {
  fromName?: string | null;
  signatureHtml?: string | null;
  identitySlug?: IdentitySlug;
  stagePlan?: Record<string, unknown>;
  enabled?: boolean;
};

export async function updateInbox(id: string, patch: InboxPatch): Promise<InboxRow | null> {
  const sets: string[] = [];
  const params: unknown[] = [id];
  const push = (fragment: string, value: unknown) => {
    params.push(value);
    sets.push(`${fragment} = $${params.length}`);
  };

  if (patch.fromName !== undefined) push('from_name', patch.fromName);
  if (patch.signatureHtml !== undefined) push('signature_html', patch.signatureHtml);
  if (patch.stagePlan !== undefined) {
    params.push(JSON.stringify(patch.stagePlan));
    sets.push(`stage_plan = $${params.length}::jsonb`);
  }
  if (patch.enabled !== undefined) push('enabled', patch.enabled);
  if (patch.identitySlug !== undefined) {
    params.push(patch.identitySlug);
    sets.push(
      `identity_id = (SELECT id FROM outreach.sender_identities WHERE slug = $${params.length})`,
    );
  }
  if (!sets.length) return getInboxById(id);

  await dbQuery(
    `UPDATE outreach.sender_inboxes SET ${sets.join(', ')}, updated_at = now() WHERE id = $1`,
    params,
  );
  return getInboxById(id);
}

/** Writes the stage transition. Lifecycle owns the decision; this owns the row. */
export async function writeStage(
  id: string,
  stage: LifecycleStage,
  options: { restReason?: string | null; incrementRestCycles?: boolean } = {},
): Promise<void> {
  await dbQuery(
    `UPDATE outreach.sender_inboxes
        SET lifecycle_stage = $2,
            stage_entered_at = now(),
            rest_reason = CASE WHEN $2 = 'resting' THEN $3 ELSE NULL END,
            rest_cycles = rest_cycles + CASE WHEN $4 THEN 1 ELSE 0 END,
            updated_at = now()
      WHERE id = $1`,
    [id, stage, options.restReason ?? null, options.incrementRestCycles ?? false],
  );
}

export async function linkSmartleadAccount(id: string, accountId: number): Promise<void> {
  await dbQuery(
    `UPDATE outreach.sender_inboxes
        SET smartlead_email_account_id = $2, updated_at = now()
      WHERE id = $1`,
    [id, accountId],
  );
}

export type SmartleadMirror = {
  status: string | null;
  maxEmailPerDay: number | null;
  warmupEnabled: boolean | null;
  warmupTotalPerDay: number | null;
  warmupReplyRate: number | null;
  warmupReputation: number | null;
  raw: unknown;
};

export async function writeSmartleadMirror(id: string, mirror: SmartleadMirror): Promise<void> {
  await dbQuery(
    `UPDATE outreach.sender_inboxes
        SET sl_status = $2,
            sl_max_email_per_day = $3,
            sl_warmup_enabled = $4,
            sl_warmup_total_per_day = $5,
            sl_warmup_reply_rate = $6,
            sl_warmup_reputation = $7,
            sl_raw = $8::jsonb,
            sl_synced_at = now(),
            updated_at = now()
      WHERE id = $1`,
    [
      id,
      mirror.status,
      mirror.maxEmailPerDay,
      mirror.warmupEnabled,
      mirror.warmupTotalPerDay,
      mirror.warmupReplyRate,
      mirror.warmupReputation,
      JSON.stringify(mirror.raw ?? {}),
    ],
  );
}

export async function setProvisioningChecklist(
  id: string,
  checklist: Record<string, unknown>,
): Promise<void> {
  await dbQuery(
    `UPDATE outreach.sender_inboxes
        SET provisioning_checklist = $2::jsonb, updated_at = now()
      WHERE id = $1`,
    [id, JSON.stringify(checklist)],
  );
}

/** Domains that still have a mailbox actively sending. */
export async function domainsWithActiveSenders(): Promise<Set<string>> {
  const { rows } = await dbQuery<{ domain: string }>(
    `SELECT DISTINCT domain
       FROM outreach.sender_inboxes
      WHERE lifecycle_stage IN ('ramping', 'production') AND enabled = true`,
  );
  return new Set(rows.map((row) => row.domain));
}

/** Distinct domains worth asking Postmaster about. */
export async function activeDomains(): Promise<string[]> {
  const { rows } = await dbQuery<{ domain: string }>(
    `SELECT DISTINCT domain
       FROM outreach.sender_inboxes
      WHERE lifecycle_stage <> 'retired'
      ORDER BY domain`,
  );
  return rows.map((row) => row.domain);
}

/** Non-retired mailboxes are billable Microsoft 365 seats. */
export async function countBillableSeats(): Promise<number> {
  const { rows } = await dbQuery<{ n: string }>(
    `SELECT count(*)::text AS n FROM outreach.sender_inboxes WHERE lifecycle_stage <> 'retired'`,
  );
  return Number(rows[0]?.n ?? 0);
}
