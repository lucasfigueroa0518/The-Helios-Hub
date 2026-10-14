/**
 * "Make Last Few Days now" and Run now's LFD step (spec §8): queue one manual
 * run, a `requested` lfd.runs row the social worker claims. Nothing here calls
 * a model; the person's click approves the run's spend up to the cap, which is
 * read and checked first. A second click while a run is queued or running
 * answers a note instead of an error (the single-requested index refuses the
 * row; ON CONFLICT DO NOTHING turns that into null).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import { readLfdSettings } from './settings';
import { requestRun } from './store';

export const LFD_ALREADY_QUEUED = 'A Last Few Days run is already queued or running.';

export async function queueManualLfdRun(q: HubQuery): Promise<{ ok: boolean; note: string }> {
  const s = await readLfdSettings(q);
  if (s.runCapUsd == null) {
    return { ok: false, note: `lfd.settings.run_cap_usd is not a positive number (${JSON.stringify(s.runCapRaw)}); fix it in Settings first.` };
  }
  const { rows } = await q(`SELECT 1 FROM lfd.runs WHERE status = 'running' LIMIT 1`);
  if (rows.length) return { ok: false, note: LFD_ALREADY_QUEUED };
  const id = await requestRun(q, 'manual', s.runCapUsd);
  return id
    ? { ok: true, note: 'Run queued. The social worker starts it within a minute; the post waits for your approval.' }
    : { ok: false, note: LFD_ALREADY_QUEUED };
}
