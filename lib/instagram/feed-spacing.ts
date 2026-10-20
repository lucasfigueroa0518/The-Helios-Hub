/**
 * Booked feed posts across every content type, for the ≥ 30-minute spacing
 * rule (SH-47). Each schema is read on its own and a missing one is skipped
 * (Explainers may run on their own database locally). Stories are exempt, and
 * so are Trial Reels (D33): they go to non-followers, not the follower feed,
 * so they neither wait for other posts nor make other posts wait. A reel
 * booked on a Main-feed slot (weekly slot calendar) is a feed post; an
 * Explainer on a Trial slot is not.
 */
export type SpacingQuery = (text: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;

/** Feed-posting types by their schema: `social` is Carousels, `lfd` is Last Few Days, `reels` is Text on Screen on a Main-feed slot. */
export type FeedSchema = 'explainers' | 'social' | 'lfd' | 'reels';

const FEED_SCHEMAS: readonly FeedSchema[] = ['explainers', 'social', 'lfd', 'reels'];

const ACTIVE = `status IN ('scheduled', 'publishing', 'published')
   AND publish_at >= $1::timestamptz AND publish_at < $2::timestamptz`;

/** Each type's bookings, on the lifecycle spine (D36). Explainers with no feed_mode are Main, as before. */
const BOOKED: Record<FeedSchema, string> = {
  explainers: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'explainers' AND coalesce(feed_mode, 'main') = 'main' AND ${ACTIVE}`,
  social: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'carousels' AND ${ACTIVE}`,
  lfd: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'last_few_days' AND ${ACTIVE}`,
  reels: `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'reels' AND feed_mode = 'main' AND ${ACTIVE}`,
};

/** Explainers before the feed_mode column exists: every booking is Main. */
const EXPLAINERS_NO_FEED_MODE = `SELECT publish_at FROM social_hub.schedule WHERE vertical = 'explainers' AND ${ACTIVE}`;

function isMissingColumn(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === '42703';
}

/**
 * One schema's booked feed instants in [fromIso, toIso). A database without
 * schedule.feed_mode yet (worker deployed before the schema apply) reads as
 * legacy: every Explainer is Main, and no reel is Main.
 */
async function bookedIn(query: SpacingQuery, schema: FeedSchema, fromIso: string, toIso: string): Promise<Date[]> {
  let rows: Array<Record<string, unknown>>;
  try {
    ({ rows } = await query(BOOKED[schema], [fromIso, toIso]));
  } catch (error) {
    if (!isMissingColumn(error) || (schema !== 'explainers' && schema !== 'reels')) throw error;
    if (schema === 'reels') return [];
    ({ rows } = await query(EXPLAINERS_NO_FEED_MODE, [fromIso, toIso]));
  }
  return rows.map((row) => new Date(String(row.publish_at)));
}

const range = (from: Date): [string, string] => [
  new Date(from.getTime() - 60 * 60_000).toISOString(),
  new Date(from.getTime() + 15 * 86_400_000).toISOString(),
];

/** Feed post instants from `from` through two weeks ahead, in every schema but `except`. */
export async function busyFeedTimes(query: SpacingQuery, from: Date, except: FeedSchema | null = null): Promise<Date[]> {
  const [fromIso, toIso] = range(from);
  const out: Date[] = [];
  for (const schema of FEED_SCHEMAS) {
    if (schema === except) continue;
    try {
      out.push(...(await bookedIn(query, schema, fromIso, toIso)));
    } catch {
      // That schema isn't reachable from this handle: its own scheduler spaces against us.
    }
  }
  return out;
}

/** The scheduler's own schema: other slots of the same type also count as feed posts. */
export async function ownFeedTimes(query: SpacingQuery, schema: FeedSchema, from: Date): Promise<Date[]> {
  const [fromIso, toIso] = range(from);
  return bookedIn(query, schema, fromIso, toIso);
}
