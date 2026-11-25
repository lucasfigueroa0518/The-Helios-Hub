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
  ai_trivia: 'Are you smarter than AI?',
  real_or_ai: 'Real or AI?',
} as const;

/**
 * The cover's headline (the promise): three lines, the last in the accent. Sets rotate through them in order,
 * never repeating the previous set's (Lucas, 2026-11-23, MC16). `oneMinute` lines promise a one-minute read and
 * are skipped on a set that takes longer.
 */
export const OPENER_PROMISES: ReadonlyArray<{ lines: readonly [string, string, string]; oneMinute?: true }> = [
  { lines: ['What you', 'need to know', 'in AI today'] },
  { lines: ['The AI news', 'worth your', 'next minute'], oneMinute: true },
  { lines: ['Today’s AI', 'news minus', 'the noise'] },
  { lines: ['What changed', 'in AI', 'overnight'] },
  { lines: ['Your 1-minute', 'AI edge', 'for today'], oneMinute: true },
  { lines: ['Skip the feed.', 'Here’s what', 'matters in AI'] },
];

/** Minutes a set of n stories takes: about 15 seconds a story, rounded, at least one. */
export const readMinutes = (n: number) => Math.max(1, Math.round((n * 15) / 60));

/** The promise after `prev` (the last set's lines), skipping one-minute promises when the set runs longer. */
export function nextOpenerPromise(prev: readonly string[] | null | undefined, storyCount: number): [string, string, string] {
  const at = prev ? OPENER_PROMISES.findIndex((p) => p.lines.join('|') === prev.join('|')) : -1;
  for (let k = 1; k <= OPENER_PROMISES.length; k++) {
    const p = OPENER_PROMISES[(at + k) % OPENER_PROMISES.length]!;
    if (!p.oneMinute || readMinutes(storyCount) === 1) return [...p.lines];
  }
  return [...OPENER_PROMISES[0]!.lines];
}

/** Morning Download cover (planning/MD-LFD Revisions/PLAN.md MC1–MC16, Lucas 2026-11-23). */
export const OPENER = {
  series: ['Morning', 'Download'] as const,
  quick: (n: number) => {
    const min = readMinutes(n);
    return `${n} ${n === 1 ? 'story' : 'stories'} · ${min} ${min === 1 ? 'minute' : 'minutes'}`;
  },
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
