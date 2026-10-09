/**
 * The photo bank as a finder source (DECISIONS_LOG D49): SELECT only.
 *
 *   person            by the identity-verified QID: headshots and second
 *                     photos
 *   thematic, setting by tag overlap with the request's words: searched
 *                     scenes (StockSnap lane, Openverse, Commons search) that
 *                     passed the close-up check and may be reused
 *   company           its headquarters by QID (a fallback only)
 *   logo              its logo by QID, seen within 90 days (a fallback only)
 *   CEO, article, official, event, product   never
 *
 * The 7-day rule holds: a photo is dropped (logos, and headshots off the
 * cover, aside) when any of its source URLs is in the run's recent set or in
 * social.used_photos within NO_REPEAT_DAYS. v1 offers the ORIGINAL URL (the
 * source fetched most recently, within the last 7 days), not the bank copy,
 * so the renderer and the checks see exactly what the online search would.
 *
 * Gated by media_library.settings.finder_source (off by default).
 */
import type { FaceBox } from '@/lib/social/render/fit-check';
import type { Lane } from '@/lib/social/photos/find';
import type { VisualKind } from '@/lib/social/writer/draft';

import { SCENE_LANES, words } from './policy';
import { cachedBankSettings, type BankSettings } from './settings';
import type { FinderSourceMode, Query } from './types';

/** The 7-day rule (lib/social/photos/used-photos.ts NO_REPEAT_DAYS; a literal so this module stays SQL-only). */
export const BANK_NO_REPEAT_DAYS = 7;
/** Only sources fetched within this many days are offered (the URL is still live). */
export const SOURCE_FRESH_DAYS = 7;
/** Logos come back only when seen this recently. */
export const LOGO_SEEN_DAYS = 90;

export type BankFind = {
  kind: VisualKind;
  query: string;
  /** The verified subject's Wikidata id (person, company, logo). */
  qid: string | null;
  /** URLs used in the last 7 days or earlier in this run. */
  recent: Set<string>;
  /** A cover never repeats a headshot within 7 days. */
  cover: boolean;
  limit: number;
};

export type BankHit = {
  photoId: string;
  /** The original URL offered (v1), and every source URL of the photo. */
  url: string;
  urls: string[];
  source: string;
  lane: Lane;
  credit: string;
  title: string;
  date: string | null;
  width: number;
  height: number;
  qids: string[];
  subjects: string[];
  tags: string[];
  /** Tags shared with the request's words (thematic, setting). */
  overlap: number;
  faces: FaceBox[] | null;
  plate: 'light' | 'dark' | null;
};

export type BankReader = {
  mode(): Promise<FinderSourceMode>;
  find(q: BankFind): Promise<BankHit[]>;
};

type Plan = { lanes: readonly string[]; byQid: boolean; byTags: boolean; visionPass: boolean; logoWindow: boolean };

/** Which bank photos may answer which request kind. */
export function planFor(kind: VisualKind): Plan | null {
  switch (kind) {
    case 'person':
      return { lanes: ['headshot', 'second'], byQid: true, byTags: false, visionPass: false, logoWindow: false };
    case 'thematic':
    case 'setting':
      return { lanes: SCENE_LANES, byQid: false, byTags: true, visionPass: true, logoWindow: false };
    case 'company':
      return { lanes: ['hq'], byQid: true, byTags: false, visionPass: false, logoWindow: false };
    case 'logo':
      return { lanes: ['logo'], byQid: true, byTags: false, visionPass: false, logoWindow: true };
    default:
      return null;
  }
}

/** By the offered lane, as searchVisual does: logos never fall under the 7-day rule; headshots only on a cover (photo spec §4). */
export const exemptFromSevenDays = (lane: string, cover: boolean) => lane === 'logo' || (lane === 'headshot' && !cover);

export function createBankReader(deps: { query: Query; settings?: () => Promise<BankSettings>; now?: () => Date }): BankReader {
  const settings = deps.settings ?? cachedBankSettings(deps.query);
  let usedTable: Promise<boolean> | null = null;
  const hasUsedPhotos = () =>
    (usedTable ??= deps.query(`SELECT to_regclass('social.used_photos') IS NOT NULL AS ok`).then((r) => Boolean(r.rows[0]?.ok)).catch(() => false));
  return {
    async mode() {
      const s = await settings();
      return s.present ? s.finderSource : 'off';
    },
    async find(q) {
      const plan = planFor(q.kind);
      if (!plan) return [];
      if (plan.byQid && !q.qid) return [];
      const want = plan.byTags ? words(q.query) : [];
      if (plan.byTags && !want.length) return [];
      const checkUsed = await hasUsedPhotos();
      const now = (deps.now?.() ?? new Date()).toISOString();
      const params: unknown[] = [[...plan.lanes], now, want, q.qid, plan.visionPass, plan.logoWindow, Math.max(1, q.limit) * 3, SOURCE_FRESH_DAYS, LOGO_SEEN_DAYS, BANK_NO_REPEAT_DAYS];
      const { rows } = await deps.query(
        `WITH offer AS (
           SELECT s.photo_id, s.url, s.source, s.lane, s.credit, s.title, s.date, s.last_ok_at
             FROM media_library.photo_sources s
            WHERE s.status = 'stored' AND s.photo_id IS NOT NULL AND s.lane = ANY($1::text[])
              AND s.last_ok_at > $2::timestamptz - make_interval(days => $8))
         SELECT p.id, p.width, p.height, p.tags, p.qids, p.subjects,
                cardinality(ARRAY(SELECT unnest(p.tags) INTERSECT SELECT unnest($3::text[]))) AS overlap,
                (SELECT row_to_json(o) FROM offer o WHERE o.photo_id = p.id ORDER BY o.last_ok_at DESC, o.url LIMIT 1) AS pick,
                (SELECT array_agg(a.url ORDER BY a.url) FROM media_library.photo_sources a WHERE a.photo_id = p.id) AS urls,
                (SELECT g.faces FROM media_library.sightings g JOIN media_library.photo_sources a ON a.url = g.url
                  WHERE a.photo_id = p.id AND g.faces IS NOT NULL ORDER BY g.at DESC LIMIT 1) AS faces,
                (SELECT g.plate FROM media_library.sightings g JOIN media_library.photo_sources a ON a.url = g.url
                  WHERE a.photo_id = p.id AND g.plate IS NOT NULL ORDER BY g.at DESC LIMIT 1) AS plate,
                ${checkUsed ? `EXISTS (
                  SELECT 1 FROM social.used_photos u JOIN media_library.photo_sources a ON a.url = u.url
                   WHERE a.photo_id = p.id AND u.used_at <= $2::timestamptz AND u.used_at > $2::timestamptz - make_interval(days => $10))` : `($10::int IS NULL)`} AS used_recently
           FROM media_library.photos p
          WHERE p.status = 'stored' AND p.reuse_ok
            AND EXISTS (SELECT 1 FROM offer o WHERE o.photo_id = p.id)
            AND ($4::text IS NULL OR $4::text = ANY(p.qids))
            AND ($5::boolean IS NOT TRUE OR p.vision_pass)
            AND (cardinality($3::text[]) = 0 OR p.tags && $3::text[])
            AND ($6::boolean IS NOT TRUE OR p.last_seen_at > $2::timestamptz - make_interval(days => $9))
          ORDER BY overlap DESC, (p.width::bigint * p.height) DESC, p.id
          LIMIT $7`,
        params,
      );
      const hits: BankHit[] = [];
      for (const r of rows) {
        const pick = typeof r.pick === 'string' ? JSON.parse(r.pick) : r.pick;
        const urls: string[] = r.urls ?? [];
        if (!pick) continue;
        // The 7-day rule on every URL the photo was found at, unless the offered lane is exempt.
        if (!exemptFromSevenDays(pick.lane, q.cover) && (r.used_recently === true || urls.some((u) => q.recent.has(u)))) continue;
        const faces = typeof r.faces === 'string' ? JSON.parse(r.faces) : r.faces;
        hits.push({
          photoId: r.id,
          url: pick.url,
          urls,
          source: pick.source ?? 'stock',
          lane: pick.lane as Lane,
          credit: pick.credit ?? '',
          title: pick.title ?? '',
          date: pick.date ?? null,
          width: Number(r.width),
          height: Number(r.height),
          qids: r.qids ?? [],
          subjects: r.subjects ?? [],
          tags: r.tags ?? [],
          overlap: Number(r.overlap) || 0,
          faces: Array.isArray(faces) ? faces : null,
          plate: r.plate === 'light' || r.plate === 'dark' ? r.plate : null,
        });
      }
      return hits.slice(0, Math.max(1, q.limit));
    },
  };
}
