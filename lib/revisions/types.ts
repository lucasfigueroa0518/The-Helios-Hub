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
  | 'paused_at_ceiling'
  | 'undone';

/** What the interpreter decided the instruction means. Shape is owned by the engine. */
export type Interpretation = { part?: PartRef; fixKind?: FixKind; stageTag?: string; [k: string]: unknown };

/** A part's state before or after a revision (stored as jsonb). */
export type PartState = { copy?: unknown; photo?: unknown; colors?: unknown; layout?: unknown; files: string[] };

export type RevisionRow = {
  id: string;
  vertical: Vertical;
  itemId: string;
  refs: PartRef[];
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
