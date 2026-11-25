/**
 * Photos offered with their bytes in hand (Stories Split, SS-24): Real or AI?'s pooled candidates. The finder's
 * offers (bank.ts planOffer) queue a URL for the ingest to download; these are stored from the bytes the type already
 * holds, as Field Notes stores its own photos (lib/field-notes/photos/ingest.ts): a real photo's original download
 * under its image URL, and an AI image (no web URL) under its `storage:<bucket>/<path>` ref.
 *
 *   photo     upserted on sha256 (master and thumbnail uploaded first, only for new bytes), with `truth` and, for an
 *             AI image, `gen_model` and `gen_prompt` (db/media_library_stories_split.sql); a known photo keeps its
 *             own and only fills what it lacks
 *   source    one row per URL, stored and linked (no download); a re-offer only ever widens its licence (store.ts)
 *   sighting  the run's request, with the type's own check as the close-up pass, so a real photo's tags and
 *             vision_pass let every type's thematic request find it again
 *
 * Licences: a real photo keeps its own (open or government, reusable); an AI image is `generated` with reuse_ok
 * false, which no reader serves to another type (reader.ts allowGenerated, drama.ts).
 */
import type { MediaBucket } from '@/lib/media-bucket';

import { dhashOf, renditions, sha256Of } from './ingest';
import { licenceRankSql, writeRows } from './store';
import { masterPath, thumbPath, type Licence, type PhotoTruth, type Query, type RunKind, type SightingRow } from './types';

export type HeldPhoto = {
  /** The bank's key for the photo: the original image URL, or a `storage:<bucket>/<path>` ref for an image with no web URL. */
  url: string;
  /** The bytes to store: a real photo's original download, an AI image's stored JPEG. */
  bytes: Buffer;
  source: string;
  lane: string;
  title: string | null;
  date: string | null;
  credit: string;
  licence: Licence;
  reuseOk: boolean;
  /** What the run asked for (Real or AI?: the search words or the prompt) and its kind (the subject). */
  request: string;
  requestKind: string;
  /** What it shows, in plain words (a title or description), for its tags. */
  shows: string | null;
  slide: number;
  outcome: 'picked' | 'passed';
  /** The type's own check passed (Real or AI?: the Jev screen): recorded as the sighting's close-up pass. */
  pass: boolean;
  truth?: PhotoTruth | null;
  genModel?: string | null;
  genPrompt?: string | null;
  /** Anything else worth keeping with the sighting (the screen's difficulty, the trap). */
  verdict?: Record<string, unknown> | null;
};

export type HeldOfferInput = {
  runKind: RunKind;
  /** The run's own id for the photo (Real or AI?: the pool key). */
  runRef: string;
  items: HeldPhoto[];
  at?: Date;
};

export type HeldDeps = { query: Query; bucket: Pick<MediaBucket, 'upload'> };

/** The sighting for one held photo. Pure. */
export function heldSighting(input: Pick<HeldOfferInput, 'runKind' | 'runRef' | 'at'>, item: HeldPhoto): SightingRow {
  return {
    url: item.url,
    run_kind: input.runKind,
    run_ref: input.runRef,
    slide: item.slide,
    request_query: item.request,
    request_kind: item.requestKind,
    request_qid: null,
    qid: null,
    subject: null,
    verified: false,
    outcome: item.outcome,
    vision: { scene: item.request, pass: item.pass, what_it_shows: item.shows, verdict: item.verdict ?? null },
    tile_tags: [],
    fit: null,
    faces: null,
    plate: null,
    at: (input.at ?? new Date()).toISOString(),
  };
}

/** The original's type from its first bytes (the bank records it); JPEG when unknown. */
export function mimeOf(bytes: Buffer): string {
  if (bytes.length > 3 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
  if (bytes.length > 11 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/jpeg';
}

const NOT_REUSABLE = new Set<Licence>(['company', 'unknown', 'generated']);

/** Store one held photo (photo, source, sighting); returns the photo id. Throws on failure: the caller logs it. */
export async function storeHeld(deps: HeldDeps, input: Pick<HeldOfferInput, 'runKind' | 'runRef' | 'at'>, item: HeldPhoto): Promise<string> {
  if (!item.url || !item.bytes?.length) throw new Error('a held photo needs a URL and its bytes');
  const sha = sha256Of(item.bytes);
  const reuseOk = Boolean(item.reuseOk && !NOT_REUSABLE.has(item.licence));
  const truth = item.truth ?? null;
  let photoId = (await deps.query(`SELECT id FROM media_library.photos WHERE sha256 = $1`, [sha])).rows[0]?.id as string | undefined;
  if (photoId) {
    if (truth || item.genModel || item.genPrompt) {
      await deps.query(
        `UPDATE media_library.photos SET truth = COALESCE(truth, $2), gen_model = COALESCE(gen_model, $3), gen_prompt = COALESCE(gen_prompt, $4), last_seen_at = now() WHERE id = $1`,
        [photoId, truth, item.genModel ?? null, item.genPrompt ?? null],
      );
    }
  } else {
    const dhash = await dhashOf(item.bytes).catch(() => null);
    const r = await renditions(item.bytes);
    // Upload before the row exists: a failed upload leaves no photo without its files.
    await deps.bucket.upload(masterPath(sha), r.master, 'image/jpeg');
    await deps.bucket.upload(thumbPath(sha), r.thumb, 'image/jpeg');
    const { rows } = await deps.query(
      `INSERT INTO media_library.photos (sha256, dhash, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok, truth, gen_model, gen_prompt)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (sha256) DO UPDATE SET last_seen_at = now()
       RETURNING id`,
      [sha, dhash, masterPath(sha), thumbPath(sha), mimeOf(item.bytes), item.bytes.byteLength, r.width, r.height, item.credit.trim() || 'Unknown source', item.licence, reuseOk, truth, item.genModel ?? null, item.genPrompt ?? null],
    );
    photoId = rows[0]!.id as string;
  }
  await deps.query(
    `INSERT INTO media_library.photo_sources AS s (url, photo_id, source, lane, title, date, credit, licence, reuse_ok, status, last_ok_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'stored', now())
     ON CONFLICT (url) DO UPDATE SET
       photo_id = EXCLUDED.photo_id, status = 'stored', claimed_at = NULL, last_error = NULL, last_ok_at = now(), last_seen_at = now(),
       source = COALESCE(s.source, EXCLUDED.source),
       lane = COALESCE(s.lane, EXCLUDED.lane),
       title = COALESCE(NULLIF(s.title, ''), EXCLUDED.title),
       date = COALESCE(s.date, EXCLUDED.date),
       credit = CASE WHEN ${licenceRankSql('EXCLUDED.licence')} > ${licenceRankSql('s.licence')} THEN EXCLUDED.credit ELSE COALESCE(s.credit, EXCLUDED.credit) END,
       reuse_ok = CASE WHEN ${licenceRankSql('EXCLUDED.licence')} > ${licenceRankSql('s.licence')} THEN EXCLUDED.reuse_ok ELSE s.reuse_ok END,
       licence = CASE WHEN ${licenceRankSql('EXCLUDED.licence')} > ${licenceRankSql('s.licence')} THEN EXCLUDED.licence ELSE COALESCE(s.licence, EXCLUDED.licence) END`,
    [item.url, photoId, item.source, item.lane, item.title, item.date, item.credit, item.licence, reuseOk],
  );
  // The sighting; writeRows then recomputes the linked photo's library fields (credit, licence, tags, vision pass).
  await writeRows(deps.query, { sources: [], sightings: [heldSighting(input, item)] });
  return photoId;
}
