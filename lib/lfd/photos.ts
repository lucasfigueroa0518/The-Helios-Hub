/**
 * One photo per story (spec §5) through the Stories finder, found as one set
 * so no two slides share a photo. The article's own images arrive through the
 * source page the finder reads. A null means the whole fallback chain found
 * nothing usable; the run replaces that story.
 *
 * The finder's last resort is an "icon scene" search for the slide's icon, and
 * a Last Few Days slide has none, so it falls to the default icon's generic
 * scene (a stack of newspapers). That photo says nothing about the story, so
 * it is refused here (null → the run replaces the story).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { HarvestInput, HarvestResult } from '@/lib/reel-ai-drama/harvest/harvest';
import { planWants } from '@/lib/reel-ai-drama/harvest/plan';
import type { HarvestDeps, Want } from '@/lib/reel-ai-drama/harvest/types';
import { DEFAULT_SETTINGS, type ReelAiDramaSettings } from '@/lib/reel-ai-drama/settings';
import type { Asset, Pitch } from '@/lib/reel-ai-drama/types';
import { findSetOrEach, type PhotoFinder, type PhotoRequest } from '@/lib/stories/photos';
import type { Photo } from '@/lib/stories/render/types';

import type { Pick, StoryCopy } from './types';

export function requestFor(pick: Pick, copy: StoryCopy, exclude: Set<string>): PhotoRequest {
  return {
    kind: copy.photo.kind,
    query: copy.photo.query,
    subjects: copy.photo.subjects,
    storyDate: pick.publishedAt?.slice(0, 10) ?? null,
    sourceUrls: [pick.url],
    alts: copy.photo.alts,
    copy: copy.headline,
    exclude,
  };
}

/** The finder's trace step for its icon-scene fallback (lib/social/photos/design.ts). */
export const ICON_SCENE_STEP = 'icon scene (';
export const REFUSED_ICON_SCENE = 'lfd: refused icon-scene fallback';

export type FoundPhotos = {
  photos: Array<Photo | null>;
  /** The finder's steps per story (same order as the items), plus any refusal noted here. */
  traces: string[][];
};

export async function findPhotos(finder: PhotoFinder, items: Array<{ pick: Pick; copy: StoryCopy }>, exclude: Set<string>): Promise<FoundPhotos> {
  if (items.length === 0) return { photos: [], traces: [] };
  const trace: string[][] = [];
  const found = await findSetOrEach(finder, items.map(({ pick, copy }) => requestFor(pick, copy, exclude)), trace);
  const traces = items.map((_, i) => [...(trace[i] ?? [])]);
  const photos = items.map((_, i) => {
    const photo = found[i] ?? null;
    if (!photo || !traces[i]!.some((line) => line.startsWith(ICON_SCENE_STEP))) return photo;
    traces[i]!.push(REFUSED_ICON_SCENE);
    return null;
  });
  return { photos, traces };
}

/* ── Builder slides: AI Drama's harvest engine (Phase 1 photo slice) ─────────────────────────── */

/** Harvest spend one post may make across all its builder slides (round 3: $0.15 a post). */
export const BUILDER_HARVEST_CAP_USD = 0.15;

/**
 * AI Drama's harvest engine as a builder slide uses it. Every outside call goes through `deps`
 * (`http` for Wikidata/Commons/Serper/articles/downloads, `serperKey`, `create` for the Haiku look,
 * `photoBank`); tests stub them all. The harvest's database is a sink (LFD keeps its own 7-day
 * reuse rule and never writes AI Drama's tables), and its spend cap is the post's remaining budget.
 */
export type BuilderHarvest = {
  deps: Omit<HarvestDeps, 'db' | 'capUsd'>;
  settings?: ReelAiDramaSettings;
  /** The engine (runHarvest); injectable for tests. */
  run?: (deps: HarvestDeps, input: HarvestInput) => Promise<HarvestResult>;
  /** Parent folder for the per-story job folder (removed afterwards); default the OS tmp dir. */
  workDir?: string;
};

/** What the post has spent on harvests so far; shared across its builder slides. */
export type HarvestBudget = { usd: number; capUsd: number };

/** Answers every harvest query with nothing and records nothing (no AI Drama asset, use or cost rows). */
const SINK_DB: HarvestDeps['db'] = { query: async () => ({ rows: [] }) };

/** A one-story pitch from the slide: a person for each named person in the photo request, the story URL as the source. */
export function builderPitch(pick: Pick, copy: StoryCopy): Pitch {
  const date = (pick.eventDate ?? pick.publishedAt)?.slice(0, 10) ?? null;
  const people = [...new Set(copy.photo.subjects.filter((s) => s.type === 'person').map((s) => s.name.trim()).filter(Boolean))];
  return {
    title: copy.headline || pick.headline,
    brief: [copy.setup, copy.body].filter(Boolean).join(' ') || pick.body.slice(0, 1200),
    story_type: 'breakthrough',
    era: 'now',
    event_date: date,
    date_precision: 'day',
    cast: people.map((name) => ({ name, role: 'named in the story', kind: 'person' as const, player_id: null })),
    why_now: null,
    expected_visuals: [],
    sources: [{ url: pick.url, title: pick.headline, publisher: pick.sourceName, date }],
    // The key moment the harvest searches for: the writer's own photo query.
    scene: copy.photo.query || copy.headline || pick.headline,
  };
}

/** The wants the harvest plans for this pitch: a portrait per named person, the key moment, the story page's images. */
export function builderWants(pitch: Pitch): Want[] {
  return planWants(pitch, null, { isNews: true, cutouts: [] });
}

const isWebUrl = (u: string | null): u is string => !!u && /^https?:\/\//i.test(u);

/** The slide's photo from the harvest's usable assets: what the writer asked for first (a person, else the key moment). */
export function chooseAsset(assets: readonly Asset[], copy: StoryCopy, exclude: ReadonlySet<string>): Asset | null {
  const usable = assets.filter((a) => isWebUrl(a.url) && !a.made && !exclude.has(a.url));
  const people = copy.photo.subjects.filter((s) => s.type === 'person').map((s) => s.name);
  const portraits = people.flatMap((name) => usable.filter((a) => a.kind === 'person_photo' && a.people.includes(name)));
  const moment = usable.filter((a) => a.flags.includes('key_moment'));
  const rest = usable.filter((a) => a.kind === 'event_photo' || a.kind === 'person_photo');
  const order = copy.photo.kind === 'person' ? [...portraits, ...moment, ...rest] : [...moment, ...portraits, ...rest];
  return order[0] ?? null;
}

function asPhoto(a: Asset): Photo {
  const kind: Photo['kind'] = a.kind === 'person_photo' ? 'person' : a.kind === 'logo' ? 'logo' : 'scene';
  const focus = a.face ? { x: Math.min(1, Math.max(0, a.face.x + a.face.w / 2)), y: Math.min(1, Math.max(0, a.face.y + a.face.h / 2)) } : undefined;
  return { src: a.url!, credit: a.credit, kind, ...(focus ? { focus } : {}) };
}

/**
 * One builder slide's photo from AI Drama's harvest, inside the post's budget. Null (with the trace saying
 * why) when the budget is spent, the harvest fails, or nothing usable comes back: the caller goes on to
 * today's finder. Never throws. A harvest that throws keeps its whole allowance charged (its partial spend
 * is unknown, fix 10), so the post's cap still holds.
 */
export async function harvestBuilderPhoto(
  h: BuilderHarvest,
  pick: Pick,
  copy: StoryCopy,
  exclude: ReadonlySet<string>,
  budget: HarvestBudget,
  now: Date,
): Promise<{ photo: Photo | null; trace: string[] }> {
  const left = budget.capUsd - budget.usd;
  if (left <= 0) return { photo: null, trace: [`harvest: skipped, the post's $${budget.capUsd.toFixed(2)} harvest cap is spent`] };
  const pitch = builderPitch(pick, copy);
  const wants = builderWants(pitch);
  const trace = [`harvest: wants ${wants.map((w) => w.id).join(', ')} (cap $${left.toFixed(3)} left)`];
  const settings: ReelAiDramaSettings = { ...(h.settings ?? DEFAULT_SETTINGS), min_visuals: 1, reuse_days: 0 };
  let jobDir: string | null = null;
  // Charged upfront (fix 10): a harvest that throws may already have paid for searches and looks it cannot report,
  // so the whole allowance it was given stays spent unless it comes back with its real cost.
  const before = budget.usd;
  budget.usd = before + left;
  try {
    const run = h.run ?? (await import('@/lib/reel-ai-drama/harvest/harvest')).runHarvest;
    jobDir = fs.mkdtempSync(path.join(h.workDir ?? os.tmpdir(), 'lfd-harvest-'));
    const res = await run(
      { ...h.deps, db: SINK_DB, capUsd: left, log: h.deps.log ?? (() => undefined), now: h.deps.now ?? (() => now) },
      { pitch, facts: null, jobDir, jobId: null, mode: 'production', settings },
    );
    const usd = Number(res.inventory.usd) || 0;
    budget.usd = before + usd;
    const asset = chooseAsset(res.inventory.assets, copy, exclude);
    trace.push(`harvest: ${res.inventory.assets.length} usable, $${usd.toFixed(3)} (post total $${budget.usd.toFixed(3)})`);
    if (!asset) return { photo: null, trace: [...trace, 'harvest: nothing usable for the slide; the finder takes over'] };
    trace.push(`harvest: ${asset.id} ${asset.kind} "${asset.shows}" via ${asset.credit}: ${asset.url}`);
    return { photo: asPhoto(asset), trace };
  } catch (err) {
    const why = err instanceof Error ? err.message.slice(0, 160) : String(err);
    return { photo: null, trace: [...trace, `harvest: failed (${why}); its $${left.toFixed(3)} allowance counts as spent; the finder takes over`] };
  } finally {
    if (jobDir) fs.rmSync(jobDir, { recursive: true, force: true });
  }
}
