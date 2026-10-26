/**
 * Generate on the AI Events page and Run now's AI Events step (plan M4): queue one manual run, a
 * `requested` ai_events.runs row the social worker claims (or scripts/ai_events_once.ts, by
 * hand). Nothing here calls a model; the person's click approves the run's Jev spend up to the
 * cap, which is read and checked first. A second click while a run is queued or running answers
 * a note instead of an error (the single-requested index refuses the row).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import { readAiEventsSettings } from './settings';
import { requestRun, type RunKind } from './store';

export const AI_EVENTS_ALREADY_QUEUED = 'An AI Events run is already queued or running.';

export async function queueAiEventsRun(
  q: HubQuery,
  o: { kind?: RunKind; requestedBy?: string | null; weekKey?: string | null } = {},
): Promise<{ ok: boolean; note: string }> {
  const s = await readAiEventsSettings(q);
  if (s.runCapUsd == null) {
    return { ok: false, note: `ai_events.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); fix it in Settings first.` };
  }
  const { rows } = await q(`SELECT 1 FROM ai_events.runs WHERE status = 'running' LIMIT 1`);
  if (rows.length) return { ok: false, note: AI_EVENTS_ALREADY_QUEUED };
  const id = await requestRun(q, 'manual', s.runCapUsd, o);
  if (!id) return { ok: false, note: AI_EVENTS_ALREADY_QUEUED };
  return o.kind === 'rebuild'
    ? { ok: true, note: 'Rebuild queued. The social worker re-renders the post within a minute, from the scores it already has.' }
    : { ok: true, note: 'Run queued. The social worker starts it within a minute; the post waits for your approval.' };
}

/** Generate: a full build of the coming week (Jev scores events not scored yet, under the cap). */
export function queueManualAiEventsRun(q: HubQuery, requestedBy: string | null = null): Promise<{ ok: boolean; note: string }> {
  return queueAiEventsRun(q, { kind: 'build', requestedBy });
}
