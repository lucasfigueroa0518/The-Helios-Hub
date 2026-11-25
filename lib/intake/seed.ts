/**
 * addIntakeSeed (Owner B; contract AddIntakeSeed). A person pastes a link for
 * one order: the page is read with the same plain reader LFD seeds use (no
 * model, no search), the item joins the story that already holds that link or
 * an identical headline, else a new story is made; that ONE story is then
 * scored with the order's scorecards and marked yours: the item carries
 * `seeded_by` and `seed_order` (db/intake_schema.sql: a story with a seeded
 * member is yours).
 *
 * Joining is exact only (same item key, or the same headline, case-folded).
 * Grouping-v2's similarity runs on the next intake run like for any item.
 */
import { randomUUID } from 'node:crypto';

import { isPrivateHost } from '@/lib/net/private-host';
import { fetchBodyLive, type FetchBody } from '@/lib/social/ingest/select/enrich';
import { SeedError } from '@/lib/social/overnight/seeds';
import { intakeItemKey } from '@/lib/intake/fetch';

import { orderById } from './orders';
import { scoreForStories, type ScoreOptions } from './score';
import { INTAKE_SCORECARDS } from './scorecards';
import type { AddIntakeSeed, Family, IntakeItem, IntakeOrder, IntakeQuery, IntakeStory, Scorecard } from './types';

export { SeedError };

const MIN_PAGE_CHARS = 200; // lib/lfd/seeds.ts

export type SeedDeps = {
  /** The page reader LFD seeds use (fetchBodyLive); a stub in tests. */
  fetchBody: FetchBody;
  scorecards?: readonly Scorecard[];
  orders?: (id: IntakeOrder['id']) => IntakeOrder;
  newId?: () => string;
  score?: ScoreOptions;
};

type ItemRow = {
  key: string; family: Family; source_id: string; source_name: string; source_type: IntakeItem['sourceType'];
  headline: string; body: string; url: string; publish_time: string | Date | null; first_seen_at: string | Date; last_seen_at: string | Date;
  engagement: Record<string, number> | null; drop_reason: string | null; story_id: string | null; role: IntakeItem['role'];
  feed_slug?: string | null; feed_drop_reason?: string | null; feed_source_name?: string | null; reels_source_id?: string | null; reels_drop_reason?: string | null;
};
type StoryRow = { id: string; representative_key: string; headline: string; first_seen_at: string | Date; last_joined_at: string | Date; merged_into: string | null };

const d = (v: string | Date) => (v instanceof Date ? v : new Date(v));

function toItem(r: ItemRow): IntakeItem {
  return {
    key: r.key, family: r.family, sourceId: r.source_id, sourceName: r.source_name, sourceType: r.source_type,
    headline: r.headline, body: r.body, url: r.url, publishTime: r.publish_time === null ? null : d(r.publish_time),
    firstSeenAt: d(r.first_seen_at), lastSeenAt: d(r.last_seen_at), engagement: r.engagement, dropReason: r.drop_reason,
    feedSlug: r.feed_slug ?? null, feedDropReason: r.feed_drop_reason ?? null, feedSourceName: r.feed_source_name ?? null,
    reelsSourceId: r.reels_source_id ?? null, reelsDropReason: r.reels_drop_reason ?? null,
    storyId: r.story_id, role: r.role,
  };
}

/** One story with its members (by id; never a scan). */
export async function loadStory(q: IntakeQuery, id: string): Promise<IntakeStory> {
  const s = (await q.query<StoryRow>(`SELECT id::text AS id, representative_key, headline, first_seen_at, last_joined_at, merged_into::text AS merged_into FROM intake.stories WHERE id = $1`, [id])).rows[0];
  if (!s) throw new Error(`intake story ${id} not found`);
  const { rows } = await q.query<ItemRow>(
    `SELECT key, family, source_id, source_name, source_type, headline, body, url, publish_time, first_seen_at, last_seen_at, engagement, drop_reason, story_id::text AS story_id, role,
            feed_slug, feed_drop_reason, feed_source_name, reels_source_id, reels_drop_reason
       FROM intake.items WHERE story_id = $1 ORDER BY first_seen_at`,
    [id],
  );
  return {
    id: s.id, representativeKey: s.representative_key, headline: s.headline, firstSeenAt: d(s.first_seen_at),
    lastJoinedAt: d(s.last_joined_at), mergedInto: s.merged_into, members: rows.map(toItem),
  };
}

const clean = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function makeAddIntakeSeed(deps: SeedDeps): AddIntakeSeed {
  const cards = deps.scorecards ?? INTAKE_SCORECARDS;
  const getOrder = deps.orders ?? orderById;
  const newId = deps.newId ?? randomUUID;

  return async (q, jev, input, now) => {
    const order = getOrder(input.order);
    const url = clean(input.url, 2000);
    if (!/^https?:\/\//i.test(url)) throw new SeedError(400, 'Paste the story’s link; it must start with http:// or https://');
    let outlet: string;
    try {
      const u = new URL(url);
      if (isPrivateHost(u.hostname)) throw new Error('private');
      outlet = u.hostname.replace(/^www\./, '');
    } catch {
      throw new SeedError(400, 'That link doesn’t look right, or points somewhere private.');
    }
    const key = intakeItemKey(url);

    const existing = (await q.query<{ story_id: string | null }>(`SELECT story_id::text AS story_id FROM intake.items WHERE key = $1`, [key])).rows[0];
    let storyId: string;
    let created = false;

    if (existing?.story_id) {
      // The link is already in a story: the seed joins it as is and marks that item yours.
      storyId = existing.story_id;
      await q.query(`UPDATE intake.items SET seeded_by = $2, seed_order = $3, last_seen_at = $4 WHERE key = $1`, [key, input.seededBy, order.id, now]);
    } else {
      const given = clean(input.body, 20_000);
      const body = given.length >= MIN_PAGE_CHARS ? given : await deps.fetchBody(url).catch(() => null);
      if (!body || body.trim().length < MIN_PAGE_CHARS) throw new SeedError(422, 'I couldn’t read that page (a paywall, or too little text). Nothing was added.');
      const headline = clean(input.headline, 200) || (body.split('\n').map((l) => l.trim()).find((l) => l.length > 15) ?? url).slice(0, 140);

      const same = (await q.query<{ id: string }>(
        `SELECT id::text AS id FROM intake.stories WHERE merged_into IS NULL AND lower(headline) = lower($1) ORDER BY last_joined_at DESC LIMIT 1`,
        [headline],
      )).rows[0];
      if (same) {
        storyId = same.id;
        await q.query(`UPDATE intake.stories SET last_joined_at = $2 WHERE id = $1`, [storyId, now]);
      } else {
        storyId = newId();
        created = true;
        await q.query(
          `INSERT INTO intake.stories (id, representative_key, headline, first_seen_at, last_joined_at) VALUES ($1, $2, $3, $4, $4)`,
          [storyId, key, headline, now],
        );
      }
      const role = created ? 'primary' : 'supporting';
      if (existing) {
        // Known link with no story (a dropped item): the person's seed overrides the drop, for every list it is on.
        await q.query(
          `UPDATE intake.items SET story_id = $2, role = $3, drop_reason = NULL, feed_drop_reason = NULL, reels_drop_reason = NULL,
                  last_seen_at = $4, joined_at = $4, seeded_by = $5, seed_order = $6 WHERE key = $1`,
          [key, storyId, role, now, input.seededBy, order.id],
        );
      } else {
        await q.query(
          `INSERT INTO intake.items (key, family, source_id, source_name, source_type, headline, body, url, publish_time, first_seen_at, last_seen_at, engagement, drop_reason, story_id, role, joined_at, seeded_by, seed_order)
           VALUES ($1, 'seed', $2, $3, 'seed', $4, $5, $6, NULL, $7, $7, NULL, NULL, $8, $9, $7, $10, $11)`,
          [key, `seed:${order.id}`, outlet, headline, body, url, now, storyId, role, input.seededBy, order.id],
        );
      }
    }

    const story = await loadStory(q, storyId);
    await scoreForStories(q, jev, [story], [order], cards.filter((c) => order.scorecards.includes(c.id)), deps.score);

    return { storyId, created };
  };
}

export const addIntakeSeed: AddIntakeSeed = makeAddIntakeSeed({ fetchBody: fetchBodyLive });
