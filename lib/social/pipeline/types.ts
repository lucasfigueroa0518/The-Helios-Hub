/**
 * Helios Social rebuild — pipeline shapes (spec §3).
 *
 * M0 skeleton: the fields here are the minimum the orchestrator needs.
 * M1–M6 fill them in (brief format in M2, writer output in M3, …).
 */
import type { Failure, Fix } from '@/lib/social/mechanical/checks';
import type { PhotoTrace } from '@/lib/social/photos/find';
import type { Post as RenderPost } from '@/lib/social/render/types';
import type { GroupMember } from '@/lib/social/ingest/select/types';
import type { Brief as ParsedBrief } from '@/lib/social/reporter/brief';
import type { PageReadOk } from '@/lib/social/reporter/read-page';
import type { DraftSubmission, FilledDraft } from '@/lib/social/writer/draft';

/** The six stages of spec §3, plus the mechanical guarantees (§6). */
export const STAGE_ORDER = [
  'jev-scoring',
  'reporter',
  'writer',
  'editor',
  // Hook pass (prototype, Tommy 2026-10-06): runs only when a run switches it on (--hook); not in the daily default.
  'hook',
  'fact-checker',
  // Mechanical text fixes and checks run before design (Tommy, 2026-10-06):
  // the render must show the fixed text. Photo and render checks run inside design.
  'mechanical',
  'design',
] as const;

export type StageName = (typeof STAGE_ORDER)[number];

/**
 * Why a story was set aside (spec §7.1). `cost-cap` stops the day rather
 * than one story, but it is logged the same way.
 */
export type ReasonCode =
  | 'malformed-output'
  | 'over-limit'
  | 'main-claim-false'
  | 'unverifiable-claim'
  | 'render-failed'
  | 'service-error'
  | 'refused'
  /** Fact-checker: free fixes would damage the post (spec §4.2b); not a set-aside by itself. */
  | 'needs-fresh-draft'
  /** Fresh-draft limit used up (spec §4.2b: 2 per story). */
  | 'unfixable-draft'
  | 'cost-cap';

/**
 * Spec §2.4: a pipeline fault has a target of zero and is fixed at its
 * source; a story that shouldn't run is the correct outcome.
 */
export type SetAsideKind = 'pipeline-fault' | 'should-not-run';

export const REASON_KIND: Record<ReasonCode, SetAsideKind> = {
  'malformed-output': 'pipeline-fault',
  'over-limit': 'pipeline-fault',
  'render-failed': 'pipeline-fault',
  'service-error': 'pipeline-fault',
  // Model declined the story (Tommy, 2026-10-04: no fallback model). Repeats
  // in the log are a pattern for selection, not a pipeline fault.
  refused: 'should-not-run',
  'needs-fresh-draft': 'pipeline-fault',
  'unfixable-draft': 'pipeline-fault',
  'cost-cap': 'pipeline-fault',
  'main-claim-false': 'should-not-run',
  'unverifiable-claim': 'should-not-run',
};

/** One story group from ingest selection (spec §5B). */
export type Candidate = {
  id: string;
  title: string;
  url: string;
  /** Every article in the group, for the Reporter's two-source confirmation. */
  members: GroupMember[];
  /** Members enrichment actually read, most text first, max 4: the Reporter's starting sources. */
  sources: string[];
  outlets: string[];
  outletCount: number;
  publishedAt: Date;
  body: string;
};

/** A candidate in run order: winners first, then backups. Higher score runs first. */
export type ScoredCandidate = Candidate & { score: number };

/** The Reporter's output for one story (spec §4): the parsed brief plus what it rests on. */
export type Brief = {
  storyId: string;
  parsed: ParsedBrief;
  /** The brief exactly as the Reporter wrote it. */
  raw: string;
  /** Every page the Reporter read (raw text + photos), for the Writer and the claim checks (M4). */
  pages: PageReadOk[];
};

/**
 * Writer/Editor/Fact-checker output: the submit_draft shape (IDs, claim
 * tags, image requests) plus its filled version (exact quotes/numbers).
 * One format for every later stage (Tommy, 2026-10-05).
 */
export type Draft = {
  storyId: string;
  submission: DraftSubmission;
  filled: FilledDraft;
  /** Set by the mechanical stage: the silent fixes applied to `filled`, and style checks that failed (warnings). */
  mechanical?: { fixes: Fix[]; warnings: Failure[] };
};

/** A designed post, ready for the mechanical guarantees and review. */
export type PostObject = {
  storyId: string;
  title: string;
  /** What the renderer draws (lib/social/render/types.ts). */
  render: RenderPost;
  /** How each photo was found or why there is none: cover first, then each story slide. */
  photos: PhotoTrace[];
  /** Mechanical fixes applied and warnings for the review screen (spec §6); photo replacements by C6. */
  checks: { fixes: Fix[]; warnings: Failure[]; photoReplacements: string[] };
  /** Stages this post went through, in order. */
  stages: StageName[];
  costUsd: number;
};

/** Every stage returns this. `costUsd` is charged whether or not it succeeded. */
export type StageResult<T> =
  | { ok: true; value: T; costUsd: number }
  | { ok: false; reasonCode: ReasonCode; detail: string; costUsd: number };
