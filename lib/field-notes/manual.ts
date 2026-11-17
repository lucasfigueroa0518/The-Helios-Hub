/**
 * Generate on the Field Notes page: queue one manual run, a `requested`
 * field_notes.runs row the social worker claims. Nothing here calls a model; the person's click
 * approves the run's spend up to the cap, which is read and checked first. A second click while
 * a run is queued or running answers a note instead of an error (the single-requested index
 * refuses the row).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import { readFieldNotesSettings } from './settings';
import { getTip, requestRun, type RunKind } from './store';

export const FIELD_NOTES_ALREADY_QUEUED = 'A Field Notes run is already queued or running.';

export async function queueFieldNotesRun(
  q: HubQuery,
  o: { kind?: RunKind; requestedBy?: string | null; seedTipId?: string | null } = {},
): Promise<{ ok: boolean; note: string }> {
  if (o.kind === 'rebuild') return { ok: false, note: 'Field Notes has no rebuild yet; reject the post and generate a new one.' };
  const s = await readFieldNotesSettings(q);
  if (s.runCapUsd == null) {
    return { ok: false, note: `field_notes.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); fix it in Settings first.` };
  }
  const { rows } = await q(`SELECT 1 FROM field_notes.runs WHERE status = 'running' LIMIT 1`);
  if (rows.length) return { ok: false, note: FIELD_NOTES_ALREADY_QUEUED };
  if (o.seedTipId) {
    const tip = await getTip(q, o.seedTipId);
    if (!tip || tip.status !== 'candidate') return { ok: false, note: 'That seeded tip is not available (it is missing or already used).' };
  }
  const id = await requestRun(q, 'manual', s.runCapUsd, { kind: 'build', requestedBy: o.requestedBy ?? null, seedTipId: o.seedTipId ?? null });
  if (!id) return { ok: false, note: FIELD_NOTES_ALREADY_QUEUED };
  return { ok: true, note: 'Run queued. The social worker starts it within a minute; the post waits for your approval.' };
}

/** Generate: one post from the person's pasted seed when there is one, else from the best scored tip. */
export function queueManualFieldNotesRun(
  q: HubQuery,
  requestedBy: string | null = null,
  o: { seedTipId?: string | null } = {},
): Promise<{ ok: boolean; note: string }> {
  return queueFieldNotesRun(q, { kind: 'build', requestedBy, seedTipId: o.seedTipId ?? null });
}

/** Why Make it refuses a tip (shown as the button's note). */
export const TIP_MAKE_REFUSALS = {
  missing: 'That tip is not in Field Notes.',
  archived: 'You archived that tip, so it stays out of the posts.',
  used: 'That tip is not waiting any more (it is on a post, set aside or expired).',
} as const;

/**
 * Make it on a chosen tip (Tommy, 2026-11-16: Field Notes runs like the other live types): queue one manual run that puts
 * this tip first, the same run Generate queues (same cap check, one run at a time; the social worker runs it). The run
 * fills the post's other slides from the queue. An archived or used tip is refused before anything is queued. Nothing
 * here calls a model; the person's click approves the run's spend up to field_notes.settings.run_cap_usd.
 */
export async function queueTipFieldNotesRun(q: HubQuery, tipId: string, requestedBy: string | null): Promise<{ ok: boolean; note: string; capUsd: number | null }> {
  const tip = await getTip(q, tipId).catch(() => null);
  if (!tip) return { ok: false, note: TIP_MAKE_REFUSALS.missing, capUsd: null };
  const { rows: archived } = await q(
    `SELECT 1 FROM social_hub.idea_adjustments WHERE vertical = 'field_notes' AND idea_id = $1 AND kind = 'archive' LIMIT 1`,
    [`field_notes:tip:${tipId}`],
  ).catch(() => ({ rows: [] as unknown[] }));
  if (archived.length) return { ok: false, note: TIP_MAKE_REFUSALS.archived, capUsd: null };
  if (tip.status !== 'candidate') return { ok: false, note: TIP_MAKE_REFUSALS.used, capUsd: null };
  const s = await readFieldNotesSettings(q);
  const out = await queueFieldNotesRun(q, { kind: 'build', requestedBy, seedTipId: tipId });
  return { ...out, capUsd: s.runCapUsd };
}
