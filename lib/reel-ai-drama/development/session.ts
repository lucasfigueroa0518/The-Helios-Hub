import type { Queryable } from '@/lib/explainers/db';
import { developmentSpendSince, recordCost, spendFor } from '@/lib/reel-ai-drama/cost';
import { RecordingDramaJevRunner, type DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { loadSettings, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Pitch, PitchRow } from '@/lib/reel-ai-drama/types';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { eventKey, findDuplicate } from '@/lib/reel-ai-drama/development/dedupe';
import { markSearched, pickCells, seedCells, type CellRow, type NewsItem } from '@/lib/reel-ai-drama/development/ledger';
import { pitchFromRow, rankScore, tendPool } from '@/lib/reel-ai-drama/development/pool';
import { producePitches, ProducerError, MAX_NEAREST, type ProducerDeps } from '@/lib/reel-ai-drama/development/producer';
import { scoreDrama, scoreMaterial } from '@/lib/reel-ai-drama/development/scores';
import { checkVisuals, type VisualsCheckDeps } from '@/lib/reel-ai-drama/development/visuals-check';
import { DAY_MS, centralPlayerId, isoDate } from '@/lib/reel-ai-drama/development/util';

/**
 * One development session (PROCESS.md D1–D7): pick cells → producer → dedupe → drama → material →
 * visuals check (only for pitches clearing both bars) → pool. Pending seed pitches (status `new`) go
 * through the same checks first. It stops starting new work once the week's development spend reaches
 * `weekly_dev_cap_usd` (MD-28); a step already started finishes.
 */

export type DevelopmentDeps = {
  db: Queryable;
  /** The producer's send and prompt loader; the session supplies db, session id, model and count. */
  producer: Pick<ProducerDeps, 'create' | 'loadPrompt'>;
  /** Jev transport (live: `liveJevTransport`); the session wraps it in a RecordingDramaJevRunner. */
  jevTransport: JevTransport;
  /** Visuals-check deps without `record` (the session records each paid call against the pitch). */
  visuals: Omit<VisualsCheckDeps, 'record'>;
  /** News touching a player in the last `days` (live: `newsTouching(storiesDb, now, days)`); none when absent. */
  news?: (now: Date, days: number) => Promise<NewsItem[]>;
  settings?: ReelAiDramaSettings;
  now?: () => Date;
  random?: () => number;
  log?: (event: string, fields?: Record<string, unknown>) => void;
};

export type SessionSummary = {
  sessionId: string;
  status: 'ok' | 'failed' | 'capped';
  trigger: 'auto' | 'click' | 'calibration';
  cellsSearched: number;
  pitchesMade: number;
  pitchesPooled: number;
  duplicates: number;
  rejected: number;
  usd: number;
  weekSpendBefore: number;
  errors: string[];
};

/** News this recent can reopen a searched cell of its player. */
export const NEWS_REOPEN_DAYS = 7;

const WEEK_MS = 7 * DAY_MS;

const REVIVE = {
  drama: 'new reporting shows a central figure whose want drives the events',
  material: 'new photos, documents or posts about the story surface',
  visuals: 'the visuals check finds a face for the central figure and enough story-specific visuals',
} as const;

/** The nearest past pitches for a cell: the same cell first, then any pitch whose cast has the player. */
export async function nearestPitches(db: Queryable, cell: CellRow, limit = MAX_NEAREST): Promise<Pitch[]> {
  const { rows } = await db.query<{ pitch: Pitch }>(
    `SELECT pitch FROM reel_ai_drama.pitches
     WHERE (cell_id = $1 OR central_player_id = $2 OR pitch->'cast' @> jsonb_build_array(jsonb_build_object('player_id', $2::text)))
       AND NOT (origin = 'seed' AND status IN ('rejected', 'retired'))
     ORDER BY (cell_id = $1) DESC NULLS LAST, created_at DESC
     LIMIT $3`,
    [cell.id, cell.player_id, limit],
  );
  return rows.map((r) => r.pitch);
}

async function insertPitch(
  db: Queryable,
  p: Pitch,
  ids: { sessionId: string; searchId: string | null; cellId: string | null },
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.pitches (session_id, search_id, cell_id, origin, title, pitch, event_key, event_date, central_player_id, status)
     VALUES ($1, $2, $3, 'producer', $4, $5::jsonb, $6, $7::date, $8, 'new') RETURNING id`,
    [ids.sessionId, ids.searchId, ids.cellId, p.title, JSON.stringify(p), eventKey(p), p.event_date, centralPlayerId(p)],
  );
  return rows[0].id;
}

async function setStatus(
  db: Queryable,
  id: string,
  now: Date,
  fields: Partial<Record<'status' | 'duplicate_of' | 'reject_reason' | 'revive_when' | 'rank_score' | 'drama' | 'drama_score' | 'material' | 'material_score' | 'visuals_card' | 'visuals_grade', unknown>>,
): Promise<void> {
  const keys = Object.keys(fields);
  const json = new Set(['drama', 'material', 'visuals_card']);
  const sets = keys.map((k, i) => `${k} = $${i + 3}${json.has(k) ? '::jsonb' : ''}`);
  await db.query(`UPDATE reel_ai_drama.pitches SET ${[...sets, 'updated_at = $2'].join(', ')} WHERE id = $1`, [
    id,
    now.toISOString(),
    ...keys.map((k) => (json.has(k) ? JSON.stringify((fields as Record<string, unknown>)[k]) : (fields as Record<string, unknown>)[k])),
  ]);
}

type Outcome = 'duplicate' | 'rejected' | 'pooled';

/** Dedupe → drama → material → visuals → pool, for one pitch already saved as `new`. */
async function checkPitch(
  ctx: { db: Queryable; jev: DramaJevRunner; deps: DevelopmentDeps; settings: ReelAiDramaSettings; sessionId: string; now: Date },
  id: string,
  p: Pitch,
): Promise<Outcome> {
  const { db, jev, settings, now } = ctx;
  const dup = await findDuplicate(db, jev, p, { excludeId: id, pitchId: id });
  if (dup) {
    await setStatus(db, id, now, { status: 'duplicate', duplicate_of: dup.duplicateOf, reject_reason: dup.why });
    return 'duplicate';
  }
  const drama = await scoreDrama(jev, { id, pitch: p });
  await setStatus(db, id, now, { drama, drama_score: drama.score });
  if (drama.score < settings.drama_bar) {
    await setStatus(db, id, now, { status: 'rejected', reject_reason: `drama ${drama.score} under the bar ${settings.drama_bar}`, revive_when: REVIVE.drama });
    return 'rejected';
  }
  const material = await scoreMaterial(jev, { id, pitch: p });
  await setStatus(db, id, now, { material, material_score: material.score });
  if (material.score < settings.material_bar) {
    await setStatus(db, id, now, { status: 'rejected', reject_reason: `material ${material.score} under the bar ${settings.material_bar}`, revive_when: REVIVE.material });
    return 'rejected';
  }
  const card = await checkVisuals(
    {
      ...ctx.deps.visuals,
      record: (line) =>
        recordCost(db, {
          sessionId: ctx.sessionId,
          pitchId: id,
          mode: 'development',
          vendor: line.vendor,
          component: 'visuals_check',
          inputTokens: line.inputTokens,
          outputTokens: line.outputTokens,
          cacheReadTokens: line.cacheReadTokens,
          cacheWriteTokens: line.cacheWriteTokens,
          usd: line.usd,
        }),
    },
    p,
    settings.visuals_check_cap_usd,
  );
  if (card.grade === 'red') {
    await setStatus(db, id, now, {
      visuals_card: card,
      visuals_grade: card.grade,
      status: 'rejected',
      reject_reason: `thin visuals: ${card.gaps.join('; ') || 'too few'}`,
      revive_when: REVIVE.visuals,
    });
    return 'rejected';
  }
  const { rows } = await db.query<Record<string, unknown>>('SELECT * FROM reel_ai_drama.pitches WHERE id = $1', [id]);
  const row: PitchRow = { ...pitchFromRow(rows[0]), visuals_card: card, visuals_grade: card.grade };
  await setStatus(db, id, now, {
    visuals_card: card,
    visuals_grade: card.grade,
    status: 'pooled',
    reject_reason: card.grade === 'amber' ? `thin visuals: ${card.gaps.join('; ')}` : null,
    rank_score: rankScore(row, settings, now),
  });
  return 'pooled';
}

export async function runDevelopmentSession(
  deps: DevelopmentDeps,
  opts: { trigger: 'auto' | 'click' | 'calibration' },
): Promise<SessionSummary> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const settings = deps.settings ?? (await loadSettings(db));
  const log = deps.log ?? (() => {});
  const weekStart = new Date(now.getTime() - WEEK_MS);
  const weekSpendBefore = await developmentSpendSince(db, weekStart);

  const { rows: [session] } = await db.query<{ id: string }>(
    `INSERT INTO reel_ai_drama.sessions (status, mode, trigger, started_at) VALUES ('running', 'development', $1, $2) RETURNING id`,
    [opts.trigger, now.toISOString()],
  );
  const sessionId = session.id;
  const summary: SessionSummary = {
    sessionId,
    status: 'ok',
    trigger: opts.trigger,
    cellsSearched: 0,
    pitchesMade: 0,
    pitchesPooled: 0,
    duplicates: 0,
    rejected: 0,
    usd: 0,
    weekSpendBefore,
    errors: [],
  };
  const capReached = async () => (await developmentSpendSince(db, weekStart)) >= settings.weekly_dev_cap_usd;
  const jev = new RecordingDramaJevRunner(deps.jevTransport, db, { mode: 'development', sessionId });
  const ctx = { db, jev, deps, settings, sessionId, now };
  const tally = (o: Outcome) => {
    if (o === 'pooled') summary.pitchesPooled += 1;
    else if (o === 'duplicate') summary.duplicates += 1;
    else summary.rejected += 1;
  };

  try {
    // Pending pitches first (seeds from seedCalibrationPitches, or any left `new` by a failed session).
    const { rows: pending } = await db.query<{ id: string; pitch: Pitch }>(
      `SELECT id, pitch FROM reel_ai_drama.pitches WHERE status = 'new' ORDER BY created_at`,
    );
    for (const row of pending) {
      if (await capReached()) {
        summary.status = 'capped';
        break;
      }
      try {
        tally(await checkPitch(ctx, row.id, row.pitch));
      } catch (e) {
        summary.errors.push(`pitch ${row.id}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (opts.trigger !== 'calibration' && summary.status !== 'capped') {
      await seedCells(db);
      const news = deps.news ? await deps.news(now, NEWS_REOPEN_DAYS) : [];
      const reopen = news.map((n) => ({ playerId: n.playerId, reason: `news: ${n.headline}`, since: n.publishedAt }));
      const cells = await pickCells(db, settings, now, { reopen, random: deps.random });
      log('cells', { picked: cells.map((c) => `${c.player_id}/${c.story_type}/${c.era}`) });

      for (const cell of cells) {
        if (await capReached()) {
          summary.status = 'capped';
          break;
        }
        const { rows: [search] } = await db.query<{ id: string }>(
          `INSERT INTO reel_ai_drama.searches (session_id, cell_id, started_at) VALUES ($1, $2, $3) RETURNING id`,
          [sessionId, cell.id, now.toISOString()],
        );
        const producerDeps: ProducerDeps = {
          ...deps.producer,
          db,
          sessionId,
          model: settings.producer_model,
          pitchesPerCell: settings.pitches_per_cell,
        };
        let pitches: Pitch[];
        try {
          const result = await producePitches(producerDeps, cell, {
            nearest: await nearestPitches(db, cell),
            news: news.filter((n) => n.playerId === cell.player_id),
            today: isoDate(now),
          });
          pitches = result.pitches;
          await db.query(
            `UPDATE reel_ai_drama.searches SET queries = $2::jsonb, pitches_made = $3, empty = $4, error = $5, finished_at = $6 WHERE id = $1`,
            [search.id, JSON.stringify(result.queries), pitches.length, pitches.length === 0, result.dropped.length ? `dropped: ${result.dropped.map((d) => `${d.title} (${d.why})`).join('; ')}`.slice(0, 2000) : null, new Date().toISOString()],
          );
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          summary.errors.push(`cell ${cell.player_id}/${cell.story_type}/${cell.era}: ${msg}`);
          await db.query(`UPDATE reel_ai_drama.searches SET error = $2, queries = $3::jsonb, finished_at = $4 WHERE id = $1`, [
            search.id,
            msg.slice(0, 2000),
            JSON.stringify(e instanceof ProducerError ? e.spend.queries : []),
            new Date().toISOString(),
          ]);
          continue; // not marked searched: the cell stays a candidate
        }
        summary.cellsSearched += 1;
        summary.pitchesMade += pitches.length;
        await markSearched(db, cell.id, { pitchesMade: pitches.length, now, dueDays: settings.cell_due_days });

        for (const p of pitches) {
          const id = await insertPitch(db, p, { sessionId, searchId: search.id, cellId: cell.id });
          if (await capReached()) {
            summary.status = 'capped';
            continue; // saved as `new`: the next session checks it
          }
          try {
            tally(await checkPitch(ctx, id, p));
          } catch (e) {
            summary.errors.push(`pitch ${p.title}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
        if (summary.status === 'capped') break;
      }
    }
    await tendPool(db, settings, now);
  } catch (e) {
    summary.status = 'failed';
    summary.errors.push(e instanceof Error ? e.message : String(e));
  }

  summary.usd = await spendFor(db, { sessionId });
  await db.query(
    `UPDATE reel_ai_drama.sessions SET status = $2, cells_searched = $3, pitches_made = $4, pitches_pooled = $5, error = $6, finished_at = $7 WHERE id = $1`,
    [sessionId, summary.status, summary.cellsSearched, summary.pitchesMade, summary.pitchesPooled, summary.errors.join('\n').slice(0, 4000) || null, new Date().toISOString()],
  );
  log('session', { ...summary });
  return summary;
}
