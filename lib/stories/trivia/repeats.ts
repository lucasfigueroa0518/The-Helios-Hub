/**
 * One fact, one question: the one repeat check the writer, the fact-check (IG story and game day) and the game builder
 * all use. The definition of a repeat is REPEAT_RULE (quality.ts); this module decides which earlier questions a
 * question is checked against and catches the plain repeats in code before any model is paid to look.
 *
 *   earlier    every question the series has written on the question's theme (not only its cell): the pool in any
 *              state, the archive, and every game day's questions (locked days hold what the game served). A question
 *              already posted, reserved or served always counts against one not yet played. Otherwise a question counts
 *              only when it was written before this one, so of two questions on one fact the first is kept and only the
 *              later fails (otherwise each would fail on the other and both be lost).
 *   lists      the model reads the question's theme plus any question from another theme close in words; code checks
 *              every theme (it costs nothing).
 *   in code    sameFact: the same answer asked in largely the same words, or one question's words mostly inside the
 *              other's (a reworded or shortened version). The model checks (trivia-write, trivia-check) read the same
 *              list and catch the repeats words alone cannot.
 *
 * Reads only the series' own pool, archive and game-day rows on the themes named (CLAUDE.md rule 2: nothing is swept).
 */
import type { Queryable } from '@/lib/stories/db';

import { cellOf } from './map';
import type { AskedItem } from './prompts';
import { poolKeyOf, TRIVIA_SERIES, type FactCheck, type TriviaPoolPayload, type TriviaQuestion } from './types';

/** One earlier question, with what the ordering rule needs. */
export type Earlier = AskedItem & {
  key: string;
  theme: number | null;
  /** Posted to a story, reserved or served by the game: always counts, whenever it was written. */
  spent: boolean;
  /** The pool day it was written ('' when unknown, which sorts first). */
  writtenOn: string;
};

/** One question as an asked item: its text and the text of its correct option. */
export const askedItem = (q: Pick<TriviaQuestion, 'question' | 'options' | 'correct'>): AskedItem => ({
  question: q.question,
  answer: q.options.find((o) => o.letter === q.correct)?.text ?? '',
});

const usable = (p: Partial<TriviaPoolPayload> | null | undefined): p is TriviaPoolPayload => !!p?.q?.question && Array.isArray(p.q.options);
const themeOf = (cellId: string | undefined | null): number | null => (cellId ? cellOf(cellId)?.theme ?? null : null);

/** Every question the series has written, once per key (spent wins over not spent), oldest first. Read once per pass. */
export async function loadEarlier(db: Queryable): Promise<Earlier[]> {
  type Row = { key: string; payload: TriviaPoolPayload; spent: boolean };
  const { rows } = await db.query<Row>(
    `SELECT key, payload, (used_at IS NOT NULL) AS spent FROM stories.pool WHERE series = $1
     UNION ALL
     SELECT key, payload, (reason LIKE 'pulled%') FROM stories.trivia_archive
     UNION ALL
     SELECT q->>'key', q->'payload', true FROM stories.trivia_game_days d, jsonb_array_elements(d.questions) q`,
    [TRIVIA_SERIES],
  );
  const byKey = new Map<string, Earlier>();
  for (const r of rows) {
    if (!r.key || !usable(r.payload)) continue;
    const prev = byKey.get(r.key);
    if (prev) {
      prev.spent ||= r.spent;
      continue;
    }
    byKey.set(r.key, { ...askedItem(r.payload.q), key: r.key, theme: themeOf(r.payload.q.cellId), spent: r.spent, writtenOn: r.payload.writtenOn ?? '' });
  }
  return [...byKey.values()].sort((a, b) => a.writtenOn.localeCompare(b.writtenOn) || a.key.localeCompare(b.key));
}

/** The questions written on one theme (the writer's list for a cell on it). */
export const onTheme = (all: readonly Earlier[], theme: number | null): Earlier[] => all.filter((e) => e.theme !== null && e.theme === theme);

/** Whether `e` came before the question with this key and pool day (the ordering rule above). */
const before = (e: Earlier, key: string, writtenOn: string) => e.writtenOn < writtenOn || (e.writtenOn === writtenOn && e.key < key);

/** A question from another theme close enough in words that the model check should see it too. */
const RELATED_OVERLAP = 0.4;

export type RepeatCheck = {
  /** The earlier question it repeats in code, or null. */
  repeat: Earlier | null;
  /** The list the model check reads: earlier questions on its theme, close ones from other themes, then `alongside`. */
  asked: AskedItem[];
};

/**
 * One pool question against everything before it: every spent question, the unposted ones written before it, and
 * `alongside` (questions already chosen to post with it). Never the question itself. Code checks all themes; the
 * model reads its theme plus the close ones from other themes.
 */
export function checkRepeat(all: readonly Earlier[], p: TriviaPoolPayload, alongside: readonly TriviaPoolPayload[] = []): RepeatCheck {
  const key = poolKeyOf(p.q);
  const theme = themeOf(p.q.cellId);
  const item = askedItem(p.q);
  // A question already played (posted or served) is held only to what came before it, so the first of two played
  // copies of one fact stays usable; one not yet played is held to every played question too.
  const played = all.some((e) => e.key === key && e.spent);
  const prior: Earlier[] = all.filter((e) => e.key !== key && ((e.spent && !played) || before(e, key, p.writtenOn ?? '')));
  const have = new Set(prior.map((e) => e.key));
  const along = new Set<string>();
  for (const a of alongside) {
    const k = poolKeyOf(a.q);
    if (k === key) continue;
    along.add(k);
    if (have.has(k)) continue;
    have.add(k);
    prior.push({ ...askedItem(a.q), key: k, theme: themeOf(a.q.cellId), spent: true, writtenOn: a.writtenOn ?? '' });
  }
  const mine = words(`${item.question} ${item.answer}`);
  const shown = prior.filter((e) => along.has(e.key) || (theme !== null && e.theme === theme) || overlap(mine, words(`${e.question} ${e.answer}`)) >= RELATED_OVERLAP);
  return { repeat: findRepeat(item, prior), asked: asAsked(shown) };
}

/**
 * The version of this repeat check a fact-check verdict was given under (FactCheck.repeats). A game-day question checked
 * under an older one is checked again before its day locks: the lists before 2026-11-22 missed the game's served
 * questions and every other cell on the theme.
 */
export const REPEAT_CHECK_VERSION = 2;

/** The fact-check verdict for a question code found to be a repeat (no model is asked). */
export const repeatFail = (e: Earlier): FactCheck => ({ verdict: 'fail', problems: [`repeat: the same fact as ${e.key} ("${e.question}" → ${e.answer})`], sources: [], repeats: REPEAT_CHECK_VERSION });

/* ── The check in code ───────────────────────────────────────────────── */

const STOP = new Set(
  'a an the and or but of to in on at by for from with about as into over than then that this these those it its is are was were be been being do does did has have had what which who whom whose when where why how many much most more some any all each one per first did can could would should will may might your you yours their they them our we us his her he she not no if so just ever also only out up'.split(' '),
);

/** Content words: lower case, letters, digits and %, stop words dropped, a plural s trimmed. */
export function words(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9%]+/)) {
    if (!raw || STOP.has(raw)) continue;
    out.add(raw.length > 3 && raw.endsWith('s') && !raw.endsWith('ss') ? raw.slice(0, -1) : raw);
  }
  return out;
}

/** |a ∩ b| / the smaller size: 1 when one set sits inside the other. */
function overlap(a: Set<string>, b: Set<string>): number {
  const small = a.size <= b.size ? a : b;
  const big = small === a ? b : a;
  if (small.size < 3) return 0;
  let n = 0;
  for (const w of small) if (big.has(w)) n++;
  return n / small.size;
}

const SAME_ANSWER_OVERLAP = 0.5;
const SAME_WORDS_OVERLAP = 0.75;

const sameAnswer = (a: string, b: string) => {
  const x = [...words(a)].sort().join(' ');
  return !!x && x === [...words(b)].sort().join(' ');
};

/** The plain repeats code can see: the same answer asked in largely the same words, or one question mostly inside the other. */
export function sameFact(a: AskedItem, b: AskedItem): boolean {
  if (sameAnswer(a.answer, b.answer) && overlap(words(a.question), words(b.question)) >= SAME_ANSWER_OVERLAP) return true;
  return overlap(words(`${a.question} ${a.answer}`), words(`${b.question} ${b.answer}`)) >= SAME_WORDS_OVERLAP;
}

/** The first earlier question this one repeats in code, or null. */
export function findRepeat<T extends AskedItem>(item: AskedItem, earlier: readonly T[]): T | null {
  return earlier.find((e) => sameFact(item, e)) ?? null;
}

/** As the prompts read the list: question and answer only. */
export const asAsked = (earlier: readonly AskedItem[]): AskedItem[] => earlier.map((e) => ({ question: e.question, answer: e.answer }));
