import type { Queryable } from '@/lib/explainers/db';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Score } from '@/lib/reel-ai-drama/types';
import { CALIBRATION_ITEMS, CALIBRATION_STORIES, type CalibrationItem } from '@/lib/reel-ai-drama/development/calibration-data';
import { eventKey } from '@/lib/reel-ai-drama/development/dedupe';
import { DRAMA_WEIGHT, MATERIAL_WEIGHT } from '@/lib/reel-ai-drama/development/pool';
import { scoreDrama, scoreMaterial } from '@/lib/reel-ai-drama/development/scores';
import { centralPlayerId } from '@/lib/reel-ai-drama/development/util';

/**
 * Calibration (MD-52's first live step, BUILD_PLAN Phase 3.1): score Lucas's 12 stories and 10 near
 * misses with both Jev sets. It passes when every "make" (the 12 plus "Her voice") ranks above every
 * "skip" on drama, and every skip falls under `drama_bar`. ~44 Jev calls; the live run needs Lucas's
 * go-ahead (BUILD_PLAN estimate $0.10–0.30).
 */

export type CalibrationScore = {
  id: string;
  title: string;
  verdict: CalibrationItem['verdict'];
  drama: Score;
  material: Score;
  /** What the pool would rank it on (drama first, material a little), before bars and bonuses. */
  combined: number;
  /** 1 = highest drama. */
  rank: number;
};

export type CalibrationReport = {
  pass: boolean;
  items: CalibrationScore[];
  dramaBar: number;
  lowestMake: { id: string; drama: number } | null;
  highestSkip: { id: string; drama: number } | null;
  /** Skips scoring at or above a make. */
  skipsAboveAMake: string[];
  /** Skips at or over the drama bar. */
  skipsOverBar: string[];
  /** Makes under the drama bar (reported, not a failure by itself). */
  makesUnderBar: string[];
};

export type CalibrationDeps = {
  jev: DramaJevRunner;
  settings: Pick<ReelAiDramaSettings, 'drama_bar'>;
  /** Defaults to all 22; tests pass a subset. */
  items?: readonly CalibrationItem[];
};

/** The pass test over already-computed scores (pure, so the logic is tested without Jev). */
export function calibrationReport(
  scored: { item: CalibrationItem; drama: Score; material: Score }[],
  dramaBar: number,
): CalibrationReport {
  const items: CalibrationScore[] = scored
    .map(({ item, drama, material }) => ({
      id: item.id,
      title: item.pitch.title,
      verdict: item.verdict,
      drama,
      material,
      combined: Math.round((DRAMA_WEIGHT * drama.score + MATERIAL_WEIGHT * material.score) * 1000) / 1000,
      rank: 0,
    }))
    .sort((a, b) => b.drama.score - a.drama.score || b.combined - a.combined)
    .map((x, i) => ({ ...x, rank: i + 1 }));
  const makes = items.filter((x) => x.verdict === 'make');
  const skips = items.filter((x) => x.verdict === 'skip');
  const lowest = makes.reduce<CalibrationScore | null>((m, x) => (!m || x.drama.score < m.drama.score ? x : m), null);
  const highest = skips.reduce<CalibrationScore | null>((m, x) => (!m || x.drama.score > m.drama.score ? x : m), null);
  const skipsAboveAMake = lowest ? skips.filter((s) => s.drama.score >= lowest.drama.score).map((s) => s.id) : [];
  const skipsOverBar = skips.filter((s) => s.drama.score >= dramaBar).map((s) => s.id);
  return {
    pass: skipsAboveAMake.length === 0 && skipsOverBar.length === 0,
    items,
    dramaBar,
    lowestMake: lowest ? { id: lowest.id, drama: lowest.drama.score } : null,
    highestSkip: highest ? { id: highest.id, drama: highest.drama.score } : null,
    skipsAboveAMake,
    skipsOverBar,
    makesUnderBar: makes.filter((m) => m.drama.score < dramaBar).map((m) => m.id),
  };
}

export async function runCalibration(deps: CalibrationDeps): Promise<CalibrationReport> {
  const scored: { item: CalibrationItem; drama: Score; material: Score }[] = [];
  for (const item of deps.items ?? CALIBRATION_ITEMS) {
    const row = { id: null, pitch: item.pitch };
    scored.push({ item, drama: await scoreDrama(deps.jev, row), material: await scoreMaterial(deps.jev, row) });
  }
  return calibrationReport(scored, deps.settings.drama_bar);
}

/**
 * Lucas's 12 as `origin='seed'` pitches with status `new`, so the next development session runs them
 * through the normal checks (dedupe, both scores, the visuals check). Idempotent by event key.
 */
export async function seedCalibrationPitches(db: Queryable): Promise<number> {
  let inserted = 0;
  for (const item of CALIBRATION_STORIES) {
    const p = item.pitch;
    const key = eventKey(p);
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO reel_ai_drama.pitches (origin, title, pitch, event_key, event_date, central_player_id, status)
       SELECT 'seed', $1, $2::jsonb, $3, $4::date, $5, 'new'
       WHERE NOT EXISTS (SELECT 1 FROM reel_ai_drama.pitches WHERE origin = 'seed' AND event_key = $3)
       RETURNING id`,
      [p.title, JSON.stringify(p), key, p.event_date, centralPlayerId(p)],
    );
    inserted += rows.length;
  }
  return inserted;
}
