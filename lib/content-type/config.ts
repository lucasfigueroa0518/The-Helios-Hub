import type { Vertical } from '@/lib/social-hub/types';

/**
 * One entry per content type: everything that differs between types and can be written down as data. The shared
 * page, the settings drawer, the pool and the night workers read it, so a type is described in one place and a new
 * Vertical fails the type check until it has an entry here. No server imports, so workers and client code can both use it.
 *
 * What cannot be data (the generate buttons, a type's extra settings section) lives in
 * components/content-type/type-parts.tsx, keyed the same way.
 */

/** How a type's pool answers a person's moves: `live` follows the queue (pin, drag, archive), `archive_only` takes Archive only, `none` has neither. */
export type QueueMode = 'live' | 'archive_only' | 'none';

/** The words of the Generate switch in the settings drawer. */
export type GenerateCopy = { label: string; confirm: string; hint: string };

export type TypeConfig = {
  /** The page title. */
  title: string;
  /** The sentence under "The bench"; null where the type has its own page. */
  benchNote: string | null;
  /** The most a daily limit may be set to (week board spec §Safety cap). */
  maxCap: number;
  queue: QueueMode;
  /** Whether the pool has a "Seed an idea" path. */
  seedable: boolean;
  /** What a post of this type is called in settings sentences ("Auto-publish: <noun> are scheduled…"). */
  postsNoun: string;
  /** The settings switch's words when the type's generate differs from "every morning"; null = the default, built from `postsNoun`. */
  generate: GenerateCopy | null;
  /** The fewest posts a day the legacy (no calendar) stepper goes down to. */
  perDayMin: number;
  /** The daily limit counts per series, not for the whole type. */
  capPerSeries: boolean;
  /** The pool is one week's ranked list (pin or exclude, then rebuild the post), not a rolling list of ideas. */
  weekPool: boolean;
  /** What the pool's groups are called (the filter row above the bench). */
  groupNoun: 'series' | 'cities';
  /** A drag in the bench needs a group picked first (each series is its own queue). */
  dragNeedsGroup: boolean;
};

/** slots/write.ts writeCaps takes 0–10. */
export const DEFAULT_MAX_CAP = 10;

/** The types a settings drawer, a live switch and a run list exist for (Text on Screen's posting settings included). */
export type ContentTypeId = Vertical;

/** The types ContentTypePage draws (Text on Screen has its own app page). */
export type PageVertical = Exclude<Vertical, 'reels'>;

export const TYPE_CONFIG: Record<Vertical, TypeConfig> = {
  reels: {
    title: 'Text on Screen',
    benchNote: null,
    maxCap: DEFAULT_MAX_CAP,
    queue: 'live',
    seedable: true,
    postsNoun: 'reels',
    generate: null,
    perDayMin: 0,
    capPerSeries: false,
    weekPool: false,
    groupNoun: 'series',
    dragNeedsGroup: false,
  },
  explainers: {
    title: 'Explainers',
    benchNote: 'Topics waiting to be rendered, best score first. Generate renders one reel. Hold and drag any topic to move it.',
    maxCap: DEFAULT_MAX_CAP,
    queue: 'live',
    seedable: true,
    postsNoun: 'explainers',
    generate: null,
    perDayMin: 1,
    capPerSeries: false,
    weekPool: false,
    groupNoun: 'series',
    dragNeedsGroup: false,
  },
  carousels: {
    title: 'Carousels',
    benchNote: 'Stories the 3:00 AM run shortlisted, best first. The top two become carousels. Hold and drag any story to move it.',
    maxCap: DEFAULT_MAX_CAP,
    queue: 'live',
    seedable: true,
    postsNoun: 'carousels',
    generate: null,
    perDayMin: 0,
    capPerSeries: false,
    weekPool: false,
    groupNoun: 'series',
    dragNeedsGroup: false,
  },
  stories: {
    title: 'Stories',
    benchNote: 'Ideas drawn from the other pools. A set is built for each series that is due. Pick a series, then hold and drag an idea to move it.',
    maxCap: DEFAULT_MAX_CAP,
    queue: 'live',
    seedable: true,
    postsNoun: 'story sets',
    generate: null,
    perDayMin: 0,
    capPerSeries: true,
    weekPool: false,
    groupNoun: 'series',
    dragNeedsGroup: true,
  },
  // Its pool is the last run's record, so there is no queue to steer; Last Few Days runs once a day.
  last_few_days: {
    title: 'Last Few Days',
    benchNote:
      'The latest run’s queue: the stories in its post, the ones it dropped and why, and what was next in line. Major headlines lead; Text on Screen ideas fill the rest.',
    maxCap: 1,
    queue: 'archive_only',
    seedable: true,
    postsNoun: 'Last Few Days posts',
    generate: {
      label: 'Generate on its days',
      confirm: 'Make Last Few Days posts on Tuesdays and Fridays at 3:00 AM? Each run makes live model and web calls (up to the run cap).',
      hint: 'Makes a Last Few Days post at 3:00 AM on its days (Tuesday and Friday), in place of that day’s carousel run.',
    },
    perDayMin: 0,
    capPerSeries: false,
    weekPool: false,
    groupNoun: 'series',
    dragNeedsGroup: false,
  },
  // At most twice a day (Miami and Boston, AE-29). No seed path yet (decided 2026-11-02: not built).
  ai_events: {
    title: 'AI Events This Week',
    benchNote:
      'The week’s ranked events, city by city: the top 3 per city go into the carousel. Gated and excluded events stay listed with the reason. Open a row to see where its score comes from.',
    maxCap: 2,
    queue: 'none',
    seedable: false,
    postsNoun: 'AI Events posts',
    generate: {
      label: 'Generate on Sundays',
      confirm: 'Make the AI Events post every Sunday at 12:00 PM? Each run ranks the coming week’s events with live Jev calls (about $0.02, up to the run cap). No Claude calls.',
      hint: 'Ranks the coming week’s events and renders the carousel at 12:00 PM on Sundays, for the 6:00–7:00 PM slot. It waits for your approval unless auto-publish is on.',
    },
    perDayMin: 0,
    capPerSeries: false,
    weekPool: true,
    groupNoun: 'cities',
    dragNeedsGroup: false,
  },
  field_notes: {
    title: 'Field Notes',
    benchNote:
      'Tips waiting for a post, newest first: from vendor docs, GitHub, Hacker News, RSS and the ones you seed. Generate picks one, pairs it with photos from the pool and renders the carousel. A tip that already made a post shows that post.',
    maxCap: 1,
    queue: 'none',
    seedable: true,
    postsNoun: 'Field Notes posts',
    generate: {
      label: 'Generate on its days',
      confirm:
        'Make a Field Notes post at 12:00 PM on its days? Each run writes one post with live Claude and Jev calls (up to the run cap, $0.50 by default). It waits for your approval.',
      hint: 'Picks the next tip and renders the carousel at 12:00 PM on its days (one or two a week), for the 2:30–3:30 PM slot. It waits for your approval unless auto-publish is on.',
    },
    perDayMin: 0,
    capPerSeries: false,
    weekPool: false,
    groupNoun: 'series',
    dragNeedsGroup: false,
  },
  // Pitches come from weekly development sessions, not seeds; the night makes up to three a day.
  reel_ai_drama: {
    title: 'AI Drama Reels',
    benchNote: 'Story pitches waiting to be made, best rank first. Make it produces one reel. Hold and drag any pitch to move it.',
    maxCap: 3,
    queue: 'live',
    seedable: false,
    postsNoun: 'AI Drama reels',
    generate: {
      label: 'Generate every night',
      confirm:
        'Make AI Drama reels every night at 12:00 AM for the day’s slots, and run the weekly development session on Mondays? Each makes live model, search, voice and video calls, up to the daily render and spend caps.',
      hint: 'At 12:00 AM the night makes the best pitches for the day’s slots; a development session refills the pitch pool on Mondays. Reels wait for your approval unless auto-publish is on.',
    },
    perDayMin: 1,
    capPerSeries: false,
    weekPool: false,
    groupNoun: 'series',
    dragNeedsGroup: false,
  },
};

/** The config for a type id given as a plain string (a posting-settings `type`); undefined for an id that is not a type. */
export const configFor = (type: string): TypeConfig | undefined => (Object.prototype.hasOwnProperty.call(TYPE_CONFIG, type) ? TYPE_CONFIG[type as Vertical] : undefined);

/** The Generate switch's words: the type's own, or the default for a type that makes its posts every morning. */
export function generateCopy(type: Vertical): GenerateCopy {
  const c = TYPE_CONFIG[type];
  return (
    c.generate ?? {
      label: 'Generate every morning',
      confirm: `Make ${c.postsNoun} every morning? Each run makes live model and web calls.`,
      hint: `Makes ${c.postsNoun} every morning to fill the day's quota.`,
    }
  );
}

const idsWhere = (test: (c: TypeConfig) => boolean): ReadonlySet<string> =>
  new Set((Object.keys(TYPE_CONFIG) as Vertical[]).filter((id) => test(TYPE_CONFIG[id])));

/** Types whose nights follow the queue (see lib/social-hub/queue.ts QUEUE_LIVE). */
export const QUEUE_LIVE_TYPES: ReadonlySet<string> = idsWhere((c) => c.queue === 'live');
/** Types that take Archive but not Pin or drag. */
export const ARCHIVE_ONLY_TYPES: ReadonlySet<string> = idsWhere((c) => c.queue === 'archive_only');
