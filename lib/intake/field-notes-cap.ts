/**
 * Field Notes' per-run scoring cap (Phase 2, Owner A). Field Notes scores at most MAX_SCORED_PER_RUN found
 * candidates a run, in its own scoringOrder (at most MAX_CANDIDATES_PER_SOURCE per source, round-robin in registry
 * order); the rest wait. The intake keeps that rule: of the stories handed to scoring, only the first
 * MAX_SCORED_PER_RUN Field Notes candidates (in scoringOrder) get field-notes-score this run; the rest go to the
 * run's `unscored` and the next run carries them (the Phase 1 carry, never a sweep). A story whose stored score
 * already matches (same version and member) is a cache hit and takes no slot.
 */
import { scoringOrder } from '@/lib/field-notes/sources/select';
import type { TipCandidate } from '@/lib/field-notes/sources/candidate';

import { memberHash } from './score';
import { fieldNotesCandidateOf, fieldNotesMemberOf, membersOf } from './scorecards';
import type { IntakeQuery, IntakeStory, Scorecard } from './types';

export type FieldNotesPick = { selected: IntakeStory[]; deferred: string[] };

/** Field Notes' MAX_SCORED_PER_RUN, read from lib/field-notes/run.ts (loaded lazily: it pulls in rendering). */
export async function fieldNotesSlots(): Promise<number> {
  const { MAX_SCORED_PER_RUN } = await import('@/lib/field-notes/run');
  return MAX_SCORED_PER_RUN;
}

/** Which of these stories field-notes-score scores this run (`slots` defaults to Field Notes' MAX_SCORED_PER_RUN). */
export async function pickFieldNotesStories(
  q: IntakeQuery,
  stories: readonly IntakeStory[],
  card: Pick<Scorecard, 'version'>,
  slots?: number,
): Promise<FieldNotesPick> {
  const withMember = stories.filter((story) => fieldNotesMemberOf(story) !== null);
  if (withMember.length === 0) return { selected: [], deferred: [] };

  const { rows } = await q.query<{ story_id: string; version: string; member_hash: string }>(
    `SELECT story_id::text AS story_id, version, member_hash FROM intake.scores WHERE scorecard = 'field-notes-score' AND story_id = ANY($1::uuid[])`,
    [withMember.map((s) => s.id)],
  );
  const cached = new Set(rows.map((r) => `${r.story_id}|${r.version}|${r.member_hash}`));
  const selected: IntakeStory[] = [];
  const open: Array<{ story: IntakeStory; candidate: TipCandidate }> = [];
  for (const story of withMember) {
    const hash = memberHash(membersOf(story, ['field-notes']));
    const candidate = fieldNotesCandidateOf(fieldNotesMemberOf(story)!);
    if (cached.has(`${story.id}|${card.version}|${hash}`) || !candidate) selected.push(story); // a cache hit, or a failure to record
    else open.push({ story, candidate });
  }
  const queue = scoringOrder(
    open.map((o) => o.candidate),
    { slots: slots ?? (await fieldNotesSlots()) },
  );
  const chosen = new Set(queue);
  for (const o of open) if (chosen.has(o.candidate)) selected.push(o.story);
  return { selected, deferred: open.filter((o) => !chosen.has(o.candidate)).map((o) => o.story.id) };
}
