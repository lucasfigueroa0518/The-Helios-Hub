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
import { isLfdDay, slotPlan, storiesSlotsOn } from '@/lib/social-hub/slots';
import { loadDataset } from '@/lib/social-hub/load';
import { lfdDueToday, planFrom, quotaCandidates, seriesDueToday, stepsFor, typeDay, type PlanStep, type RunInputs, type RunPlan } from '@/lib/social-hub/run-today';
import type { Vertical } from '@/lib/social-hub/types';
import { DEFAULT_DAY_QUOTAS } from '@/lib/social-hub/queries/day';
import { nyDateOf } from '@/lib/social-hub/time';
import { capacityWindows, placedCount } from '@/lib/social-hub/views/plan';
import { generate as requestStorySet } from '@/lib/stories/api';
import { liveStoriesDb } from '@/lib/stories/db';
import type { Series } from '@/lib/stories/render/types';
import { openStorySlots } from '@/lib/stories/schedule';
import { DEFAULT_LFD_RUN_CAP_USD } from '@/lib/lfd/config';
import { queueManualLfdRun } from '@/lib/lfd/manual';
import { readLfdSettings } from '@/lib/lfd/settings';

/** Typical spend, for the confirm line: a reels night ran $1.40–2.80 this month; one reel (copy, frame, video, song) about $1. */
const REELS_NIGHT_USD = 2.5;
const REEL_BUILD_USD = 1;
const STORY_SET_USD = 0.45;

/**
 * Last Few Days for Run now: due on its days while its auto_run is on (any day from its own button;
 * in template mode its days are the calendar's LFD slots),
 * made when today already has a post that wasn't rejected, in flight when a
 * run is queued or running. Unreadable (schema not applied): no step.
 */
async function liveLfd(today: string, anyDay: boolean): Promise<{ day: RunInputs['lastFewDays']; inFlight: boolean; cap: number }> {
  try {
    const [s, plan, made, flight] = await Promise.all([
      readLfdSettings(liveHubQuery),
      slotPlan(liveHubQuery, today, 1).catch(() => null),
      dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.posts WHERE ny_date = $1::date AND status <> 'rejected'`, [today]),
      dbQuery<{ n: number }>(`SELECT count(*)::int AS n FROM lfd.runs WHERE status IN ('requested', 'running')`),
    ]);
    const due = lfdDueToday(s, today, anyDay, plan ? isLfdDay(plan, today) : null);
    return { day: { due, made: Number(made.rows[0]?.n ?? 0) > 0 }, inFlight: Number(flight.rows[0]?.n ?? 0) > 0, cap: s.runCapUsd ?? DEFAULT_LFD_RUN_CAP_USD };
  } catch {
    return { day: undefined, inFlight: false, cap: DEFAULT_LFD_RUN_CAP_USD };
  }
}

/** `lfdAnyDay`: the Last Few Days page's own button may make a post on any day (spec §8 Run button). */
export async function livePlan(now = new Date(), opts: { lfdAnyDay?: boolean } = {}): Promise<RunPlan> {
  const today = nyDateOf(now)!;
  const lfd = await liveLfd(today, opts.lfdAnyDay === true);
  const [dataset, stories, storySlots, reelsPending, building, slate, carouselRuns, carouselSettings, exDb] = await Promise.all([
    loadDataset(liveHubQuery, now),
    readPosting('stories', now),
    storiesSlotsOn(liveHubQuery, today).catch(() => null),
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
  const day = (v: 'reels' | 'carousels' | 'explainers') => typeDay(quotaCandidates(dataset, v, now), Math.min(quotas[v], capacityWindows(v, today, dataset.dayQuotas?.lfdDays ?? [], placedCount(dataset.posts, v, today), today, dataset.dayQuotas?.slots ?? null).length));
  // Stories: each series due today by its own settings, or (template mode) a series while it has an
  // open slot today (capped, not passed, not held), the slots the 4 AM worker would still request.
  const open = storySlots ? await openStorySlots(liveStoriesDb, storySlots, now).catch(() => null) : null;
  const dueOn = open ? (id: string) => (open.get(id as Series)?.open.length ?? 0) > 0 : null;
  const held = open ? new Set<string>() : new Set(sets.rows.map((r) => r.series));
  const series = seriesDueToday(stories.series ?? [], today, held, dueOn);
  return planFrom({
    today,
    reels: { ...day('reels'), slateToday: Number(slate.rows[0]?.n ?? 0) > 0 },
    carousels: day('carousels'),
    explainers: day('explainers'),
    series,
    ...(lfd.day ? { lastFewDays: lfd.day } : {}),
    inFlight: {
      reelsRun: Boolean(reelsPending),
      reelsBuilding: building.rows.map((r) => r.post_idea_id),
      carouselRun: Number(carouselRuns.rows[0]?.n ?? 0) > 0,
      explainerTopics: jobs.rows.map((r) => r.topic_id),
      lfdRun: lfd.inFlight,
    },
    cost: { reelsNight: REELS_NIGHT_USD, reelBuild: REEL_BUILD_USD, carouselCap: carouselSettings.runCapUsd, explainerCap: exSettings.per_reel_cap_usd, storySet: STORY_SET_USD, lfdCap: lfd.cap },
  });
}

export type StepResult = { vertical: PlanStep['vertical']; label: string; ok: boolean; note: string };

/**
 * Re-plan on the server, then start what today still needs. `only`: a type's
 * own Run button runs just that type's step, so every Run button makes the
 * same thing from the same ranked queue. `only` + `target`: a card's Make it
 * runs just that card.
 */
export async function runToday(by: string, now = new Date(), only?: Vertical, target?: string): Promise<{ plan: RunPlan; results: StepResult[] }> {
  const plan = await livePlan(now, { lfdAnyDay: only === 'last_few_days' });
  const results: StepResult[] = [];
  for (const step of stepsFor(plan, only, target)) {
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
        const out = await requestManualRun(step.targets);
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
      } else if (step.action === 'lfd_run') {
        // The click approves this run's spend, up to the cap (CLAUDE.md Rule 1); only the social worker runs it.
        const out = await queueManualLfdRun(liveHubQuery);
        done(out.ok, out.note);
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

/** What a type's own Run button answers: queued or not, and what it is making (or why nothing). */
export async function runType(by: string, vertical: Vertical, now = new Date()): Promise<{ queued: boolean; note: string }> {
  const { plan, results } = await runToday(by, now, vertical);
  const started = results.filter((r) => r.ok);
  if (started.length) return { queued: true, note: started.map((r) => r.note).join(' ') };
  if (results.length) return { queued: false, note: results.map((r) => r.note).join(' ') };
  return { queued: false, note: stepsFor(plan, vertical)[0]?.note ?? 'Nothing to run.' };
}
