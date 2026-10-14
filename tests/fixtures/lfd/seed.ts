import type { HubQuery } from '@/lib/social-hub/db';
import { insertPost } from '@/lib/lfd/store';

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
    `INSERT INTO social.runs (kind, trigger, status, started_at, finished_at, hook_pass, cap_usd, record) VALUES ('daily', 'scheduled', 'ok', $1, $1, false, 0, $2::jsonb)`,
    [finishedAt, JSON.stringify(record)],
  );
}

/**
 * A finished Last Few Days post (3 stories; 8 slide objects in Storage) for
 * spine, publish and hub tests. Story 2's photo is a logo (never recorded as used).
 */
export async function seedLfdPost(
  q: HubQuery,
  o: { nyDate?: string; slug?: string; status?: string; slides?: number; short?: boolean; fitProblems?: string[]; renderProblems?: string[] } = {},
): Promise<string> {
  const nyDate = o.nyDate ?? '2026-10-13';
  const slug = o.slug ?? `lfd-${nyDate}`;
  const stories = [
    { lane: 'major', origin: 'carousel', url: 'https://big.com/haiku', outlet: 'The Verge', headline: 'Anthropic Releases Claude Haiku 5.5', body: 'It is out today', photo: { src: 'https://p/haiku.jpg', credit: 'Anthropic', kind: 'scene' } },
    { lane: 'rundown', origin: 'reels', url: 'https://n.com/1', outlet: 'Wired', headline: 'Niche Thing 1 Happens', body: 'It happened', photo: { src: 'https://p/logo.png', credit: 'Logo', kind: 'logo' } },
    { lane: 'rundown', origin: 'reels', url: 'https://n.com/2', outlet: 'Wired', headline: 'Niche Thing 2 Happens', body: 'It happened', photo: { src: 'https://p/person.jpg', credit: 'Jane Doe / CC BY', kind: 'person' } },
  ];
  const render = {
    caption: 'Caption',
    slides: [
      { position: 0, layoutVariant: 'lfd_cover', altText: 'Do you realize what just happened in AI in the last few days? Trending in AI.' },
      ...stories.map((s, i) => ({ position: i + 1, layoutVariant: 'lfd_story', altText: s.headline, lfdStory: { setup: '', headline: s.headline, highlight: '', names: [], body: s.body }, photoUrl: s.photo.src })),
      { position: stories.length + 1, layoutVariant: 'follow', altText: 'Follow Helios' },
    ],
  };
  const id = await insertPost(q, {
    runId: null,
    slug,
    nyDate,
    ideaIds: stories.map((s) => s.url),
    stories,
    render,
    caption: 'Do you realize what just happened in AI in the last few days? Swipe ⬅️ to catch up.',
    slideObjects: Array.from({ length: o.slides ?? 8 }, (_, i) => `lfd/${slug}/slide-${String(i + 1).padStart(2, '0')}.jpg`),
    fitProblems: o.fitProblems ?? [],
    renderProblems: o.renderProblems ?? [],
    short: o.short ?? false,
  });
  if (o.status && o.status !== 'review') await q(`UPDATE lfd.posts SET status = $2 WHERE id = $1`, [id, o.status]);
  return id;
}
