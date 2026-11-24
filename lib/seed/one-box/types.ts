/** Shared types for one-box seeding (design 2026-11-04-one-box-seeding-design). */

export type SeedVerticalKey =
  | 'reels' | 'carousels' | 'last_few_days' | 'stories' | 'explainers' | 'field_notes' | 'ai_trivia' | 'real_or_ai' | 'reel_ai_drama';
/** Who does the work after the click: Vercel (`after`) or a social-worker runner that claims the queued request. */
export type Runner = 'vercel' | 'stories' | 'drama';
export const RUNNER: Record<SeedVerticalKey, Runner> = {
  reels: 'vercel', carousels: 'vercel', last_few_days: 'vercel', stories: 'vercel', explainers: 'vercel', field_notes: 'vercel',
  ai_trivia: 'stories', real_or_ai: 'stories', reel_ai_drama: 'drama',
};
export type Stage = 'queued' | 'claimed' | 'searching' | 'reading' | 'checking' | 'filing' | 'writing' | 'making';

export type OneBoxInput = {
  vertical: SeedVerticalKey;
  blurb: string;
  link?: string;
};

/** The fields a pool's existing add function takes (design: the agent returns exactly these). Every field is a plain string. */
export type EntryField = 'headline' | 'url' | 'title' | 'sourceUrl' | 'value' | 'fact' | 'storyHeadline' | 'toolName' | 'description';
export type Entry = Partial<Record<EntryField, string>>;

/** What the search call reports (design section 3): up to three candidate entries, best first, each in the pool's own fields. */
export type Finding = {
  found: boolean;
  reason?: string;
  duplicateOf?: string;
  entries: Entry[];
  mainPoint?: string;
};

/** A candidate whose page was read and judged a match. `url` is the page it was judged on. */
export type PassedEntry = { entry: Entry; url: string; text: string };

/** The verified result; the first is the primary source. */
export type Verified = { passed: PassedEntry[] };
