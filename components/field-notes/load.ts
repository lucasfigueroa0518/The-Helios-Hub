/**
 * What the Field Notes page shows above the hub: the photo pool and the posts waiting for review with
 * their tip. Reads only; the query function is injected (the page passes the live one, tests PGlite).
 */
import { parseHowToTry } from '@/lib/field-notes/caption';
import { listPool } from '@/lib/field-notes/photos/store';
import { PLACEHOLDER_USE } from '@/lib/field-notes/types';
import { CONTENT_LEAVES, KNOW_HOW_TIERS, WANTS, type ContentLeaf, type KnowHowTier, type PoolPhoto, type Want } from '@/lib/field-notes/types';
import type { Query } from '@/lib/media-library/types';

export type ReviewPost = {
  id: string;
  slug: string;
  status: string;
  caption: string;
  renderVersion: number;
  slideCount: number;
  /** Rendered JPEGs exist (field_notes.posts.slide_objects is set). */
  hasSlides: boolean;
  /** One line per slide: its headline, for the alt text. */
  slideHeadlines: string[];
  fitProblems: string[];
  renderProblems: string[];
  /** The Writer's soft notes (voice, casing, small overruns), kept on the run record; guidance only. */
  softNotes: string[];
  /** Every tip on the post, in slide order, each with its source link and its tags (null: not tagged yet). */
  tips: ReviewTip[];
};

export type ReviewTip = {
  id: string;
  subject: string;
  leaf: ContentLeaf | null;
  want: Want | null;
  tier: KnowHowTier | null;
  sourceUrl: string | null;
  sourceLabel: string | null;
  useWithResult: string;
  /** The tool's real name and how to try it, from the caption's how-to-try line for this tip's slide (null: none). */
  name: string | null;
  tryIt: string | null;
};

/** A stored value read back only when it is one we know; anything else (or a missing column) is not tagged. */
const known = <T extends string>(values: readonly T[], v: unknown): T | null => values.find((x) => x === v) ?? null;

export type PanelData = { pool: PoolPhoto[]; posts: ReviewPost[] };

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

type PostRow = {
  id: string; slug: string; status: string; caption: string; render_version: number; slides: unknown; slide_objects: unknown;
  fit_problems: unknown; render_problems: unknown; soft_notes: unknown;
  tips: unknown;
};

export function toReviewPost(r: PostRow): ReviewPost {
  const slides = Array.isArray(r.slides) ? (r.slides as Array<{ blocks?: Array<{ role?: string; text?: string }> }>) : [];
  // The caption's how-to-try lines are code-built, one per tip slide in slide order (lib/field-notes/caption.ts).
  const howToTry = parseHowToTry(r.caption ?? '');
  return {
    id: r.id,
    slug: r.slug,
    status: r.status,
    caption: r.caption,
    renderVersion: r.render_version,
    slideCount: slides.length,
    hasSlides: Array.isArray(r.slide_objects) && r.slide_objects.length > 0,
    slideHeadlines: slides.map((s) => s.blocks?.find((b) => b.role === 'headline')?.text ?? s.blocks?.[0]?.text ?? ''),
    fitProblems: strings(r.fit_problems),
    renderProblems: strings(r.render_problems),
    softNotes: strings(r.soft_notes),
    tips: (Array.isArray(r.tips) ? (r.tips as Array<Record<string, string | null>>) : []).map((t, i) => ({
      id: String(t.id ?? ''),
      subject: String(t.subject ?? ''),
      leaf: known(CONTENT_LEAVES, t.leaf),
      want: known(WANTS, t.want),
      tier: known(KNOW_HOW_TIERS, t.tier),
      sourceUrl: t.source_url ?? null,
      sourceLabel: t.source_label ?? null,
      // The store's placeholder is an instruction for the Writer, not something a reviewer should read as the tip.
      useWithResult: t.use && t.use !== PLACEHOLDER_USE ? t.use : '',
      name: howToTry[i]?.name ?? null,
      tryIt: howToTry[i]?.tryIt ?? null,
    })),
  };
}

/** The pool and up to `limit` newest posts still in review (or preview). */
export async function loadPanelData(db: Query, limit = 3): Promise<PanelData> {
  const [pool, posts] = await Promise.all([
    listPool(db),
    db(
      `SELECT p.id::text AS id, p.slug, p.status, p.caption, p.render_version, p.slides, p.slide_objects, p.fit_problems, p.render_problems, p.soft_notes,
              (SELECT COALESCE(jsonb_agg(jsonb_build_object('id', t.id::text, 'subject', t.subject, 'leaf', t.leaf, 'want', t.want, 'tier', t.tier, 'source_url', t.source_url, 'source_label', t.source_label, 'use', t.use_with_result) ORDER BY u.ord), '[]'::jsonb)
                 FROM unnest(CASE WHEN cardinality(p.tip_ids) > 0 THEN p.tip_ids WHEN p.tip_id IS NOT NULL THEN ARRAY[p.tip_id] ELSE '{}'::uuid[] END) WITH ORDINALITY AS u(id, ord)
                 JOIN field_notes.tips t ON t.id = u.id) AS tips
         FROM field_notes.posts p
        WHERE p.status IN ('review', 'preview')
        ORDER BY p.created_at DESC
        LIMIT $1`,
      [limit],
    ),
  ]);
  return { pool, posts: (posts.rows as PostRow[]).map(toReviewPost) };
}
