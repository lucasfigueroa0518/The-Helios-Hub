/**
 * Story scoring, one Jev call per candidate (spec §5A #1, §5B, §5B-1, §5A #2).
 *
 * @3 (2026-10-11, Lucas and Tommy): ranks on what makes a story worth a
 * carousel on a feed, not on whether it is easy to illustrate. @2 ranked by
 * how many of why_it_matters, sourcing and photographable_subject passed; the
 * last passed on nearly every company story (0.95+), so it ranked nothing and
 * pulled in one company's many small stories. @3 keeps the gates (AI is the
 * subject, enough substance, the skip list, already posted), adds one (it
 * reports a specific new event: timelines, opinion pieces, reviews and "I
 * tried" tests are not news) and ranks on four engagement questions plus how
 * well the story is sourced:
 *
 *   big_news         a major company, government or big number; widely heard
 *   surprise         a first, a reversal, a record, something strange
 *   everyday_stakes  jobs, money, safety, privacy, or products people use
 *   tension_people   a real fight: a firing, lawsuit, public clash, investigation
 *
 * Calibrated on the 2026-10-11 run's 35 qualified stories before it shipped:
 * a looser tension question (any named person or warning) scored 0.9+ on
 * nearly every story, so it ranked nothing; it now asks for a real conflict.
 *
 * Changing a question's wording means a new version file, not an edit.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

import type { StoryGroup } from '@/lib/social/ingest/select/types';

export const VERSION = 'story-scoring@3';

export const THRESHOLDS = {
  /** Relevance and substance must both reach this to qualify (as @2). */
  REQUIRED_MIN: 0.6,
  /** An engagement question counts as passed at this (shown on the hub; ranking uses the probabilities). */
  BONUS_MIN: 0.5,
  /** Any skip-list category at or above this skips the story (as @2). */
  SKIP_MIN: 0.5,
  /** Already-posted at or above this skips the story (as @2). */
  POSTED_MIN: 0.7,
} as const;

export const REQUIRED_IDS = ['ai_main_subject', 'substance', 'news_event'] as const;
export const ENGAGEMENT_IDS = ['big_news', 'surprise', 'everyday_stakes', 'tension_people'] as const;
export const SOURCING_ID = 'sourcing';
export const SKIP_IDS = ['skip_weapons_war', 'skip_death_tragedy', 'skip_crime_violence', 'skip_sexual_abuse'] as const;
export const POSTED_ID = 'already_posted';

/**
 * The ranking score, 0 to 5.5: the four engagement probabilities (0 to 4),
 * plus sourcing (0 to 1), plus coverage (0 to 0.5: half a point at 16 or more
 * outlets, on a log scale, so a story everyone is reporting rises).
 */
export const WEIGHTS = { engagement: 1, sourcing: 1, coverage: 0.5 } as const;
export const COVERAGE_FULL_AT = 16;

/** The coverage part of the score, 0 to WEIGHTS.coverage. */
export function coverageScore(outletCount: number): number {
  return WEIGHTS.coverage * Math.min(1, Math.log2(1 + Math.max(0, outletCount)) / Math.log2(1 + COVERAGE_FULL_AT));
}

export function engagementScore(answers: Record<string, number>, outletCount: number): number {
  const p = (id: string) => answers[id] ?? 0;
  const engagement = ENGAGEMENT_IDS.reduce((s, id) => s + p(id), 0);
  return WEIGHTS.engagement * engagement + WEIGHTS.sourcing * p(SOURCING_ID) + coverageScore(outletCount);
}

export const SCORE_MAX = 4 * WEIGHTS.engagement + WEIGHTS.sourcing + WEIGHTS.coverage;

const BODY_CHARS = 6000;

export function buildState(group: StoryGroup, postedHeadlines: string[]) {
  return {
    story: {
      headline: group.representative.headline,
      outlets: group.outlets,
      outlet_count: group.outletCount,
      published_at: group.publishedAt.toISOString(),
      body: group.body.slice(0, BODY_CHARS),
    },
    ...(postedHeadlines.length > 0 ? { recently_posted: postedHeadlines } : {}),
  };
}

const skip = (subject: string, examples: string, notThis?: string) =>
  noul(`Is the main subject of \`story\` ${subject}?`, {
    true: `The story is mainly about ${subject}, for example ${examples}.`,
    false: notThis
      ? `${subject} is absent or only a side detail. ${notThis}`
      : `${subject} is absent or only a side detail.`,
  });

export function buildQuestions(postedHeadlines: string[]): Questions {
  const questions: Questions = {
    ai_main_subject: noul(
      'Is artificial intelligence the main subject of `story`, not a side detail?',
      {
        true: 'The story is about AI itself: AI companies, models, products, research, policy or people building AI.',
        false: 'AI is mentioned only in passing, or the story is mainly about something else.',
      },
    ),
    substance: noul(
      'Does `story` have enough substance to fill a 5 to 8 slide news carousel?',
      {
        true: 'There is a clear event with several concrete details, context and consequences to tell.',
        false: 'It is thin: a brief announcement, a rumour with no detail, or an opinion with no news.',
      },
    ),
    news_event: noul(
      'Does `story` report a specific new event from the last few days?',
      {
        true: 'Something happened: an announcement, release, ruling, deal, firing, incident, filing or published finding.',
        false: 'It is not news of an event: an explainer or timeline, an opinion or analysis piece, a review, a how-to, or a writer trying products.',
      },
    ),
    big_news: noul(
      'Is `story` big news that many people will hear about this week?',
      {
        true: 'It involves a major company, a government, a very large number (money, users, jobs), or it is being reported widely.',
        false: 'It is a niche update: a small company, a minor feature, a partnership, an opinion piece, or trade-press detail.',
      },
    ),
    surprise: noul(
      'Is `story` surprising?',
      {
        true: 'It is a first, a reversal, a record, a mistake, or something strange or unexpected that makes people say "wait, what?".',
        false: 'It is expected or routine: a scheduled release, an incremental update, or something everyone saw coming.',
      },
    ),
    everyday_stakes: noul(
      'Does `story` change something for ordinary people?',
      {
        true: 'It affects jobs, money, safety, privacy, schools or health, or apps and devices that many people use.',
        false: 'It matters mainly to insiders: developers, investors, researchers, or one company\'s business.',
      },
    ),
    tension_people: noul(
      'Is there a real fight in `story`?',
      {
        true: 'Two sides are in conflict: a firing, a lawsuit, an investigation, a public clash between named people or organisations, or a clear winner and loser.',
        false: 'There is no real conflict. Quoting a CEO, naming a person, or a general warning or concern is not enough.',
      },
    ),
    sourcing: noul(
      'Is `story` from a primary source, or confirmed by several outlets (see `story.outlets`)?',
      {
        true: 'It cites official statements, documents or on-record people, or several independent outlets report it.',
        false: 'It rests on a single unnamed source, rumour, or one outlet repeating another.',
      },
    ),
    skip_weapons_war: skip(
      'weapons or war',
      'weapons tests, AI weapons, military operations or armed conflict',
      'Defense business and policy news (contracts, funding, procurement) does not count.',
    ),
    skip_death_tragedy: skip(
      'a death or tragedy',
      'deaths, disasters or suicides, including AI-linked cases',
    ),
    skip_crime_violence: skip(
      'crime or violence',
      'shootings, terrorism or violent crime, including AI used in a crime',
      'Partisan political fights and lawsuits between companies do not count.',
    ),
    skip_sexual_abuse: skip(
      'sexual abuse or sexual deepfakes',
      'child exploitation, nudify apps, sexual deepfakes, or laws against them',
    ),
  };
  if (postedHeadlines.length > 0) {
    questions[POSTED_ID] = noul(
      'Is `story` the same news story as any headline in `recently_posted`?',
      {
        true: 'It reports the same event as one of the recently posted headlines.',
        false: 'It is a different event, even if it involves the same company or topic.',
      },
    );
  }
  return questions;
}
