/**
 * Offline fixtures for the AI Events engine tests: the hub's PGlite (every real schema, including
 * networking and ai_events), kept events, a stub Jev transport and a stub render. No network, no
 * model (CLAUDE.md Rule 1).
 */
import type { PGlite } from '@electric-sql/pglite';
import type { EntryType, Questions, SystemOneResult } from '@typesafe-ai/sdk';

import type { AiEventsEngineDeps } from '@/lib/ai-events/run';
import { PLANTED_ID, VALUE_IDS } from '@/lib/networking/pick/score';
import type { EventPickState } from '@/lib/networking/pick/state';
import type { Metro } from '@/lib/networking/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import type { HubQuery } from '@/lib/social-hub/db';
import type { FitResult } from '@/lib/social/render/fit-check';

import { openHubTestDb } from '../social-hub/pglite';

/** Sunday 2026-10-25, 12:00 PM New York: the clock's run. The coming week is Mon Oct 26 to Sun Nov 1 (2026-W44). */
export const SUN_NOON = new Date('2026-10-25T16:00:00Z');
export const WEEK = '2026-W44';

/**
 * The spine's vertical checks (db/social_hub_schema.sql) learn 'ai_events' with the hub
 * registration (plan M4). Until the file carries the id, these engine tests lift the three
 * checks that would refuse it; once it does, the real checks stay and are exercised.
 */
async function allowAiEventsOnSpine(pg: PGlite): Promise<void> {
  const { rows } = await pg.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'content_items_vertical_check'`,
  );
  if (rows[0]?.def.includes('ai_events')) return;
  await pg.exec(`
    ALTER TABLE social_hub.content_items DROP CONSTRAINT IF EXISTS content_items_vertical_check;
    ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
    ALTER TABLE social_hub.publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_trigger_check;
  `);
}

export async function openAiEventsDb(o: { publishingLive?: boolean } = {}): Promise<{ pg: PGlite; query: HubQuery }> {
  const { pg, query } = await openHubTestDb();
  await allowAiEventsOnSpine(pg);
  if (o.publishingLive) await query(`UPDATE ai_events.settings SET value = 'true'::jsonb WHERE key = 'publishing_live'`);
  return { pg, query };
}

let seq = 0;

/** One kept, scheduled, in-person tech event. */
export async function addEvent(
  q: HubQuery,
  o: { title: string; metro?: Metro; startAt: string; organizer?: string | null; guests?: number | null; bucket?: string; url?: string },
): Promise<string> {
  seq += 1;
  const { rows } = await q<{ id: string }>(
    `INSERT INTO networking.events (fingerprint, title, description, canonical_url, start_at, timezone, metro, attendance, access, bucket, status,
                                    organizer_name, guest_count, venue_name, is_free)
     VALUES ($1, $2, $3, $4, $5, NULL, $6, 'in_person', 'open', $7, 'scheduled', $8, $9, $10, true)
     RETURNING id::text AS id`,
    [
      `ae-fp-${seq}`,
      o.title,
      `${o.title}: talks, demos and networking.`,
      o.url ?? `https://luma.com/ae${seq}`,
      o.startAt,
      o.metro ?? 'boston',
      o.bucket ?? 'tech',
      o.organizer === undefined ? `Org ${seq}` : o.organizer,
      o.guests ?? null,
      `Venue ${seq}`,
    ],
  );
  return rows[0]!.id;
}

/** Jev answers by event title: every gate passes and every value question answers `value` (0.6) unless overridden. */
export function stubJev(byTitle: Record<string, Record<string, number>> = {}): JevTransport & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async systemOne<const Q extends Questions>(state: EntryType, questions: Q): Promise<SystemOneResult<Q>> {
      const title = (state as unknown as EventPickState).title;
      calls.push(title);
      const o = byTitle[title] ?? {};
      const base: Record<string, number> = {
        in_person_networking: 0.9,
        vendor_pitch: 0.1,
        get_rich: 0.05,
        ai_relevant: 0.9,
        [PLANTED_ID]: 0.02,
        ...Object.fromEntries(VALUE_IDS.map((id) => [id, o.value ?? 0.6])),
        ...Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'value')),
      };
      const answers = Object.fromEntries(Object.keys(questions).map((k) => [k, { type: 'noul', noul: base[k] ?? 0 }]));
      return { model: 'jev-stub-1', answers, usage: { input_tokens: 1000, output_tokens: 0 } } as unknown as SystemOneResult<Q>;
    },
  };
}

export type StubEngine = AiEventsEngineDeps & { uploads: string[]; renders: number };

/**
 * Engine deps with a stub render: one small PNG per slide into the fit-check's screenshot dir
 * (so the real storeSlideJpegs converts and "uploads" them), and `problems` reported when given.
 */
export function stubEngine(query: HubQuery, ask: JevTransport, o: { problems?: string[]; rand?: () => number } = {}): StubEngine {
  const uploads: string[] = [];
  const deps: StubEngine = {
    query,
    ask,
    uploads,
    renders: 0,
    now: SUN_NOON,
    rand: o.rand ?? (() => 0),
    upload: async (p) => {
      uploads.push(p);
    },
    fitCheck: async (post, opts): Promise<FitResult> => {
      deps.renders += 1;
      if (opts?.screenshotDir) {
        const fs = await import('node:fs/promises');
        const sharp = (await import('sharp')).default;
        for (let i = 1; i <= post.slides.length; i++) {
          const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: { r: i * 20, g: 0, b: 0 } } }).png().toBuffer();
          await fs.writeFile(`${opts.screenshotDir}/slide-slide-${String(i).padStart(2, '0')}.png`, png);
        }
      }
      const problems = o.problems ?? [];
      return { ok: problems.length === 0, violations: [], problems, slideText: [] } as unknown as FitResult;
    },
  };
  return deps;
}

/** A review post for a week (its Sunday is `nyDate`), with two slide objects and a caption, as a run leaves it. */
export async function seedAiEventsPost(
  q: HubQuery,
  o: { weekKey?: string; nyDate?: string; hook?: string; look?: string; status?: string; slug?: string; metro?: string | null } = {},
): Promise<string> {
  const weekKey = o.weekKey ?? WEEK;
  const { rows } = await q<{ id: string }>(
    `INSERT INTO ai_events.posts (week_key, slug, ny_date, status, hook, look, cities, render, caption, slide_objects, metro)
     VALUES ($1, $2, $3::date, $4, $5, $6, '[]'::jsonb, '{}'::jsonb, 'Caption', $7::jsonb, $8) RETURNING id::text AS id`,
    [
      weekKey,
      o.slug ?? `ai-events-${weekKey.toLowerCase()}${o.metro ? `-${o.metro}` : ''}`,
      o.nyDate ?? '2026-10-25',
      o.status ?? 'review',
      o.hook ?? 'one_event',
      o.look ?? 'spotlight',
      JSON.stringify([`ai-events/${weekKey}/slide-01.jpg`, `ai-events/${weekKey}/slide-02.jpg`]),
      o.metro ?? null,
    ],
  );
  return rows[0]!.id;
}

/** A review post as a real run leaves it: the render the builder makes for one Boston pick, its caption and slide objects. */
export async function seedRenderedPost(q: HubQuery, o: { weekKey?: string; nyDate?: string; slug?: string; status?: string } = {}): Promise<{ id: string; slides: number }> {
  const { buildAiEventsPost } = await import('@/lib/ai-events/post');
  const weekKey = o.weekKey ?? WEEK;
  const cities = [
    {
      metro: 'boston' as const,
      remainingCount: 4,
      picks: [{
        id: 'e1', title: 'Boston AI Builders Night | Oct 27', start: '2026-10-27T22:30:00Z', end: null, timezone: 'America/New_York', metro: 'boston' as const,
        organizer: 'AI Tinkerers', venue: 'CIC Cambridge', city: 'Cambridge', price: { free: true, minCents: null, maxCents: null, currency: null },
        access: 'open' as const, soldOut: false, waitlist: false, going: 120, rsvpUrl: 'https://luma.com/boston-builders',
      }],
    },
  ];
  const render = buildAiEventsPost({ weekKey, weekStart: '2026-10-26', weekEnd: '2026-11-01', cities, hookKey: 'one_event', look: 'spotlight' });
  const slug = o.slug ?? `ai-events-${weekKey.toLowerCase()}`;
  const objects = render.slides.map((_, i) => `ai-events/${slug}/v1/slide-${String(i + 1).padStart(2, '0')}.jpg`);
  const { rows } = await q<{ id: string }>(
    `INSERT INTO ai_events.posts (week_key, slug, ny_date, status, hook, look, event_ids, cities, render, caption, slide_objects)
     VALUES ($1, $2, $3::date, $4, 'one_event', 'spotlight', $5, $6::jsonb, $7::jsonb, $8, $9::jsonb) RETURNING id::text AS id`,
    [weekKey, slug, o.nyDate ?? '2026-10-25', o.status ?? 'review', ['e1'], JSON.stringify(cities), JSON.stringify(render), render.caption, JSON.stringify(objects)],
  );
  return { id: rows[0]!.id, slides: render.slides.length };
}

/** One pool row for `eventId` in `weekKey`, with its stored event-pick@1 parts when `parts` is given. */
export async function seedPoolRow(
  q: HubQuery,
  eventId: string,
  o: { weekKey?: string; metro?: string; rank?: number | null; score?: number | null; gate?: string | null; picked?: boolean; pickRank?: number | null; pinnedBy?: string; excludedBy?: string; parts?: unknown[] } = {},
): Promise<void> {
  await q(
    `INSERT INTO ai_events.pool (week_key, event_id, metro, rank, score, gate, picked, pick_rank, pinned_by, pinned_at, excluded_by, excluded_at, updated_at)
     VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8, $9, CASE WHEN $9::text IS NULL THEN NULL ELSE now() END, $10, CASE WHEN $10::text IS NULL THEN NULL ELSE now() END, '2026-10-25T16:05:00Z')`,
    [o.weekKey ?? WEEK, eventId, o.metro ?? 'boston', o.rank === undefined ? 1 : o.rank, o.score === undefined ? 5 : o.score, o.gate ?? null, o.picked ?? false, o.pickRank ?? null, o.pinnedBy ?? null, o.excludedBy ?? null],
  );
  if (o.parts) {
    await q(
      `INSERT INTO networking.event_scores (event_id, set_version, answers, gate, score, parts) VALUES ($1::uuid, 'event-pick@1', '{}'::jsonb, $2, $3, $4::jsonb)`,
      [eventId, o.gate ?? null, o.score ?? null, JSON.stringify(o.parts)],
    );
  }
}
