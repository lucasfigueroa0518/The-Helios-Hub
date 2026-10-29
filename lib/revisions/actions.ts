/**
 * Targeted Revisions verbs for the user-action layer (lib/publishing/actions):
 * `revise` queues one `requested` row and returns at once (the social worker
 * interprets and runs it, lib/revisions/worker.ts); `undoRevision` walks a
 * part back one revision, or to the pipeline's original with `original: true`;
 * `continueRevision` re-queues a row paused at its cap or ceiling with a raised
 * allowance. Any hub user may revise (no role check).
 *
 * Each content type's action file passes its spine query and how to find the
 * post's spine item from its refs (the revisions log is keyed by that item).
 */
import type { ActionOutcome, ActionTarget, ContentActions } from '@/lib/publishing/actions/types';
import type { Query } from '@/lib/social/store/pg';
import type { Vertical } from '@/lib/social-hub/types';

import { continueAfterCeiling, restoreOriginal, undoRevision, type EngineDeps } from './engine';
import { VERTICAL_LABELS, descriptionFor } from './registry';
import { createRequest, getRequest } from './store';
import { INSTRUCTION_MAX_CHARS, type PartRef } from './types';

const LOCKED = new Set(['published', 'rejected']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ReviseDeps = {
  vertical: Vertical;
  query: () => Promise<Query>;
  itemOf: (q: Query, target: ActionTarget) => Promise<string | null>;
  /** Engine notices (undo and restore send none today); defaults to the console. */
  notify?: (msg: string) => Promise<void>;
  now?: () => Date;
};

const bad = (note: string): ActionOutcome => ({ ok: false, note, status: 400 });
const GONE: ActionOutcome = { ok: false, note: 'The post is gone.', status: 409 };
const conflict = (o: { ok: boolean; note: string }): ActionOutcome => (o.ok ? o : { ...o, status: 409 });

const validPart = (p: PartRef | undefined): p is PartRef =>
  !!p && typeof p.kind === 'string' && typeof p.key === 'string' && p.kind.trim() !== '' && p.key.trim() !== '';

export function reviseVerbs(deps: ReviseDeps): Pick<ContentActions, 'revise' | 'undoRevision' | 'continueRevision'> {
  const label = VERTICAL_LABELS[deps.vertical];
  const engine = (q: Query): EngineDeps => ({
    q,
    notify: deps.notify ?? (async (msg) => console.log(`[revisions] ${msg}`)),
    now: deps.now ?? (() => new Date()),
  });

  return {
    async revise(t, by, input) {
      const instruction = typeof input?.instruction === 'string' ? input.instruction.trim() : '';
      if (!instruction) return bad('Say what to change.');
      if (instruction.length > INSTRUCTION_MAX_CHARS) return bad(`Keep it under ${INSTRUCTION_MAX_CHARS} characters.`);
      if (input?.parentId !== undefined && !UUID.test(input.parentId)) return bad('That question is not on this post.');

      const desc = descriptionFor(deps.vertical);
      if (!desc) return { ok: false, note: `Revisions are not available for ${label} yet.`, status: 409 };

      const q = await deps.query();
      const itemId = await deps.itemOf(q, t);
      if (!itemId) return GONE;
      const snap = await desc.load(q, t);
      if (!snap) return GONE;
      if (LOCKED.has(snap.status)) return { ok: false, note: `This ${label} post is ${snap.status} and can no longer be revised.`, status: 409 };

      if (input?.parentId) {
        const parent = await getRequest(q, input.parentId);
        if (!parent || parent.itemId !== itemId || parent.status !== 'asking') return bad('That question is not open on this post.');
        // One reply per question, so two replies cannot start two paid runs.
        const { rows } = await q(`SELECT 1 FROM revisions.requests WHERE parent_id = $1 LIMIT 1`, [parent.id]);
        if (rows.length) return { ok: false, note: 'That question was already answered.', status: 409 };
      }
      await createRequest(q, { vertical: deps.vertical, refs: t, itemId, by, instruction, parentId: input?.parentId ?? null });
      return { ok: true, note: 'Revising…' };
    },

    async undoRevision(t, by, input) {
      const part = input?.part;
      if (!validPart(part)) return bad('Say which part to undo.');
      const q = await deps.query();
      const itemId = await deps.itemOf(q, t);
      if (!itemId) return GONE;
      const p = { kind: part.kind, key: part.key };
      const out = input?.original ? await restoreOriginal(engine(q), itemId, p, by) : await undoRevision(engine(q), itemId, p, by);
      return conflict(out);
    },

    async continueRevision(t, by, input) {
      const id = input?.revisionId;
      if (!id || !UUID.test(id)) return bad('Say which revision to continue.');
      const usd = input?.overrideUsd;
      if (typeof usd !== 'number' || !Number.isFinite(usd) || usd <= 0) return bad('The allowed amount must be a positive number.');
      const q = await deps.query();
      const itemId = await deps.itemOf(q, t);
      if (!itemId) return GONE;
      const row = await getRequest(q, id);
      if (!row || row.itemId !== itemId) return { ok: false, note: 'That revision is not on this post.', status: 404 };
      return conflict(await continueAfterCeiling(engine(q), id, by, usd));
    },
  };
}
