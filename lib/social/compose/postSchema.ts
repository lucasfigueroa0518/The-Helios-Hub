import { z } from 'zod';

/**
 * Runtime validator for the `Post` object shape (see `lib/social/render/types.ts`).
 * Every string arriving from Haiku's compose call passes through here before
 * hitting the database — the JSON schema is enforced *at parse time* so a
 * malformed field short-circuits into the retry path rather than persisting
 * a broken Post to `helios_social.posts`.
 *
 * Keep this file's schema in sync with `types.ts` — the render types are the
 * design source of truth; this is the runtime mirror.
 */

const SpanRoleSchema = z.enum(['narrative', 'hook', 'pivot']);

const SpanSchema = z.object({
  text: z.string(),
  role: SpanRoleSchema,
});

const SpanRunSchema = z.array(SpanSchema).min(1);

const LayoutVariantSchema = z.enum([
  'cover',
  'story_beat',
  'data_block',
  'quote',
  'source',
  'follow',
  'proof',
  'thesis',
  'debate',
]);

const VariantSchema = z.enum([
  'C1', 'C2', 'C3', 'C4',
  'B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7',
  'D1', 'D2', 'D3',
  'Q1', 'Q2',
  'P1',
  'T1', 'T2',
  'F1',
]);

const BeatSchema = z.enum([
  'HOOK', 'GROUND', 'SCALE', 'CONTEXT', 'TURN', 'PROOF',
  'SCENARIO', 'MECHANISM', 'ANALOGY', 'QUOTE', 'STAKES',
  'TWIST', 'THESIS', 'DEBATE', 'FOLLOW',
]);

const StoryTypeSchema = z.enum([
  'ai_funding',
  'model_launch',
  'agents',
  'safety',
  'policy',
  'infrastructure',
  'benchmark',
  'leadership',
  'deal',
  'research',
  'tech',
]);

const FormatSchema = z.enum(['carousel', 'story']);

const PhotoTreatmentSchema = z.enum(['card', 'bottom-fade']);

export const SlideCopySchema = z.object({
  position: z.number().int().nonnegative(),
  layoutVariant: LayoutVariantSchema,
  variant: VariantSchema.optional(),
  beat: BeatSchema.optional(),
  headline: SpanRunSchema.optional(),
  body: SpanRunSchema.optional(),
  bodyBottom: SpanRunSchema.optional(),
  title: SpanRunSchema.optional(),
  photoCaption: z.string().optional(),
  altText: z.string().min(1, 'altText is required for accessibility'),
  lightCanvas: z.boolean().optional(),
  photoUrl: z.string().optional(),
  photoCredit: z.string().optional(),
  photoTreatment: PhotoTreatmentSchema.optional(),
  sides: z.array(z.object({ label: z.string(), text: z.string() })).optional(),
  storySpecificLine: z.string().optional(),
  artifact: z.object({
    kind: z.enum(['headline', 'tweet', 'paper_figure', 'filing_excerpt']),
    text: z.string().optional(),
    imageUrl: z.string().optional(),
    attribution: z.string().optional(),
    sourceLine: z.string().optional(),
  }).optional(),
  chartData: z.object({
    kind: z.enum(['bar_comparison', 'trend_curve', 'flywheel', 'before_after']),
    title: z.string().optional(),
    points: z.array(z.object({
      label: z.string(),
      value: z.number(),
      role: z.enum(['subject', 'comparison']).optional(),
    })),
    sourceLine: z.string().optional(),
  }).optional(),
  panoramaSide: z.enum(['left', 'right']).optional(),
});

export const PostSchema = z.object({
  format: FormatSchema,
  storyType: StoryTypeSchema,
  source: z.string().min(1),
  sourceUrl: z.string().url(),
  publishedAt: z.string().min(1),
  issueNumber: z.number().int().nonnegative(),
  slides: z.array(SlideCopySchema).min(3, 'a carousel needs at least a cover + one beat + follow'),
  caption: z.string().min(1),
  attributionBlock: z.string().optional(),
});

export type ParsedPost = z.infer<typeof PostSchema>;
