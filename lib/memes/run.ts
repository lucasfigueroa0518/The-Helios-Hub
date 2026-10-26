/**
 * One Generate click, start to finish (BUILD_PLAN M4–M5, UPGRADE_PLAN U4–U5):
 * claim the request, read the story, ask the 90-day gate which templates are
 * free, write (turns first, then memes from each turn's short list), render
 * every candidate (dropping any that fail fit or faces), judge, rank by the
 * calibrated score, keep 3 on 3 templates from at least two turns, save.
 * Every candidate is saved with why it was or wasn't kept, and the turns are
 * saved on the slate, so a run can always be read back. Nothing publishes.
 *
 * All model calls come in as dependencies: tests pass canned ones, and only
 * a person's click starts a live run (CLAUDE.md Rule 1).
 */
import fs from 'node:fs';
import path from 'node:path';

import { capped, createJevTally, tallied, type JevAsk } from '@/lib/social/jev/client';
import type { MessagesCreate } from '@/lib/social/reporter/reporter';

import { CostMeter, MEME_SPEND_CAP_USD } from './cost';
import type { MemesDb, Queryable } from './db';
import { resolveMeme } from './fill';
import { availableTemplates } from './gate';
import { chooseSlate, judgeCandidates, verdict, type Candidate, type JudgeScores } from './judges';
import { storyFeatures, turnFeatures } from './predict';
import { regimeId } from './regime';
import type { MemeRenderer } from './render';
import type { MemeStory } from './story';
import type { Coverage } from './turns';
import { writeMemes, writeMoreMemes, type Mapping, type WriterOutput } from './writer';

export const RENDER_DIR = path.join(process.cwd(), '.memes-local', 'renders');

/** Which pipeline wrote a slate, saved on it so the lab can compare versions (UPGRADE_PLAN U0; v4 = golden cards, GOLDEN_SET.md; v5 = headline-visible, UPGRADE_V5_PLAN.md). */
export const MEME_PIPELINE = 'v5';

/** The regime fingerprint (lib/memes/regime.ts), computed once per process: the code it hashes doesn't change while it runs. */
let regimeMemo: string | null = null;
const currentRegime = () => (regimeMemo ??= regimeId());

/** How many recent lab slates the matcher looks back over to spread templates. */
export const RECENT_SLATES = 12;

export type RunDeps = {
  db: MemesDb;
  create: MessagesCreate;
  jev: JevAsk;
  renderer: MemeRenderer;
  loadStory: (postId: string) => Promise<MemeStory | null>;
  /** Landscape memes (M6): blue-chip stories since a date, each with its facts. */
  loadPool?: (since: Date) => Promise<MemeStory[]>;
  /** Spread: load specific LFD stories (must already have briefs). */
  loadStories?: (ids: string[]) => Promise<MemeStory[]>;
  renderDir?: string;
  now?: () => Date;
};

export type RequestKind = 'single' | 'landscape' | 'spread';
export type RequestRow = { id: string; kind: RequestKind; post_id: string | null; storyIds?: string[] };

/** Take the oldest waiting request, or null. One runner at a time owns a request. */
export async function claimRequest(db: Queryable): Promise<RequestRow | null> {
  const { rows } = await db.query<RequestRow & { detail: { storyIds?: string[] } | null }>(
    `UPDATE memes.requests SET status = 'running', started_at = now(), stage = 'starting'
      WHERE id = (SELECT id FROM memes.requests WHERE status = 'requested' ORDER BY requested_at LIMIT 1 FOR UPDATE SKIP LOCKED)
      RETURNING id, kind, post_id, detail`,
  );
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, kind: row.kind, post_id: row.post_id, storyIds: row.detail?.storyIds };
}

export const stage = (db: Queryable, id: string, name: string) => db.query(`UPDATE memes.requests SET stage = $2 WHERE id = $1`, [id, name]);

export async function finish(db: Queryable, id: string, status: 'ok' | 'failed', costUsd: number, error: string | null, detail: Record<string, unknown>) {
  await db.query(
    `UPDATE memes.requests SET status = $2, finished_at = now(), stage = NULL, cost_usd = $3, error = $4, detail = $5::jsonb WHERE id = $1`,
    [id, status, costUsd.toFixed(6), error, JSON.stringify(detail)],
  );
}

type Outcome = {
  mapping: Mapping;
  candidate: Candidate | null;
  scores: JudgeScores | null;
  dropped: string | null;
  /** The only bar it missed is a soft one (clarity). */
  soft?: boolean;
  /** Shown although it missed a soft bar, because fewer than two passed (ME-95). */
  belowBar: string | null;
  imagePath: string | null;
};

/** Run one claimed single-story request to the end. Never throws: a failure is written to the request. */
export async function runSingleRequest(deps: RunDeps, req: RequestRow): Promise<void> {
  const meter = new CostMeter(MEME_SPEND_CAP_USD);
  try {
    if (!req.post_id) throw new Error('a single-story request needs a post id');
    await stage(deps.db, req.id, 'reading the story');
    const story = await deps.loadStory(req.post_id);
    if (!story) throw new Error(`post ${req.post_id} has no Reporter brief`);
    const { free, blocked } = await availableTemplates(deps.db, deps.now?.() ?? new Date());
    if (!free.length) throw new Error('every template is on its 90-day cooldown');

    await produceSlate(deps, req, { story, free, blocked, meter, kind: 'single', slateStories: [{ postId: story.postId, title: story.title }] });
  } catch (err) {
    await finish(deps.db, req.id, 'failed', meter.spent, err instanceof Error ? err.message : String(err), {}).catch(() => {});
  }
}

export type SlateContext = {
  story: MemeStory;
  free: string[];
  blocked: Array<{ id: string; reason: string }>;
  meter: CostMeter;
  kind: RequestKind;
  slateStories: unknown[];
  /** Extra lines for the writer (a landscape's relation). */
  note?: string;
  extraShape?: Record<string, unknown>;
  /** Drops a written meme before rendering when it returns a reason (a landscape meme drawing on one story). */
  filterMapping?: (m: Mapping) => string | null;
  /** Spread and landscape turns must draw on several stories. */
  coverage?: Coverage;
};

/** How often each template sat in the last RECENT_SLATES lab slates, so no template becomes the default. */
export async function recentTemplates(db: Queryable): Promise<Map<string, number>> {
  const { rows } = await db.query<{ template_id: string; n: number }>(
    `SELECT m.template_id, count(*)::int AS n FROM memes.memes m
      WHERE m.in_slate AND m.slate_id IN (SELECT id FROM memes.slates ORDER BY created_at DESC LIMIT ${RECENT_SLATES})
      GROUP BY m.template_id`,
  );
  return new Map(rows.map((r) => [r.template_id, Number(r.n)]));
}

/** The turns as the slate keeps them: every submitted turn, kept or dropped with why. */
function turnsForShape(out: WriterOutput) {
  const kept = new Map(out.turns.kept.map((t) => [t.id, t]));
  return out.turns.all.map((a) => {
    const t = kept.get(a.id);
    return {
      id: a.id, type: a.type, summary: a.summary, strength: a.strength, kept: Boolean(t),
      dropped: t ? (out.unmatched.includes(t.id) ? 'no free template carries it' : null) : a.errors.slice(0, 2).join('; ') || 'not kept',
      ...(t ? { beats: t.beats, touchesViewer: t.touchesViewer, templates: out.lists.find((l) => l.turn.id === t.id)?.cards.map((c) => c.id) ?? [] } : {}),
    };
  });
}

/** Lines the follow-up call reads: what didn't make it and why. */
const failedLine = (o: Outcome) => `${o.mapping.templateId}: ${o.dropped ?? 'dropped'}`;

/**
 * Write, render, judge and choose for one story (or one merged landscape
 * story), then finish the request. There is always a slate (ME-90): when
 * fewer than two memes clear the bars, the writer is asked once for more
 * drafts (ME-95), and if still short, memes that missed only a soft
 * (calibrated) bar are shown, marked as below the bar. The calibrated score
 * ranks; Jev's pairwise funny no longer does (ME-106).
 */
export async function produceSlate(deps: RunDeps, req: RequestRow, ctx: SlateContext): Promise<void> {
  const { story, free, blocked, meter } = ctx;
  const renderDir = deps.renderDir ?? RENDER_DIR;
  const tally = createJevTally();
  const jev = capped(tallied(deps.jev, tally), tally, Math.max(0, meter.cap - meter.spent));
  const outcomes: Outcome[] = [];
  const scores = new Map<number, JudgeScores>();

  /** Render and judge a batch of written memes, appending them to the outcomes. */
  const evaluate = async (mappings: Mapping[]) => {
    const batch: Outcome[] = mappings.map((mapping) => ({ mapping, candidate: null, scores: null, dropped: ctx.filterMapping?.(mapping) ?? null, belowBar: null, imagePath: null }));
    const base = outcomes.length;
    outcomes.push(...batch);
    await stage(deps.db, req.id, 'rendering');
    const specs = batch.map((o) => resolveMeme(o.mapping.fill));
    const todo = batch.flatMap((o, i) => (o.dropped ? [] : [i]));
    const renders = await deps.renderer.render(todo.map((i) => specs[i]!));
    fs.mkdirSync(renderDir, { recursive: true });
    todo.forEach((i, n) => {
      const o = batch[i]!;
      const r = renders[n]!;
      if (r.problems.length) {
        o.dropped = `render: ${r.problems.join('; ')}`;
        return;
      }
      const file = path.join(renderDir, `${req.id}-${base + i}.png`);
      fs.writeFileSync(file, r.png);
      o.imagePath = path.relative(process.cwd(), file);
      o.candidate = { index: base + i, mapping: o.mapping, spec: specs[i]! };
    });
    await stage(deps.db, req.id, 'judging');
    const judged = await judgeCandidates(jev, story, batch.flatMap((o) => (o.candidate ? [o.candidate] : [])));
    for (const o of batch) {
      if (!o.candidate) continue;
      o.scores = judged.get(o.candidate.index) ?? null;
      if (o.scores) scores.set(o.candidate.index, o.scores);
      const v = o.scores ? verdict(o.scores) : { reason: 'not judged', soft: false };
      if (v) {
        o.dropped = `judges: ${v.reason}`;
        o.soft = v.soft;
      }
    }
  };
  const passing = () => outcomes.filter((o) => o.candidate && !o.dropped);

  await stage(deps.db, req.id, 'writing');
  const recent = await recentTemplates(deps.db);
  const written = await writeMemes({ create: deps.create, story, freeTemplates: free, meter, note: ctx.note, kind: ctx.kind, recent, coverage: ctx.coverage });
  if (!written.ok) {
    const turns = written.turns?.all.map((a) => ({ id: a.id, type: a.type, summary: a.summary, errors: a.errors })) ?? [];
    await finish(deps.db, req.id, 'failed', meter.spent, `writer: ${written.reason}: ${written.detail}`, { turns });
    return;
  }
  const writerDropped = [...written.output.dropped];
  await evaluate(written.output.mappings);

  // Fewer than two cleared the bars: one more call, on the same conversation, for new drafts.
  let extraCall = false;
  if (passing().length < 2) {
    await stage(deps.db, req.id, 'writing more');
    const failed = [...writerDropped.map((d) => `${d.templateId}: ${d.errors.join('; ')}`), ...outcomes.filter((o) => o.dropped).map(failedLine)];
    const more = await writeMoreMemes({ create: deps.create, story, freeTemplates: free, meter, kind: ctx.kind, recent, coverage: ctx.coverage, session: written.session, failed });
    extraCall = true;
    if (more.ok) {
      writerDropped.push(...more.output.dropped);
      await evaluate(more.output.mappings);
    }
  }

  // Still short: show the memes that missed only a soft (calibrated) bar, marked, so there are two to look at.
  const passed = passing().flatMap((o) => (o.candidate ? [o.candidate] : []));
  const shown = [...passed];
  const soft = outcomes.filter((o) => o.candidate && o.soft).sort((a, b) => (b.scores?.score ?? 0) - (a.scores?.score ?? 0));
  for (const o of soft) {
    if (shown.length >= 2) break;
    if (shown.some((c) => c.mapping.templateId === o.mapping.templateId)) continue;
    o.belowBar = o.dropped;
    o.dropped = null;
    shown.push(o.candidate!);
  }
  meter.add(tally.costUsd);

  const ranked = chooseSlate(shown, scores, { checked: true });
  const slateId = await insertSlate(deps.db, req.id, ctx.kind, ctx.slateStories, {
    ...ctx.extraShape, pipeline: MEME_PIPELINE, regime: currentRegime(), turns: turnsForShape(written.output), weakTurn: written.output.weakTurn,
    blocked, dropped: writerDropped, extraCall,
    // The predictor's inputs, from the story and the kept turns only (planning/Memes/PREDICTOR.md).
    predictor: { story: storyFeatures(story), turns: turnFeatures(turnsForShape(written.output)) },
  });
  await saveMemes(deps.db, slateId, outcomes, ranked);
  await finish(deps.db, req.id, 'ok', meter.spent, null, { slateId, memes: ranked.length, candidates: outcomes.length, jevCalls: tally.calls, extraCall });
}

export async function insertSlate(db: Queryable, requestId: string, kind: RequestKind, stories: unknown[], shape: Record<string, unknown>): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO memes.slates (request_id, kind, stories, shape) VALUES ($1, $2, $3::jsonb, $4::jsonb) RETURNING id`,
    [requestId, kind, JSON.stringify(stories), JSON.stringify(shape)],
  );
  return rows[0]!.id;
}

async function saveMemes(db: Queryable, slateId: string, outcomes: Outcome[], slate: Candidate[]) {
  for (const o of outcomes) {
    const rank = o.candidate ? slate.findIndex((c) => c.index === o.candidate!.index) : -1;
    await db.query(
      `INSERT INTO memes.memes (slate_id, template_id, in_slate, rank, situation_id, mapping, judges, image_path) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8)`,
      [
        slateId, o.mapping.templateId, rank >= 0, rank >= 0 ? rank + 1 : null, o.mapping.situationId,
        JSON.stringify(o.mapping), JSON.stringify({ ...(o.scores ?? {}), belowBar: o.belowBar, dropped: o.dropped ?? (rank < 0 && o.candidate ? 'ranked below the slate' : null) }), o.imagePath,
      ],
    );
  }
}

/** Claim and run the next waiting request, if any. Returns whether one ran. */
export async function processNextRequest(deps: RunDeps): Promise<boolean> {
  const req = await claimRequest(deps.db);
  if (!req) return false;
  if (req.kind === 'single') await runSingleRequest(deps, req);
  else if (req.kind === 'spread') {
    const { runSpreadRequest } = await import('./spread');
    await runSpreadRequest(deps, req);
  } else {
    const { runLandscapeRequest } = await import('./landscape');
    await runLandscapeRequest(deps, req);
  }
  return true;
}
