/**
 * Central intake replay, Phase 2 comparisons (planning/Central Intake/PHASE2-CONTRACT.md, Owner A item 8). Same
 * ≥ 80% rule as Phase 1 (TARGET in replay.ts):
 *  - Reels: per replayed night, the legacy slate's ideas (selected + top 10 by net) vs the intake path's (the
 *    night's timely reels-scored stories, top by net). Read on the main replay's store: no extra Jev.
 *  - Carousel: the last nights with a carousel run (≤ Oct 28): that run's stored `selection.scored` articles become
 *    feed items in a fresh in-memory store, grouped and story-scored; legacy shortlist vs the intake shortlist.
 *  - Field Notes: the candidate tips past Field Notes runs saved (field_notes.tips) become Field Notes items in a
 *    fresh store, scored with field-notes-score (its per-run cap applies); legacy top tips vs the intake's.
 *
 * Real DB: read only, inside replay.ts's one BEGIN READ ONLY transaction. Intake state: in-memory PGlite only.
 * Plan mode (no --go) makes no Jev call and no HTTP request; tests stub every scorecard.
 */
import { canonicalSourceUrl, type TipCandidate } from '@/lib/field-notes/sources/candidate';
import { SOURCE_REGISTRY } from '@/lib/field-notes/sources/registry';
import { storeFieldNotesCandidate, upsertItem } from '@/lib/intake/fetch';
import { pickFieldNotesStories } from '@/lib/intake/field-notes-cap';
import { groupIntake, type GroupingResult } from '@/lib/intake/group';
import { CAROUSEL_ORDER, FIELD_NOTES_ORDER, REELS_ORDER } from '@/lib/intake/orders';
import { listOrderStories, loadStories } from '@/lib/intake/read';
import { scoreForStories } from '@/lib/intake/score';
import { FIELD_NOTES_CARD, STORY_SCORING } from '@/lib/intake/scorecards';
import type { IntakeJev, IntakeQuery, Scorecard, ScoredStory } from '@/lib/intake/types';
import { jevUsd } from '@/lib/reels/jev/runner';
import type { TipSourceKind } from '@/lib/field-notes/types';

import { compareLists, safeKey, TARGET, type Comparison, type IntakeCand, type LegacyCand } from './replay';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The last carousel run day the comparison may use (carousels stopped after it). */
export const CAROUSEL_BEFORE = '2026-10-29';
export const CAROUSEL_RUNS = 2;
export const FIELD_NOTES_RUNS = 3;
export const REELS_TOP = 10;
/** Average field-notes-score@3 input tokens (6000 chars of scraped text plus the question set). */
export const FIELD_NOTES_TOKENS = 2600;
const STORY_SCORING_TOKENS = 1610;
const GROUPING_TOKENS = 1320;
const STORY_SCORING_CALLS = 2.1;
const FEED_GROUPING_PER_ARTICLE = 2;

/* ── snapshot ─────────────────────────────────────────────────────────── */

export type ReelsIdea = { ideaId: string; headline: string; keys: string[]; net: number | null; selected: boolean };
/** A replayed night's Reels slate, limited to its new ideas (a member source from that night's run): carryovers are
 * scored by idea id the same way in both paths, and the replay store holds only that night's sources. */
export type ReelsNight = { nyDate: string; runAt: Date; legacy: ReelsIdea[] };
export type CarouselArticle = { key: string; url: string; headline: string; outlet: string; feedSlug: string; body: string; publishedAt: Date };
export type CarouselNight = { runId: string; at: Date; articles: CarouselArticle[]; shortlist: LegacyCand[] };
export type FieldNotesTipRow = { key: string; kind: TipSourceKind; label: string; content: string; score: number | null; publishedAt: string | null };
export type FieldNotesRun = { runId: string; at: Date; tips: FieldNotesTipRow[] };
export type Phase2Snapshot = { reels: ReelsNight[]; carousel: CarouselNight[]; fieldNotes: FieldNotesRun[] };

type Json = Record<string, unknown>;
const arr = (v: unknown): Json[] => (Array.isArray(v) ? (v as Json[]) : []);
const str = (v: unknown) => (typeof v === 'string' ? v : null);
const parse = (v: unknown) => (typeof v === 'string' ? (JSON.parse(v) as unknown) : v);

/** Legacy slate: the selected ideas plus the top REELS_TOP by net, each with its member URLs (primary first). */
async function reelsNight(db: IntakeQuery, nyDate: string, runAt: Date): Promise<ReelsNight> {
  const { rows } = await db.query<{ id: string; net: number | null; selected: boolean }>(
    `SELECT s.post_idea_id::text AS id, s.net, s.selected FROM reels.idea_scores s
       JOIN reels.score_slates sl ON sl.id = s.slate_id WHERE sl.ny_date = $1::date
        AND EXISTS (SELECT 1 FROM reels.post_idea_members m JOIN reels.sources src ON src.id = m.source_id
                     WHERE m.post_idea_id = s.post_idea_id AND src.run_id = sl.run_id)`,
    [nyDate],
  );
  const byNet = [...rows].sort((a, b) => (b.net ?? -Infinity) - (a.net ?? -Infinity));
  const picked = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (r.selected) picked.set(r.id, r);
  for (const r of byNet.slice(0, REELS_TOP)) picked.set(r.id, r);
  const ids = [...picked.keys()];
  const members = ids.length
    ? (
        await db.query<{ id: string; url: string; headline: string; role: string }>(
          `SELECT m.post_idea_id::text AS id, src.canonical_url AS url, src.headline, m.role
             FROM reels.post_idea_members m JOIN reels.sources src ON src.id = m.source_id
            WHERE m.post_idea_id = ANY($1::uuid[]) ORDER BY CASE m.role WHEN 'primary' THEN 0 ELSE 1 END, m.joined_at`,
          [ids],
        )
      ).rows
    : [];
  const legacy: ReelsIdea[] = ids.map((id) => {
    const own = members.filter((m) => m.id === id);
    const r = picked.get(id)!;
    return { ideaId: id, headline: own[0]?.headline ?? id, keys: own.map((m) => safeKey(m.url)), net: r.net == null ? null : Number(r.net), selected: r.selected };
  });
  return { nyDate, runAt, legacy };
}

/** A carousel run's selection.scored as articles (the representative carries the enriched body) and its shortlist. */
export function carouselNightFrom(runId: string, at: Date, selection: unknown): CarouselNight {
  const sel = (parse(selection) ?? {}) as Json;
  const articles = new Map<string, CarouselArticle>();
  for (const g of arr(sel.scored)) {
    const rep = (g.representative ?? {}) as Json;
    const repUrl = str(g.id) ?? str(rep.url);
    for (const m of arr(g.members)) {
      const url = str(m.url);
      const headline = str(m.title);
      if (!url || !headline) continue;
      const key = safeKey(url);
      if (articles.has(key)) continue;
      const when = new Date(str(m.publishedAt) ?? at.toISOString());
      articles.set(key, {
        key,
        url,
        headline,
        outlet: str(m.outlet) ?? 'unknown',
        feedSlug: str(m.feedSlug) ?? 'unknown',
        body: url === repUrl ? str(g.body) ?? '' : '',
        publishedAt: Number.isFinite(when.getTime()) ? when : at,
      });
    }
  }
  const shortlist = arr(sel.shortlist)
    .map((g) => ({ url: str(g.id) ?? str(((g.representative ?? {}) as Json).url), headline: str(((g.representative ?? {}) as Json).title) ?? str(arr(g.members)[0]?.title) ?? '' }))
    .filter((g): g is { url: string; headline: string } => !!g.url)
    .map((g) => ({ key: safeKey(g.url), headline: g.headline }));
  return { runId, at, articles: [...articles.values()], shortlist };
}

/** Every real-DB read Phase 2 needs (inside replay.ts's read-only transaction). */
export async function loadPhase2Snapshot(db: IntakeQuery, nights: ReadonlyArray<{ nyDate: string; runAt: Date }>): Promise<Phase2Snapshot> {
  const reels: ReelsNight[] = [];
  for (const n of nights) reels.push(await reelsNight(db, n.nyDate, n.runAt));

  const { rows: runs } = await db.query<{ id: string; at: Date | string; selection: unknown }>(
    `SELECT id::text AS id, finished_at AS at, record->'selection' AS selection FROM social.runs
      WHERE finished_at IS NOT NULL AND finished_at < $1::date AND record->'selection' IS NOT NULL
      ORDER BY finished_at DESC LIMIT $2`,
    [CAROUSEL_BEFORE, CAROUSEL_RUNS],
  );
  const carousel = runs.map((r) => carouselNightFrom(r.id, new Date(r.at), r.selection)).reverse();

  const { rows: fnRuns } = await db.query<{ id: string; started_at: Date | string; finished_at: Date | string }>(
    `SELECT id::text AS id, started_at, finished_at FROM field_notes.runs
      WHERE status IN ('ok', 'partial') AND started_at IS NOT NULL AND finished_at IS NOT NULL
      ORDER BY started_at DESC LIMIT $1`,
    [FIELD_NOTES_RUNS],
  );
  const fieldNotes: FieldNotesRun[] = [];
  for (const r of [...fnRuns].reverse()) {
    const { rows: tips } = await db.query<{ source_url: string; source_kind: TipSourceKind; source_label: string | null; untrusted_content: string | null; score: number | string | null; published_at: Date | string | null }>(
      `SELECT source_url, source_kind, source_label, untrusted_content, score, published_at FROM field_notes.tips
        WHERE source_kind <> 'seed' AND source_url IS NOT NULL AND created_at >= $1 AND created_at <= $2
        ORDER BY created_at`,
      [r.started_at, r.finished_at],
    );
    fieldNotes.push({
      runId: r.id,
      at: new Date(r.started_at),
      tips: tips.map((t) => ({
        key: canonicalSourceUrl(t.source_url),
        kind: t.source_kind,
        label: t.source_label ?? t.source_kind,
        content: t.untrusted_content ?? '',
        score: t.score == null ? null : Number(t.score),
        publishedAt: t.published_at ? new Date(t.published_at).toISOString() : null,
      })),
    });
  }
  return { reels, carousel, fieldNotes };
}

/* ── plan (no Jev, no HTTP) ───────────────────────────────────────────── */

export type Phase2Plan = {
  reels: Array<{ nyDate: string; legacy: number; selected: number }>;
  carousel: Array<{ runId: string; at: Date; articles: number; shortlist: number; calls: number; usd: number }>;
  fieldNotes: Array<{ runId: string; at: Date; tips: number; calls: number; usd: number }>;
  usd: number;
};

export function planPhase2(snap: Phase2Snapshot, fieldNotesSlots = 25): Phase2Plan {
  const carousel = snap.carousel.map((c) => {
    const grouping = c.articles.length * FEED_GROUPING_PER_ARTICLE;
    const scoring = Math.round(c.articles.length * STORY_SCORING_CALLS);
    return { runId: c.runId, at: c.at, articles: c.articles.length, shortlist: c.shortlist.length, calls: grouping + scoring, usd: jevUsd(grouping * GROUPING_TOKENS + scoring * STORY_SCORING_TOKENS) };
  });
  const fieldNotes = snap.fieldNotes.map((f) => {
    const calls = Math.min(f.tips.length, fieldNotesSlots);
    return { runId: f.runId, at: f.at, tips: f.tips.length, calls, usd: jevUsd(calls * FIELD_NOTES_TOKENS) };
  });
  return {
    reels: snap.reels.map((r) => ({ nyDate: r.nyDate, legacy: r.legacy.length, selected: r.legacy.filter((i) => i.selected).length })),
    carousel,
    fieldNotes,
    usd: [...carousel, ...fieldNotes].reduce((s, x) => s + x.usd, 0),
  };
}

const money = (usd: number) => `$${usd.toFixed(4)}`;
const day = (d: Date) => d.toISOString().slice(0, 10);

export function renderPhase2Plan(plan: Phase2Plan): string {
  const L = ['', 'Phase 2 comparisons (same ≥ 80% rule)', '', 'Phase 2: Reels (legacy slate vs the intake path; read on the main replay, no extra Jev)'];
  if (plan.reels.length === 0) L.push('  no slate nights');
  for (const r of plan.reels) L.push(`  ${r.nyDate}: legacy ${r.legacy} new ideas (${r.selected} selected + top ${REELS_TOP} by net)`);
  L.push('', `Phase 2: Carousel (last runs before ${CAROUSEL_BEFORE}: selection.scored articles, legacy shortlist vs intake shortlist)`);
  if (plan.carousel.length === 0) L.push('  no carousel run found');
  for (const c of plan.carousel) L.push(`  ${day(c.at)} run ${c.runId.slice(0, 8)}: ${c.articles} articles, shortlist ${c.shortlist}; Jev ≈ ${c.calls} calls ≈ ${money(c.usd)}`);
  L.push('', 'Phase 2: Field Notes (candidate tips of past runs vs the intake’s field-notes-score)');
  if (plan.fieldNotes.length === 0) L.push('  no Field Notes run found');
  for (const f of plan.fieldNotes) L.push(`  ${day(f.at)} run ${f.runId.slice(0, 8)}: ${f.tips} tips; field-notes-score ≈ ${f.calls} calls ≈ ${money(f.usd)}`);
  L.push('', `Phase 2 total ≈ ${money(plan.usd)} (inside the same --cap).`);
  return L.join('\n');
}

/* ── the comparisons ──────────────────────────────────────────────────── */

export type Phase2Comparison = { label: string; comparison: Comparison; pass: boolean | null; misses?: string[] };
export type Phase2Result = { reels: Phase2Comparison[]; carousel: Phase2Comparison[]; fieldNotes: Phase2Comparison[]; stopped: string | null };

const verdict = (c: Comparison) => (c.pct === null ? null : c.pct >= TARGET);
const asCand = (s: ScoredStory): IntakeCand => ({ storyId: s.id, keys: s.members.map((m) => m.key), headline: s.headline });
const kindOther = () => 'other' as const;

/**
 * Reels on the main replay's store, right after that night was scored: the night's timely reels stories (a kept
 * reels/search member seen in the 26 h before the night's clock), ranked by net, as many as the legacy list.
 */
export async function compareReelsNight(q: IntakeQuery, night: ReelsNight, inStore: (key: string) => boolean): Promise<Phase2Comparison> {
  const since = new Date(night.runAt.getTime() - 26 * HOUR);
  const stories = await listOrderStories(q, REELS_ORDER, { since, needScores: ['reels-score'] });
  const timely = stories.filter((s) => s.members.some((m) => (m.family === 'reels' || m.family === 'search') && m.lastSeenAt >= since && m.lastSeenAt <= night.runAt));
  const ranked = timely.sort((a, b) => (b.scores['reels-score']?.net ?? -Infinity) - (a.scores['reels-score']?.net ?? -Infinity));
  const top = ranked.slice(0, Math.max(REELS_TOP, night.legacy.length));
  const legacy: LegacyCand[] = night.legacy.filter((i) => i.keys.length).map((i) => ({ key: i.keys.find(inStore) ?? i.keys[0]!, headline: i.headline }));
  const comparison = compareLists(legacy, top.map(asCand), inStore, kindOther);
  // Why each in-scope legacy idea is missing from the intake top: rank and net in the intake, or where it fell out.
  const topKeys = new Set(top.flatMap((s) => s.members.map((m) => m.key)));
  const all = await listOrderStories(q, REELS_ORDER, { since });
  const misses: string[] = [];
  for (const idea of night.legacy) {
    const keys = idea.keys.filter(inStore);
    if (keys.length === 0 || keys.some((k) => topKeys.has(k))) continue;
    const has = (s: ScoredStory) => s.members.some((m) => keys.includes(m.key));
    const rank = ranked.findIndex(has);
    const scored = stories.find(has);
    const why =
      rank >= 0
        ? `intake rank ${rank + 1} of ${ranked.length}, net ${ranked[rank]!.scores['reels-score']?.net?.toFixed(2) ?? '?'}`
        : scored
          ? 'scored but not timely in the intake'
          : all.some(has)
            ? 'in the pool without a reels-score (screened out or unscored)'
            : 'not in the reels pool (dropped or grouped away)';
    misses.push(`${idea.headline} (legacy net ${idea.net?.toFixed(2) ?? '?'}${idea.selected ? ', selected' : ''}): ${why}`);
  }
  return { label: night.nyDate, comparison, pass: verdict(comparison), misses };
}

export type Phase2Deps = {
  /** A fresh in-memory intake store per comparison (replay.ts memoryIntake; never the real DB). */
  store: () => Promise<{ q: IntakeQuery; close: () => Promise<void> }>;
  /** The replay's capped intake Jev (its cap covers Phase 1 and Phase 2 together). */
  jev: IntakeJev & { capHit?: boolean };
  storyScoring?: Scorecard;
  fieldNotes?: Scorecard;
  /** Field Notes' MAX_SCORED_PER_RUN (default 25). */
  fieldNotesSlots?: number;
  log?: (line: string) => void;
};

/** One carousel run: its articles as feed items, grouped and story-scored; intake shortlist = top qualified by probSum. */
async function compareCarouselRun(run: CarouselNight, deps: Phase2Deps): Promise<Phase2Comparison> {
  const store = await deps.store();
  try {
    const q = store.q;
    const { rows } = await q.query<{ id: string }>(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('manual', 'running', $1) RETURNING id::text AS id`, [run.at]);
    const runId = rows[0]!.id;
    for (const a of run.articles) {
      await upsertItem(
        q,
        { key: a.key, family: 'feeds', sourceId: `feed:${a.feedSlug}`, sourceName: a.outlet, sourceType: 'feed', headline: a.headline, body: a.body, url: a.url, publishTime: a.publishedAt, dropReason: null, runId },
        new Date(Math.min(a.publishedAt.getTime(), run.at.getTime())),
      );
    }
    const grouping: GroupingResult = { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0, touched: new Set(), failures: [] };
    await groupIntake(q, deps.jev.asReelsRunner(), runId, run.at, grouping);
    const stories = await loadStories(q, [...grouping.touched]);
    await scoreForStories(q, deps.jev, stories, [CAROUSEL_ORDER], [deps.storyScoring ?? STORY_SCORING], { log: deps.log });
    const scored = await listOrderStories(q, CAROUSEL_ORDER, { since: new Date(run.at.getTime() - 7 * DAY), needScores: ['story-scoring'] });
    const qualified = scored
      .filter((s) => s.scores['story-scoring']?.status === 'qualified')
      .sort((a, b) => (b.scores['story-scoring']?.probSum ?? 0) - (a.scores['story-scoring']?.probSum ?? 0))
      .slice(0, Math.max(run.shortlist.length, 1));
    const keys = new Set(run.articles.map((a) => a.key));
    const comparison = compareLists(run.shortlist, qualified.map(asCand), (k) => keys.has(k), kindOther);
    return { label: `${day(run.at)} carousel ${run.runId.slice(0, 8)}`, comparison, pass: verdict(comparison) };
  } finally {
    await store.close();
  }
}

/** The registry entry a stored tip came from (by label), so the item keeps its source id; enrichment off (stored tips were enriched). */
function entryFor(label: string): { id: string; enrich: null } {
  const entry = SOURCE_REGISTRY.find((e) => e.label === label);
  return { id: entry?.id ?? label.toLowerCase().replace(/[^a-z0-9]+/g, '-'), enrich: null };
}

/** One Field Notes run: its saved candidate tips as Field Notes items, scored (per-run cap); legacy top vs intake top. */
async function compareFieldNotesRun(run: FieldNotesRun, deps: Phase2Deps): Promise<Phase2Comparison> {
  const store = await deps.store();
  try {
    const q = store.q;
    const { rows } = await q.query<{ id: string }>(`INSERT INTO intake.runs (kind, status, started_at) VALUES ('manual', 'running', $1) RETURNING id::text AS id`, [run.at]);
    const runId = rows[0]!.id;
    for (const t of run.tips) {
      const candidate: TipCandidate = { sourceUrl: t.key, sourceKind: t.kind, sourceLabel: t.label, publishedAt: t.publishedAt, item: {} as TipCandidate['item'], untrustedContent: t.content };
      await storeFieldNotesCandidate(q, candidate, entryFor(t.label), run.at, runId);
    }
    const grouping: GroupingResult = { created: 0, joined: 0, merges: 0, pairCalls: 0, cacheHits: 0, touched: new Set(), failures: [] };
    await groupIntake(q, deps.jev.asReelsRunner(), runId, run.at, grouping);
    const card = deps.fieldNotes ?? FIELD_NOTES_CARD;
    const stories = await loadStories(q, [...grouping.touched]);
    const pick = await pickFieldNotesStories(q, stories, card, deps.fieldNotesSlots ?? 25);
    await scoreForStories(q, deps.jev, pick.selected, [FIELD_NOTES_ORDER], [card], { log: deps.log });
    const scored = await listOrderStories(q, FIELD_NOTES_ORDER, { since: new Date(run.at.getTime() - DAY), needScores: ['field-notes-score'] });
    const score = (s: ScoredStory) => s.scores['field-notes-score']?.score ?? 0;
    const intakeTop = scored.filter((s) => score(s) > 0).sort((a, b) => score(b) - score(a)).slice(0, REELS_TOP);
    const legacyTop = run.tips
      .filter((t) => (t.score ?? 0) > 0)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, REELS_TOP)
      .map((t) => ({ key: t.key, headline: t.content.split('\n')[0]!.slice(0, 120) }));
    const keys = new Set(run.tips.map((t) => t.key));
    const comparison = compareLists(legacyTop, intakeTop.map(asCand), (k) => keys.has(k), kindOther);
    return { label: `${day(run.at)} Field Notes ${run.runId.slice(0, 8)} (${pick.deferred.length} left for a later run)`, comparison, pass: verdict(comparison) };
  } finally {
    await store.close();
  }
}

/** Carousel and Field Notes comparisons (Reels runs inside the main replay: compareReelsNight). Stops at the cap. */
export async function runPhase2(snap: Phase2Snapshot, deps: Phase2Deps): Promise<Phase2Result> {
  const result: Phase2Result = { reels: [], carousel: [], fieldNotes: [], stopped: null };
  try {
    for (const run of snap.carousel) {
      if (deps.jev.capHit) throw new Error('the replay cap is spent');
      result.carousel.push(await compareCarouselRun(run, deps));
    }
    for (const run of snap.fieldNotes) {
      if (deps.jev.capHit) throw new Error('the replay cap is spent');
      result.fieldNotes.push(await compareFieldNotesRun(run, deps));
    }
  } catch (error) {
    result.stopped = error instanceof Error ? error.message : String(error);
    deps.log?.(`[replay] Phase 2 stopped: ${result.stopped}`);
  }
  return result;
}

export function renderPhase2Report(r: Phase2Result): string {
  const pct = (c: Comparison) => (c.pct === null ? 'n/a' : `${Math.round(c.pct * 100)}%`);
  const line = (x: Phase2Comparison) =>
    `| ${x.label} | ${x.comparison.inScope} | ${x.comparison.matched} | ${pct(x.comparison)} | ${x.pass === null ? '–' : x.pass ? 'pass' : 'FAIL'} | ${x.comparison.legacyOnly.slice(0, 5).join('; ').replace(/\|/g, '/')} |`;
  const L = ['## Phase 2 comparisons', ''];
  for (const [title, rows] of [['Reels', r.reels], ['Carousel', r.carousel], ['Field Notes', r.fieldNotes]] as const) {
    L.push(`### Phase 2: ${title}`, '', '| run | legacy in scope | matched | overlap | ≥ 80% | legacy only (first 5) |', '|---|---|---|---|---|---|');
    if (rows.length === 0) L.push('| (none) | | | | | |');
    for (const x of rows) L.push(line(x));
    L.push('');
    for (const x of rows) if (x.misses?.length) L.push(`${x.label} misses:`, ...x.misses.map((m) => `- ${m.replace(/\|/g, '/')}`), '');
  }
  if (r.stopped) L.push(`Stopped: ${r.stopped}`, '');
  return L.join('\n');
}
