/**
 * The shared photo finder (central intake Phase 3, CI-30/CI-31): one engine for every news content type, built on
 * AI Drama's harvest engine (lib/reel-ai-drama/harvest), adapting to what each type asks for. FROZEN contract
 * (planning/Central Intake/PHASE3-CONTRACT.md): owners change it only through the lead.
 *
 * Each type keeps today's finder behind a per-type switch (`intake.settings` key `photo_finders`, default
 * 'legacy'). In 'shared' mode a frame tries the shared finder first; a frame it leaves empty (nothing usable, or
 * the post's $0.30 cap spent) goes to today's finder, unchanged.
 */
import type { HarvestInput, HarvestResult } from '@/lib/reel-ai-drama/harvest/harvest';
import type { HarvestDeps } from '@/lib/reel-ai-drama/harvest/types';
import type { ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Photo } from '@/lib/stories/render/types';

import type { UsedLedger } from './used';

/** The content types that use the shared finder. Field Notes is out (the team's own photos). */
export type PhotoProfileId = 'lfd' | 'md' | 'gtn' | 'fvp' | 'carousel';
export const PHOTO_PROFILE_IDS: readonly PhotoProfileId[] = ['lfd', 'md', 'gtn', 'fvp', 'carousel'];

export type PhotoFinderMode = 'legacy' | 'shared';
export type PhotoFinderModes = Record<PhotoProfileId, PhotoFinderMode>;
/** `intake.settings` key holding `{ "<profile>": "shared" | "legacy" }`. A missing row or key reads as 'legacy'. */
export const PHOTO_FINDERS_SETTINGS_KEY = 'photo_finders';

/** The per-post hard cap (CI-30: "$0.30 per post"). Once spent, the post's remaining frames use today's finder. */
export const SHARED_PHOTO_CAP_USD = 0.3;

export type PhotoSubject = { name: string; type: 'person' | 'organization' | 'product' };

/**
 * How specific the frame's photo must be.
 * - 'story':   try for a photo of this story's own moment first (the article's images, the key moment), then a
 *              photo of a named subject (CI-30 "subject photo, then old finder").
 * - 'subject': a photo of the named subject first (a portrait, a product, a logo), then the story's moment.
 */
export type Specificity = 'story' | 'subject';

/** One frame's photo need, the same shape for every type (lib/photos/needs.ts builds it from each type's request). */
export type PhotoNeed = {
  /** Stable within one set (e.g. the slide's index or key); traces are keyed by it. */
  id: string;
  /** The story's headline. */
  headline: string;
  /** The story's text for the harvest pitch (at most 1200 characters). */
  brief: string;
  /** The frame's own words, so the look judges the photo against what the frame says. Empty when none. */
  copy: string;
  /** The writer's photo query: the moment the harvest searches for. */
  query: string;
  /** The writer's photo kind (person, company, logo, product, event, thematic, setting, or the type's own kind). */
  kind: string;
  subjects: PhotoSubject[];
  /** The story's own pages (article images are a first-class source); http(s) only. */
  storyUrls: string[];
  /** The outlet of the first story URL, for the pitch's source line. */
  sourceName: string | null;
  /** YYYY-MM-DD of the event (else publish date), or null. */
  storyDate: string | null;
  specificity: Specificity;
  /** The set's cover frame: no logo, and the profile's cover size floor. */
  cover?: boolean;
};

/** What one content type asks of the shared finder. */
export type PhotoProfile = {
  id: PhotoProfileId;
  /** Shortest side, in pixels, a frame's photo must have. */
  minShortSide: number;
  /** Shortest side for the cover frame. */
  coverMinShortSide: number;
  /** A logo may fill a non-cover frame only when the need's kind is logo/company or this is true. */
  allowLogo: boolean;
  /** Per-post hard cap in USD (Serper searches + Haiku looks), shared across the post's frames. */
  capUsd: number;
  /** News photos are used editorially with the outlet or agency credited (round-1 decision). */
  licence: 'editorial_credited';
};

/** The shared finder's spend for one post; mutated across its frames (serial). */
export type PhotoBudget = { usd: number; capUsd: number };

/**
 * Everything outside the process goes through here; tests stub it all. `harvest` is the engine's own deps minus
 * `db` (always a sink: the shared finder never writes AI Drama's tables) and `capUsd` (set per frame from the budget).
 */
export type PhotoDeps = {
  harvest: Omit<HarvestDeps, 'db' | 'capUsd'>;
  /** The engine (runHarvest); injectable for tests. */
  run?: (deps: HarvestDeps, input: HarvestInput) => Promise<HarvestResult>;
  settings?: ReelAiDramaSettings;
  /** Parent folder for per-frame job folders (removed afterwards); default the OS tmp dir. */
  workDir?: string;
  now: () => Date;
  /**
   * The used-photo ledger (CI-32, lib/photos/used.ts), read once per post: a found photo published by any post in the
   * last 20 days, by URL or by pHash, is refused (logos aside: brand assets). Absent: only `exclude` applies.
   */
  used?: () => Promise<UsedLedger>;
};

export type FindOptions = {
  /** Never pick these URLs (the type's recently-used photos, and photos already in this set). */
  exclude: ReadonlySet<string>;
  budget: PhotoBudget;
  /**
   * The type's own rules for a photo (e.g. carousels' C6 credit check): the reason a candidate can't be used, or null
   * when it can. A refused candidate gives way to the next-ranked one, so the frame's spend isn't wasted on one pick.
   */
  accept?: (photo: Photo, need: PhotoNeed) => string | null;
};

export type FoundPhotos = {
  /** One per need, same order; null = the shared finder left this frame to today's finder. */
  photos: Array<Photo | null>;
  /** One trace per need, same order: every step and why a frame was left empty. */
  traces: string[][];
};
