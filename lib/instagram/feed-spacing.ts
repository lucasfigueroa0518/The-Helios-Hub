/**
 * Booked feed posts across every content type, for the ≥ 30-minute spacing
 * rule (SH-47). Each schema is read on its own and a missing one is skipped
 * (Explainers may run on their own database locally). Stories are exempt.
 */
export type SpacingQuery = (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

export type FeedSchema = 'reels' | 'explainers' | 'social';

const BOOKED = (schema: FeedSchema) => `
SELECT publish_at FROM ${schema}.posting_schedule
 WHERE status IN ('scheduled', 'publishing', 'published')
   AND publish_at >= $1::timestamptz AND publish_at < $2::timestamptz`;

/** Feed post instants from `from` through two weeks ahead, in every schema but `except`. */
export async function busyFeedTimes(query: SpacingQuery, from: Date, except: FeedSchema | null = null): Promise<Date[]> {
  const fromIso = new Date(from.getTime() - 60 * 60_000).toISOString();
  const toIso = new Date(from.getTime() + 15 * 86_400_000).toISOString();
  const out: Date[] = [];
  for (const schema of ['reels', 'explainers', 'social'] as const) {
    if (schema === except) continue;
    try {
      const { rows } = await query(BOOKED(schema), [fromIso, toIso]);
      for (const row of rows) out.push(new Date(String(row.publish_at)));
    } catch {
      // That schema isn't reachable from this handle: its own scheduler spaces against us.
    }
  }
  return out;
}

/** The scheduler's own schema: other slots of the same type also count as feed posts. */
export async function ownFeedTimes(query: SpacingQuery, schema: FeedSchema, from: Date): Promise<Date[]> {
  const { rows } = await query(BOOKED(schema), [new Date(from.getTime() - 60 * 60_000).toISOString(), new Date(from.getTime() + 15 * 86_400_000).toISOString()]);
  return rows.map((r) => new Date(String(r.publish_at)));
}
