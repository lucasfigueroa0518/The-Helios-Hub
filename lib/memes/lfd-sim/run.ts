/**
 * One simulated Last Few Days post with memes (LFD lab plan §5), the way the
 * future pipeline would make it:
 *   1. lfd     Tommy's engine (unchanged) on a window as of now or a past date; writes stay local.
 *   2. tags    Jev tags every story in the post (story-tags.ts).
 *   3. gate    the odds from the graded stories (odds.ts); the top 3 at or above the threshold get slates.
 *   4. briefs  a body brief for each gated story (the existing brief-from-body step).
 *   5. memes   the existing single-story meme run for each, unchanged (they count as v5 runs).
 *   6. pick    the slate's #1 is the story's meme (ME-134); Jev's fault counts are saved for reference (faults.ts).
 *   7. render  the placement (lfd-placement.ts) and the post re-rendered with the memes.
 * Every dependency is injected, so the tests run it offline. Live, stages 1 and 7 run in a child Node
 * process (child.ts, live.ts): the slide renderer can't run inside the Next.js server.
 */
import fs from 'node:fs';
import path from 'node:path';

import type { LfdRunDeps } from '@/lib/lfd/run';
import { runLastFewDays } from '@/lib/lfd/run';
import type { JevAsk } from '@/lib/social/jev/client';
import type { FitCheck } from '@/lib/social/render/fit-check';
import type { HubQuery } from '@/lib/social-hub/db';

import type { MemesDb, Queryable } from '../db';
import { faultSubject, scoreManyFaults } from '../faults';
import type { MemeFill } from '../fill';
import { placeMemes } from '../lfd-placement';
import { fitOdds, gate } from '../odds';
import { getSettings, loadFaults, loadStoryTags, oddsRows, saveFaults, saveStoryTags } from '../odds-store';
import { tagStories, TAGGER_VERSION } from '../story-tags';

import { postWithMemes, type MemeImage, type SavedStory } from './post';
import { reporter, tap, type Progress } from './report';
import { simQuery } from './router';

export const SIM_DIR = path.join(process.cwd(), '.memes-local', 'lfd-sim');
export const LFD_CAP_USD = 1;
/** Rough cost of one simulated post, shown before Run (LFD about $0.50, up to 3 × (brief $0.04 + memes $0.12), Jev). */
export const SIM_ESTIMATE_USD = 1.0;
/** Long enough for three simulations' meme runs queued behind each other (about 9 runs). */
const MEME_WAIT_MS = 45 * 60_000;
/** Simulations queued or running at once. */
export const MAX_QUEUED = 3;

/** What the engine stage hands back: the original post as lfd.posts saved it, the article texts it read, its spend. */
export type EngineResult =
  | {
      ok: true; postId: string; stories: SavedStory[]; render: unknown; caption: string;
      /** Slide files under the sim folder, cover first. */
      slides: string[]; fitProblems: string[]; renderProblems: string[];
      /** Full article text by URL, for the meme briefs. */
      bodies: Record<string, string>; spentUsd: number;
    }
  | { ok: false; error: string; spentUsd: number };

/**
 * Stage 1: Tommy's engine. Live, it runs in a child Node process (child.ts): its slide render can't run inside
 * the Next.js server, which treats the slide template as browser code. Tests run it in-process (inProcessEngine).
 */
export type Engine = (o: { asOf: Date; replay: boolean; dir: string; onProgress?: (p: Progress) => void }) => Promise<EngineResult>;

export type SimDeps = {
  db: MemesDb;
  engine: Engine;
  jev: JevAsk;
  /** Body briefs for these lab story ids (memes.lfd_stories); returns what they cost. */
  briefs: (ids: string[]) => Promise<number>;
  /** Wake the meme runner after requests are queued. */
  kickMemes: () => void;
  /** Stage 7's render (live: in a child process, like the engine). */
  fitCheck: FitCheck;
  regime: string;
  now: () => Date;
  sleep?: (ms: number) => Promise<void>;
};

/**
 * The engine in this process, over a local database for its writes (lfd.runs, lfd.posts) and the Hub for its reads.
 * `lfdDeps` is Tommy's live wiring (lib/lfd/live.ts) or a test stub.
 */
export function inProcessEngine(o: {
  local: Queryable;
  hub: HubQuery;
  lfdDeps: (x: { capUsd: number; now: Date }) => Promise<{ deps: LfdRunDeps; spentUsd: () => number }>;
}): Engine {
  return async ({ asOf, replay, dir, onProgress }) => {
    fs.mkdirSync(path.join(dir, 'original'), { recursive: true });
    await o.local.query(`UPDATE lfd.runs SET status = 'failed', finished_at = now(), stop_reason = 'abandoned' WHERE status = 'running'`);
    const live = await o.lfdDeps({ capUsd: LFD_CAP_USD, now: asOf });
    const bodies: Record<string, string> = {};
    const deps: LfdRunDeps = tap({
      ...live.deps,
      query: simQuery(o.local, o.hub),
      now: asOf,
      trigger: 'manual',
      replay,
      fetchFeeds: replay ? async () => [] : live.deps.fetchFeeds,
      fetchBody: async (url) => {
        const text = await live.deps.fetchBody(url);
        if (text) bodies[url] = text;
        return text;
      },
      upload: async (objectPath, body) => {
        fs.writeFileSync(path.join(dir, 'original', path.basename(objectPath)), body);
      },
    }, onProgress ?? (() => undefined), live.spentUsd);
    // A replay reads no feeds (they only know the last 48 hours): set after the tap so the report doesn't claim it.
    if (replay) deps.fetchFeeds = async () => [];
    const result = await runLastFewDays(deps);
    if (!result.ok) return { ok: false, error: result.error, spentUsd: live.spentUsd() };
    const { rows } = await o.local.query<{ stories: SavedStory[]; render: unknown; caption: string; slide_objects: string[]; fit_problems: string[]; render_problems: string[] }>(
      `SELECT stories, render, caption, slide_objects, fit_problems, render_problems FROM lfd.posts WHERE id = $1`,
      [result.postId],
    );
    const post = rows[0]!;
    // A story whose stored text was already long enough was never fetched: read it now for its brief.
    for (const s of post.stories) {
      if (bodies[s.url]) continue;
      const text = await live.deps.fetchBody(s.url).catch(() => null);
      if (text) bodies[s.url] = text;
    }
    return {
      ok: true, postId: result.postId, stories: post.stories, render: post.render, caption: post.caption,
      slides: post.slide_objects.map((x) => `original/${path.basename(x)}`), fitProblems: post.fit_problems, renderProblems: post.render_problems,
      bodies, spentUsd: live.spentUsd(),
    };
  };
}

type SimRow = { id: string; as_of: string; replay: boolean };

const stage = (db: MemesDb, id: string, s: string) => db.query(`UPDATE memes.lfd_sims SET stage = $2 WHERE id = $1`, [id, s]);

export async function requestSim(db: Queryable, o: { asOf: Date | null; by: string | null }, now = new Date()): Promise<string> {
  // Simulations queue; the runner works on up to SIM_PARALLEL at once (live.ts). A cap keeps a stuck queue from piling up spend.
  const { rows: busy } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM memes.lfd_sims WHERE status IN ('requested', 'running')`);
  if (busy[0]!.n >= MAX_QUEUED) throw new Error(`${busy[0]!.n} simulations are already queued or running.`);
  const asOf = o.asOf ?? now;
  if (asOf.getTime() > now.getTime() + 60_000) throw new Error('The as-of date is in the future.');
  const replay = o.asOf !== null && now.getTime() - asOf.getTime() > 6 * 3600_000;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO memes.lfd_sims (as_of, replay, requested_by) VALUES ($1, $2, $3) RETURNING id::text`,
    [asOf.toISOString(), replay, o.by],
  );
  return rows[0]!.id;
}

export async function claimSim(db: Queryable): Promise<SimRow | null> {
  const { rows } = await db.query<SimRow>(
    `UPDATE memes.lfd_sims SET status = 'running', stage = 'lfd', started_at = now()
      WHERE id = (SELECT id FROM memes.lfd_sims WHERE status = 'requested' ORDER BY requested_at LIMIT 1)
      RETURNING id::text, as_of::text, replay`,
  );
  return rows[0] ?? null;
}

async function waitForRequests(d: SimDeps, ids: string[], onChange: (r: { id: string; status: string; stage: string | null; cost: number }) => void): Promise<void> {
  const sleep = d.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const start = Date.now();
  const seen = new Map<string, string>();
  for (;;) {
    const { rows } = await d.db.query<{ id: string; status: string; stage: string | null; cost: number }>(
      `SELECT id::text, status, stage, cost_usd::float8 AS cost FROM memes.requests WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    for (const r of rows) {
      const k = `${r.status}/${r.stage ?? ''}`;
      if (seen.get(r.id) !== k) {
        seen.set(r.id, k);
        onChange(r);
      }
    }
    if (rows.every((r) => r.status !== 'requested' && r.status !== 'running')) return;
    if (Date.now() - start > MEME_WAIT_MS) throw new Error('The meme runs did not finish in 45 minutes.');
    await sleep(2000);
  }
}

/**
 * A meme render is the template on a white 1080×1350 canvas (render.ts); placed in a post, only the template shows.
 * Two per-side cleanups so the meme sits on the slide's dark ground without a stray white edge:
 *  - a clean off-white frame (a solid light band, then a sharp edge into the picture) that some template images
 *    carry, which JPEG noise keeps past the trim, is cut;
 *  - a white-ground meme (a white-background template such as Buff Doge) gets a little of its own white back on
 *    each side its text touches, so the text breathes.
 */
export async function trimLetterbox(png: Buffer): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const trimmed = await sharp(png).trim({ background: '#ffffff', threshold: 8 }).png().toBuffer().catch(() => png);
  const { data, info } = await sharp(trimmed).raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  const light = (x: number, y: number) => {
    const i = (y * w + x) * c;
    return Math.min(data[i]!, data[i + 1]!, data[i + 2]!) >= FRAME_LIGHT;
  };
  const share = (n: number, at: (k: number) => boolean) => {
    let hits = 0;
    for (let k = 0; k < n; k++) if (at(k)) hits++;
    return hits / n;
  };
  const lines = {
    top: (i: number) => share(w, (x) => light(x, i)),
    bottom: (i: number) => share(w, (x) => light(x, h - 1 - i)),
    left: (i: number) => share(h, (y) => light(i, y)),
    right: (i: number) => share(h, (y) => light(w - 1 - i, y)),
  };
  type Side = keyof typeof lines;
  const sides = Object.keys(lines) as Side[];
  const cap = (k: Side) => Math.round((k === 'top' || k === 'bottom' ? h : w) * FRAME_MAX);
  /** The frame's depth on a side: solid light lines, then the picture within FRAME_EDGE lines; else 0. */
  const frameDepth = (k: Side) => {
    let band = 0;
    while (band <= cap(k) && lines[k](band) >= 0.98) band++;
    if (band === 0) return 0;
    for (let i = band; i < band + FRAME_EDGE && i <= cap(k); i++) if (lines[k](i) < 0.5) return i;
    return 0;
  };
  const cut = Object.fromEntries(sides.map((k) => [k, frameDepth(k)])) as Record<Side, number>;
  const padBy = Math.round(WHITE_PAD * Math.max(w, h));
  // Content touches the edge: a mostly light edge with a few inked pixels in its outer two lines (noise-white has none).
  const inked = (x: number, y: number) => {
    const i = (y * w + x) * c;
    return Math.min(data[i]!, data[i + 1]!, data[i + 2]!) < 240;
  };
  const inkOn = {
    top: (i: number) => share(w, (x) => inked(x, i)) * w,
    bottom: (i: number) => share(w, (x) => inked(x, h - 1 - i)) * w,
    left: (i: number) => share(h, (y) => inked(i, y)) * h,
    right: (i: number) => share(h, (y) => inked(w - 1 - i, y)) * h,
  };
  // Only a meme on a white ground (its outer ring nearly all light, as Buff Doge or Marked Safe) gets white back; a
  // picture meme whose light edge is touched by art (Bike Fall, Drake) would read as a white border.
  const ringW = Math.max(1, Math.round(Math.min(w, h) * WHITE_RING));
  let ringLight = 0;
  let ringAll = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x >= ringW && x < w - ringW && y >= ringW && y < h - ringW) {
        x = w - ringW - 1;
        continue;
      }
      ringAll++;
      if (light(x, y)) ringLight++;
    }
  }
  const whiteGround = ringLight / ringAll >= WHITE_GROUND;
  const touches = (k: Side) => whiteGround && inkOn[k](0) + inkOn[k](1) >= 3;
  const pad = Object.fromEntries(sides.map((k) => [k, !cut[k] && touches(k) ? padBy : 0])) as Record<Side, number>;
  if (sides.every((k) => !cut[k] && !pad[k])) return trimmed;
  let img = sharp(trimmed);
  if (sides.some((k) => cut[k])) {
    img = sharp(await img.extract({ left: cut.left, top: cut.top, width: w - cut.left - cut.right, height: h - cut.top - cut.bottom }).png().toBuffer());
  }
  if (sides.some((k) => pad[k])) img = img.extend({ ...pad, background: '#ffffff' });
  return img.png().toBuffer();
}
/** A frame pixel: every channel at least this light. */
const FRAME_LIGHT = 225;
/** The deepest frame cut, as a share of the side. */
const FRAME_MAX = 0.04;
/** A frame ends in a sharp edge: the picture starts within this many lines of the solid band. */
const FRAME_EDGE = 3;
/** The white given back on a side where white-ground content touches the edge, as a share of the longer side. */
const WHITE_PAD = 0.03;
/** The outer ring read to tell a white-ground meme, as a share of the shorter side, and how light it must be. */
const WHITE_RING = 0.03;
const WHITE_GROUND = 0.85;

/** A trimmed meme as the post renders it: a data URL and its width / height. */
export async function memeImageOf(png: Buffer): Promise<{ url: string; aspect?: number }> {
  const sharp = (await import('sharp')).default;
  const { width, height } = await sharp(png).metadata().catch(() => ({ width: undefined, height: undefined }));
  return { url: `data:image/png;base64,${png.toString('base64')}`, ...(width && height ? { aspect: width / height } : {}) };
}

const textOf = (s: SavedStory) => [s.setup, s.body].filter(Boolean).join(' ');

/** Run one claimed simulation to the end. Never throws: a failure is saved on the row. */
export async function runSim(d: SimDeps, sim: SimRow): Promise<void> {
  const dir = path.join(SIM_DIR, sim.id);
  const record: Record<string, unknown> = {};
  let cost = 0;
  const save = (extra: Record<string, unknown> = {}) =>
    d.db.query(`UPDATE memes.lfd_sims SET record = $2::jsonb, cost_usd = $3 ${Object.keys(extra).map((k, i) => `, ${k} = $${i + 4}::jsonb`).join('')} WHERE id = $1`, [
      sim.id, JSON.stringify(record), cost, ...Object.values(extra).map((v) => JSON.stringify(v)),
    ]);
  // The live run report (report.ts): every step, with the spend so far.
  const rep = reporter(d.db, sim.id);
  const money = (x: number) => `$${x.toFixed(2)}`;
  const say = (stage: string, message: string) => rep.event(stage, message, cost);
  try {
    const asOf = new Date(sim.as_of);

    // 1. The real engine, writes kept local, slides into the sim folder.
    say('lfd', sim.replay ? `Replaying Last Few Days as of ${sim.as_of.slice(0, 10)} (fresh-article lane left out)` : 'Running Last Few Days as of now');
    let liveCost = 0;
    let lastSaved = 0;
    const result = await d.engine({
      asOf, replay: sim.replay, dir,
      onProgress: (p) => {
        rep.event('lfd', p.step, p.usd);
        if (p.usd > liveCost) liveCost = p.usd;
        if (p.usd - lastSaved >= 0.01) {
          lastSaved = p.usd;
          void d.db.query(`UPDATE memes.lfd_sims SET cost_usd = $2 WHERE id = $1`, [sim.id, p.usd]).catch(() => undefined);
        }
      },
    }).catch((err: unknown) => {
      // A stopped or crashed engine returns no spend: keep the last spend its progress reported.
      cost += liveCost;
      throw err;
    });
    await rep.flush();
    cost += result.spentUsd;
    record.lfd = result.ok ? { ok: true, postId: result.postId, stories: result.stories.length } : result;
    if (!result.ok) throw new Error(`Last Few Days run failed: ${result.error}`);
    const stories = result.stories;
    say('lfd', `Post written: ${stories.length} stories, ${result.slides.length} slides (${money(result.spentUsd)})`);
    const bodies = new Map(Object.entries(result.bodies));
    const original = {
      postId: result.postId, stories, render: result.render, caption: result.caption,
      slides: result.slides, fitProblems: result.fitProblems, renderProblems: result.renderProblems,
    };
    await save({ original_post: original });

    // 2. Tags.
    await stage(d.db, sim.id, 'tags');
    say('tags', `Tagging ${stories.length} stories with Jev (irony, launch, number story, headline length)`);
    // A story already tagged (a graded one, or seen in an earlier simulation) keeps its tags; only new ones go to Jev.
    const known = await loadStoryTags(d.db, stories.map((s) => s.key));
    const fresh = await tagStories(d.jev, stories.filter((s) => !known.has(s.key)).map((s) => ({ id: s.key, headline: s.headline, text: textOf(s) })));
    for (const [key, t] of fresh) await saveStoryTags(d.db, key, t);
    const tags = new Map([...known, ...fresh]);

    // 3. Gate.
    await stage(d.db, sim.id, 'gate');
    const settings = await getSettings(d.db);
    const rows = await oddsRows(d.db, d.regime);
    const model = fitOdds(rows);
    const gated = gate(model, stories.map((s, i) => ({ key: s.key, origIndex: i, tags: tags.get(s.key)! })), settings.gateThreshold);
    record.gate = { threshold: settings.gateThreshold, evidence: rows.length, taggerVersion: TAGGER_VERSION, regime: d.regime };
    for (const [i, s] of stories.entries()) {
      const g = gated.find((x) => x.key === s.key)!;
      await d.db.query(
        `INSERT INTO memes.lfd_sim_stories (sim_id, story_key, story_id, orig_index, headline, tags, tagger_version, odds, gated)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)`,
        [sim.id, s.key, g.chosen ? s.key : null, i, s.headline, JSON.stringify(tags.get(s.key)), TAGGER_VERSION, JSON.stringify({ ...g.odds, passes: g.passes }), g.chosen],
      );
    }
    const chosen = stories.filter((s) => gated.find((x) => x.key === s.key)!.chosen);
    const passing = gated.filter((g) => g.passes).length;
    say('gate', `Gate at ${Math.round(settings.gateThreshold * 100)}% on ${rows.length} graded stories: ${passing} of ${stories.length} pass${chosen.length ? `; making memes for ${chosen.map((s) => `"${s.headline.slice(0, 40)}"`).join(', ')}` : '; no memes this post'}`);
    await save();

    // 4. Briefs. The story goes into the lab's story table with the article's full text.
    const requestIds = new Map<string, string>();
    if (chosen.length) {
      await stage(d.db, sim.id, 'briefs');
      for (const s of chosen) {
        const body = bodies.get(s.url) ?? textOf(s);
        await d.db.query(
          `INSERT INTO memes.lfd_stories (id, group_kind, post_ref, ny_date, headline, url, body, origin, outlet, original_photo)
           VALUES ($1, 'sim', $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
           ON CONFLICT (id) DO UPDATE SET headline = EXCLUDED.headline, body = EXCLUDED.body, post_ref = EXCLUDED.post_ref`,
          [s.key, `sim:${sim.id}`, sim.as_of.slice(0, 10), s.headline, s.url, body, s.origin, s.outlet, JSON.stringify({ url: s.photo.src, credit: s.photo.credit ?? null, kind: s.photo.kind ?? null })],
        );
      }
      say('briefs', `Writing ${chosen.length} body brief${chosen.length === 1 ? '' : 's'} from the full articles`);
      cost += await d.briefs(chosen.map((s) => s.key));
      say('briefs', `Briefs done (${money(cost)} so far)`);
      await save();

      // 5. Memes: one single-story request each, through the unchanged pipeline.
      await stage(d.db, sim.id, 'memes');
      for (const s of chosen) {
        const { rows: r } = await d.db.query<{ id: string }>(
          `INSERT INTO memes.requests (kind, post_id, requested_by, detail) VALUES ('single', $1, 'lfd-sim', $2::jsonb) RETURNING id::text`,
          [s.key, JSON.stringify({ simId: sim.id })],
        );
        requestIds.set(s.key, r[0]!.id);
        await d.db.query(`UPDATE memes.lfd_sim_stories SET request_id = $3 WHERE sim_id = $1 AND story_key = $2`, [sim.id, s.key, r[0]!.id]);
      }
      d.kickMemes();
      const headlineOf = new Map([...requestIds].map(([key, id]) => [id, stories.find((s) => s.key === key)!.headline.slice(0, 50)]));
      const STAGE_WORDS: Record<string, string> = { writing: 'writing turns and memes', judging: 'judging candidates', rendering: 'rendering', ranking: 'ranking the slate' };
      await waitForRequests(d, [...requestIds.values()], (r) => {
        const h = headlineOf.get(r.id) ?? '';
        if (r.status === 'requested') say('memes', `Meme run queued: "${h}"`);
        else if (r.status === 'running') say('memes', `Meme run for "${h}": ${r.stage ? STAGE_WORDS[r.stage] ?? r.stage : 'starting'}`);
        else if (r.status === 'ok') say('memes', `Meme run done: "${h}" (${money(r.cost)})`);
        else say('memes', `Meme run failed: "${h}"`);
      });
      const { rows: spent } = await d.db.query<{ c: string }>(`SELECT COALESCE(sum(cost_usd), 0)::text AS c FROM memes.requests WHERE id = ANY($1::uuid[])`, [[...requestIds.values()]]);
      cost += Number(spent[0]!.c);
      await save();
    }

    // 6. The pick: the slate's #1 (ME-134). The fault counts are saved for reference only.
    await stage(d.db, sim.id, 'faults');
    if (chosen.length) say('faults', 'Picking each slate\'s #1; Jev counts faults for reference');
    const picks = new Map<string, string | null>();
    for (const s of chosen) {
      const requestId = requestIds.get(s.key)!;
      const { rows: memes } = await d.db.query<{ id: string; rank: number; mapping: { fill: MemeFill } }>(
        `SELECT m.id::text, m.rank, m.mapping FROM memes.memes m JOIN memes.slates sl ON sl.id = m.slate_id
          WHERE sl.request_id = $1 AND m.in_slate ORDER BY m.rank`,
        [requestId],
      );
      const first = memes[0];
      const pick = first ? { memeId: first.id, rank: first.rank, reason: 'The slate\'s #1.' } : { memeId: null, rank: null, reason: 'The meme run made no slate.' };
      picks.set(s.key, pick.memeId);
      await d.db.query(`UPDATE memes.lfd_sim_stories SET picked_meme_id = $3, picker = $4::jsonb WHERE sim_id = $1 AND story_key = $2`, [sim.id, s.key, pick.memeId, JSON.stringify(pick)]);
      const have = await loadFaults(d.db, memes.map((m) => m.id));
      const todo = memes.filter((m) => !have.has(m.id));
      const scored = await scoreManyFaults(d.jev, todo.map((m) => faultSubject(m.mapping.fill, { headline: s.headline, theNews: textOf(s) }, m.id)));
      for (const [id, f] of scored) await saveFaults(d.db, id, f);
    }

    // 7. Placement and the post with memes.
    await stage(d.db, sim.id, 'render');
    const placement = placeMemes(stories.map((s) => ({ key: s.key, memeId: picks.get(s.key) ?? null })));
    for (const p of placement.placed) {
      const h = stories.find((s) => s.key === p.key)!.headline.slice(0, 50);
      say('render', p.role === 'cover' ? `Meme #${p.rank} "${h}" becomes the cover; its story moves to slide 1` : `Meme #${p.rank} "${h}" goes on story slide ${p.position}`);
    }
    if (placement.placed.length) say('render', 'Rendering the post with memes');
    const images = new Map<string, MemeImage>();
    for (const id of placement.placed.map((p) => p.memeId)) {
      const { rows: m } = await d.db.query<{ image_path: string | null }>(`SELECT image_path FROM memes.memes WHERE id = $1`, [id]);
      const file = m[0]?.image_path ? path.join(process.cwd(), m[0].image_path) : null;
      if (file && fs.existsSync(file)) images.set(id, await memeImageOf(await trimLetterbox(fs.readFileSync(file))));
    }
    const render = postWithMemes(stories, placement, (id) => images.get(id) ?? { url: '' }, asOf);
    let finalSlides: string[] = [];
    let finalProblems: string[] = [];
    if (placement.placed.length) {
      const out = path.join(dir, 'final');
      fs.mkdirSync(out, { recursive: true });
      const fit = await d.fitCheck(render, { screenshotDir: out, name: 'slide' });
      finalProblems = fit.problems;
      finalSlides = fs.readdirSync(out).filter((f) => /^slide-slide-\d+\.png$/.test(f)).sort().map((f) => `final/${f}`);
    } else {
      finalSlides = original.slides;
    }
    // The data URLs stay out of the saved render: the slides are the images.
    const savedRender = JSON.parse(JSON.stringify(render, (k, v) => (typeof v === 'string' && v.startsWith('data:image/') ? '(meme image)' : v)));
    await save({ placement, final_post: { render: savedRender, caption: render.caption, slides: finalSlides, problems: finalProblems } });
    say('done', `Done: ${placement.placed.length} meme${placement.placed.length === 1 ? '' : 's'} placed, ${money(cost)} total`);
    await rep.flush();
    await d.db.query(`UPDATE memes.lfd_sims SET status = 'ok', stage = NULL, error = NULL, finished_at = now() WHERE id = $1`, [sim.id]);
  } catch (err) {
    record.error = err instanceof Error ? err.message : String(err);
    say('failed', `Failed: ${String(record.error).slice(0, 300)}`);
    await rep.flush();
    await save().catch(() => undefined);
    await d.db.query(`UPDATE memes.lfd_sims SET status = 'failed', stage = NULL, finished_at = now(), error = $2 WHERE id = $1`, [sim.id, String(record.error)]);
  }
}
