/**
 * Guess the Number (plan §5.2; S-06, S-10 to S-13, S-26, S-45, S-49, S-51).
 *
 *   pool       carousel brief numbers (last 7 days, weighted up: S-10), plus
 *              numbers gtn-extract@1 pulls from shortlisted stories without a
 *              brief and from reels The Number ideas; numbers whose story ran
 *              in the last 30 days are dropped
 *   pre-score  gtn-candidate@1 on each raw number (at most 12 asked); top 4 on
 *   write      gtn-question@1 for the 4 (question, answer, label, meaning,
 *              topic, two photo requests)
 *   re-score   gtn-candidate@1 on each written question; the best clears the
 *              bar or the day is skipped
 *   images     the carousel post's photo when it has one (S-12), else the
 *              finder; the answer's photo only when a second one is found
 *
 * Difficulty (O-10, provisional until Lucas decides): code maps it from the
 * written question's `guessable` and `surprise` answers.
 */
import { GTN_CANDIDATE } from '@/lib/stories/questions';
import { GTN_EXTRACT, GTN_QUESTION, material, type GtnExtractOut, type GtnQuestionOut } from '@/lib/stories/prompts';
import { GTN_FAMILIES, type Difficulty, type FrameData, type GtnFamily, type Photo } from '@/lib/stories/render/types';
import { recentKeys, type NewCandidate } from '@/lib/stories/repository';
import { carouselNumbers, recentUsedPhotoUrls, shortlistWithoutBrief, type NumberCandidate } from '@/lib/stories/sources/carousel';
import { theNumberIdeas, type StoryCandidate } from '@/lib/stories/sources/reels';
import { writeStructured } from '@/lib/stories/writer';

import { findPhoto, nextBackdrop, toFrames, type BuildDeps, type BuildResult } from './common';

export const CAROUSEL_WEIGHT = 1.15;
export const GTN_BAR = 0.6;
export const PRESCORE_LIMIT = 12;
export const WRITE_TOP = 4;

export type GtnSources = { numbers: () => Promise<NumberCandidate[]>; unbriefed: () => Promise<StoryCandidate[]> };

type Answers = Record<string, { noul: number }>;
export const candidateScore = (a: Answers) => ['public_context', 'guessable', 'want_to_guess', 'interest_category', 'surprise', 'verifiable'].reduce((s, k) => s + (a[k]?.noul ?? 0), 0) / 6;

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

export async function buildGuessTheNumber(deps: BuildDeps, sources?: GtnSources): Promise<BuildResult> {
  const pooled = deps.pool;
  const src: GtnSources = sources ?? (pooled ? { numbers: async () => pooled.numbers, unbriefed: async () => pooled.unbriefed } : null) ?? {
    numbers: () => carouselNumbers(deps.sourceDb, deps.now),
    unbriefed: async () => [...(await shortlistWithoutBrief(deps.sourceDb, deps.now).catch(() => [])), ...(await theNumberIdeas(deps.sourceDb, deps.nyDate).catch(() => []))],
  };
  const log: string[] = [];
  const candidates: NewCandidate[] = [];
  const shown = await recentKeys(deps.db, 'guess_the_number', 30, deps.now);
  let pool = (await src.numbers().catch(() => [])).filter((n) => !shown.has(n.storyKey));

  // Numbers from stories with no brief: one extraction call over up to 6 stories.
  const unbriefed = (await src.unbriefed().catch(() => [])).filter((s) => !shown.has(s.key)).slice(0, 6);
  if (unbriefed.length) {
    const out = (await writeStructured<GtnExtractOut>({
      create: deps.write, db: deps.db, setId: deps.setId, component: GTN_EXTRACT.id, model: deps.settings.models.copy, system: GTN_EXTRACT.system, tool: GTN_EXTRACT.tool, effort: 'low',
      user: material(unbriefed.map((s) => ({ story_key: s.key, headline: s.headline, outlet: s.sourceName, text: s.body.slice(0, 9000) }))),
    })).value;
    const byKey = new Map(unbriefed.map((s) => [s.key, s]));
    for (const [i, n] of out.numbers.slice(0, 18).entries()) {
      const s = byKey.get(n.story_key);
      if (s && n.value.trim()) pool.push({ key: `${s.key}#x${i}`, origin: s.origin === 'reels' ? 'reels' : 'generated', ref: s.ref, value: n.value, fact: n.fact, counts: n.counts, storyHeadline: s.headline, sourceName: s.sourceName, url: s.url, storyKey: s.key, photo: s.photo ?? null });
    }
  }
  pool = pool.slice(0, PRESCORE_LIMIT);
  if (!pool.length) return { ok: false, skip: 'no new numbers this week', candidates };

  // Pre-score the raw numbers.
  const scored: Array<NumberCandidate & { score: number; answers: Record<string, number> }> = [];
  for (const n of pool) {
    const res = await deps.jev.ask({ component: 'gtn-prescore', set: GTN_CANDIDATE, setId: deps.setId, state: { number: n.value, counts: n.counts, fact: { untrusted_content: n.fact }, story: n.storyHeadline } });
    const weight = n.origin === 'carousel' ? CAROUSEL_WEIGHT : 1;
    scored.push({ ...n, score: candidateScore(res.answers as Answers) * weight, answers: Object.fromEntries(Object.entries(res.answers).map(([k, v]) => [k, (v as { noul: number }).noul])) });
  }
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, WRITE_TOP);

  // Write the top 4, then re-score each written question.
  const written = (await writeStructured<GtnQuestionOut>({
    create: deps.write, db: deps.db, setId: deps.setId, component: GTN_QUESTION.id, model: deps.settings.models.copy, system: GTN_QUESTION.system, tool: GTN_QUESTION.tool,
    user: material(top.map((n) => ({ candidate_key: n.key, number: n.value, counts: n.counts, fact: n.fact, story: n.storyHeadline, outlet: n.sourceName, url: n.url }))),
  })).value.questions.filter((q) => top.some((t) => t.key === q.candidate_key) && q.question.length <= 90 && q.answer.length <= 12);
  const finals: Array<{ q: GtnQuestionOut['questions'][number]; n: (typeof top)[number]; score: number; answers: Answers }> = [];
  for (const q of written) {
    const n = top.find((t) => t.key === q.candidate_key)!;
    const res = await deps.jev.ask({ component: 'gtn-rescore', set: GTN_CANDIDATE, setId: deps.setId, state: { question: q.question, answer: q.answer, what_it_is: q.label, meaning: q.meaning, fact: { untrusted_content: n.fact } } });
    finals.push({ q, n, score: candidateScore(res.answers as Answers) * (n.origin === 'carousel' ? CAROUSEL_WEIGHT : 1), answers: res.answers as Answers });
  }
  finals.sort((a, b) => b.score - a.score);
  const best = finals[0];
  for (const s of scored) candidates.push({ origin: s.origin === 'carousel' ? 'carousel' : s.origin === 'reels' ? 'reels' : 'generated', ref: s.ref, payload: { value: s.value, counts: s.counts, fact: s.fact, story: s.storyHeadline }, jev: s.answers, score: s.score, chosen: best?.n.key === s.key, reason: best?.n.key === s.key ? null : top.includes(s) ? 'lost on the re-score' : 'below the top 4' });
  if (!best || best.score < GTN_BAR) return { ok: false, skip: `no written question cleared the bar (best ${best ? best.score.toFixed(2) : 'none'})`, candidates };

  // Images (S-12).
  const recent = await recentUsedPhotoUrls(deps.sourceDb, deps.now).catch(() => new Set<string>());
  const req = (v: { kind: string; query: string }, exclude: Set<string>) => ({ kind: v.kind, query: v.query, subjects: best.q.subjects, storyDate: null, sourceUrls: best.n.url ? [best.n.url] : [], exclude });
  let qPhoto: Photo | null = best.n.photo ? { src: best.n.photo.url, credit: best.n.photo.credit, kind: 'scene' } : null;
  if (!qPhoto) qPhoto = await findPhoto(deps.photos, req(best.q.visual, recent), log);
  const aPhoto = await findPhoto(deps.photos, req(best.q.answer_visual, new Set([...recent, ...(qPhoto ? [qPhoto.src] : [])])), log);
  const family = await nextFamily(deps, Boolean(qPhoto));

  const data: FrameData[] = [
    { role: 'intro', difficulty: difficultyFrom(best.answers), topic: best.q.topic },
    { role: 'question', family, question: best.q.question, ...(qPhoto && family !== 'type' ? { photo: qPhoto } : {}) },
    { role: 'answer', family, number: best.q.answer, label: best.q.label, meaning: best.q.meaning, source: { verb: best.q.source_verb, name: best.q.source_name }, ...(aPhoto && family !== 'type' ? { photo: aPhoto } : {}) },
  ];
  const backdrop = await nextBackdrop(deps.db, 'guess_the_number', deps.setId);
  return {
    ok: true,
    payload: { number: best.n.value, question: best.q.question, story: best.n.storyHeadline, url: best.n.url, score: best.score, difficulty: difficultyFrom(best.answers), family, log, families: GTN_FAMILIES },
    frames: toFrames(data, backdrop, (d) => (d.role === 'question' || d.role === 'answer' ? d.family : null)),
    candidates,
    historyKeys: [best.n.storyKey],
  };
}
