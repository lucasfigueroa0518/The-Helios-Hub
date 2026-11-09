/**
 * Generate on the Field Notes page: queue one manual run, a `requested`
 * field_notes.runs row the social worker claims. Nothing here calls a model; the person's click
 * approves the run's spend up to the cap, which is read and checked first. A second click while
 * a run is queued or running answers a note instead of an error (the single-requested index
 * refuses the row). A full review queue (max_pending_drafts) refuses too.
 */
import type { HubQuery } from '@/lib/social-hub/db';

import { readFieldNotesSettings } from './settings';
import { getTip, pendingDraftCount, requestRun, type RunKind } from './store';

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
  const pending = await pendingDraftCount(q);
  if (pending >= s.maxPendingDrafts) {
    return { ok: false, note: `${pending} Field Notes posts are waiting for review (the limit is ${s.maxPendingDrafts}). Approve or reject one first.` };
  }
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

