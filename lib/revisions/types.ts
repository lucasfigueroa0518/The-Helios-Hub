import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { Query } from '@/lib/social/store/pg';
import type { Vertical } from '@/lib/social-hub/types';

export type { Vertical };

export type FixKind = 'photo' | 'wording' | 'color' | 'layout' | 'motion';

/** One addressable part of an item, e.g. { kind: 'slide', key: '3' }. */
export type PartRef = { kind: string; key: string };

export type RevisionStatus =
  | 'requested'
  | 'asking'
  | 'running'
  | 'applied'
  | 'blocked'
  | 'failed'
  | 'paused_at_cap'
  | 'paused_at_ceiling'
  | 'undone';

/** What the interpreter decided the instruction means. Shape is owned by the engine. */
export type Interpretation = {
  vertical: Vertical;
  part: PartRef;
  fixKind: FixKind;
  stageTag: string;
  instruction: string;
  args?: Record<string, string>;
};

/** A part's state before or after a revision (stored as jsonb). */
export type PartState = { copy?: unknown; photo?: unknown; colors?: unknown; layout?: unknown; files: string[] };

export type RevisionRow = {
  id: string;
  vertical: Vertical;
  itemId: string;
  refs: ActionTarget;
  requestedBy: string | null;
  instruction: string;
  parentId: string | null;
  status: RevisionStatus;
  question: string | null;
  interpretation: Interpretation | null;
  stageTag: string | null;
  fixKind: FixKind | null;
  part: PartRef | null;
  capUsd: number | null;
  ceilingUsd: number | null;
  overrideUsd: number | null;
  spendUsd: number;
  before: PartState | null;
  after: PartState | null;
  note: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  undoneAt: string | null;
  undoneBy: string | null;
};

// ---- Task 2: the per-content-type description ----

/** Spend tracker handed to a revision; throws CeilingReached (caps.ts) past the ceiling. */
export type CostMeter = { spend(usd: number): void; readonly spent: number };

export type PostSnapshot = {
  vertical: Vertical;
  refs: ActionTarget;
  status: 'preview' | 'review' | 'approved' | 'scheduled' | 'published' | 'rejected';
  parts: ReadonlyArray<{
    ref: PartRef;
    text?: string;
    photoUrl?: string;
    photoCredit?: string;
    color?: string;
    layout?: string;
  }>;
};

export type RevisionResult =
  | { ok: true; before: PartState; after: PartState }
  | { ok: false; reason: 'blocked' | 'failed'; note: string };

/** Code-defined description each content type supplies to the shared revision engine. */
export interface ContentTypeDescription {
  vertical: Vertical;
  label: string;
  /** The type's StageTag list (its pipeline stages a revision can be attributed to). */
  stageTags: readonly string[];
  fixKinds: readonly FixKind[];
  load(q: Query, refs: ActionTarget): Promise<PostSnapshot | null>;
  estimate(fix: FixKind): number;
  revise(ctx: { q: Query; refs: ActionTarget; interpretation: Interpretation; meter: CostMeter }): Promise<RevisionResult>;
  restore(ctx: { q: Query; refs: ActionTarget; part: PartRef; state: PartState }): Promise<void>;
  unschedule(q: Query, refs: ActionTarget): Promise<{ ok: boolean; note: string }>;
}
