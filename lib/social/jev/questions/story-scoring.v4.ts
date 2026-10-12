/**
 * Story scoring, one Jev call per candidate (spec §5A #1, §5B, §5B-1, §5A #2).
 *
 * @4 (2026-10-12, Tommy): ranks on how much a story matters to the AI field,
 * not on how strange or fought-over it is. @3's four engagement questions
 * (big_news, surprise, everyday_stakes, tension_people) rewarded incidents and
 * punished flagship news: a scheduled model launch is "routine" and has no
 * fight, so Claude fabricating a murder tip (4.06) outranked a Grok 4.7
 * release (1.38), and a first-person NYT column passed the news gate.
 *
 * @4 keeps the skip list and already-posted, keeps the AI-is-the-subject and
 * substance gates, splits the news gate in two (see below), and ranks on three
 * impact axes, two audience questions, sourcing and coverage:
 *
 *   field_shift      changes what AI can do, what it costs, or who leads
 *   industry_power   money or power moving among the companies that build AI
 *   national_policy  a government newly acting on AI (a binding or formal act) in a way that
 *                    changes what AI developers or products can or must do
 *   must_know        someone who follows AI would feel behind for missing it (the insider)
 *   common_person    a regular person curious about AI would notice or care (the public)
 *
 * The score takes the strongest of the first three (a story is big on one
 * axis, it need not be big on all), then adds must_know, common_person,
 * sourcing and coverage. common_person is worth more than must_know on
 * purpose (Tommy, 2026-10-12: announce the Haiku release before a White House
 * statement; officials and executives are who a government story affects, not
 * the common person). A famous name in the story does not make it matter to a
 * regular person. There was a `reach` question ("who must react"); it tracked
 * must_know (0.69) and scored government stories high, so it was dropped.
 * A launch or a deal can earn the full
 * 1.5 on its axis; a government act earns at most 1.0 (Tommy, 2026-10-12: it
 * should rank just below launches and deals, not crowd them out). A government
 * act means a binding or formal one (a law, rule, ruling, order, enforcement,
 * an official testing or access arrangement) by the US federal government, the
 * EU, the UK, China, the G7 or the UN; statements, demands and plans do not
 * count. The maximum is still 5.5, so the hub's scale does not change.
 *
 * The news gate is two questions, not one (2026-10-12): news_event asks
 * whether something happened, and commentary asks whether the story is
 * mainly someone's opinion, interview or remarks. One question could not
 * separate them: real events (a government action at 0.54, a leaked model at
 * 0.55) scored in the same band as an executive's remarks (0.58) and an
 * interview (0.53). A story qualifies when it is an event and is not mostly
 * commentary.
 *
 * Changing a question's wording means a new version file, not an edit.
 */
import { noul, type Questions } from '@typesafe-ai/sdk';

import type { StoryGroup } from '@/lib/social/ingest/select/types';

export const VERSION = 'story-scoring@4';

export const THRESHOLDS = {
  /** AI-is-the-subject and substance must each reach this to qualify (as @3; the gate() function applies it). */
  REQUIRED_MIN: 0.6,
  /** "Something happened" must reach this. Lower than REQUIRED_MIN: commentary is now rejected by its own question. */
  EVENT_MIN: 0.5,
  /** Commentary at or above this is not a news story (an opinion piece, an interview, remarks). */
  COMMENTARY_MIN: 0.5,
  /** A significance question counts as passed at this (shown on the hub; ranking uses the probabilities). */
  BONUS_MIN: 0.5,
  /** Any skip-list category at or above this skips the story (as @3). */
  SKIP_MIN: 0.5,
  /** Already-posted at or above this skips the story (as @3). */
  POSTED_MIN: 0.7,
} as const;

export const COMMENTARY_ID = 'commentary';
/** The questions gate() reads to disqualify a story, in the order the hub lists them. gate() is the one place their thresholds live. */
export const GATE_IDS = ['ai_main_subject', 'substance', 'news_event', COMMENTARY_ID] as const;
/** The three axes a story can be big on; the score counts the strongest. */
export const IMPACT_IDS = ['field_shift', 'industry_power', 'national_policy'] as const;
export const ENGAGEMENT_IDS = ['field_shift', 'industry_power', 'national_policy', 'must_know', 'common_person'] as const;
export const SOURCING_ID = 'sourcing';
export const SKIP_IDS = ['skip_weapons_war', 'skip_death_tragedy', 'skip_crime_violence', 'skip_sexual_abuse'] as const;
export const POSTED_ID = 'already_posted';

/**
 * The ranking score, 0 to 5.5: the strongest impact axis (0 to 1.5), must_know
 * (0 to 1), common_person (0 to 1.5), sourcing (0 to 1) and coverage (0 to 0.5,
 * half a point at 16 or more outlets, on a log scale).
 */
export const WEIGHTS = { impact: 1.5, policy: 1, mustKnow: 1, commonPerson: 1.5, sourcing: 1, coverage: 0.5 } as const;
export const COVERAGE_FULL_AT = 16;

/** The coverage part of the score, 0 to WEIGHTS.coverage. */
export function coverageScore(outletCount: number): number {
  return WEIGHTS.coverage * Math.min(1, Math.log2(1 + Math.max(0, outletCount)) / Math.log2(1 + COVERAGE_FULL_AT));
}

export function engagementScore(answers: Record<string, number>, outletCount: number): number {
  const p = (id: string) => answers[id] ?? 0;
  // A launch or a deal can reach the full impact weight; a government act counts at WEIGHTS.policy.
  const impact = Math.max(WEIGHTS.impact * p('field_shift'), WEIGHTS.impact * p('industry_power'), WEIGHTS.policy * p('national_policy'));
  return (
    impact +
    WEIGHTS.mustKnow * p('must_know') +
    WEIGHTS.commonPerson * p('common_person') +
    WEIGHTS.sourcing * p(SOURCING_ID) +
    coverageScore(outletCount)
  );
}

export const SCORE_MAX = WEIGHTS.impact + WEIGHTS.mustKnow + WEIGHTS.commonPerson + WEIGHTS.sourcing + WEIGHTS.coverage;

export type Gate = { status: 'qualified' | 'not-qualified' | 'skipped'; reason?: string };

/** Skip list and already-posted skip a story; the required questions and the commentary check disqualify it. */
export function gate(answers: Record<string, number>): Gate {
  const t = THRESHOLDS;
  const p = (id: string) => answers[id] ?? 0;
  const skipHit = SKIP_IDS.find((id) => p(id) >= t.SKIP_MIN);
  if (skipHit) return { status: 'skipped', reason: skipHit };
  if (p(POSTED_ID) >= t.POSTED_MIN) return { status: 'skipped', reason: POSTED_ID };
  const missing = [
    ...(p('ai_main_subject') < t.REQUIRED_MIN ? ['ai_main_subject'] : []),
    ...(p('substance') < t.REQUIRED_MIN ? ['substance'] : []),
    ...(p('news_event') < t.EVENT_MIN ? ['news_event'] : []),
    ...(p(COMMENTARY_ID) >= t.COMMENTARY_MIN ? [COMMENTARY_ID] : []),
  ];
  return missing.length > 0 ? { status: 'not-qualified', reason: `required: ${missing.join(', ')}` } : { status: 'qualified' };
}

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

const LABS = 'OpenAI, Anthropic, Google or DeepMind, Meta, xAI, Microsoft, Amazon, Apple, Nvidia, DeepSeek or Mistral';

export function buildQuestions(postedHeadlines: string[]): Questions {
  const questions: Questions = {
    ai_main_subject: noul(
      'Is artificial intelligence the main subject of `story`, not a side detail?',
      {
        true: 'The story is about AI itself: AI companies, models, products, chips, research, policy or people building AI.',
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
      'Did something happen in `story`, in the last few days?',
      {
        true: 'A reporter is telling what happened: an announcement, release, deal or deal talks, ruling, filing, firing, incident, published finding, or a government or company taking a formal action or making a formal response.',
        false: 'Nothing new happened. It is an explainer or timeline, a review, a how-to, a comparison, or a recap of a leaderboard or benchmark.',
      },
    ),
    [COMMENTARY_ID]: noul(
      'Is `story` mainly someone\'s opinion, interview or remarks, not a report of what happened?',
      {
        true: 'A column or op-ed (including first-person writing such as "my conversations", "I tried", "why I am worried"), an interview or Q&A, a speech or on-stage remarks by an executive or official, or an analysis of what might happen.',
        false: 'A reporter tells what happened. People are quoted, but the story is built on the event.',
      },
    ),
    field_shift: noul(
      'Does `story` change what AI can do, what it costs, or who is ahead?',
      {
        true: `A new model, product or chip from a leading company (${LABS}), a major price cut, or a jump in capability or benchmark results that moves the field.`,
        false: 'A minor feature, a tutorial, an integration into someone else\'s app, a small company\'s update, or an incremental patch.',
      },
    ),
    industry_power: noul(
      'Does `story` move money or power among the companies that build AI?',
      {
        true: 'A funding round, an acquisition or acquisition talks, a valuation or revenue figure of about a billion dollars or more, a compute, chip or data-centre deal, a major partnership, or a leadership change at a leading AI or big tech company.',
        false: 'A small deal, a local or niche business story, or one company\'s news with no effect on the leading AI companies.',
      },
    ),
    national_policy: noul(
      'Is `story` about a government taking a binding or formal act on AI, at national or international level?',
      {
        true: 'A law, rule, regulator action, court ruling, executive order, enforcement action, or an official safety-testing or access arrangement, by the US federal government, the EU, the UK, China, the G7 or the UN.',
        false: 'A statement, speech, demand, warning or plan with no act behind it; an action by a state, city or any other country; or an advocacy group\'s opinion.',
      },
    ),
    must_know: noul(
      'Would someone who follows AI for work feel behind if they missed `story` this week?',
      {
        true: 'It is a development the whole field will be discussing: leaders, products, prices or rules changed.',
        false: 'It is interesting but nobody would be caught out for missing it: an odd incident, a curiosity, one user\'s experience, or a niche update.',
      },
    ),
    common_person: noul(
      'Would a regular person who is curious about AI notice or care about `story` this week?',
      {
        true: 'Someone who uses AI at work or at home, but does not work in government, a boardroom or an AI lab, would care: it changes what they use, pay or can do (a cheap new model, a price cut, a feature they can try), or it affects their job, money or privacy.',
        false: 'It matters mainly to officials, executives, investors, lawyers or the staff of one company. A famous person or institution in the story does not make it matter to a regular person.',
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
