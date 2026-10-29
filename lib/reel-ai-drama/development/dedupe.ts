import { noul } from '@typesafe-ai/sdk';

import type { Queryable } from '@/lib/explainers/db';
import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import type { Pitch } from '@/lib/reel-ai-drama/types';
import { DAY_MS, norm, slug } from '@/lib/reel-ai-drama/development/util';

/**
 * Same-event dedupe (PROCESS.md D3, MD-27, research 05 §10): the unit is the real-world event, not the
 * wording. Three steps, cheapest first: an exact fingerprint, a cheap similarity over title, cast and
 * date, then a Jev same-event judgment on the borderline pairs only. Every duplicate carries a reason.
 */

// ── Step 1: the fingerprint ─────────────────────────────────────────────────

function castSlugs(p: Pitch): string[] {
  return [...new Set(p.cast.map((c) => c.player_id ?? slug(c.name)))].sort();
}

function whenOf(p: Pitch): string {
  if (!p.event_date) return 'undated';
  return p.date_precision === 'year' ? p.event_date.slice(0, 4) : p.event_date.slice(0, 7);
}

/** who (central figure, then the cast) | what (story type) | when (month, or year at year precision). */
export function eventKey(p: Pitch): string {
  const central = p.cast.find((c) => norm(c.name) === norm(p.central_figure));
  const who = central?.player_id ?? slug(p.central_figure);
  return `${who}|${castSlugs(p).join('+')}|${p.story_type}|${whenOf(p)}`;
}

// ── Step 2: cheap similarity ────────────────────────────────────────────────

const STOP = new Set(
  'the a an and or of to in on at for from with by as is was are were be been his her their its it this that who what how why when vs versus after before into over not but'.split(' '),
);

export function titleTokens(s: string): Set<string> {
  return new Set(norm(s).replace(/'/g, '').split(' ').filter((w) => w.length >= 3 && !STOP.has(w)));
}

function jaccard<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both += 1;
  return both / (a.size + b.size - both);
}

function dateCloseness(a: Pitch, b: Pitch): number {
  if (!a.event_date || !b.event_date) return 0.25;
  const days = Math.abs(new Date(a.event_date).getTime() - new Date(b.event_date).getTime()) / DAY_MS;
  const coarse = a.date_precision === 'year' || b.date_precision === 'year';
  if (days <= (coarse ? 366 : 31)) return 1;
  if (days <= 92) return 0.5;
  if (days <= 366) return 0.25;
  return 0;
}

/** 0–1: title words, cast and date. Wording alone never decides (the event does). */
export function similarity(a: Pitch, b: Pitch): number {
  const title = jaccard(titleTokens(`${a.title} ${a.scene}`), titleTokens(`${b.title} ${b.scene}`));
  const cast = jaccard(new Set(castSlugs(a)), new Set(castSlugs(b)));
  return 0.3 * title + 0.45 * cast + 0.25 * dateCloseness(a, b);
}

/** At or above: a duplicate without asking Jev. */
export const SURE_DUPLICATE = 0.85;
/** At or above (and below SURE_DUPLICATE): borderline, Jev decides. */
export const BORDERLINE = 0.45;
/** Borderline pairs sent to Jev per pitch, nearest first. */
export const MAX_JEV_PAIRS = 10;

// ── Step 3: Jev same-event on borderline pairs (Real Case pattern, new ids) ──

/** A noul at or above this counts as "yes, the same event". */
export const SAME_EVENT_YES = 0.5;

const SAME_EVENT_JUDGE =
  'Judge the real-world event, not the wording, the angle or the story type. Two pitches are the same event when they turn on the same incident, decision, meeting, deal, case, launch or moment, even when they tell it from different people\'s points of view or stress different parts of it. Pitches that share people or a period but turn on different moments are different events.';

export const PAIR_KEYS = ['pair_0', 'pair_1', 'pair_2', 'pair_3', 'pair_4'] as const;
export type PairKey = (typeof PAIR_KEYS)[number];

const pairQuestion = (key: PairKey) =>
  noul({ question: `Is the candidate pitch about the same real event as the pitch at incumbents.${key}?`, judge: SAME_EVENT_JUDGE });

/** State: { candidate: <pitch ref>, incumbents: { pair_0: <pitch ref>, ... } }. Version bumps on any wording change. */
export const SAME_EVENT_PAIRS = defineQuestionSet({
  id: 'reel-ai-drama-same-event-v1',
  version: '1',
  questions: {
    pair_0: pairQuestion('pair_0'),
    pair_1: pairQuestion('pair_1'),
    pair_2: pairQuestion('pair_2'),
    pair_3: pairQuestion('pair_3'),
    pair_4: pairQuestion('pair_4'),
  },
});

/** What Jev sees of a pitch: the event, summarised (research 05: summarise each mention first). */
export function pitchRef(p: Pitch) {
  return {
    title: p.title,
    logline: p.logline,
    event_date: p.event_date,
    central_figure: p.central_figure,
    cast: p.cast.map((c) => c.name),
    scene: p.scene,
    turn: p.turn,
  };
}

export type PastPitch = { id: string; pitch: Pitch; event_key: string };

export type Duplicate = { duplicateOf: string; why: string };

/** Every past pitch that is not itself a duplicate (it points at an original that is here). */
export async function pastPitches(db: Queryable, excludeId?: string | null): Promise<PastPitch[]> {
  const { rows } = await db.query<{ id: string; pitch: Pitch; event_key: string }>(
    `SELECT id, pitch, event_key FROM reel_ai_drama.pitches
     WHERE status <> 'duplicate' AND ($1::uuid IS NULL OR id <> $1::uuid)
       -- A seed that failed its checks is left for the producer to rediscover and enrich (MD-55).
       AND NOT (origin = 'seed' AND status IN ('rejected', 'retired'))
     ORDER BY created_at`,
    [excludeId ?? null],
  );
  return rows;
}

export async function findDuplicate(
  db: Queryable,
  jev: DramaJevRunner,
  p: Pitch,
  opts: { excludeId?: string | null; pitchId?: string | null } = {},
): Promise<Duplicate | null> {
  const past = await pastPitches(db, opts.excludeId);
  const key = eventKey(p);
  const exact = past.find((q) => q.event_key === key);
  if (exact) return { duplicateOf: exact.id, why: `same event fingerprint (${key}) as "${exact.pitch.title}"` };

  const scored = past.map((q) => ({ q, s: similarity(p, q.pitch) })).sort((a, b) => b.s - a.s);
  const sure = scored.find((x) => x.s >= SURE_DUPLICATE);
  if (sure) return { duplicateOf: sure.q.id, why: `near-identical title, cast and date (similarity ${sure.s.toFixed(2)}) to "${sure.q.pitch.title}"` };

  const borderline = scored.filter((x) => x.s >= BORDERLINE).slice(0, MAX_JEV_PAIRS);
  for (let i = 0; i < borderline.length; i += PAIR_KEYS.length) {
    const batch = borderline.slice(i, i + PAIR_KEYS.length);
    const keys = PAIR_KEYS.slice(0, batch.length);
    const questions = Object.fromEntries(keys.map((k) => [k, SAME_EVENT_PAIRS.questions[k]]));
    const result = await jev.ask({
      component: 'same_event',
      state: { candidate: pitchRef(p), incumbents: Object.fromEntries(keys.map((k, j) => [k, pitchRef(batch[j].q.pitch)])) },
      set: SAME_EVENT_PAIRS,
      questions,
      pitchId: opts.pitchId ?? null,
    });
    const answers = result.answers as Record<string, { noul?: number }>;
    const j = keys.findIndex((k) => (answers[k]?.noul ?? 0) >= SAME_EVENT_YES);
    if (j >= 0) {
      const hit = batch[j];
      return {
        duplicateOf: hit.q.id,
        why: `Jev: same event as "${hit.q.pitch.title}" (p=${(answers[keys[j]].noul ?? 0).toFixed(2)}, similarity ${hit.s.toFixed(2)})`,
      };
    }
  }
  return null;
}
