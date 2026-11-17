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
import type { BankReader } from '@/lib/media-library/reader';
import type { Photo } from '@/lib/stories/render/types';

import type { UsedLedger } from './used';

/**
 * The content types that use the shared finder. Field Notes is out (the team's own photos).
 * SS-20 (Stories Split): 'trivia' ("Are you smarter than AI?", Guess the Number's old values) and 'roa' (Real or AI?)
 * replace the retired 'gtn' and 'fvp'.
 */
export type PhotoProfileId = 'lfd' | 'md' | 'trivia' | 'roa' | 'carousel';
export const PHOTO_PROFILE_IDS: readonly PhotoProfileId[] = ['lfd', 'md', 'trivia', 'roa', 'carousel'];

export type PhotoFinderMode = 'legacy' | 'shared';
export type PhotoFinderModes = Record<PhotoProfileId, PhotoFinderMode>;
/** `intake.settings` key holding `{ "<profile>": "shared" | "legacy" }`. A missing row or key reads as 'legacy'. */
export const PHOTO_FINDERS_SETTINGS_KEY = 'photo_finders';

/** The per-post hard cap (CI-30: "$0.30 per post"). Once spent, the post's remaining frames use today's finder. */
export const SHARED_PHOTO_CAP_USD = 0.3;

export type PhotoSubject = { name: string; type: 'person' | 'organization' | 'product' };

/**
 * How specific the frame's photo must be.
 * - 'story':     try for a photo of this story's own moment first (the article's images, the key moment), then a
 *                photo of a named subject (CI-30 "subject photo, then old finder").
 * - 'subject':   a photo of the named subject first (a portrait, a product, a logo), then the story's moment.
 * - 'aesthetic': no story and no subject: a photo picked for how it looks (Real or AI?'s "looks staged or too
 *                perfect" rounds, SS-21). Only the archives path serves it; the harvest treats it as 'story'.
 */
export type Specificity = 'story' | 'subject' | 'aesthetic';

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
  /**
   * News photos are used editorially with the outlet or agency credited (round-1 decision). Real or AI? takes only
   * open or government licences (SS-20).
   */
  licence: 'editorial_credited' | 'open_or_government';
  /** Where the photos come from: AI Drama's harvest (default), or the free archives path (./archive.ts, SS-22). */
  sources?: 'harvest' | 'archives';
  /** False: the credit is kept off the frame (Real or AI?: it would give the answer away; the reveal carries it). */
  creditOnFrame?: boolean;
  /** The photo's own height floor in pixels, when the frame is taller than the short-side rule says (a 9:16 Story). */
  minHeight?: number;
  /** Widest width/height ratio a photo may have: portrait, or croppable to the frame (Real or AI?: 16/9). */
  maxAspect?: number;
  /** What the photo must not show. The finder drops what it can tell (a bank photo's faces); the type's screen judges the rest. */
  refuse?: ReadonlyArray<'faces' | 'brands' | 'text'>;
};

/** What a camera recorded (EXIF), as a type shows it (Real or AI?'s camera card, RA-26). Every field is optional. */
export type PhotoCamera = {
  /** Make and model, cleaned: "Nikon D7200". */
  body?: string;
  lens?: string;
  focalMm?: number;
  fNumber?: number;
  /** Seconds: 0.0015625 is 1/640 s. */
  exposureS?: number;
  iso?: number;
  /** YYYY-MM-DD. */
  taken?: string;
};

/**
 * One photo the archives path found (SS-22): the photo bank, Wikimedia Commons Featured and Quality pictures, or the
 * NASA image library. Not downloaded: the type fetches `imageUrl` (then `alt`) itself.
 */
export type ArchiveFind = {
  source: 'bank' | 'commons' | 'nasa';
  /** The photo's own page (Commons file page, NASA details page; the bank: the URL it offers). */
  page: string;
  imageUrl: string;
  /** Tried in order when imageUrl fails. */
  alt: string[];
  /** The licence as the source names it ("CC BY-SA 4.0", "Public domain (NASA)"). */
  licence: string;
  licenceClass: 'open' | 'government';
  credit: string;
  title?: string;
  description?: string;
  year?: string;
  place?: string;
  camera?: PhotoCamera;
  /** 0 when the source doesn't say before download. */
  width: number;
  height: number;
  portrait: boolean;
  /** More about a photo that was kept (best effort; NASA's metadata file): its camera and place. */
  more?: () => Promise<{ camera?: PhotoCamera; place?: string }>;
};

/** The shared finder's spend for one post; mutated across its frames (serial). */
export type PhotoBudget = { usd: number; capUsd: number };

/**
 * Everything outside the process goes through here; tests stub it all. `harvest` is the engine's own deps minus
 * `db` (always a sink: the shared finder never writes AI Drama's tables) and `capUsd` (set per frame from the budget).
 */
export type PhotoDeps = {
  /** Absent: the harvest path can't run (its frames go to today's finder); the archives path never needs it. */
  harvest?: Omit<HarvestDeps, 'db' | 'capUsd'>;
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
  /** The archives path's reads (Commons, NASA); default: deps.harvest.http, else global fetch. Tests stub it. */
  fetch?: typeof fetch;
  /** The archives path's photo bank, read first (cleared licences only). Absent or off: the archives alone. */
  bank?: BankReader | null;
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
  /** The archives path only: how many ranked finds to return per need in `found` (default 1). */
  limit?: number;
};

export type FoundPhotos = {
  /** One per need, same order; null = the shared finder left this frame to today's finder. */
  photos: Array<Photo | null>;
  /** One trace per need, same order: every step and why a frame was left empty. */
  traces: string[][];
  /** The archives path only: per need, the ranked finds (at most `limit`), the first being `photos[i]`. */
  found?: ArchiveFind[][];
};
