import { normalizeTerm } from '@/lib/explainers/ideas/coverage';
import { SYLLABUS, type SyllabusTopic } from '@/lib/explainers/ideas/syllabus';

/**
 * The curriculum (Lucas, 2026-11-21): the fixed syllabus (syllabus.ts) in teaching order. The nightly idea cycle asks
 * it for the next topics to write, fundamentals first; the generator writes one idea per assigned topic and delivers
 * its angle. Scores stay quality gates; `rank` decides the order (topics.syllabus_rank, POOL_ORDER_BY). Pure: no
 * database, no model.
 *
 * Teaching order is the file's AI topics and its CS topics, each in file order, woven together so CS topics come
 * evenly through the run at the syllabus's own CS share (about 1 in 3, 2026-11-22), never a long stretch of one kind
 * (the file groups CS into its own level and units). A topic still never comes before one it requires.
 */

/** A syllabus topic (term, kind, angle, requires, aka) with its place in the curriculum. */
export type CurriculumTopic = SyllabusTopic & {
  /** Position in the teaching order, 0-based. */
  rank: number;
  level: number;
  levelName: string;
  unitId: string;
  unitName: string;
};

type Placed = Omit<CurriculumTopic, 'rank'>;

/** The file's topics woven into teaching order (see the file note). Exported for its test. */
export function weave(topics: readonly Placed[]): Placed[] {
  const queues = { ai: topics.filter((t) => t.kind !== 'cs'), cs: topics.filter((t) => t.kind === 'cs') };
  const share = queues.cs.length / Math.max(1, topics.length);
  const byTerm = new Map(topics.map((t) => [t.term.toLowerCase(), t]));
  const done = new Set<string>();
  const out: Placed[] = [];
  let cs = 0;
  // a topic goes in after whatever it requires that isn't in yet (pulled forward, its own prerequisites first)
  const place = (t: Placed) => {
    if (done.has(t.term.toLowerCase())) return;
    done.add(t.term.toLowerCase());
    for (const r of t.requires) {
      const need = byTerm.get(r.toLowerCase());
      if (need) place(need);
    }
    const q = queues[t.kind === 'cs' ? 'cs' : 'ai'];
    q.splice(q.indexOf(t), 1);
    if (t.kind === 'cs') cs++;
    out.push(t);
  };
  while (queues.ai.length || queues.cs.length) {
    const kind = queues.cs.length && (!queues.ai.length || cs < share * (out.length + 1)) ? 'cs' : 'ai';
    place(queues[kind][0]!);
  }
  return out;
}

export const CURRICULUM: readonly CurriculumTopic[] = weave(
  SYLLABUS.flatMap((level) =>
    level.units.flatMap((unit) =>
      unit.topics.map((topic) => ({ ...topic, level: level.level, levelName: level.name, unitId: unit.id, unitName: unit.name })),
    ),
  ),
).map((topic, rank) => ({ ...topic, rank }));

export const LEVEL_COUNT = SYLLABUS.length;

/** A term as typed: lowercase, trimmed, inner whitespace collapsed. */
function termKey(term: string): string {
  return term.trim().toLowerCase().replace(/\s+/g, ' ');
}

const BY_KEY = new Map<string, CurriculumTopic>();
for (const topic of CURRICULUM) for (const name of [topic.term, ...(topic.aka ?? [])]) BY_KEY.set(termKey(name), topic);

/**
 * The looser key (normalizeTerm: punctuation and simple plurals gone, so "embeddings" or "fine tuning" still match),
 * kept only where it names one topic.
 */
const BY_NORMAL = new Map<string, CurriculumTopic | null>();
for (const topic of CURRICULUM) {
  for (const name of [topic.term, ...(topic.aka ?? [])]) {
    const key = normalizeTerm(name);
    if (!key) continue;
    const seen = BY_NORMAL.get(key);
    BY_NORMAL.set(key, seen === undefined || seen?.rank === topic.rank ? topic : null);
  }
}

/** The syllabus topic a term names (its term or any aka, case- and whitespace-insensitive); null when none does. */
export function syllabusEntry(term: unknown): CurriculumTopic | null {
  if (typeof term !== 'string' || !term.trim()) return null;
  return BY_KEY.get(termKey(term)) ?? BY_NORMAL.get(normalizeTerm(term)) ?? null;
}

/** The syllabus rank a topic's term gets on insert (topics.syllabus_rank); null off the syllabus. */
export function syllabusRank(term: unknown): number | null {
  return syllabusEntry(term)?.rank ?? null;
}

/** The level of a stored rank, for the hub's "Level N" label; null when the rank is not on the syllabus. */
export function levelOfRank(rank: number | null | undefined): number | null {
  return rank == null ? null : CURRICULUM[rank]?.level ?? null;
}

/**
 * The ideas the pool keeps waiting (Lucas, 2026-11-24: always 10). Each night's refill writes what the pool is short
 * of it, in as many calls as that takes, so the pool is back at 10 every morning and no idea is written only to be cut.
 */
export const POOL_TARGET = 10;

/** How many ideas tonight's refill writes: what `waiting` is short of POOL_TARGET, at most `max`. */
export function refillCount(waiting: number, max: number = POOL_TARGET): number {
  return Math.max(0, Math.min(max, POOL_TARGET - waiting));
}

/** One existing explainers topic as the curriculum sees it. */
export type TopicTermState = { term: string | null; status: string; duplicateOf?: string | null; syllabusRank?: number | null };

/** After this many failed tries a term is passed over, so one topic that keeps failing the gates can't stall the curriculum. */
export const MAX_FAILED_TRIES = 2;

/**
 * A failed try: rejected (a gate, a duplicate, a dropped analogy), or displaced as the loser of a duplicate
 * head-to-head. A topic displaced only by the pool cut (no duplicate_of) is not a failure; its term is free again.
 */
function failedTry(t: TopicTermState): boolean {
  return t.status === 'rejected' || (t.status === 'displaced' && t.duplicateOf != null);
}

/**
 * The first `n` syllabus topics, in file order, that are not taken. A term is taken when a syllabus idea (one with a
 * syllabus_rank) has it (or an aka) in any status but rejected or displaced, when a made reel has it, or when syllabus
 * ideas for it have failed MAX_FAILED_TRIES times; `skipped` is the latter, for the cycle to log.
 */
export function nextSyllabusTopics(
  state: readonly TopicTermState[],
  n: number,
): { topics: CurriculumTopic[]; skipped: CurriculumTopic[] } {
  const live = new Set<number>();
  const failures = new Map<number, number>();
  for (const t of state) {
    const entry = syllabusEntry(t.term);
    if (!entry) continue;
    // Only syllabus ideas (they carry a rank) and made reels count (Lucas, 2026-11-22: the whole content type runs on
    // the syllabus). An idea from before the curriculum, unmade, takes nothing: it is archived, and the syllabus
    // writes the topic fresh with its angle. A made reel still takes its topic, so no concept is taught twice.
    if (t.syllabusRank == null && t.status !== 'rendered') continue;
    if (t.status === 'rejected' || t.status === 'displaced') {
      if (failedTry(t)) failures.set(entry.rank, (failures.get(entry.rank) ?? 0) + 1);
    } else live.add(entry.rank);
  }
  const topics: CurriculumTopic[] = [];
  const skipped: CurriculumTopic[] = [];
  for (const topic of CURRICULUM) {
    if (topics.length >= n) break;
    if (live.has(topic.rank)) continue;
    if ((failures.get(topic.rank) ?? 0) >= MAX_FAILED_TRIES) skipped.push(topic);
    else topics.push(topic);
  }
  return { topics, skipped };
}

/**
 * The generator's ideas held to their assignment: each kept idea names one assigned topic (its term or an aka) and
 * carries that topic's exact term; an idea naming no assigned topic, or one already written, is dropped. Dropped
 * topics stay untaken, so the next night assigns them again.
 */
export function matchAssigned<T extends { term: string }>(
  ideas: readonly T[],
  assigned: readonly CurriculumTopic[],
): { kept: T[]; dropped: T[] } {
  const open = new Map(assigned.map((t) => [t.rank, t]));
  const kept: T[] = [];
  const dropped: T[] = [];
  for (const idea of ideas) {
    const topic = open.get(syllabusEntry(idea.term)?.rank ?? -1);
    if (!topic) {
      dropped.push(idea);
      continue;
    }
    open.delete(topic.rank);
    kept.push({ ...idea, term: topic.term });
  }
  return { kept, dropped };
}
