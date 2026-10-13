import type { HubQuery } from '@/lib/social-hub/db';

const slates = new Map<string, string>();

/** One reels slate per NY date (with its reels.runs parent). */
async function slateFor(q: HubQuery, nyDate: string): Promise<string> {
  const hit = slates.get(nyDate);
  if (hit) return hit;
  const run = (await q<{ id: string }>(`INSERT INTO reels.runs (trigger, status) VALUES ('scheduled', 'ok') RETURNING id`)).rows[0]!.id;
  const slate = (await q<{ id: string }>(
    `INSERT INTO reels.score_slates (run_id, ny_date, pass1_version, pass2_version) VALUES ($1, $2, 'p1', 'p2') RETURNING id`,
    [run, nyDate],
  )).rows[0]!.id;
  slates.set(nyDate, slate);
  return slate;
}

export function resetSeed(): void {
  slates.clear();
}

/** A reels idea with its primary source; returns the post_idea id. */
export async function seedReelsIdea(q: HubQuery, o: { headline: string; url: string; body?: string; sourceName?: string }): Promise<string> {
  const idea = (await q<{ id: string }>(`INSERT INTO reels.post_ideas DEFAULT VALUES RETURNING id`)).rows[0]!.id;
  const source = (await q<{ id: string }>(
    `INSERT INTO reels.sources (canonical_url, headline, body, source_name, source_type, adapter_id, bucket, publish_time)
     VALUES ($1, $2, $3, $4, 'A1', 'rss', 'A', now()) RETURNING id`,
    [o.url, o.headline, o.body ?? 'x'.repeat(2000), o.sourceName ?? 'The Verge'],
  )).rows[0]!.id;
  await q(`INSERT INTO reels.post_idea_members (source_id, post_idea_id, role) VALUES ($1, $2, 'primary')`, [source, idea]);
  return idea;
}

/** One score row for an idea on a NY date's slate. */
export async function seedScore(q: HubQuery, idea: string, o: { nyDate: string; origin: 'timely' | 'carryover'; net: number; blockbuster?: number }): Promise<void> {
  const slate = await slateFor(q, o.nyDate);
  await q(
    `INSERT INTO reels.idea_scores (slate_id, post_idea_id, origin, net, blockbuster, components) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb)`,
    [slate, idea, o.origin, o.net, o.blockbuster ?? 0],
  );
}

/** A finished carousel daily run whose record holds a selection shortlist. */
export async function seedCarouselRun(q: HubQuery, finishedAt: string, shortlist: Array<{ id: string; headline: string; source: string; body?: string; outlets?: string[] }>): Promise<void> {
  const record = {
    selection: {
      shortlist: shortlist.map((s) => ({
        id: s.id,
        outlets: s.outlets ?? [s.source],
        publishedAt: finishedAt,
        body: s.body ?? 'y'.repeat(2000),
        representative: { sourceUrl: s.id, headline: s.headline, source: s.source, body: s.body ?? 'y'.repeat(2000), publishedAt: finishedAt },
      })),
    },
  };
  await q(
    `INSERT INTO social.runs (kind, started_at, finished_at, hook_pass, cap_usd, record) VALUES ('daily', $1, $1, false, 0, $2::jsonb)`,
    [finishedAt, JSON.stringify(record)],
  );
}
