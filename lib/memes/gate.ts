/**
 * The 90-day template rule (ME-40 to ME-45), a hard gate in code. A use of a
 * template blocks its whole family while it is reserved (approved or
 * scheduled, not yet live) and for 90 days after it publishes; a reservation
 * that never publishes is released and blocks nothing. A template whose image
 * near-duplicates a blocking use's image is blocked as well, whatever its
 * family says (the safety net).
 *
 * Checked twice: before generation (`availableTemplates`, so the writer only
 * sees free templates) and again when a meme is reserved or published
 * (`reserve`, `markPublished`), so two runs can't both take one template.
 * The lab never publishes; these run for real once memes are wired in.
 */
import type { MemesDb, Queryable } from './db';
import { nearDuplicate } from './phash';

export const COOLDOWN_DAYS = 90;

/**
 * Templates Lucas has banned outright: never offered to the writer, never reserved. Kept in the catalog (the
 * regime's card hash and old memes still resolve), only taken out of what is available.
 */
export const BANNED_TEMPLATES: Readonly<Record<string, string>> = {
  'sleeping-shaq': 'banned: the image itself prints "real shit?" (Lucas, 2026-10-19, ME-139)',
};
const DAY_MS = 86_400_000;

export class TemplateOnCooldown extends Error {
  constructor(readonly templateId: string, readonly reason: string) {
    super(`Template ${templateId} is on cooldown: ${reason}`);
  }
}

type BlockingUse = { template_id: string; family_key: string; image_hash: string | null; reserved: boolean; published_at: string | null };

/** Uses that block right now: open reservations, and publishes inside the window. */
async function blockingUses(db: Queryable, at: Date): Promise<BlockingUse[]> {
  const since = new Date(at.getTime() - COOLDOWN_DAYS * DAY_MS);
  const { rows } = await db.query<BlockingUse>(
    `SELECT template_id, family_key, image_hash, (published_at IS NULL) AS reserved, published_at::text AS published_at
       FROM memes.template_uses
      WHERE released_at IS NULL
        AND (published_at IS NULL OR (published_at > $1 AND published_at <= $2))
        AND reserved_at <= $2`,
    [since.toISOString(), at.toISOString()],
  );
  return rows;
}

export type TemplateRow = { id: string; family_key: string; image_hash: string | null };

/** Why a template is blocked at `at`, or null when it is free. */
export function blockReason(t: TemplateRow, uses: BlockingUse[]): string | null {
  for (const u of uses) {
    const when = u.reserved ? 'reserved, not yet published' : `published ${u.published_at?.slice(0, 10)}`;
    if (u.family_key === t.family_key) return `family "${t.family_key}" ${when} (${u.template_id})`;
    if (nearDuplicate(t.image_hash, u.image_hash)) return `image near-duplicates ${u.template_id} (${when})`;
  }
  return null;
}

/** Approved templates free at `at`, with the blocked ones and why. */
export async function availableTemplates(db: Queryable, at: Date = new Date()): Promise<{ free: string[]; blocked: Array<{ id: string; reason: string }> }> {
  const { rows } = await db.query<TemplateRow>(`SELECT id, family_key, image_hash FROM memes.templates WHERE status = 'approved' ORDER BY id`);
  const uses = await blockingUses(db, at);
  const free: string[] = [];
  const blocked: Array<{ id: string; reason: string }> = [];
  for (const t of rows) {
    const reason = BANNED_TEMPLATES[t.id] ?? blockReason(t, uses);
    if (reason) blocked.push({ id: t.id, reason });
    else free.push(t.id);
  }
  return { free, blocked };
}

/** Reserve a template for a meme (ME-41). Throws TemplateOnCooldown when it is no longer free. */
export async function reserve(db: MemesDb, templateId: string, memeId: string | null, at: Date = new Date()): Promise<string> {
  return db.transaction(async (tx) => {
    await tx.query(`LOCK TABLE memes.template_uses IN EXCLUSIVE MODE`);
    const { rows } = await tx.query<TemplateRow>(`SELECT id, family_key, image_hash FROM memes.templates WHERE id = $1 AND status = 'approved'`, [templateId]);
    const t = rows[0];
    if (!t) throw new TemplateOnCooldown(templateId, 'not an approved template');
    const reason = BANNED_TEMPLATES[t.id] ?? blockReason(t, await blockingUses(tx, at));
    if (reason) throw new TemplateOnCooldown(templateId, reason);
    const ins = await tx.query<{ id: string }>(
      `INSERT INTO memes.template_uses (family_key, template_id, image_hash, meme_id, reserved_at) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [t.family_key, t.id, t.image_hash, memeId, at.toISOString()],
    );
    return ins.rows[0]!.id;
  });
}

/** The reserved meme went live: its 90 days start now (ME-41). */
export async function markPublished(db: Queryable, useId: string, at: Date = new Date()): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE memes.template_uses SET published_at = $2 WHERE id = $1 AND published_at IS NULL AND released_at IS NULL RETURNING id`,
    [useId, at.toISOString()],
  );
  if (!rows[0]) throw new Error(`Use ${useId} is not an open reservation`);
}

/** The reserved meme was cancelled before publishing: its template is free again (ME-41). */
export async function release(db: Queryable, useId: string, at: Date = new Date()): Promise<void> {
  const { rows } = await db.query<{ id: string }>(
    `UPDATE memes.template_uses SET released_at = $2 WHERE id = $1 AND published_at IS NULL AND released_at IS NULL RETURNING id`,
    [useId, at.toISOString()],
  );
  if (!rows[0]) throw new Error(`Use ${useId} is not an open reservation`);
}
