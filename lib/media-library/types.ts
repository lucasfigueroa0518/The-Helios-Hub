/**
 * The photo bank's shared shapes (DECISIONS_LOG D49; schema
 * db/media_library_schema.sql). Pure: no database, no network, so the hub's
 * read code may import it.
 */

/** A SELECT/INSERT query function: the runtime passes lib/db.ts `dbQuery`, tests pass PGlite. */
export type Query = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;

export type RunKind = 'carousel' | 'story' | 'backfill';

/** picked: a slide's winner · passed: a runner-up that passed every check · verified: an identity-verified headshot, second photo, CEO, headquarters or logo · rejected: failed the tag fit or the close-up check · used: imported from social.used_photos. */
export type Outcome = 'picked' | 'passed' | 'verified' | 'rejected' | 'used';

export type Licence = 'open' | 'government' | 'company' | 'unknown';

/** settings.finder_source: off (default) · compete (bank candidates join the online ones) · first (online search stops once the bank has enough). */
export type FinderSourceMode = 'off' | 'compete' | 'first';

export type SourceStatus = 'pending' | 'fetching' | 'stored' | 'failed' | 'gone' | 'skipped';

/** The private Storage bucket that holds the bank copies (lib/media-bucket.ts). */
export const PHOTO_BANK_BUCKET = 'photo-bank';

export const masterPath = (sha256: string) => `originals/${sha256.slice(0, 2)}/${sha256}.jpg`;
export const thumbPath = (sha256: string) => `thumbs/${sha256.slice(0, 2)}/${sha256}.jpg`;

/** A photo_sources row to queue (status pending). */
export type SourceRow = {
  url: string;
  source: string | null;
  lane: string | null;
  title: string | null;
  date: string | null;
  credit: string | null;
  licence: Licence;
  reuse_ok: boolean;
};

/** A sightings row. `slide`: render position (1 = cover); Stories: the request's order in the build. */
export type SightingRow = {
  url: string;
  run_kind: RunKind;
  run_ref: string;
  slide: number;
  request_query: string;
  request_kind: string | null;
  request_qid: string | null;
  qid: string | null;
  subject: string | null;
  verified: boolean;
  outcome: Outcome;
  vision: SightingVision | null;
  tile_tags: string[];
  fit: number | null;
  faces: unknown[] | null;
  plate: string | null;
  at: string;
};

/**
 * A vision answer recorded with a sighting. `scene` is what the check was
 * asked about (the request, or an official image's announcement); `pass` is
 * the stock close-up rule (vision.ts passesVision). `inferred`: not a recorded
 * answer but implied (a published carousel stock photo passed its close-up).
 */
export type SightingVision = {
  scene: string;
  pass: boolean;
  what_it_shows?: string | null;
  verdict?: Record<string, unknown> | null;
  error?: string;
  inferred?: boolean;
};

/** What queueing writes: sources to fetch and sightings to record. */
export type BankRows = { sources: SourceRow[]; sightings: SightingRow[] };
