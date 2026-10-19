/**
 * Caption closings log (social captions redesign, 2026-10-19): every caption type
 * records its closing paragraph here. It feeds the recent-closings prompt block and
 * the build-line ceiling. Table: social_hub.caption_closings (db/social_hub_schema.sql).
 *
 * A closing is recorded when it is written, not when it is published, so posts
 * captioned earlier in the same run count toward later ones.
 */
import { CLOSINGS_WINDOW, type RecentClosing } from '@/lib/social/captions/build-line';

export type CaptionType = 'carousel' | 'reel' | 'explainer' | 'lfd';

export type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Newest first. */
export async function recentClosings(
  query: Query,
  type: CaptionType,
  limit: number = CLOSINGS_WINDOW,
): Promise<RecentClosing[]> {
  const { rows } = await query(
    `SELECT closing, build_line, created_at FROM social_hub.caption_closings
     WHERE type = $1 ORDER BY created_at DESC, id DESC LIMIT $2`,
    [type, limit],
  );
  return rows.map((r) => ({
    closing: r.closing as string,
    buildLine: r.build_line as boolean,
    createdAt: r.created_at instanceof Date ? r.created_at : new Date(r.created_at as string),
  }));
}

/** May throw; callers that must never fail a caption use closingsLog().record instead. */
export async function recordClosing(
  query: Query,
  row: { type: CaptionType; subjectId: string; closing: string; buildLine: boolean },
): Promise<void> {
  await query(
    `INSERT INTO social_hub.caption_closings (type, subject_id, closing, build_line) VALUES ($1, $2, $3, $4)`,
    [row.type, row.subjectId, row.closing, row.buildLine],
  );
}

export type ClosingsLog = {
  recent(): Promise<RecentClosing[]>;
  record(subjectId: string, closing: string, buildLine: boolean): Promise<void>;
};

/**
 * A log bound to one caption type. `record` catches and console.warns: a failed
 * write must never fail the caption. `recent` lets errors propagate so the caller
 * decides how to degrade (an empty log allows the build line).
 */
export function closingsLog(query: Query, type: CaptionType): ClosingsLog {
  return {
    recent: () => recentClosings(query, type),
    async record(subjectId, closing, buildLine) {
      try {
        await recordClosing(query, { type, subjectId, closing, buildLine });
      } catch (err) {
        console.warn(`[captions] could not record ${type} closing for ${subjectId}:`, err);
      }
    },
  };
}
