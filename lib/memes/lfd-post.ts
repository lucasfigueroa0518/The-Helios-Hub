/**
 * Memes in a real Last Few Days post (Lucas, 2026-10-19: "LFD is APPROVED TO SHIP"). After Tommy's engine has
 * saved the post, this does what the meme lab's simulation does (lib/memes/lfd-sim/run.ts), on the worker:
 *   1. tag every story with Jev (story-tags.ts);
 *   2. gate: the odds from the frozen evidence snapshot (gate-evidence.generated.json), top 3 at or above the
 *      threshold with enough graded stories in their cell;
 *   3. a body brief and one meme run (the unchanged v5 pipeline) per gated story, in an in-memory meme database;
 *   4. each slate's #1 (ME-134), placed by the placement rules (lfd-placement.ts);
 *   5. the post re-rendered with the memes, its slides re-uploaded, and the post row updated.
 * Production grades nothing, so the evidence never moves here; it is refreshed from the lab with
 * scripts/memes_gate_snapshot.ts. Templates used in recent posts are blocked for 90 days (the gate.ts rule),
 * read back from the posts themselves. Any failure leaves the post exactly as the engine made it.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { JevAsk } from '@/lib/social/jev/client';
import type { FitCheck } from '@/lib/social/render/fit-check';
import type { HubQuery } from '@/lib/social-hub/db';

import { generateBriefs } from './brief-from-body';
import { openLocalMemesDb, type MemesDb } from './db';
import type { MemeFill } from './fill';
import { placeMemes, type Placement } from './lfd-placement';
import { postWithMemes, type MemeImage, type SavedStory } from './lfd-sim/post';
import { memeImageOf, trimLetterbox } from './lfd-sim/run';
import { loadLabStory } from './lfd-source';
import { fitOdds, gate, type OddsRow } from './odds';
import { evidenceRegimes, regimeId } from './regime';
import type { MemeRenderer } from './render';
import { processNextRequest } from './run';
import { tagStories, TAGGER_VERSION, type StoryTags } from './story-tags';

import EVIDENCE from './gate-evidence.generated.json';

export type GateEvidence = { regime: string; taggerVersion: string; threshold: number; createdAt: string; rows: OddsRow[] };

/** What the post keeps about its memes (lfd.posts.stories[i].meme, and the run record). */
export type PostMeme = { templateId: string; memeId: string; rank: number; role: 'cover' | 'slide'; position: number; object: string; text: string[] };

export type PostMemesDeps = {
  query: HubQuery;
  create: MessagesCreate;
  jev: JevAsk;
  openRenderer: () => Promise<MemeRenderer>;
  fitCheck: FitCheck;
  /** Storage upload (the slide bucket), the same one the engine used for this post's slides. */
  upload: (objectPath: string, body: Buffer, contentType: string) => Promise<void>;
  fetchBody: (url: string) => Promise<string | null>;
  storeSlides: (slug: string, render: unknown) => Promise<string[]>;
  now: () => Date;
  log: (message: string, fields?: Record<string, unknown>) => void;
  /** Spend ceiling for the meme stage (briefs, meme runs, Jev). */
  capUsd: number;
  /** Overrides for tests. */
  evidence?: GateEvidence;
  regime?: string;
  /** One queued meme request, run to the end (default: the v5 pipeline, processNextRequest). */
  runRequest?: (db: MemesDb, renderer: MemeRenderer, renderDir: string) => Promise<void>;
};

export type PostMemesResult = { placed: number; gated: number; skipped?: string; costUsd: number };

type PostRow = { id: string; slug: string; ny_date: string; stories: Array<SavedStory & { meme?: PostMeme }>; caption: string };

export const COOLDOWN_DAYS = 90;
const textOf = (s: SavedStory) => [s.setup, s.body].filter(Boolean).join(' ');

/** Templates used in the last 90 days of posts that weren't rejected, with when (the 90-day rule reads these). */
async function recentTemplateUses(q: HubQuery, now: Date, excludePostId: string): Promise<Array<{ templateId: string; at: string; published: boolean }>> {
  const { rows } = await q<{ stories: Array<{ meme?: { templateId?: string } }>; at: string; published: boolean }>(
    `SELECT stories, COALESCE(published_at, created_at)::text AS at, (published_at IS NOT NULL) AS published FROM lfd.posts
      WHERE status <> 'rejected' AND id <> $1 AND created_at > $2::timestamptz - make_interval(days => $3)`,
    [excludePostId, now.toISOString(), COOLDOWN_DAYS],
  );
  return rows.flatMap((r) => (Array.isArray(r.stories) ? r.stories : []).flatMap((s) => (s.meme?.templateId ? [{ templateId: s.meme.templateId, at: r.at, published: r.published }] : [])));
}

/** Fill a fresh in-memory meme database's 90-day ledger from the posts. */
async function seedLedger(db: MemesDb, uses: Array<{ templateId: string; at: string; published: boolean }>): Promise<void> {
  for (const u of uses) {
    await db.query(
      `INSERT INTO memes.template_uses (family_key, template_id, image_hash, reserved_at, published_at)
       SELECT family_key, id, image_hash, $2::timestamptz, CASE WHEN $3 THEN $2::timestamptz ELSE NULL END FROM memes.templates WHERE id = $1`,
      [u.templateId, u.at, u.published],
    );
  }
}

export async function addMemesToPost(d: PostMemesDeps, postId: string): Promise<PostMemesResult> {
  const evidence = d.evidence ?? (EVIDENCE as GateEvidence);
  const regime = d.regime ?? regimeId();
  // Integrity (PREDICTOR.md): the evidence only predicts for the system it was graded on.
  if (!evidenceRegimes(regime).includes(evidence.regime) || evidence.taggerVersion !== TAGGER_VERSION) {
    const skipped = `the gate evidence is for regime ${evidence.regime} / ${evidence.taggerVersion}, not this code (${regime} / ${TAGGER_VERSION})`;
    d.log('lfd_memes_skipped', { postId, reason: skipped });
    return { placed: 0, gated: 0, skipped, costUsd: 0 };
  }
  const { rows } = await d.query<PostRow>(`SELECT id::text AS id, slug, ny_date::text AS ny_date, stories, caption FROM lfd.posts WHERE id = $1`, [postId]);
  const post = rows[0];
  if (!post || !Array.isArray(post.stories) || post.stories.length === 0) return { placed: 0, gated: 0, skipped: 'no post', costUsd: 0 };
  const stories = post.stories;
  let costUsd = 0;
  const over = () => costUsd >= d.capUsd;

  // 1–2. Tags and the gate.
  const tags = await tagStories(d.jev, stories.map((s) => ({ id: s.key, headline: s.headline, text: textOf(s) })));
  const gated = gate(fitOdds(evidence.rows), stories.map((s, i) => ({ key: s.key, origIndex: i, tags: tags.get(s.key) as StoryTags })), evidence.threshold);
  const chosen = stories.filter((s) => gated.find((g) => g.key === s.key)?.chosen);
  d.log('lfd_memes_gate', { postId, chosen: chosen.length, passing: gated.filter((g) => g.passes).length, stories: stories.length, evidence: evidence.rows.length });
  if (!chosen.length) return { placed: 0, gated: 0, costUsd };

  // 3. Briefs and meme runs, in a database of this run's own.
  const { db, pg } = await openLocalMemesDb();
  const renderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfd-memes-'));
  const renderer = await d.openRenderer();
  const picks = new Map<string, { memeId: string; rank: number; templateId: string; fill: MemeFill; imagePath: string }>();
  try {
    await seedLedger(db, await recentTemplateUses(d.query, d.now(), postId));
    for (const s of chosen) {
      const body = (await d.fetchBody(s.url).catch(() => null)) ?? textOf(s);
      await db.query(
        `INSERT INTO memes.lfd_stories (id, group_kind, post_ref, ny_date, headline, url, body, origin, outlet) VALUES ($1, 'post', $2, $3, $4, $5, $6, $7, $8)`,
        [s.key, postId, post.ny_date, s.headline, s.url, body, s.origin, s.outlet],
      );
    }
    costUsd += (await generateBriefs(db, chosen.map((s) => s.key), 'from-body', d.create)).spent;
    for (const s of chosen) {
      if (over()) break;
      await db.query(`INSERT INTO memes.requests (kind, post_id, requested_by, detail) VALUES ('single', $1, 'lfd-worker', '{}'::jsonb)`, [s.key]);
      if (d.runRequest) await d.runRequest(db, renderer, renderDir);
      else await processNextRequest({ db, create: d.create, jev: d.jev, renderer, loadStory: (id) => loadLabStory(db, id), renderDir, now: d.now });
      const { rows: req } = await db.query<{ status: string; cost: number; error: string | null }>(
        `SELECT status, cost_usd::float8 AS cost, error FROM memes.requests WHERE post_id = $1 ORDER BY requested_at DESC LIMIT 1`,
        [s.key],
      );
      costUsd += req[0]?.cost ?? 0;
      if (req[0]?.status !== 'ok') {
        d.log('lfd_memes_run_failed', { postId, story: s.key, error: req[0]?.error });
        continue;
      }
      // 4. The slate's #1.
      const { rows: first } = await db.query<{ id: string; rank: number; template_id: string; mapping: { fill: MemeFill }; image_path: string | null }>(
        `SELECT m.id::text, m.rank, m.template_id, m.mapping, m.image_path FROM memes.memes m JOIN memes.slates sl ON sl.id = m.slate_id
           JOIN memes.requests r ON r.id = sl.request_id WHERE r.post_id = $1 AND m.in_slate ORDER BY m.rank LIMIT 1`,
        [s.key],
      );
      const m = first[0];
      if (m?.image_path) picks.set(s.key, { memeId: m.id, rank: m.rank, templateId: m.template_id, fill: m.mapping.fill, imagePath: path.resolve(m.image_path) });
    }
  } finally {
    await renderer.close().catch(() => undefined);
    await pg.close().catch(() => undefined);
  }
  if (!picks.size) {
    d.log('lfd_memes_none', { postId, gated: chosen.length, costUsd });
    fs.rmSync(renderDir, { recursive: true, force: true });
    return { placed: 0, gated: chosen.length, costUsd };
  }

  // 5. Placement, uploads, re-render, the post row.
  const placement: Placement = placeMemes(stories.map((s) => ({ key: s.key, memeId: picks.get(s.key)?.memeId ?? null })));
  const images = new Map<string, MemeImage>();
  const objects = new Map<string, string>();
  for (const p of placement.placed) {
    const pick = picks.get(p.key)!;
    const png = await trimLetterbox(fs.readFileSync(pick.imagePath));
    const object = `lfd/${post.slug}/meme-${p.rank}.png`;
    await d.upload(object, png, 'image/png');
    images.set(p.memeId, await memeImageOf(png));
    objects.set(p.memeId, object);
  }
  fs.rmSync(renderDir, { recursive: true, force: true });
  const render = postWithMemes(stories, placement, (id) => images.get(id) ?? { url: '' }, d.now());
  const slideObjects = await d.storeSlides(post.slug, render);
  // The saved render keeps each meme's storage object, not the image: the hub lists posts with their render.
  const savedRender = postWithMemes(stories, placement, (id) => ({ ...images.get(id), url: `storage:${objects.get(id) ?? ''}` }), d.now());
  const byKey = new Map(stories.map((s) => [s.key, s]));
  const newStories = placement.order.map((key) => {
    const s = byKey.get(key)!;
    const p = placement.placed.find((x) => x.key === key);
    const pick = picks.get(key);
    if (!p || !pick) return s;
    const text = pick.fill.fills.flatMap((f) => (f.kind === 'entity' ? [] : [f.text]));
    const meme: PostMeme = { templateId: pick.templateId, memeId: pick.memeId, rank: p.rank, role: p.role, position: p.position, object: objects.get(pick.memeId)!, text };
    return { ...s, meme };
  });
  await d.query(
    `UPDATE lfd.posts SET stories = $2::jsonb, render = $3::jsonb, caption = $4, slide_objects = $5::jsonb WHERE id = $1`,
    [postId, JSON.stringify(newStories), JSON.stringify(savedRender), render.caption, JSON.stringify(slideObjects)],
  );
  d.log('lfd_memes_placed', { postId, placed: placement.placed.map((p) => ({ story: p.key, rank: p.rank, role: p.role, position: p.position, template: picks.get(p.key)?.templateId })), costUsd });
  return { placed: placement.placed.length, gated: chosen.length, costUsd };
}
