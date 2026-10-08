import type { ExplainersDb } from '@/lib/explainers/db';

import { need, type ContentActions } from './types';

type Queued = { queued: boolean; note?: string; status?: number };

const REFUSAL: Record<string, string> = {
  daily_render_cap: 'Today’s explainer render cap is used up.',
  daily_spend_cap: 'Today’s explainer spend cap is used up.',
  already_in_flight: 'A render for this topic is already queued or running.',
  topic_not_found: 'That topic no longer exists.',
  topic_not_renderable: 'That topic can’t be rendered (rejected or displaced).',
};

/**
 * Explainers (lib/explainers): approve and reject set the review verdict
 * (keeping the reviewer's tags; mirrored onto the spine), Hard publish counts
 * as approval (SH-17), regenerate queues a rerender under the caps.
 */
export function explainerActions(deps: {
  db: () => Promise<ExplainersDb>;
  setVerdict: (db: ExplainersDb, jobId: string, verdict: 'approved' | 'rejected', by: string | null) => Promise<unknown>;
  hardPublishJob: (db: ExplainersDb, jobId: string, by: string) => Promise<Queued>;
  loadSettings: (db: ExplainersDb) => Promise<unknown>;
  requestRerender: (db: ExplainersDb, input: { topicId: string; settings: never }) => Promise<{ ok: boolean; reason?: string }>;
}): ContentActions {
  return {
    vertical: 'explainers',
    async approve(t, by) {
      await deps.setVerdict(await deps.db(), need(t, 'jobId'), 'approved', by);
      return { ok: true, note: 'Approved. It gets the next free window.' };
    },
    async reject(t, by) {
      await deps.setVerdict(await deps.db(), need(t, 'jobId'), 'rejected', by);
      return { ok: true, note: 'Rejected. It will not post.' };
    },
    async publishNow(t, by) {
      const out = await deps.hardPublishJob(await deps.db(), need(t, 'jobId'), by);
      return out.queued ? { ok: true, note: 'Queued to publish now.' } : { ok: false, note: out.note ?? 'Not queued.', status: out.status };
    },
    async regenerate(t) {
      const db = await deps.db();
      const settings = await deps.loadSettings(db);
      const out = await deps.requestRerender(db, { topicId: need(t, 'topicId'), settings: settings as never });
      return out.ok
        ? { ok: true, note: 'A new render is queued. It replaces the current version when it finishes.' }
        : { ok: false, note: REFUSAL[out.reason ?? ''] ?? `Refused: ${out.reason}` };
    },
  };
}
