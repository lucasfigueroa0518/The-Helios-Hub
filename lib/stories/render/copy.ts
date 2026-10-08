/**
 * Fixed frame copy (plan §5.1: the opener and closer are fixed copy approved
 * on the M1 mock-up, not model-written). Brand per S-28: Helios Group, an AI
 * consultancy, heliosgroup.ai, "We build your unfair advantage."
 *
 * DRAFT until Lucas approves it on the M1 mock-up (O-1).
 */
export const SERIES_LABEL = {
  morning_download: 'Morning Download',
  guess_the_number: 'Guess the Number',
  free_vs_paid: 'Free vs. Paid',
} as const;

export const OPENER = {
  title: ['Morning', 'Download'] as const,
  tagline: "Today's major AI news",
  cue: (n: number) => `Tap for today's ${n} ${n === 1 ? 'story' : 'stories'}`,
};

export const CLOSER = {
  eyebrow: "That's today's download",
  headline: 'Follow for AI news, updates and lessons.',
  body: 'Helios Group is an AI consultancy. We build your unfair advantage.',
  url: 'heliosgroup.ai',
};

/** Guess the Number: framed as a game show through the copy (S-45). */
export const GTN = {
  /** Intro slide (S-49): Today's "Guess the Number", difficulty, topic. */
  intro: {
    today: "Today's",
    title: 'Guess the Number',
    difficulty: 'Difficulty',
    topic: 'Topic',
    levels: { low: 'Low', medium: 'Medium', high: 'High' },
    cue: 'Tap to play',
  },
  /** The dominant line; the second part takes the accent. */
  kicker: ['Can you guess', 'the number?'] as const,
  cue: 'Lock it in. Tap to reveal',
  reveal: 'The answer is',
  close: 'How close did you get?',
};

/** Free vs. Paid: the series title leads both slides (S-46). */
export const FVP = {
  title: { free: 'Free', vs: 'vs.', paid: 'Paid' },
  /** Intro slide (S-50), Lucas's wording verbatim. */
  intro: {
    line: "Free Vs. Paid is our series where we give you guys open source or free tools that can replace the tech you're currently paying for, enjoy :)",
    cue: "Tap for today's pick",
  },
  paidEyebrow: 'The paid one',
  freeEyebrow: 'The free one',
  cue: 'Tap for the free one',
  devTool: 'Developer tool',
  free: 'Free',
};
