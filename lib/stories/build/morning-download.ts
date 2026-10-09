/**
 * Helios Morning Download (plan §5.1; S-03, S-04, S-14, S-15, S-22, S-29).
 *
 *   pool     reels (top 15 by net + blockbusters) + carousel (qualified,
 *            last 30 hours); drop what ran in the last 3 days
 *   merge    one Jev same-event check per cross-system pair sharing a name
 *   rank     one major-news@1 call per candidate → score; up to 5 clear the
 *            bar, else the top 2 (S-04)
 *   write    md-headlines@1 (one Sonnet call), length and sentence checks
 *   ground   md-grounding@1 per headline; a miss gets one rewrite, a second
 *            miss drops the story; fewer than 2 left skips the day
 *   photos   carousel photo first (S-29), else the finder; the opener's
 *            second photo never repeats a story frame's (S-14)
 *
 * Weights and the bar are first values (S-63), to calibrate on real runs.
 */
import { MAJOR_NEWS, MD_GROUNDING, SAME_EVENT } from '@/lib/stories/questions';
import { MD_HEADLINES, material, type MdHeadlinesOut } from '@/lib/stories/prompts';
import type { FrameData, Photo, StoryData } from '@/lib/stories/render/types';
import { recentKeys, type NewCandidate } from '@/lib/stories/repository';
import { morningDownloadCarousel, recentUsedPhotoUrls } from '@/lib/stories/sources/carousel';
import { dedupe, morningDownloadReels, type StoryCandidate } from '@/lib/stories/sources/reels';
import { writeStructured } from '@/lib/stories/writer';

import { findPhoto, nextBackdrop, openerDate, sentenceCount, toFrames, type BuildDeps, type BuildResult } from './common';

export const MAJOR_NEWS_WEIGHTS = { blockbuster_entity: 0.25, political_relevance: 0.15, global_relevance: 0.2, broad_effect: 0.2, headline_news: 0.2 } as const;
export const MAJOR_NEWS_BAR = 0.55;
export const SAME_EVENT_BAR = 0.7;
export const GROUNDING_BAR = 0.6;
export const MAX_STORIES = 5;
export const MIN_STORIES = 2;
const BODY_CHARS = 9000; // ~1,500 words (plan §5.1)

export type Sources = { reels: () => Promise<StoryCandidate[]>; carousel: () => Promise<StoryCandidate[]> };

const NAME = /\b[A-Z][a-zA-Z0-9]+(?:\s+[A-Z][a-zA-Z0-9]+)*\b/g;
const STOP = new Set(['The', 'A', 'An', 'This', 'That', 'AI', 'In', 'On', 'At', 'For', 'With', 'And', 'But', 'How', 'Why', 'What', 'New', 'Its', 'It']);
/** Proper names in a headline, for the cheap pre-filter before the Jev merge check. */
export function namesIn(text: string): Set<string> {
  return new Set((text.match(NAME) ?? []).flatMap((n) => n.split(/\s+/)).filter((w) => w.length > 2 && !STOP.has(w)));
}

export function majorNewsScore(answers: Record<string, { noul: number }>): number {
  return Object.entries(MAJOR_NEWS_WEIGHTS).reduce((s, [k, w]) => s + w * (answers[k]?.noul ?? 0), 0);
}

/** S-04: every story that clears the bar, up to 5; fewer than 2 clear → the top 2 anyway. */
export function chooseStories<T extends { score: number }>(ranked: T[]): T[] {
  const sorted = [...ranked].sort((a, b) => b.score - a.score);
  const clear = sorted.filter((c) => c.score >= MAJOR_NEWS_BAR).slice(0, MAX_STORIES);
  return clear.length >= MIN_STORIES ? clear : sorted.slice(0, MIN_STORIES);
}

export async function buildMorningDownload(deps: BuildDeps, sources?: Sources): Promise<BuildResult> {
  const src: Sources = sources ?? { reels: () => morningDownloadReels(deps.sourceDb, deps.nyDate), carousel: () => morningDownloadCarousel(deps.sourceDb, deps.now) };
  const log: string[] = [];
  const shown = await recentKeys(deps.db, 'morning_download', 3, deps.now);
  const [reels, carousel] = await Promise.all([src.reels().catch(() => []), src.carousel().catch(() => [])]);
  let pool = dedupe([...carousel, ...reels]).filter((c) => !shown.has(c.key));

  // One event is one story, from either system. Jev only sees pairs that share a name.
  const dropped = new Set<string>();
  for (let i = 0; i < pool.length; i++) {
    if (dropped.has(pool[i]!.key)) continue;
    for (let j = i + 1; j < pool.length; j++) {
      const other = pool[j]!;
      if (dropped.has(other.key)) continue;
      const shared = [...namesIn(pool[i]!.headline)].some((n) => namesIn(other.headline).has(n));
      if (!shared) continue;
      const res = await deps.jev.ask({ component: 'md-merge', set: SAME_EVENT, setId: deps.setId, state: { story_a: { headline: pool[i]!.headline, untrusted_content: pool[i]!.body.slice(0, 1200) }, story_b: { headline: other.headline, untrusted_content: other.body.slice(0, 1200) } } });
      if (res.answers.same_event.noul < SAME_EVENT_BAR) continue;
      const keepOther = !pool[i]!.photo && Boolean(other.photo);
      const drop = keepOther ? pool[i]! : other;
      const keep = keepOther ? other : pool[i]!;
      dropped.add(drop.key);
      keep.alsoFrom = [...(keep.alsoFrom ?? []), drop.sourceName];
      keep.blockbuster = Math.max(keep.blockbuster ?? 0, drop.blockbuster ?? 0);
    }
  }
  pool = pool.filter((c) => !dropped.has(c.key));
  const candidates: NewCandidate[] = [];
  if (pool.length < MIN_STORIES) return { ok: false, skip: `only ${pool.length} new stories in the pool`, candidates };

  // Rank with one major-news node (S-03).
  const ranked: Array<StoryCandidate & { score: number; answers: Record<string, number> }> = [];
  for (const c of pool) {
    const res = await deps.jev.ask({
      component: 'md-rank',
      set: MAJOR_NEWS,
      setId: deps.setId,
      state: { headline: c.headline, outlets: [c.sourceName, ...(c.alsoFrom ?? [])], published: c.publishedAt, story: { untrusted_content: c.body.slice(0, BODY_CHARS) } },
    });
    const answers = Object.fromEntries(Object.entries(res.answers).map(([k, v]) => [k, (v as { noul: number }).noul]));
    ranked.push({ ...c, score: majorNewsScore(res.answers as Record<string, { noul: number }>), answers });
  }
  const chosen = chooseStories(ranked);
  const chosenKeys = new Set(chosen.map((c) => c.key));
  for (const c of ranked) candidates.push({ origin: c.origin, ref: c.ref, payload: { headline: c.headline, url: c.url, source: c.sourceName, native: c.nativeScore }, jev: c.answers, score: c.score, chosen: chosenKeys.has(c.key), reason: chosenKeys.has(c.key) ? null : 'below the cut' });

  // Write, check lengths, ground.
  const byKey = new Map(chosen.map((c) => [c.key, c]));
  const writeFor = async (list: typeof chosen, note?: string) =>
    (await writeStructured<MdHeadlinesOut>({
      create: deps.write, db: deps.db, setId: deps.setId, component: MD_HEADLINES.id, model: deps.settings.models.copy, system: MD_HEADLINES.system, tool: MD_HEADLINES.tool,
      user: `${note ? `${note}\n\n` : ''}${material(list.map((c) => ({ key: c.key, headline: c.headline, outlet: c.sourceName, also_reported_by: c.alsoFrom ?? [], published: c.publishedAt, url: c.url, text: c.body.slice(0, BODY_CHARS) })))}`,
    })).value;
  const first = await writeFor(chosen);
  const ok = (h: string) => h.length <= 260 && sentenceCount(h) >= 1 && sentenceCount(h) <= 2;
  const oneEach = (list: typeof first.stories) => {
    const seen = new Set<string>();
    return list.filter((s) => byKey.has(s.key) && !seen.has(s.key) && (seen.add(s.key), true));
  };
  let written = oneEach(first.stories);
  const grounded: typeof written = [];
  const ground = async (s: (typeof written)[number]) => {
    const c = byKey.get(s.key)!;
    const res = await deps.jev.ask({ component: 'md-grounding', set: MD_GROUNDING, setId: deps.setId, state: { headline: s.headline, source: { untrusted_content: c.body.slice(0, BODY_CHARS) } } });
    return ok(s.headline) && res.answers.supported.noul >= GROUNDING_BAR;
  };
  const misses: typeof chosen = [];
  for (const s of written) (await ground(s)) ? grounded.push(s) : misses.push(byKey.get(s.key)!);
  if (misses.length) {
    log.push(`grounding: ${misses.length} rewrite(s)`);
    const again = await writeFor(misses, 'A previous headline for each of these stories made a claim the source does not support, or ran past two sentences or 240 characters. Write it again, stating only what the source says.');
    for (const s of oneEach(again.stories).filter((x) => misses.some((m) => m.key === x.key))) if (await ground(s)) grounded.push(s);
  }
  written = chosen.map((c) => grounded.find((g) => g.key === c.key)).filter((x): x is (typeof written)[number] => Boolean(x));
  if (written.length < MIN_STORIES) return { ok: false, skip: `only ${written.length} headline(s) passed grounding`, candidates };

  // Photos: the carousel's own photo first (S-29), else the finder; never one used in 7 days.
  const recent = await recentUsedPhotoUrls(deps.sourceDb, deps.now).catch(() => new Set<string>());
  const inSet = new Set<string>();
  const storyFrames: StoryData[] = [];
  for (const s of written) {
    const c = byKey.get(s.key)!;
    let photo: Photo | null = c.photo ? { src: c.photo.url, credit: c.photo.credit, kind: 'scene' } : null;
    if (!photo) photo = await findPhoto(deps.photos, { kind: s.visual.kind, query: s.visual.query, subjects: s.subjects, storyDate: c.publishedAt?.slice(0, 10) ?? null, sourceUrls: [c.url], exclude: new Set([...recent, ...inSet]) }, log);
    if (photo) inSet.add(photo.src);
    storyFrames.push({ role: 'story', headline: s.headline.trim(), source: { verb: s.source_verb, name: s.source_name }, ...(photo ? { photo } : {}) });
  }
  const openerSource = byKey.get(written[0]!.key)!;
  const openerPhoto = await findPhoto(deps.photos, { kind: first.opener_visual.kind, query: first.opener_visual.query, subjects: written[0]!.subjects, storyDate: openerSource.publishedAt?.slice(0, 10) ?? null, sourceUrls: [openerSource.url], exclude: new Set([...recent, ...inSet]) }, log);

  const data: FrameData[] = [{ role: 'opener', date: openerDate(deps.nyDate), storyCount: storyFrames.length, ...(openerPhoto ? { photo: openerPhoto } : {}) }, ...storyFrames, { role: 'closer' }];
  const backdrop = await nextBackdrop(deps.db, 'morning_download', deps.setId);
  return {
    ok: true,
    payload: { stories: written.map((s) => ({ key: s.key, headline: s.headline, url: byKey.get(s.key)!.url, source: s.source_name, score: ranked.find((r) => r.key === s.key)!.score })), pool: pool.length, log },
    frames: toFrames(data, backdrop),
    candidates,
    historyKeys: written.map((s) => s.key),
  };
}
