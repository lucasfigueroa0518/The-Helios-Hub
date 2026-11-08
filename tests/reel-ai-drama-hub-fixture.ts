/**
 * Shared PGlite fixtures for the hub-wiring tests (HUB-WIRING-CONTRACT.md §8, Builder A). Nothing here calls a model,
 * Meta, HeyGen or the network.
 */
import type { ExplainersDb } from '@/lib/explainers/db';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';

import { scratchExplainersDb } from './explainers-pglite';

/** The social_hub constraint widening of §3.2 (Builder B owns the file; applied here too so these tests stand alone). */
const SPINE_WIDENING = [
  `ALTER TABLE social_hub.content_items DROP CONSTRAINT IF EXISTS content_items_vertical_check`,
  `ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'reel_ai_drama'))`,
  `ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT IF EXISTS idea_adjustments_vertical_check`,
  `ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'reel_ai_drama'))`,
  `ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check`,
  `ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon')) OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
    OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening')) OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'last_few_days' AND slot IN ('morning')) OR (vertical = 'ai_events' AND slot IN ('evening', 'night'))
    OR (vertical = 'reel_ai_drama' AND slot IN ('evening')) OR slot ~ '^t[0-9]{4}(:[a-z_]+)?$')`,
  `ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_feed_mode_check`,
  `ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_feed_mode_check CHECK (feed_mode IS NULL OR (vertical IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IN ('trial', 'main')))`,
  `ALTER TABLE social_hub.publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_trigger_check`,
  `ALTER TABLE social_hub.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (
    (vertical IN ('carousels', 'explainers', 'last_few_days', 'ai_events', 'reel_ai_drama') AND trigger IN ('approve', 'auto', 'force'))
    OR (vertical = 'reels' AND trigger IN ('approve', 'auto', 'mix_test', 'force')) OR (vertical = 'stories' AND trigger IN ('approve', 'auto')))`,
  `ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_feed_mode_check`,
  `ALTER TABLE social_hub.slot_template ADD CONSTRAINT slot_template_feed_mode_check CHECK (
    (vertical IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IS NOT NULL AND feed_mode IN ('trial', 'main'))
    OR (vertical NOT IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IS NULL))`,
];

export async function dramaHubDb(): Promise<ExplainersDb> {
  const { db } = await scratchExplainersDb();
  await ensureReelAiDramaSchema(db);
  for (const sql of SPINE_WIDENING) await db.query(sql);
  return db;
}

export const POST = { caption: 'The deal nobody saw coming.', question: 'Would you have signed?', credits: ['Photo: AP', 'Photo: Reuters'] };

export async function pitch(db: ExplainersDb, opts: { title?: string; status?: string; rank?: number; player?: string | null } = {}): Promise<string> {
  const title = opts.title ?? `Pitch ${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (title, pitch, event_key, status, rank_score, central_player_id)
     VALUES ($1, $2::jsonb, $3, $4, $5, $6) RETURNING id`,
    [title, JSON.stringify({ title, brief: `${title} brief`, story_type: 'deal', era: 'race', sources: [{ url: 'https://example.com/a', title: 'A' }] }), `key:${title}`, opts.status ?? 'pooled', opts.rank ?? 0.5, opts.player ?? null],
  );
  return rows[0].id;
}

/** A finished job for a fresh pitch: its video artifact (bucket by default) and its post text. */
export async function finishedJob(
  db: ExplainersDb,
  opts: { location?: 'local' | 'bucket'; post?: unknown; trigger?: 'auto' | 'click'; pitchId?: string; title?: string } = {},
): Promise<{ jobId: string; pitchId: string }> {
  const pitchId = opts.pitchId ?? (await pitch(db, { status: 'made', title: opts.title }));
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.jobs (pitch_id, status, trigger, mode, spend_cap_usd, started_at, finished_at)
     VALUES ($1, 'ok', $2, 'production', 8, now() - interval '1 hour', now()) RETURNING id`,
    [pitchId, opts.trigger ?? 'click'],
  );
  const jobId = rows[0].id;
  await db.query(
    `INSERT INTO reel_ai_drama.artifacts (job_id, kind, storage_path, bytes, storage_location) VALUES ($1, 'video', $2, 10, $3)`,
    [jobId, `reel-ai-drama/jobs/${jobId}/video.mp4`, opts.location ?? 'bucket'],
  );
  if (opts.post !== null) await db.query(`INSERT INTO reel_ai_drama.artifacts (job_id, kind, content) VALUES ($1, 'post_text', $2)`, [jobId, JSON.stringify(opts.post ?? POST)]);
  return { jobId, pitchId };
}

export async function setDrama(db: ExplainersDb, key: string, value: unknown): Promise<void> {
  await db.query(
    `INSERT INTO reel_ai_drama.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, JSON.stringify(value)],
  );
}
