import type { Queryable } from '@/lib/explainers/db';
import { CAPTION_MAX_CHARS } from '@/lib/explainers/publish/config';
import { isUuid } from '@/lib/reel-ai-drama/publish/items';
import { dramaCaption } from '@/lib/reel-ai-drama/publish/publish';
import { unscheduleDramaJob } from '@/lib/reel-ai-drama/publish/schedule';
import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { ContentTypeDescription, PartState, PostSnapshot, RevisionResult } from '@/lib/revisions/types';

/**
 * Targeted Revisions for AI Drama reels (HUB-WIRING-CONTRACT.md §4.9): caption only. The interpreter returns the
 * exact new caption (args.value); revise adds a `post_caption` artifact row, with no model call ($0). Restore re-adds
 * the old text. Scene fixes are out of scope. Drama data is reached through the explainers handle, never the caller's query.
 */

export const DRAMA_STAGE_TAGS = ['caption'] as const;
type CaptionState = PartState & { copy: { caption: string } };

const failed = (note: string): RevisionResult => ({ ok: false, reason: 'failed', note });
const blocked = (note: string): RevisionResult => ({ ok: false, reason: 'blocked', note });
const jobIdOf = (refs: ActionTarget): string | null => (isUuid(refs.jobId) ? refs.jobId : null);

type Status = PostSnapshot['status'];

async function statusOf(db: Queryable, jobId: string): Promise<{ job: string; status: Status } | null> {
  const { rows } = await db.query<{ status: string; verdict: string | null; posted: boolean; booked: boolean }>(
    `SELECT j.status,
            CASE WHEN f.verdict = 'rejected' OR ap.decision = 'rejected' THEN 'rejected' ELSE coalesce(ap.decision, f.verdict) END AS verdict,
            EXISTS (SELECT 1 FROM social_hub.publish_attempts p WHERE p.content_item_id = ci.id AND p.status IN ('requested', 'creating', 'processing', 'publishing', 'published')) AS posted,
            EXISTS (SELECT 1 FROM social_hub.schedule s WHERE s.content_item_id = ci.id AND s.status IN ('scheduled', 'publishing')) AS booked
       FROM reel_ai_drama.jobs j
       LEFT JOIN reel_ai_drama.feedback f ON f.job_id = j.id
       LEFT JOIN social_hub.content_items ci ON ci.vertical = 'reel_ai_drama' AND ci.native_ref = j.id::text
       LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
      WHERE j.id = $1`,
    [jobId],
  );
  const r = rows[0];
  if (!r) return null;
  const status: Status = r.posted ? 'published' : r.verdict === 'rejected' ? 'rejected' : r.booked ? 'scheduled' : r.verdict === 'approved' ? 'approved' : r.status === 'ok' ? 'review' : 'preview';
  return { job: r.status, status };
}

/** Add a post_caption row while the job is finished, not posting, and its caption is still `current`. */
async function captionTo(db: Queryable, jobId: string, current: string | null, next: string): Promise<boolean> {
  if ((await dramaCaption(db, jobId)) !== current) return false;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.artifacts (job_id, kind, content)
     SELECT j.id, 'post_caption', $2 FROM reel_ai_drama.jobs j
      WHERE j.id = $1 AND j.status = 'ok'
        AND NOT EXISTS (SELECT 1 FROM social_hub.content_items ci JOIN social_hub.publish_attempts p ON p.content_item_id = ci.id
                         WHERE ci.vertical = 'reel_ai_drama' AND ci.native_ref = j.id::text
                           AND p.status IN ('requested', 'creating', 'processing', 'publishing', 'published'))
     RETURNING id`,
    [jobId, next],
  );
  return rows.length === 1;
}

export function createReelAiDramaDescription(deps: { db: () => Promise<Queryable> }): ContentTypeDescription {
  return {
    vertical: 'reel_ai_drama',
    label: 'AI Drama reels',
    stageTags: DRAMA_STAGE_TAGS,
    fixKinds: ['wording'],
    argsGuide: {
      wording: 'The caption part only: args.value is the exact new post caption, written out in full (the caption, a blank line, the question, a blank line, then the credits one per line).',
    },

    async load(_q, refs) {
      const id = jobIdOf(refs);
      if (!id) return null;
      const db = await deps.db();
      const s = await statusOf(db, id);
      if (!s) return null;
      const caption = await dramaCaption(db, id);
      return { vertical: 'reel_ai_drama', refs, status: s.status, parts: [{ ref: { kind: 'caption', key: 'caption' }, text: `The post caption under the video: "${caption ?? ''}"` }] };
    },

    estimate: () => 0,

    async revise({ refs, interpretation: it }) {
      const id = jobIdOf(refs);
      if (!id) return failed('This AI Drama reel could not be found, so nothing was changed.');
      if (it.part.kind !== 'caption' || it.part.key !== 'caption' || it.fixKind !== 'wording') {
        return blocked('Only an AI Drama reel’s caption wording can be changed here, so nothing was changed.');
      }
      const db = await deps.db();
      const s = await statusOf(db, id);
      if (!s) return failed('This AI Drama reel could not be found, so nothing was changed.');
      if (s.status === 'published') return blocked('This reel is posting or has posted, so it was not changed.');
      if (s.status === 'rejected') return blocked('This reel was rejected, so it was not changed.');
      if (s.job !== 'ok') return failed('This reel is not finished, so nothing was changed.');
      const text = (it.args?.value ?? '').trim();
      if (!text) return failed('I could not tell what the new caption should say, so nothing was changed.');
      if (text.length > CAPTION_MAX_CHARS) return blocked(`The new caption is ${text.length} characters; Instagram takes ${CAPTION_MAX_CHARS}, so it was not changed.`);
      const current = await dramaCaption(db, id);
      if (text === (current ?? '').trim()) return failed('The caption already says that, so nothing was changed.');
      if (!(await captionTo(db, id, current, text))) return failed('This reel changed or started posting just now, so the caption was not changed.');
      const before: CaptionState = { copy: { caption: current ?? '' }, files: [] };
      const after: CaptionState = { copy: { caption: text }, files: [] };
      return { ok: true, before, after };
    },

    async restore({ refs, part, state }) {
      const id = jobIdOf(refs);
      if (!id) throw new Error('This AI Drama reel could not be found.');
      if (part.kind !== 'caption') throw new Error('Only an AI Drama caption can be restored.');
      const old = (state as CaptionState).copy?.caption;
      if (typeof old !== 'string') throw new Error('This undo record has no AI Drama caption.');
      const db = await deps.db();
      const current = await dramaCaption(db, id);
      if ((current ?? '') === old) return;
      if (!(await captionTo(db, id, current, old))) throw new Error('The reel changed or is posting, so its caption was not restored.');
    },

    async unschedule(_q, refs) {
      const id = jobIdOf(refs);
      if (!id) return { ok: false, note: 'This AI Drama reel could not be found.' };
      return unscheduleDramaJob(await deps.db(), id);
    },
  };
}

export const reelAiDramaDescription: ContentTypeDescription = createReelAiDramaDescription({
  db: async () => (await import('@/lib/explainers/connection')).explainersDb(),
});
