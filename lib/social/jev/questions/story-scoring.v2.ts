/**
 * Story scoring, one Jev call per candidate (spec §5A #1, §5B, §5B-1, §5A #2).
 *
 * Thresholds are calibrated from live run reports (§2.3).
 * Changing a question's wording means a new version file, not an edit.
 *
 * @2 (2026-10-04): drops number_or_quote. In the first live run every one of
 * the 27 qualified stories passed it (min 0.76), and its only low scores
 * came from thin text; slide material is the Reporter's job (spec §5.3).
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

import type { StoryGroup } from '@/lib/social/ingest/select/types';

export const VERSION = 'story-scoring@2';

export const THRESHOLDS = {
  /** Relevance and substance must both reach this to qualify. */
  REQUIRED_MIN: 0.6,
  /** Each of the three score questions passes at this. */
  BONUS_MIN: 0.5,
  /** Any skip-list category at or above this skips the story. 0.5 per Tommy (2026-10-04); calibrated from live run reports (§2.3). */
  SKIP_MIN: 0.5,
  /** Already-posted at or above this skips the story. */
  POSTED_MIN: 0.7,
} as const;

export const REQUIRED_IDS = ['ai_main_subject', 'substance'] as const;
export const BONUS_IDS = ['why_it_matters', 'sourcing', 'photographable_subject'] as const;
export const SKIP_IDS = ['skip_weapons_war', 'skip_death_tragedy', 'skip_crime_violence', 'skip_sexual_abuse'] as const;
export const POSTED_ID = 'already_posted';

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
    why_it_matters: noul(
      'Is it clear from `story` why this news matters to a general reader?',
      {
        true: 'The article says or makes plain what changes, who is affected, or what is at stake.',
        false: 'The consequences are unclear or left unstated.',
      },
    ),
    sourcing: noul(
      'Is `story` from a primary source, or confirmed by several outlets (see `story.outlets`)?',
      {
        true: 'It cites official statements, documents or on-record people, or several independent outlets report it.',
        false: 'It rests on a single unnamed source, rumour, or one outlet repeating another.',
      },
    ),
    photographable_subject: noul(
      'Is the main subject of `story` a named person, company or product?',
      {
        true: 'The story centres on a specific named person, company or product.',
        false: 'The subject is abstract: a trend, a concept, or an unnamed group.',
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
