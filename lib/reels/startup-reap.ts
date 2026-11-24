/**
 * Called once when helios-reels boots (daemon mode), before it claims anything (CI-33). The night run and the copy,
 * frame, video and song-pick stages run only inside that one daemon, so a row still 'running' at boot died with the
 * previous process (a deploy restart). Each is failed now with its own reaper's wording, instead of after the 12 h
 * backstop (the age reapers in releaseStaleRuns and each stage's claim stay as the backstop).
 */
type Query = (text: string, params?: unknown[]) => Promise<{ rowCount: number | null }>;

const STAGES: ReadonlyArray<{ table: string; noteColumn: 'note' | 'error'; message: string; keepExisting: boolean }> = [
  { table: 'reels.runs', noteColumn: 'note', message: 'Run did not report a result; released as stale.', keepExisting: true },
  { table: 'reels.copy_jobs', noteColumn: 'error', message: 'The worker stopped while this copy was running.', keepExisting: false },
  { table: 'reels.visual_jobs', noteColumn: 'error', message: 'The worker stopped while this frame was running.', keepExisting: false },
  { table: 'reels.video_jobs', noteColumn: 'error', message: 'The worker stopped while this video was running.', keepExisting: false },
  { table: 'reels.song_picks', noteColumn: 'error', message: 'The worker stopped while this song pick was running.', keepExisting: false },
];

/** Returns how many rows each table had failed (tables with none are omitted). */
export async function reapReelsAtStartup(query?: Query): Promise<Record<string, number>> {
  const q: Query = query ?? (async (text, params) => (await import('@/lib/db')).dbQuery(text, params));
  const out: Record<string, number> = {};
  for (const s of STAGES) {
    const value = s.keepExisting ? `COALESCE(${s.noteColumn}, $1)` : '$1';
    const { rowCount } = await q(
      `UPDATE ${s.table} SET status = 'failed', finished_at = now(), ${s.noteColumn} = ${value} WHERE status = 'running'`,
      [s.message],
    );
    if (rowCount) out[s.table] = rowCount;
  }
  return out;
}
