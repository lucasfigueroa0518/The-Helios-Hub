/**
 * The photo hold's second half (Bald-Eagle D3): photos chosen by items that are built but not yet posted, of every
 * content type. The used-photo ledger (./used.ts) logs a photo only when its post is published, so a built set that
 * waits for review (Stories' shadow sets, a cushion type's item made two days ahead) held nothing, and the next
 * build could pick the same picture. `readUsedLedger` folds these in, so every finder holds them without a caller
 * change.
 *
 * One read per ledger read: the items still waiting (by each type's own status names) whose posting day hasn't
 * passed, and that the hub has not deleted, rejected or published. An item whose day has gone by unposted is stale
 * and holds nothing: if it is ever posted, the publish-time log holds its photos from then. A type with no posting
 * day on the item counts as waiting for PENDING_UNDATED_DAYS after it was built. Photos come out through the same
 * per-type readers the publish-time log uses (./published-posts.ts), so the keys line up with the ledger's: a web
 * photo by its URL, a Field Notes team photo by mediaLibraryKey(id) with the bank's dHash, an AI Drama asset by its
 * URL and pHash. Brand assets (logos, meme templates, cutouts) are left out there, as in the ledger.
 *
 *   type              items                waiting when                                 day           photos
 *   Stories-format    stories.sets        ready/approved/scheduled/publishing          ny_date       stories.frames.photo.src
 *   (Morning Download,                     (Free vs. Paid: logos only, skipped)                       (+ Real or AI?'s
 *   AI Trivia,                             each set under its own type (SS-23)                         real rounds'
 *   Real or AI?)                                                                                      provenance.src)
 *   Carousels          social.posts        review, origin pipeline                      (built ≤ 3d)  render.slides[].photoUrl
 *   Last Few Days      lfd.posts           review                                       ny_date       stories[].photo.src
 *   Field Notes        field_notes.posts   review                                       ny_date       photo_ids → media_library.photos
 *   AI Drama           reel_ai_drama.jobs  ok, the pitch's latest job (it has no        night_date    asset_uses → assets.data
 *                                          posted state of its own, so the hub's says)  (else ≤ 3d)
 *   Text on Screen, Explainers: no web or bank photos.
 *   AI Events: not held. Its posters are organizer event images no other finder offers, and its rebuild redoes the
 *   week's waiting posts in place (lib/ai-events/store.ts), so holding them would only take a post's posters from
 *   its own rebuild. Its published posters stay in the ledger.
 *
 * An item rebuilding or re-rendering its own photos, or a remake replacing a waiting item, passes `excludeItem`
 * (one item or several), so those picks never block it.
 */
import type { Query } from '@/lib/social/store/pg';

import {
  carouselCandidate,
  dramaCandidate,
  fieldNotesCandidate,
  lfdCandidate,
  SPINE_VERTICAL,
  storiesCandidate,
  type CandidatePost,
} from './published-posts';
import { USED_PHOTO_DAYS, type UsedLedger, type UsedVertical } from './used';

/** The item whose own photos must not block it: its type (ledger or hub name) and its own id. */
export type ExcludeItem = { vertical: string; id: string };
export type ExcludeItems = ExcludeItem | readonly ExcludeItem[] | null | undefined;
export type PendingOptions = { excludeItem?: ExcludeItems; days?: number };

/** How long an item with no posting day of its own (a Carousels post) counts as waiting after it was built. */
export const PENDING_UNDATED_DAYS = 3;

const LEDGER_VERTICAL: Record<string, UsedVertical> = Object.fromEntries(
  (Object.entries(SPINE_VERTICAL) as Array<[UsedVertical, string]>).flatMap(([v, spine]) => [
    [v, v],
    [spine, v],
  ]),
);

/** The ledger name for a type given by either its ledger name ('lfd') or its hub name ('last_few_days'). */
export const ledgerVertical = (v: string): UsedVertical | null => LEDGER_VERTICAL[v] ?? null;

/**
 * Every waiting item, one row each: its type, id, build time, the idea it was made for (Carousels: the news story id)
 * and just the fields its photos live in. $1 = now, $2 = the undated window in days. "Today" is New York's.
 */
export const PENDING_ITEMS_SQL = `
WITH win AS (SELECT $1::timestamptz AS hi, $1::timestamptz - make_interval(days => $2) AS lo,
                    ($1::timestamptz AT TIME ZONE 'America/New_York')::date AS today),
items AS (
  SELECT (CASE WHEN s.series IN ('ai_trivia', 'real_or_ai') THEN s.series ELSE 'stories' END)::text AS vertical,
         s.id::text AS id, coalesce(s.built_at, s.created_at) AS built_at, NULL::text AS idea,
         jsonb_build_object('series', s.series, 'rounds', s.payload->'roa'->'rounds', 'frames', coalesce((
           SELECT jsonb_agg(jsonb_build_object('seq', f.seq, 'role', f.role, 'photo', f.photo))
             FROM stories.frames f WHERE f.set_id = s.id AND f.photo IS NOT NULL), '[]'::jsonb)) AS doc
    FROM stories.sets s, win
   WHERE s.status IN ('ready', 'approved', 'scheduled', 'publishing') AND s.series <> 'free_vs_paid'
     AND s.ny_date >= win.today AND coalesce(s.built_at, s.created_at) <= win.hi
  UNION ALL
  SELECT 'carousels', p.id::text, p.created_at, p.story_id,
         jsonb_build_object('render', jsonb_build_object('slides', coalesce((
           SELECT jsonb_agg(jsonb_build_object('photoUrl', sl->'photoUrl', 'photoKind', sl->'photoKind', 'position', sl->'position'))
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.render->'slides') = 'array' THEN p.render->'slides' ELSE '[]'::jsonb END) sl), '[]'::jsonb)))
    FROM social.posts p, win
   WHERE p.status = 'review' AND p.origin = 'pipeline' AND p.created_at > win.lo AND p.created_at <= win.hi
  UNION ALL
  SELECT 'lfd', p.id::text, p.created_at, NULL,
         jsonb_build_object('stories', coalesce((
           SELECT jsonb_agg(jsonb_build_object('photo', st->'photo'))
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.stories) = 'array' THEN p.stories ELSE '[]'::jsonb END) st), '[]'::jsonb),
           'render', jsonb_build_object('slides', coalesce((
           SELECT jsonb_agg(jsonb_build_object('position', sl->'position', 'photoKind', sl->'photoKind'))
             FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p.render->'slides') = 'array' THEN p.render->'slides' ELSE '[]'::jsonb END) sl), '[]'::jsonb)))
    FROM lfd.posts p, win
   WHERE p.status = 'review' AND p.ny_date >= win.today AND p.created_at <= win.hi
  UNION ALL
  SELECT 'field_notes', p.id::text, p.created_at, NULL,
         jsonb_build_object('photo_ids', to_jsonb(p.photo_ids::text[]), 'bank', coalesce((
           SELECT jsonb_agg(jsonb_build_object('id', m.id::text, 'dhash', m.dhash))
             FROM media_library.photos m WHERE m.id::text = ANY(p.photo_ids::text[])), '[]'::jsonb))
    FROM field_notes.posts p, win
   WHERE p.status = 'review' AND p.created_at <= win.hi
     AND (CASE WHEN p.ny_date IS NOT NULL THEN p.ny_date >= win.today ELSE p.created_at > win.lo END)
  UNION ALL
  SELECT 'reel_ai_drama', j.id::text, coalesce(j.finished_at, j.requested_at), NULL,
         jsonb_build_object('uses', coalesce((
           SELECT jsonb_agg(jsonb_build_object('asset_key', u.asset_key, 'character_image', u.character_image, 'data',
                    (SELECT a.data FROM reel_ai_drama.assets a WHERE a.asset_key = u.asset_key ORDER BY (a.job_id = u.job_id) DESC, a.created_at DESC LIMIT 1))
                    ORDER BY u.used_at, u.id)
             FROM reel_ai_drama.asset_uses u WHERE u.job_id = j.id), '[]'::jsonb))
    FROM reel_ai_drama.jobs j, win
   WHERE j.status = 'ok' AND coalesce(j.finished_at, j.requested_at) <= win.hi
     AND (CASE WHEN j.night_date IS NOT NULL THEN j.night_date >= win.today ELSE coalesce(j.finished_at, j.requested_at) > win.lo END)
     AND NOT EXISTS (SELECT 1 FROM reel_ai_drama.jobs n WHERE n.pitch_id = j.pitch_id AND n.status = 'ok' AND n.id <> j.id
                      AND (coalesce(n.finished_at, n.requested_at), n.id) > (coalesce(j.finished_at, j.requested_at), j.id))
)
SELECT i.vertical, i.id, i.built_at, i.idea, i.doc
  FROM items i
 WHERE NOT EXISTS (
   SELECT 1 FROM social_hub.content_items ci
     LEFT JOIN social_hub.approvals ap ON ap.content_item_id = ci.id
    WHERE (ci.vertical = (CASE i.vertical WHEN 'lfd' THEN 'last_few_days' ELSE i.vertical END)
           -- SS-23: a Trivia or Real or AI? item made before db/stories_split.sql moved it off the 'stories' vertical
           OR (i.vertical IN ('ai_trivia', 'real_or_ai') AND ci.vertical = 'stories'))
      AND ci.native_ref = i.id
      AND (ci.deleted_at IS NOT NULL OR ap.decision = 'rejected'
           OR EXISTS (SELECT 1 FROM social_hub.schedule sc WHERE sc.content_item_id = ci.id AND sc.status = 'published')))`;

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : typeof v === 'string' ? safeParse(v) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
function safeParse(s: string): Json {
  try {
    const v = JSON.parse(s);
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

export type PendingRow = { vertical: string; id: string; built_at: unknown; idea?: string | null; doc: unknown };

/** One waiting item's photos, through the same reader the publish-time log uses. Unknown types: none. */
export function pendingCandidate(row: PendingRow): CandidatePost | null {
  const id = String(row.id);
  const doc = obj(row.doc);
  const base = { id, caption: null, created_at: row.built_at, slide_objects: null };
  switch (row.vertical) {
    case 'stories':
    case 'ai_trivia':
    case 'real_or_ai':
      return storiesCandidate(
        { id, series: String(doc.series ?? ''), built_at: row.built_at, rounds: doc.rounds },
        arr(doc.frames).map((f) => {
          const fr = obj(f);
          return { set_id: id, seq: Number(fr.seq) || 0, role: typeof fr.role === 'string' ? fr.role : null, photo: fr.photo, storage_path: null };
        }),
      );
    case 'carousels':
      return carouselCandidate({ ...base, render: doc.render });
    case 'lfd':
      return lfdCandidate({ ...base, stories: doc.stories, render: doc.render });
    case 'field_notes':
      return fieldNotesCandidate(
        { ...base, photo_ids: doc.photo_ids },
        arr(doc.bank).map((b) => {
          const r = obj(b);
          return { id: String(r.id), dhash: typeof r.dhash === 'string' ? r.dhash : null, credit: null, qids: [], subjects: [], scenes: [], master_path: null };
        }),
      );
    case 'reel_ai_drama':
      return dramaCandidate(
        { id, finished_at: row.built_at, caption: null },
        arr(doc.uses).map((u) => {
          const r = obj(u);
          return { job_id: id, asset_key: String(r.asset_key ?? ''), character_image: r.character_image === true, data: r.data };
        }),
      );
    default:
      return null;
  }
}

/** Who holds a photo: the waiting item's type and id, and the idea it was made for when known (Carousels: story id). */
export type PendingOwner = { vertical: UsedVertical; id: string; idea: string | null };

/** The waiting items' photos: the ledger shape, plus who holds each URL. */
export type PendingHold = UsedLedger & { owners: ReadonlyMap<string, readonly PendingOwner[]> };

const isMissing = (err: unknown) => ['42P01', '3F000', '42703'].includes((err as { code?: string } | null)?.code ?? '');

const excludeList = (e: ExcludeItems): ExcludeItem[] => (e ? (Array.isArray(e) ? [...(e as readonly ExcludeItem[])] : [e as ExcludeItem]) : []);

/**
 * The photos of every waiting item, as ledger entries (URLs plus whatever hashes the item stored) with their
 * owners. A failed read holds nothing extra (the published rule still applies); a missing table is silent, anything
 * else is logged once per read. `days` ≤ 0 holds nothing (a caller that turned the rule off).
 */
export async function pendingHold(query: Query, now: Date, opts: PendingOptions = {}): Promise<PendingHold> {
  const urls = new Set<string>();
  const phashes: string[] = [];
  const dhashes: string[] = [];
  const owners = new Map<string, PendingOwner[]>();
  const empty = { urls, phashes, dhashes, owners };
  if ((opts.days ?? USED_PHOTO_DAYS) <= 0) return empty;
  let rows: PendingRow[];
  try {
    ({ rows } = (await query(PENDING_ITEMS_SQL, [now.toISOString(), Math.min(PENDING_UNDATED_DAYS, opts.days ?? USED_PHOTO_DAYS)])) as { rows: PendingRow[] });
  } catch (err) {
    if (!isMissing(err)) console.warn(`photo hold: waiting items could not be read (${err instanceof Error ? err.message : String(err)}); only published photos are held`);
    return empty;
  }
  const skip = excludeList(opts.excludeItem).map((e) => ({ vertical: ledgerVertical(e.vertical) ?? e.vertical, id: String(e.id) }));
  for (const row of rows ?? []) {
    if (!row || typeof row.vertical !== 'string' || row.id == null) continue;
    if (skip.some((s) => s.vertical === row.vertical && s.id === String(row.id))) continue;
    const post = pendingCandidate(row);
    if (!post) continue;
    const owner: PendingOwner = { vertical: post.vertical, id: post.postId, idea: typeof row.idea === 'string' && row.idea ? row.idea : null };
    for (const p of post.photos) {
      urls.add(p.url);
      const list = owners.get(p.url) ?? [];
      if (!list.some((o) => o.vertical === owner.vertical && o.id === owner.id)) list.push(owner);
      owners.set(p.url, list);
      if (p.phash && !phashes.includes(p.phash)) phashes.push(p.phash);
      if (p.dhash && !dhashes.includes(p.dhash)) dhashes.push(p.dhash);
    }
  }
  return empty;
}

/** The waiting items' photos in the ledger's shape. */
export async function pendingPhotos(query: Query, now: Date, opts: PendingOptions = {}): Promise<UsedLedger> {
  const { urls, phashes, dhashes } = await pendingHold(query, now, opts);
  return { urls, phashes, dhashes };
}

/** The contract's reader: the URLs (ledger keys) of every waiting item's photos. */
export async function pendingPhotoUrls(db: Query, now: Date, opts: PendingOptions = {}): Promise<Set<string>> {
  return new Set((await pendingPhotos(db, now, opts)).urls);
}

/**
 * The waiting items of one type for one posting day: what a remake of that day replaces (Last Few Days' "Make now"
 * while the day's earlier post still waits), to pass as `excludeItem`. Only types with a posting day; [] on error.
 */
export async function waitingItemsOn(query: Query, vertical: 'lfd' | 'field_notes', nyDate: string): Promise<ExcludeItem[]> {
  const table = vertical === 'lfd' ? 'lfd.posts' : 'field_notes.posts';
  try {
    const { rows } = await query(`SELECT id::text AS id FROM ${table} WHERE status = 'review' AND ny_date = $1::date`, [nyDate]);
    return (rows as Array<{ id: string }>).map((r) => ({ vertical, id: r.id }));
  } catch {
    return [];
  }
}
