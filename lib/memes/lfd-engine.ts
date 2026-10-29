/**
 * Tag + 92% gate and one v5 meme for a Last Few Days story, used mid-run when
 * a photo fails or the lineup still has no passer (lib/lfd/run.ts). Same
 * evidence snapshot as addMemesToPost. Tests stub the hook; live.ts wires this.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { MessagesCreate } from '@/lib/social/reporter/reporter';
import type { JevAsk } from '@/lib/social/jev/client';
import type { HubQuery } from '@/lib/social-hub/db';

import { generateBriefs } from './brief-from-body';
import { openLocalMemesDb } from './db';
import type { MemeFill } from './fill';
import { trimLetterbox } from './lfd-sim/run';
import { loadLabStory } from './lfd-source';
import { fitOdds, gate, type OddsRow } from './odds';
import { evidenceRegimes, regimeId } from './regime';
import type { MemeRenderer } from './render';
import { processNextRequest } from './run';
import { tagStory, TAGGER_VERSION, type StoryTags } from './story-tags';

import EVIDENCE from './gate-evidence.generated.json';

export type GateEvidence = { regime: string; taggerVersion: string; threshold: number; createdAt: string; rows: OddsRow[] };

export type GateStory = { key: string; headline: string; text: string };
export type MakeStory = { key: string; headline: string; url: string; body: string; outlet: string; origin?: string };

export type MadeMeme = { png: Buffer; templateId: string; text: string[]; costUsd: number };

const COOLDOWN_DAYS = 90;

export async function clearsStoryGate(
  jev: JevAsk,
  story: GateStory,
  opts: { assumeShort?: boolean; evidence?: GateEvidence; regime?: string } = {},
): Promise<boolean> {
  const evidence = opts.evidence ?? (EVIDENCE as GateEvidence);
  const regime = opts.regime ?? regimeId();
  if (!evidenceRegimes(regime).includes(evidence.regime) || evidence.taggerVersion !== TAGGER_VERSION) return false;
  const tags = await tagStory(jev, { id: story.key, headline: story.headline, text: story.text });
  const t: StoryTags = opts.assumeShort ? { ...tags, shortHeadline: true } : tags;
  const [g] = gate(fitOdds(evidence.rows), [{ key: story.key, origIndex: 0, tags: t }], evidence.threshold);
  return g?.passes ?? false;
}

async function seedLedger(db: Awaited<ReturnType<typeof openLocalMemesDb>>['db'], q: HubQuery, now: Date): Promise<void> {
  const { rows } = await q<{ stories: Array<{ meme?: { templateId?: string } }>; at: string; published: boolean }>(
    `SELECT stories, COALESCE(published_at, created_at)::text AS at, (published_at IS NOT NULL) AS published FROM lfd.posts
      WHERE status <> 'rejected' AND created_at > $1::timestamptz - make_interval(days => $2)`,
    [now.toISOString(), COOLDOWN_DAYS],
  );
  const uses = rows.flatMap((r) => (Array.isArray(r.stories) ? r.stories : []).flatMap((s) => (s.meme?.templateId ? [{ templateId: s.meme.templateId, at: r.at, published: r.published }] : [])));
  for (const u of uses) {
    await db.query(
      `INSERT INTO memes.template_uses (family_key, template_id, image_hash, reserved_at, published_at)
       SELECT family_key, id, image_hash, $2::timestamptz, CASE WHEN $3 THEN $2::timestamptz ELSE NULL END FROM memes.templates WHERE id = $1`,
      [u.templateId, u.at, u.published],
    );
  }
}

export async function makeStoryMeme(
  d: {
    create: MessagesCreate;
    jev: JevAsk;
    openRenderer: () => Promise<MemeRenderer>;
    query?: HubQuery;
    now?: () => Date;
    nyDate?: string;
  },
  story: MakeStory,
): Promise<MadeMeme | null> {
  const now = d.now ?? (() => new Date());
  const nyDate = d.nyDate ?? now().toISOString().slice(0, 10);
  const { db, pg } = await openLocalMemesDb();
  const renderDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lfd-engine-meme-'));
  const renderer = await d.openRenderer();
  let costUsd = 0;
  try {
    if (d.query) await seedLedger(db, d.query, now()).catch(() => undefined);
    await db.query(
      `INSERT INTO memes.lfd_stories (id, group_kind, post_ref, ny_date, headline, url, body, origin, outlet) VALUES ($1, 'post', 'engine', $2, $3, $4, $5, $6, $7)`,
      [story.key, nyDate, story.headline, story.url, story.body, story.origin ?? 'feed', story.outlet],
    );
    costUsd += (await generateBriefs(db, [story.key], 'from-body', d.create)).spent;
    await db.query(`INSERT INTO memes.requests (kind, post_id, requested_by, detail) VALUES ('single', $1, 'lfd-engine', '{}'::jsonb)`, [story.key]);
    await processNextRequest({ db, create: d.create, jev: d.jev, renderer, loadStory: (id) => loadLabStory(db, id), renderDir, now });
    const { rows: req } = await db.query<{ status: string; cost: number }>(
      `SELECT status, cost_usd::float8 AS cost FROM memes.requests WHERE post_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [story.key],
    );
    costUsd += req[0]?.cost ?? 0;
    if (req[0]?.status !== 'ok') return null;
    const { rows: first } = await db.query<{ template_id: string; mapping: { fill: MemeFill }; image_path: string | null }>(
      `SELECT m.template_id, m.mapping, m.image_path FROM memes.memes m JOIN memes.slates sl ON sl.id = m.slate_id
         JOIN memes.requests r ON r.id = sl.request_id WHERE r.post_id = $1 AND m.in_slate ORDER BY m.rank LIMIT 1`,
      [story.key],
    );
    const m = first[0];
    if (!m?.image_path) return null;
    const png = await trimLetterbox(fs.readFileSync(path.resolve(m.image_path)));
    const text = m.mapping.fill.fills.flatMap((f) => (f.kind === 'entity' ? [] : [f.text]));
    return { png, templateId: m.template_id, text, costUsd };
  } catch {
    return null;
  } finally {
    await renderer.close().catch(() => undefined);
    await pg.close().catch(() => undefined);
    fs.rmSync(renderDir, { recursive: true, force: true });
  }
}
