/**
 * Guess the Number (plan §5.2; S-06, S-10 to S-13, S-26, S-45, S-49, S-51;
 * redesign 2026-10-19).
 *
 *   pool     carousel brief numbers and stories without a brief (shortlist,
 *            reels The Number ideas), minus anything whose story ran in the
 *            last 30 days; short ids p1, p2, … over both
 *   pick     one gtn-pick@1 call (web search + fetch) returns three ranked
 *            candidates: pool items or the model's own ideas
 *   gates    the worker reads each cited page itself; Jev (gtn-gate@1) judges
 *            the question against that page, and gtn-same-subject@1 against
 *            each recent set. Every candidate is gated (calibration data);
 *            the highest-ranked one that passes every gate wins, else the day
 *            is skipped and the record lands on the set as gtnSkip
 *   images   the pool item's photo when it has one (S-12), else the finder;
 *            the answer's photo only when a second one is found
 *
 * Difficulty (O-10, provisional until Lucas decides): code maps it from the
 * gate's `guessable` and `surprise` answers. Every number below is
 * provisional until Lucas calibrates.
 */
import type { StoriesDb } from '@/lib/stories/db';
import { GTN_GATE, GTN_SAME_SUBJECT } from '@/lib/stories/questions';
import { GTN_PICK, material, type GtnPickCandidate, type GtnPickMaterial, type GtnPickOut } from '@/lib/stories/prompts';
import { GTN_FAMILIES, type Difficulty, type FrameData, type GtnFamily, type Photo } from '@/lib/stories/render/types';
import { nyDate, recentKeys, type NewCandidate } from '@/lib/stories/repository';
import { gateExcerpt, readSourcePage, type SourcePage } from '@/lib/stories/source-page';
import { carouselNumbers, recentUsedPhotoUrls, shortlistWithoutBrief, type NumberCandidate } from '@/lib/stories/sources/carousel';
import { theNumberIdeas, type StoryCandidate } from '@/lib/stories/sources/reels';
import { writeStructured } from '@/lib/stories/writer';

import { findPhoto, nextBackdrop, shortIds, toFrames, type BuildDeps, type BuildResult } from './common';

export const POOL_NUMBERS_IN = 8;
export const UNBRIEFED_IN = 4;
export const UNBRIEFED_TEXT_CHARS = 6000;
export const PICK_SEARCHES = 5;
export const PICK_FETCHES = 3;
export const GATE_FLOORS = { verifiable: 0.7, want_to_guess: 0.6, newly_changed: 0.5, copy_says_new: 0.5, same_subject: 0.7 };

export type GtnSources = { numbers: () => Promise<NumberCandidate[]>; unbriefed: () => Promise<StoryCandidate[]> };

export type GtnGate = 'too-long' | 'unreadable' | 'verifiable' | 'want_to_guess' | 'not-said-new' | 'same-subject';
export type GtnRecord = {
  poolOffered: number;
  recentTopics: number;
  contract: string[];
  considered: Array<{ rank: number; origin: string; question: string; answer: string; sourceUrl: string; fetch: 'article' | 'plain' | string; answers: Record<string, number> | null; failedGate: GtnGate | null }>;
  floors: typeof GATE_FLOORS;
};

type Answers = Record<string, { noul: number }>;

/** O-10 (provisional): hard to reason toward and far from most guesses → High. */
export function difficultyFrom(a: Answers): Difficulty {
  const d = (1 - (a.guessable?.noul ?? 0.5)) * 0.5 + (a.surprise?.noul ?? 0.5) * 0.5;
  return d < 0.4 ? 'low' : d < 0.65 ? 'medium' : 'high';
}

/** The family after the last set's, among those this set's photos allow (S-13 rotation). */
export async function nextFamily(deps: BuildDeps, hasPhoto: boolean): Promise<GtnFamily> {
  if (!hasPhoto) return 'type';
  const { rows } = await deps.db.query<{ template: string | null }>(
    `SELECT f.template FROM stories.sets s JOIN stories.frames f ON f.set_id = s.id AND f.role = 'question'
      WHERE s.series = 'guess_the_number' AND s.id <> $1 AND s.status IN ('ready', 'approved', 'scheduled', 'publishing', 'published')
      ORDER BY s.ny_date DESC, s.created_at DESC LIMIT 1`,
    [deps.setId],
  );
  const order: GtnFamily[] = ['photo', 'marquee'];
  const last = rows[0]?.template as GtnFamily | undefined;
  return last && order.includes(last) ? order[(order.indexOf(last) + 1) % order.length]! : 'photo';
}

export type RecentGtnTopic = { date: string; question: string; answer: string; label: string; topic: string };

/**
 * Guess the Number sets of the last `days` New York days (other than `setId`) that were posted or are on their way,
 * newest first. The pick call shows them as "don't repeat" and the same-subject check compares against them.
 */
export async function recentGtnTopics(db: StoriesDb, setId: string, now: Date, days = 30): Promise<RecentGtnTopic[]> {
  const since = nyDate(new Date(now.getTime() - days * 86_400_000));
  const { rows } = await db.query<RecentGtnTopic>(
    `SELECT to_char(s.ny_date, 'YYYY-MM-DD') AS date,
            q.copy->>'question' AS question, a.copy->>'number' AS answer, a.copy->>'label' AS label, i.copy->>'topic' AS topic
       FROM stories.sets s
       JOIN stories.frames q ON q.set_id = s.id AND q.role = 'question'
       JOIN stories.frames a ON a.set_id = s.id AND a.role = 'answer'
       JOIN stories.frames i ON i.set_id = s.id AND i.role = 'intro'
      WHERE s.series = 'guess_the_number' AND s.id <> $1 AND s.ny_date >= $2::date
        AND s.status IN ('ready', 'approved', 'scheduled', 'publishing', 'published')
      ORDER BY s.ny_date DESC, s.created_at DESC`,
    [setId, since],
  );
  return rows;
}

type PoolItem = { kind: 'number'; n: NumberCandidate } | { kind: 'story'; s: StoryCandidate };
const poolOrigin = (p: PoolItem): NewCandidate['origin'] => (p.kind === 'number' ? p.n.origin : p.s.origin);
const poolRef = (p: PoolItem) => (p.kind === 'number' ? p.n.ref : p.s.ref);
const poolKey = (p: PoolItem) => (p.kind === 'number' ? p.n.storyKey : p.s.key);
const poolPhoto = (p: PoolItem) => (p.kind === 'number' ? p.n.photo : p.s.photo) ?? null;

/** History key for the model's own idea: its label, lower-cased, runs of non-alphanumerics as '-'. */
const modelKey = (label: string) => `model:${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

type Gated = { c: GtnPickCandidate; item: PoolItem | null; fetch: string; answers: Record<string, number> | null; failedGate: GtnGate | null };

async function recordGtnSkip(deps: BuildDeps, rec: GtnRecord): Promise<void> {
  try {
    console.log(`gtn-skip ${deps.setId} ${JSON.stringify(rec)}`);
  } catch {
    /* logging is best effort */
  }
  try {
    await deps.db.query(`UPDATE stories.sets SET payload = payload || $2::jsonb WHERE id = $1`, [deps.setId, JSON.stringify({ gtnSkip: rec })]);
  } catch {
    /* recording is best effort: a failed write must not turn a skip into a failure */
  }
}

export async function buildGuessTheNumber(deps: BuildDeps, sources?: GtnSources): Promise<BuildResult> {
  const pooled = deps.pool;
  const src: GtnSources = sources ?? (pooled ? { numbers: async () => pooled.numbers, unbriefed: async () => pooled.unbriefed } : null) ?? {
    numbers: () => carouselNumbers(deps.sourceDb, deps.now),
    unbriefed: async () => [...(await shortlistWithoutBrief(deps.sourceDb, deps.now).catch(() => [])), ...(await theNumberIdeas(deps.sourceDb, deps.nyDate).catch(() => []))],
  };
  const log: string[] = [];
  const shown = await recentKeys(deps.db, 'guess_the_number', 30, deps.now);
  const numbers = (await src.numbers().catch(() => [])).filter((n) => !shown.has(n.storyKey)).slice(0, POOL_NUMBERS_IN);
  const stories = (await src.unbriefed().catch(() => [])).filter((s) => !shown.has(s.key)).slice(0, UNBRIEFED_IN);
  // The writer sees short ids, never the story keys (shortIds).
  const pool = shortIds<PoolItem>([...numbers.map((n) => ({ kind: 'number' as const, n })), ...stories.map((s) => ({ kind: 'story' as const, s }))], 'p');
  const recent = await recentGtnTopics(deps.db, deps.setId, deps.now);

  // 1. One pick call: three ranked candidates, pool items or the model's own ideas.
  const mat: GtnPickMaterial = {
    today: deps.nyDate,
    pool: pool.items.map(({ id, item }) =>
      item.kind === 'number'
        ? { id, kind: 'number' as const, value: item.n.value, fact: item.n.fact, counts: item.n.counts, story: item.n.storyHeadline, outlet: item.n.sourceName, url: item.n.url }
        : { id, kind: 'story' as const, headline: item.s.headline, outlet: item.s.sourceName, url: item.s.url, text: item.s.body.slice(0, UNBRIEFED_TEXT_CHARS) },
    ),
    recent: recent.map(({ date, question, answer, topic }) => ({ date, question, answer, topic })),
  };
  const out = (await writeStructured<GtnPickOut>({
    create: deps.write, db: deps.db, setId: deps.setId, component: GTN_PICK.id, model: deps.settings.models.copy, system: GTN_PICK.system, tool: GTN_PICK.tool,
    user: material(mat), webSearch: { maxUses: PICK_SEARCHES }, webFetch: { maxUses: PICK_FETCHES },
  })).value;

  // 2. Contract checks: logged, never thrown.
  const contract: string[] = [];
  const returned = Array.isArray(out.candidates) ? [...out.candidates].sort((a, b) => a.rank - b.rank) : [];
  if (returned.length < 3) contract.push(`fewer than 3 candidates (${returned.length})`);
  const resolved = returned.map((c) => {
    if (c.origin !== 'pool') return { c, item: null };
    const item = pool.byId.get(c.pool_id) ?? null;
    if (!item) contract.push(`unknown pool id ${c.pool_id || '(empty)'}: treated as model`);
    return { c, item };
  });
  if (pool.items.length && !resolved.some((r) => r.item)) contract.push('no pool item');
  if (!resolved.some((r) => !r.item)) contract.push('no model idea');

  // 3. Gate every candidate, in rank order, against the page the worker read itself.
  const read = deps.readSource ?? ((url: string, figure?: string) => readSourcePage(url, undefined, figure));
  const gated: Gated[] = [];
  for (const { c, item } of resolved) {
    if (c.question.length > 90 || c.answer.length > 12) {
      gated.push({ c, item, fetch: 'not fetched', answers: null, failedGate: 'too-long' });
      continue;
    }
    const page: SourcePage = await read(c.source_url, c.answer).catch((err: unknown) => ({ ok: false as const, url: c.source_url, error: err instanceof Error ? err.message : String(err) }));
    if (!page.ok) {
      gated.push({ c, item, fetch: page.error, answers: null, failedGate: 'unreadable' });
      continue;
    }
    const res = await deps.jev.ask({
      component: 'gtn-gate', set: GTN_GATE, setId: deps.setId,
      state: { today: deps.nyDate, question: c.question, answer: c.answer, label: c.label, meaning: c.meaning, topic: c.topic, page_published: page.publishedTime, page: { untrusted_content: gateExcerpt(page.text, c.answer) } },
    });
    const answers: Record<string, number> = Object.fromEntries(Object.entries(res.answers).map(([k, v]) => [k, (v as { noul: number }).noul]));
    if (recent.length) {
      let same = 0;
      for (const r of recent) {
        const s = await deps.jev.ask({ component: 'gtn-same-subject', set: GTN_SAME_SUBJECT, setId: deps.setId, state: { candidate: { question: c.question, label: c.label }, recent: { question: r.question, label: r.label } } });
        same = Math.max(same, (s.answers.same_subject as { noul: number }).noul);
      }
      answers.same_subject = same;
    }
    const f = GATE_FLOORS;
    const failedGate: GtnGate | null =
      (answers.verifiable ?? 0) < f.verifiable ? 'verifiable'
      : (answers.want_to_guess ?? 0) < f.want_to_guess ? 'want_to_guess'
      : (answers.newly_changed ?? 0) >= f.newly_changed && (answers.copy_says_new ?? 0) < f.copy_says_new ? 'not-said-new'
      : (answers.same_subject ?? 0) >= f.same_subject ? 'same-subject'
      : null;
    gated.push({ c, item, fetch: page.via, answers, failedGate });
  }

  const best = gated.find((g) => !g.failedGate);
  const rec: GtnRecord = {
    poolOffered: pool.items.length,
    recentTopics: recent.length,
    contract,
    considered: gated.map((g) => ({ rank: g.c.rank, origin: g.item ? poolOrigin(g.item) : 'model', question: g.c.question, answer: g.c.answer, sourceUrl: g.c.source_url, fetch: g.fetch, answers: g.answers, failedGate: g.failedGate })),
    floors: GATE_FLOORS,
  };
  const candidates: NewCandidate[] = gated.map((g) => ({
    origin: g.item ? poolOrigin(g.item) : 'model',
    ref: g.item ? poolRef(g.item) : g.c.source_url,
    payload: { ...g.c, fetch: g.fetch },
    jev: g.answers,
    score: null,
    chosen: g === best,
    reason: g.failedGate ?? (g === best ? null : 'lower rank'),
  }));
  if (!best) {
    await recordGtnSkip(deps, rec);
    const why = gated.map((g) => `${g.c.rank}: ${g.failedGate}`).join(', ') || 'no candidates';
    return { ok: false, skip: `no candidate passed the gates (${why})`, candidates };
  }

  // 4. Images (S-12).
  const w = best.c;
  const a = best.answers!;
  const shownPhotos = await recentUsedPhotoUrls(deps.sourceDb, deps.now).catch(() => new Set<string>());
  const req = (v: { kind: string; query: string }, exclude: Set<string>) => ({ kind: v.kind, query: v.query, subjects: w.subjects, storyDate: null, sourceUrls: [w.source_url], exclude });
  const own = best.item ? poolPhoto(best.item) : null;
  let qPhoto: Photo | null = own ? { src: own.url, credit: own.credit, kind: 'scene' } : null;
  if (!qPhoto) qPhoto = await findPhoto(deps.photos, req(w.visual, shownPhotos), log);
  const aPhoto = await findPhoto(deps.photos, req(w.answer_visual, new Set([...shownPhotos, ...(qPhoto ? [qPhoto.src] : [])])), log);
  const family = await nextFamily(deps, Boolean(qPhoto));
  const difficulty = difficultyFrom({ guessable: { noul: a.guessable ?? 0.5 }, surprise: { noul: a.surprise ?? 0.5 } });

  const data: FrameData[] = [
    { role: 'intro', difficulty, topic: w.topic },
    { role: 'question', family, question: w.question, ...(qPhoto && family !== 'type' ? { photo: qPhoto } : {}) },
    { role: 'answer', family, number: w.answer, label: w.label, meaning: w.meaning, source: { verb: w.source_verb, name: w.source_name }, ...(aPhoto && family !== 'type' ? { photo: aPhoto } : {}) },
  ];
  const backdrop = await nextBackdrop(deps.db, 'guess_the_number', deps.setId);
  const origin = best.item ? poolOrigin(best.item) : 'model';
  return {
    ok: true,
    payload: { number: w.answer, question: w.question, story: best.item ? (best.item.kind === 'number' ? best.item.n.storyHeadline : best.item.s.headline) : null, url: w.source_url, difficulty, family, log, families: GTN_FAMILIES, origin, gtn: rec },
    frames: toFrames(data, backdrop, (d) => (d.role === 'question' || d.role === 'answer' ? d.family : null)),
    candidates,
    historyKeys: [best.item ? poolKey(best.item) : modelKey(w.label)],
  };
}
