/**
 * Run now's live reads and actions (server only). Each action is the same
 * call the type's own button makes, so every guard it has still applies
 * (one queued run per type, one render per topic, one set per series a day).
 */
import { dbQuery } from '@/lib/db';
import { loadSettings as loadCarouselSettings, requestManualRun } from '@/lib/carousels/overview';
import { readPosting } from '@/lib/content-type/posting';
import { explainersDb } from '@/lib/explainers/connection';
import { requestRender } from '@/lib/explainers/repository';
import { loadSettings as loadExplainerSettings } from '@/lib/explainers/settings';
import { pendingRun, requestRun } from '@/lib/reels/repository';
import { liveHubQuery } from '@/lib/social-hub/db';
import { loadDataset } from '@/lib/social-hub/load';
import { heldToday, planFrom, seriesDue, todayNy, type PlanStep, type RunPlan } from '@/lib/social-hub/run-today';
import { poolList } from '@/lib/social-hub/views/pools';
import { generate as requestStorySet } from '@/lib/stories/api';
import { liveStoriesDb } from '@/lib/stories/db';

/** Typical spend per unit, for the confirm line (reels: recent nights ran $1.40–2.80). */
const REELS_NIGHT_USD = 2.5;
const STORY_SET_USD = 0.45;

export async function livePlan(now = new Date()): Promise<RunPlan> {
  const today = todayNy(now);
  const [dataset, reels, carousels, explainers, stories, reelsPending, carouselRuns, carouselSettings, exDb] = await Promise.all([
    loadDataset(liveHubQuery, now),
    readPosting('reels'),
    readPosting('carousels'),
    readPosting('explainers'),
    readPosting('stories'),
    pendingRun(),
    dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM social.runs WHERE status IN ('requested', 'running')`),
    loadCarouselSettings(),
    explainersDb(),
  ]);
  const [jobs, exSettings, sets] = await Promise.all([
    exDb.query<{ n: number }>(`SELECT count(*)::int AS n FROM explainers.jobs WHERE status IN ('requested', 'running')`),
    loadExplainerSettings(exDb),
    liveStoriesDb.query<{ series: string }>(`SELECT series FROM stories.sets WHERE ny_date = $1::date AND status NOT IN ('rejected', 'failed', 'skipped')`, [today]),
  ]);
  const topics = poolList(dataset.ideas, 'explainers', 'open')
    .filter((i) => i.state === 'idea_only' && i.id.startsWith('explainers:topic:'))
    .map((i) => i.id.slice('explainers:topic:'.length));
  return planFrom({
    today,
    quota: { reels: reels.perDay ?? 0, carousels: carousels.perDay ?? 0, explainers: explainers.perDay ?? 0 },
    held: heldToday(dataset, now),
    inFlight: { reels: Boolean(reelsPending), carousels: Number(carouselRuns.rows[0]?.n ?? 0) > 0, explainers: Number(jobs.rows[0]?.n ?? 0) },
    topics,
    series: seriesDue(today, stories.series ?? [], new Set(sets.rows.map((r) => r.series))),
    cost: { reelsNight: REELS_NIGHT_USD, carouselCap: carouselSettings.runCapUsd, explainerCap: exSettings.per_reel_cap_usd, storySet: STORY_SET_USD },
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
      if (step.action === 'reels_run') {
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
