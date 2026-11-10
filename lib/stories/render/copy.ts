/**
 * Fixed frame copy (plan §5.1: the opener and closer are fixed copy approved
 * on the M1 mock-up, not model-written). Brand per S-28: Helios Group, an AI
 * consultancy, heliosgroup.ai, "We build your unfair advantage."
 *
 * DRAFT until Lucas approves it on the M1 mock-up (O-1).
 */
/** Every series' name. Guess the Number is retired (AT-14); its name stays for the sets on record. */
export const SERIES_LABEL = {
  morning_download: 'Morning Download',
  guess_the_number: 'Guess the Number',
  free_vs_paid: 'Free vs. Paid',
  ai_trivia: 'AI Trivia',
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

/**
 * Homemade style (S-53, exploration): the same words as above, typed the way
 * someone types a story on their phone, with emoji. DRAFT until Lucas
 * approves the homemade look. An emoji is glued to the word before it with a
 * no-break space, the way a phone keeps them on one line.
 */
export const HOMEMADE = {
  fvp: {
    free: 'FREE',
    vs: 'vs',
    paid: 'PAID',
    introCue: "tap for today's pick",
    ouch: '😬',
    cue: 'tap for the free one',
    freeBadge: 'FREE\u00A0✅',
    howTo: 'how to get it\u00A0👇',
  },
  photo: '📷',
};
