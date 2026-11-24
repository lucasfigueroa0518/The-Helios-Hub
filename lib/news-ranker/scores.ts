/**
 * News Ranker scores (planning/MD-LFD Revisions/CONTRACT.md), shared by Morning
 * Download, Last Few Days and the central intake. Moved from lib/stories/scores.ts
 * and lib/stories/build/morning-download.ts with identical values; both re-export.
 * Originally: the major-news weights and bar (moved from
 * lib/stories/build/morning-download.ts with identical values), and the
 * builder lane (story-builder@2; round 3, replay review 2026-11-09).
 *
 * Weights and bars are first values, to calibrate on real runs. BUILDER_BAR is
 * set by the calibration replay before ship (round 3, Q3: no cap on builders).
 */
import { BUILDER_WINDOW_DAYS, type LeadOf } from '@/lib/intake/types';

/** major-news@2 (Lucas, 2026-10-09): the positive weights sum to 1; `speculative` takes points away. */
export const MAJOR_NEWS_WEIGHTS = { happened: 0.3, news_kind: 0.25, blockbuster_entity: 0.2, global_relevance: 0.15, political_relevance: 0.1, speculative: -0.35 } as const;
export const MAJOR_NEWS_BAR = 0.55;
export const SAME_EVENT_BAR = 0.7;
/** md-grounding@1 `supported` (S-22): the written headline passes at or above this. */
export const GROUNDING_BAR = 0.6;
/** md-development@1 `new_event` (Bald-Eagle 2026-11-12, D2): a story we already ran comes back at or above this. First value, to calibrate. */
export const DEVELOPMENT_BAR = 0.6;

/**
 * story-builder@2: the positive weights sum to 1; `routine_launch` and `speculative` take points away.
 * `general_interest` carries the most weight so a specialist-only result cannot clear the bar on the other three.
 */
export const BUILDER_WEIGHTS = { made_or_found: 0.25, pushes_limits: 0.2, shown_working: 0.2, general_interest: 0.35, routine_launch: -0.4, speculative: -0.35 } as const;
export const BUILDER_BAR = 0.65;

type NoulAnswers = Record<string, { noul: number }>;

const weighted = (weights: Record<string, number>, answers: NoulAnswers) =>
  Math.max(0, Object.entries(weights).reduce((s, [k, w]) => s + w * (answers[k]?.noul ?? 0), 0));

/** Judged on the story alone: which system it came from adds nothing. */
export function majorNewsScore(answers: NoulAnswers): number {
  return weighted(MAJOR_NEWS_WEIGHTS, answers);
}

/** Same shape as majorNewsScore: weighted sum, floored at 0. */
export function builderScore(answers: NoulAnswers): number {
  return weighted(BUILDER_WEIGHTS, answers);
}

const DAY_MS = 86_400_000;

/**
 * The lane whose score clears its bar by more (margin = score − bar), or null
 * when neither clears. Builder requires the event within BUILDER_WINDOW_DAYS of
 * `now`; an unknown date passes (round 3b). A tie goes to major.
 */
export const leadOf: LeadOf = ({ major, builder, eventDate }, now) => {
  const majorMargin = major === null ? null : major - MAJOR_NEWS_BAR;
  const recent = eventDate === null || now.getTime() - eventDate.getTime() <= BUILDER_WINDOW_DAYS * DAY_MS;
  const builderMargin = builder === null || !recent ? null : builder - BUILDER_BAR;
  const m = majorMargin !== null && majorMargin >= 0 ? majorMargin : null;
  const b = builderMargin !== null && builderMargin >= 0 ? builderMargin : null;
  if (m === null && b === null) return null;
  if (b === null || (m !== null && m >= b)) return { lane: 'major', margin: m! };
  return { lane: 'builder', margin: b };
};

const NAME = /\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*\b/g;
const STOP = new Set(['The', 'A', 'An', 'This', 'That', 'AI', 'In', 'On', 'At', 'For', 'With', 'And', 'But', 'How', 'Why', 'What', 'New', 'Its', 'It']);
/** Proper names in a headline, for the cheap pre-filter before the Jev merge check. */
export function namesIn(text: string): Set<string> {
  return new Set((text.match(NAME) ?? []).flatMap((n) => n.split(/\s+/)).filter((w) => w.length > 2 && !STOP.has(w)));
}

/**
 * news-massive-development@1 `massive` (D2/D11): a story the asking format already ran comes back only at or above
 * this. Placeholder, calibrated in the lab from Lucas-tagged real repeats.
 */
export const MASSIVE_BAR = 0.8;

/** news-gate@1 `is_news` (D10): a story fails the gate only below this, i.e. when Jev is fairly sure it is not news. */
export const GATE_BAR = 0.3;
