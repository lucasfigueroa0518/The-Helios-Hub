/**
 * Run now's live reads and actions (server only). Each action is the call the
 * type's own button makes, so every guard it has still applies (one queued
 * run per type, one build per reel idea, one render per topic, one set per
 * series a day).
 */
import { dbQuery } from '@/lib/db';
import { loadSettings as loadCarouselSettings, requestManualRun } from '@/lib/carousels/overview';
import { readPosting } from '@/lib/content-type/posting';
import { explainersDb } from '@/lib/explainers/connection';
import { requestRender } from '@/lib/explainers/repository';
import { loadSettings as loadExplainerSettings } from '@/lib/explainers/settings';
import { pendingRun, requestRun } from '@/lib/reels/repository';
import { requestFinish, todaySlateFor } from '@/lib/reels/visual/finish';
import { liveHubQuery } from '@/lib/social-hub/db';
import { loadDataset } from '@/lib/social-hub/load';
import { planFrom, quotaCandidates, typeDay, type PlanStep, type RunPlan } from '@/lib/social-hub/run-today';
import { DEFAULT_DAY_QUOTAS } from '@/lib/social-hub/queries/day';
import { nyDateOf } from '@/lib/social-hub/time';
import { windowsOn } from '@/lib/social-hub/views/plan';
import { generate as requestStorySet } from '@/lib/stories/api';
import { liveStoriesDb } from '@/lib/stories/db';

/** Typical spend, for the confirm line: a reels night ran $1.40–2.80 this month; one reel (copy, frame, video, song) about $1. */
const REELS_NIGHT_USD = 2.5;
const REEL_BUILD_USD = 1;
const STORY_SET_USD = 0.45;

export async function livePlan(now = new Date()): Promise<RunPlan> {
  const today = nyDateOf(now)!;
  const [dataset, stories, reelsPending, building, slate, carouselRuns, carouselSettings, exDb] = await Promise.all([
    loadDataset(liveHubQuery, now),
    readPosting('stories'),
    pendingRun(),
    dbQuery<{ post_idea_id: string }>(`SELECT post_idea_id::text FROM reels.finish_requests WHERE status = 'active'`),
    dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM reels.score_slates WHERE ny_date = $1::date`, [today]),
    dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM social.runs WHERE status IN ('requested', 'running')`),
    loadCarouselSettings(),
    explainersDb(),
  ]);
  const [jobs, exSettings, sets] = await Promise.all([
    exDb.query<{ topic_id: string }>(`SELECT topic_id::text FROM explainers.jobs WHERE status IN ('requested', 'running')`),
    loadExplainerSettings(exDb),
    liveStoriesDb.query<{ series: string }>(`SELECT series FROM stories.sets WHERE ny_date = $1::date AND status NOT IN ('rejected', 'failed', 'skipped')`, [today]),
  ]);
  const quotas = dataset.dayQuotas ?? DEFAULT_DAY_QUOTAS;
  // A type's quota is its posts per day, never more than its windows today (the candidates use the same rule).
  const day = (v: 'reels' | 'carousels' | 'explainers') => typeDay(quotaCandidates(dataset, v, now), Math.min(quotas[v], windowsOn(v, today).length));
  // Stories: each series due today by its own settings.
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  const held = new Set(sets.rows.map((r) => r.series));
  const series = (stories.series ?? []).filter((s) => s.enabled && s.days.includes(weekday)).map((s) => ({ id: s.id, label: s.label, held: held.has(s.id) }));
  return planFrom({
    today,
    reels: { ...day('reels'), slateToday: Number(slate.rows[0]?.n ?? 0) > 0 },
    carousels: day('carousels'),
    explainers: day('explainers'),
    series,
    inFlight: {
      reelsRun: Boolean(reelsPending),
      reelsBuilding: building.rows.map((r) => r.post_idea_id),
      carouselRun: Number(carouselRuns.rows[0]?.n ?? 0) > 0,
      explainerTopics: jobs.rows.map((r) => r.topic_id),
    },
    cost: { reelsNight: REELS_NIGHT_USD, reelBuild: REEL_BUILD_USD, carouselCap: carouselSettings.runCapUsd, explainerCap: exSettings.per_reel_cap_usd, storySet: STORY_SET_USD },
  });
}

export type StepResult = { vertical: PlanStep['vertical']; label: string; ok: boolean; note: string };

/** Re-plan on the server, then start what today still needs. */
export async function runToday(by: string, now = new Date()): Promise<{ plan: RunPlan; results: StepResult[] }> {
  const plan = await livePlan(now);
  const results: StepResult[] = [];
  for (const step of plan.steps) {
    if (step.action === 'none') continue;
    const done = (ok: boolean, note: string) => results.push({ vertical: step.vertical, label: step.label, ok, note });
    try {
      if (step.action === 'reels_build') {
        const notes: string[] = [];
        let started = 0;
        for (const ideaId of step.targets) {
          const slateId = await todaySlateFor(ideaId, now);
          if (!slateId) {
            notes.push('one idea is not on today’s slate');
            continue;
          }
          const out = await requestFinish(ideaId, slateId);
          if (out.status === 'failed') notes.push(out.note);
          else started += 1;
        }
        done(started > 0, `${started} reel${started === 1 ? '' : 's'} being made (copy → frame → video).${notes.length ? ` ${notes.join('; ')}` : ''}`);
      } else if (step.action === 'reels_run') {
        const run = await requestRun('manual');
        done(Boolean(run), run ? 'Run queued. The reels worker starts it within a minute.' : 'A run was already queued.');
      } else if (step.action === 'carousel_run') {
        const out = await requestManualRun();
        done(out.queued, out.queued ? 'Run queued. The social worker starts it within a minute.' : out.note);
      } else if (step.action === 'explainer_renders') {
        const db = await explainersDb();
        const settings = await loadExplainerSettings(db);
        let queued = 0;
        const refused: string[] = [];
        for (const topicId of step.targets) {
          const r = await requestRender(db, { topicId, trigger: 'click', settings, now });
          if (r.ok) queued += 1;
          else refused.push(r.reason.replaceAll('_', ' '));
        }
        done(queued > 0, `${queued} render${queued === 1 ? '' : 's'} queued${refused.length ? `; refused: ${[...new Set(refused)].join(', ')}` : ''}.`);
      } else if (step.action === 'story_sets') {
        const made: string[] = [];
        for (const series of step.targets) {
          const { created } = await requestStorySet(liveStoriesDb, series, by, now);
          if (created) made.push(series);
        }
        done(made.length > 0, made.length ? `${made.length} set${made.length === 1 ? '' : 's'} requested. The Stories worker builds them in order.` : 'Already requested.');
      }
    } catch (error) {
      done(false, error instanceof Error ? error.message : String(error));
    }
  }
  return { plan, results };
}
