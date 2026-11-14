/**
 * Guess the Number (plan §5.2; S-06, S-10 to S-13, S-26, S-45, S-49, S-51;
 * redesign 2026-10-19).
 *
 *   pool     carousel brief numbers and stories without a brief (shortlist,
 *            reels The Number ideas), minus anything whose story ran in the
 *            last 30 days; short ids p1, p2, … over both
 *   pick     one gtn-pick@2 call (web search + fetch) returns three ranked
 *            candidates: pool items or the model's own ideas
 *   links    a model idea citing a news-aggregator wrapper link, or a link a
 *            higher-ranked candidate cites, fails 'bad-link' (Bald-Eagle D7)
 *   read     the worker reads the page itself: the cited link, then (pool
 *            stories) the intake story's other member links, publisher links
 *            before wrapper links, paywalled pages skipped; the first page
 *            holding the answer's figure is gated (lib/stories/gtn-sources.ts,
 *            readFirstWithFigure; Bald-Eagle D7). No model call
 *   gates    Jev (gtn-gate@1) judges the question against that page, and
 *            gtn-same-subject@1 against each recent set. Every candidate is
 *            gated (calibration data); the highest-ranked one that passes
 *            every gate wins
 *   retry    no winner → one more pick call told each failure and the links
 *            tried, gated the same way (Bald-Eagle D10). Still none → the day
 *            is skipped and the record (both rounds) lands on the set as gtnSkip
 *   images   the pool item's photo when it has one (S-12), else the finder;
 *            the answer's photo only when a second one is found
 *
 * want_to_guess floor 0.45 (Bald-Eagle D10, was 0.6).
 *
 * Difficulty (O-10, provisional until Lucas decides): code maps it from the
 * gate's `guessable` and `surprise` answers. Every number below is
 * provisional until Lucas calibrates.
 */
import type { StoriesDb } from '@/lib/stories/db';
import { GTN_GATE, GTN_SAME_SUBJECT } from '@/lib/stories/questions';
import { badLink, intakeMemberLinks, outletFromHost, sourceOrder, type MemberLink } from '@/lib/stories/gtn-sources';
import { GTN_PICK, material, type GtnPickCandidate, type GtnPickMaterial, type GtnPickOut, type GtnPickRetry } from '@/lib/stories/prompts';
import { GTN_FAMILIES, type Difficulty, type FrameData, type GtnFamily, type Photo } from '@/lib/stories/render/types';
import { nyDate, type NewCandidate } from '@/lib/stories/repository';
import { gateExcerpt, readFirstWithFigure, readSourcePage, type SourceTry } from '@/lib/stories/source-page';
import { carouselNumbers, recentUsedPhotoUrls, shortlistWithoutBrief, type NumberCandidate } from '@/lib/stories/sources/carousel';
import { storyKey, theNumberIdeas, type StoryCandidate } from '@/lib/stories/sources/reels';
import { writeStructured } from '@/lib/stories/writer';

import { findPhoto, keysToAvoid, nextBackdrop, shortIds, toFrames, type BuildDeps, type BuildResult } from './common';

export const POOL_NUMBERS_IN = 8;
export const UNBRIEFED_IN = 4;
export const UNBRIEFED_TEXT_CHARS = 6000;
export const PICK_SEARCHES = 5;
export const PICK_FETCHES = 3;
export const GATE_FLOORS = { verifiable: 0.7, want_to_guess: 0.45, newly_changed: 0.5, copy_says_new: 0.5, same_subject: 0.7 };

export type GtnSources = {
  numbers: () => Promise<NumberCandidate[]>;
  unbriefed: () => Promise<StoryCandidate[]>;
  /** A pool story's intake member links (Bald-Eagle D7). Defaults to a read-only intake.items read; tests stub it. */
  memberLinks?: (storyId: string) => Promise<MemberLink[]>;
};

export type GtnGate = 'too-long' | 'bad-link' | 'unreadable' | 'verifiable' | 'want_to_guess' | 'not-said-new' | 'same-subject' | 'jev-error';
export type GtnConsidered = {
  /** 1, or 2 for the second try (Bald-Eagle D10). */
  round: number;
  rank: number;
  origin: string;
  question: string;
  answer: string;
  sourceUrl: string;
  fetch: 'article' | 'plain' | string;
  /** The page the gate read, when it is not the cited link (or always, once read). */
  readUrl?: string;
  /** Every link the fallback reader tried, in order (Bald-Eagle D7). */
  tried?: SourceTry[];
  answers: Record<string, number> | null;
  failedGate: GtnGate | null;
  error?: string;
};
export type GtnRecord = {
  poolOffered: number;
  recentTopics: number;
  /** Both rounds' contract notes; round 2's prefixed "round 2: ". */
  contract: string[];
  /** Every candidate of every round, flattened in order (round 1 first). */
  considered: GtnConsidered[];
  /** The same, by round (Bald-Eagle D10). */
  rounds: Array<{ round: number; contract: string[]; considered: GtnConsidered[] }>;
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

type Gated = { round: number; c: GtnPickCandidate; item: PoolItem | null; fetch: string; readUrl?: string; readOutlet?: string | null; tried?: SourceTry[]; answers: Record<string, number> | null; failedGate: GtnGate | null; error?: string };

/** A short reason a candidate failed, for the second try's material. */
function failReason(g: Gated): string {
  const a = g.answers ?? {};
  const score = (k: keyof typeof GATE_FLOORS) => `${k} ${(a[k] ?? 0).toFixed(2)} vs floor ${GATE_FLOORS[k]}`;
  switch (g.failedGate) {
    case 'too-long': return 'question over 90 or answer over 12 characters';
    case 'bad-link':
    case 'jev-error': return g.error ?? g.failedGate;
    case 'unreadable': return `no linked page could be read (${g.fetch})`;
    case 'verifiable': return `the page read did not plainly state the figure (${score('verifiable')})`;
    case 'want_to_guess': return `not enough pull to guess (${score('want_to_guess')})`;
    case 'not-said-new': return 'a recently changed figure the copy did not call new';
    case 'same-subject': return 'same subject as a recent set';
    default: return '';
  }
}

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
    unbriefed: async () => [...(await shortlistWithoutBrief(deps.sourceDb, deps.now).catch(() => [])), ...(await theNumberIdeas(deps.sourceDb, deps.now).catch(() => []))],
  };
  const log: string[] = [];
  const shown = await keysToAvoid(deps, 'guess_the_number', 30);
  const numbers = (await src.numbers().catch(() => [])).filter((n) => !shown.has(n.storyKey)).slice(0, POOL_NUMBERS_IN);
  const stories = (await src.unbriefed().catch(() => [])).filter((s) => !shown.has(s.key)).slice(0, UNBRIEFED_IN);
  // The writer sees short ids, never the story keys (shortIds).
  const pool = shortIds<PoolItem>([...numbers.map((n) => ({ kind: 'number' as const, n })), ...stories.map((s) => ({ kind: 'story' as const, s }))], 'p');
  const recent = await recentGtnTopics(deps.db, deps.setId, deps.now);

  // Bald-Eagle S6: with lead days, deps.nyDate is the posting date; "newly changed" and "most current" are judged
  // against the day the run happens.
  const runDay = nyDate(deps.now);

  // 1. One pick call: three ranked candidates, pool items or the model's own ideas.
  const mat: GtnPickMaterial = {
    today: runDay,
    pool: pool.items.map(({ id, item }) =>
      item.kind === 'number'
        ? { id, kind: 'number' as const, value: item.n.value, fact: item.n.fact, counts: item.n.counts, story: item.n.storyHeadline, outlet: item.n.sourceName, url: item.n.url }
        : { id, kind: 'story' as const, headline: item.s.headline, outlet: item.s.sourceName, url: item.s.url, text: item.s.body.slice(0, UNBRIEFED_TEXT_CHARS) },
    ),
    recent: recent.map(({ date, question, answer, topic }) => ({ date, question, answer, topic })),
  };
  const read = deps.readSource ?? ((url: string, figure?: string) => readSourcePage(url, undefined, figure));
  const memberLinks = sources?.memberLinks ?? ((storyId: string) => intakeMemberLinks(deps.sourceDb, storyId));

  /** One pick call and its gates (steps 2 and 3), for round 1 and the second try. */
  const runRound = async (round: number, m: GtnPickMaterial): Promise<{ contract: string[]; gated: Gated[] }> => {
    const out = (await writeStructured<GtnPickOut>({
      create: deps.write, db: deps.db, setId: deps.setId, component: GTN_PICK.id, model: deps.settings.models.copy, system: GTN_PICK.system, tool: GTN_PICK.tool,
      user: material(m), webSearch: { maxUses: PICK_SEARCHES }, webFetch: { maxUses: PICK_FETCHES },
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
    const gated: Gated[] = [];
    const cited: string[] = [];
    for (const { c, item } of resolved) {
      const higher = [...cited];
      cited.push(c.source_url);
      if (c.question.length > 90 || c.answer.length > 12) {
        gated.push({ round, c, item, fetch: 'not fetched', answers: null, failedGate: 'too-long' });
        continue;
      }
      // Bald-Eagle D7: a model idea cites a page it opened, never a wrapper link, never a link a higher rank cites.
      const bad = item ? null : badLink(c.source_url, higher);
      if (bad) {
        gated.push({ round, c, item, fetch: 'not fetched', answers: null, failedGate: 'bad-link', error: bad });
        continue;
      }
      // Bald-Eagle D7: a pool story is read from its own link, then its intake story's other links.
      const storyId = item?.kind === 'story' ? item.s.intake?.storyId : undefined;
      const links: MemberLink[] = [
        ...(item ? [item.kind === 'number' ? { url: item.n.url, outlet: item.n.sourceName } : { url: item.s.url, outlet: item.s.sourceName }] : []),
        ...(storyId ? await memberLinks(storyId).catch(() => []) : []),
      ];
      const { page, tried } = await readFirstWithFigure(sourceOrder(c.source_url, links.map((l) => l.url)), c.answer, read);
      // The publisher of the page actually read, when it is not the cited one (the answer frame credits it).
      const readFrom = (pageUrl: string): string | null => {
        const used = tried.find((x) => x.result.startsWith('read'))?.url ?? pageUrl;
        if (storyKey(used) === storyKey(c.source_url)) return null;
        return links.find((l) => storyKey(l.url) === storyKey(used) && l.outlet)?.outlet ?? outletFromHost(pageUrl);
      };
      if (!page.ok) {
        gated.push({ round, c, item, fetch: page.error, tried, answers: null, failedGate: 'unreadable' });
        continue;
      }
      let answers: Record<string, number> = {};
      try {
        const res = await deps.jev.ask({
          component: 'gtn-gate', set: GTN_GATE, setId: deps.setId,
          state: { today: runDay, question: c.question, answer: c.answer, label: c.label, meaning: c.meaning, topic: c.topic, page_published: page.publishedTime?.trim().slice(0, 40) || null, page: { untrusted_content: gateExcerpt(page.text, c.answer) } },
        });
        answers = Object.fromEntries(Object.entries(res.answers).map(([k, v]) => [k, (v as { noul: number }).noul]));
        if (recent.length) {
          let same = 0;
          for (const r of recent) {
            const s = await deps.jev.ask({ component: 'gtn-same-subject', set: GTN_SAME_SUBJECT, setId: deps.setId, state: { candidate: { question: c.question, label: c.label }, recent: { question: r.question, label: r.label } } });
            // A missing key is a failed gate, never a default pass.
            const v = (s.answers.same_subject as { noul: number } | undefined)?.noul;
            same = Math.max(same, typeof v === 'number' ? v : 1);
          }
          answers.same_subject = same;
        }
      } catch (err) {
        gated.push({ round, c, item, fetch: page.via, readUrl: page.url, readOutlet: readFrom(page.url), tried, answers: Object.keys(answers).length ? answers : null, failedGate: 'jev-error', error: err instanceof Error ? err.message : String(err) });
        continue;
      }
      const f = GATE_FLOORS;
      const failedGate: GtnGate | null =
        (answers.verifiable ?? 0) < f.verifiable ? 'verifiable'
        : (answers.want_to_guess ?? 0) < f.want_to_guess ? 'want_to_guess'
        : (answers.newly_changed ?? 0) >= f.newly_changed && (answers.copy_says_new ?? 0) < f.copy_says_new ? 'not-said-new'
        : (answers.same_subject ?? 0) >= f.same_subject ? 'same-subject'
        : null;
      gated.push({ round, c, item, fetch: page.via, readUrl: page.url, readOutlet: readFrom(page.url), tried, answers, failedGate });
    }
    return { contract, gated };
  };

  const rounds: Array<{ round: number; contract: string[]; gated: Gated[] }> = [{ round: 1, ...(await runRound(1, mat)) }];
  // Bald-Eagle D10: no winner in round 1 → one more pick, told why each failed and which links were tried.
  if (!rounds[0]!.gated.some((g) => !g.failedGate)) {
    const first = rounds[0]!.gated;
    const retry: GtnPickRetry = {
      failures: first.map((g) => ({ question: g.c.question, failed_gate: g.failedGate ?? 'none', reason: failReason(g) })),
      links_tried: [...new Set(first.flatMap((g) => [g.c.source_url, ...(g.tried ?? []).map((t) => t.url)]).filter(Boolean))],
    };
    rounds.push({ round: 2, ...(await runRound(2, { ...mat, retry })) });
  }
  const gated = rounds.flatMap((r) => r.gated);
  const best = gated.find((g) => !g.failedGate);
  const consideredOf = (g: Gated): GtnConsidered => ({
    round: g.round, rank: g.c.rank, origin: g.item ? poolOrigin(g.item) : 'model', question: g.c.question, answer: g.c.answer, sourceUrl: g.c.source_url, fetch: g.fetch,
    ...(g.readUrl ? { readUrl: g.readUrl } : {}), ...(g.tried ? { tried: g.tried } : {}),
    answers: g.answers, failedGate: g.failedGate, ...(g.error ? { error: g.error } : {}),
  });
  const rec: GtnRecord = {
    poolOffered: pool.items.length,
    recentTopics: recent.length,
    contract: rounds.flatMap((r) => (r.round === 1 ? r.contract : r.contract.map((c) => `round ${r.round}: ${c}`))),
    considered: gated.map(consideredOf),
    rounds: rounds.map((r) => ({ round: r.round, contract: r.contract, considered: r.gated.map(consideredOf) })),
    floors: GATE_FLOORS,
  };
  const candidates: NewCandidate[] = gated.map((g) => ({
    origin: g.item ? poolOrigin(g.item) : 'model',
    ref: g.item ? poolRef(g.item) : g.c.source_url,
    payload: { ...g.c, round: g.round, fetch: g.fetch, ...(g.readUrl ? { read_url: g.readUrl } : {}), ...(g.tried ? { tried: g.tried } : {}), ...(g.error ? { error: g.error } : {}) },
    jev: g.answers,
    score: null,
    chosen: g === best,
    reason: g.failedGate ?? (g === best ? null : 'lower rank'),
  }));
  if (!best) {
    await recordGtnSkip(deps, rec);
    const why = rounds.map((r) => r.gated.map((g) => `${g.c.rank}: ${g.failedGate}`).join(', ') || 'no candidates').join(' | ');
    return { ok: false, skip: `no candidate passed the gates in ${rounds.length} round${rounds.length > 1 ? 's' : ''} (${why})`, candidates };
  }

  // 4. Images (S-12).
  const w = best.c;
  const a = best.answers!;
  const shownPhotos = await recentUsedPhotoUrls(deps.sourceDb, deps.now).catch(() => new Set<string>());
  const sourceUrls = [...new Set([best.readUrl, w.source_url].filter((u): u is string => Boolean(u)))];
  const req = (v: { kind: string; query: string }, exclude: Set<string>) => ({ kind: v.kind, query: v.query, subjects: w.subjects, storyDate: null, sourceUrls, exclude });
  const own = best.item ? poolPhoto(best.item) : null;
  let qPhoto: Photo | null = own ? { src: own.url, credit: own.credit, kind: 'scene' } : null;
  if (!qPhoto) qPhoto = await findPhoto(deps.photos, req(w.visual, shownPhotos), log);
  const aPhoto = await findPhoto(deps.photos, req(w.answer_visual, new Set([...shownPhotos, ...(qPhoto ? [qPhoto.src] : [])])), log);
  const family = await nextFamily(deps, Boolean(qPhoto));
  const difficulty = difficultyFrom({ guessable: { noul: a.guessable ?? 0.5 }, surprise: { noul: a.surprise ?? 0.5 } });

  // The gate read another publisher's page than the one cited: credit that publisher; a first-party "from" no longer fits.
  const credit = best.readOutlet
    ? { verb: w.source_verb === 'from' ? ('reported by' as const) : w.source_verb, name: best.readOutlet }
    : { verb: w.source_verb, name: w.source_name };

  const data: FrameData[] = [
    { role: 'intro', difficulty, topic: w.topic },
    { role: 'question', family, question: w.question, ...(qPhoto && family !== 'type' ? { photo: qPhoto } : {}) },
    { role: 'answer', family, number: w.answer, label: w.label, meaning: w.meaning, source: credit, ...(aPhoto && family !== 'type' ? { photo: aPhoto } : {}) },
  ];
  const backdrop = await nextBackdrop(deps.db, 'guess_the_number', deps.setId);
  const origin = best.item ? poolOrigin(best.item) : 'model';
  return {
    ok: true,
    payload: { number: w.answer, question: w.question, story: best.item ? (best.item.kind === 'number' ? best.item.n.storyHeadline : best.item.s.headline) : null, url: w.source_url, readUrl: best.readUrl ?? w.source_url, round: best.round, difficulty, family, log, families: GTN_FAMILIES, origin, gtn: rec },
    frames: toFrames(data, backdrop, (d) => (d.role === 'question' || d.role === 'answer' ? d.family : null)),
    candidates,
    historyKeys: [best.item ? poolKey(best.item) : modelKey(w.label)],
  };
}
