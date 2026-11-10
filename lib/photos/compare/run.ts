/**
 * Runs the shared finder over a comparison plan (PHASE3-CONTRACT.md, Owner D). Live only behind `--go` in
 * scripts/photos/compare.ts; tests pass a stub `find`.
 *
 * One fresh PhotoBudget per post (the profile's $0.30 cap). The global cap is checked before each post: a post
 * starts only when the spend so far plus that post's own cap still fits, so the run can never pass the global cap.
 */
import type { Photo } from '@/lib/stories/render/types';

import { PHOTO_PROFILES } from '../profiles';
import type { FindOptions, FoundPhotos, PhotoDeps, PhotoNeed, PhotoProfile, PhotoProfileId } from '../types';

import type { ComparePost, OldPhoto, SkippedPost } from './plan';

/** Room kept per post above its cap when checking the global cap. */
export const POST_SLACK_USD = 0.03;

export type FindFn = (needs: PhotoNeed[], profile: PhotoProfile, deps: PhotoDeps, opts: FindOptions) => Promise<FoundPhotos>;

export type FrameResult = { id: string; label: string; copy: string; need: PhotoNeed; old: OldPhoto | null; new: Photo | null; trace: string[] };

export type PostResult = {
  type: PhotoProfileId;
  postId: string;
  date: string;
  status: string;
  title: string;
  notes: string[];
  excludeCount: number;
  /** 'ran': the shared finder ran; 'planned': dry mode; 'cap': the global cap left no room for this post. */
  outcome: 'ran' | 'planned' | 'cap';
  costUsd: number;
  frames: FrameResult[];
};

export type CompareResults = {
  generatedAt: string;
  mode: 'dry' | 'go';
  capUsd: number;
  spentUsd: number;
  posts: PostResult[];
  skipped: SkippedPost[];
};

export type RunOptions = {
  mode: 'dry' | 'go';
  capUsd: number;
  /** Required for 'go'. */
  find?: FindFn;
  deps?: PhotoDeps;
  /** The post's own exclude (7-day used URLs as of its build). */
  exclude: (post: ComparePost) => Promise<{ urls: Set<string>; note: string | null }>;
  now?: () => Date;
  log?: (line: string) => void;
};

const planned = (post: ComparePost, outcome: PostResult['outcome'], excludeCount: number, notes: string[]): PostResult => ({
  type: post.type, postId: post.postId, date: post.date, status: post.status, title: post.title, notes, excludeCount, outcome, costUsd: 0,
  frames: post.frames.map((f) => ({ id: f.id, label: f.label, copy: f.copy, need: f.need, old: f.old, new: null, trace: [] })),
});

export async function runComparison(posts: ComparePost[], skipped: SkippedPost[], o: RunOptions): Promise<CompareResults> {
  if (o.mode === 'go' && (!o.find || !o.deps)) throw new Error('go mode needs find and deps');
  const log = o.log ?? (() => {});
  const out: PostResult[] = [];
  let spent = 0;
  for (const post of posts) {
    const ex = await o.exclude(post);
    const notes = [...post.notes, ...(ex.note ? [ex.note] : [])];
    if (o.mode === 'dry') {
      out.push(planned(post, 'planned', ex.urls.size, notes));
      continue;
    }
    const profile = PHOTO_PROFILES[post.type];
    // A post can run a cent or two past its cap (one look sheet past the check), so each post reserves a little slack.
    if (spent + profile.capUsd + POST_SLACK_USD > o.capUsd + 1e-9) {
      log(`cap: $${spent.toFixed(3)} spent of $${o.capUsd.toFixed(2)}; ${post.type} ${post.postId} needs room for $${profile.capUsd.toFixed(2)}, not run`);
      out.push(planned(post, 'cap', ex.urls.size, [...notes, `not run: the global cap ($${o.capUsd.toFixed(2)}) had no room for this post's $${profile.capUsd.toFixed(2)}`]));
      continue;
    }
    const budget = { usd: 0, capUsd: profile.capUsd };
    log(`${post.type} ${post.postId}: ${post.frames.length} frame(s), exclude ${ex.urls.size}`);
    let found: FoundPhotos;
    try {
      found = await o.find!(post.frames.map((f) => f.need), profile, o.deps!, { exclude: ex.urls, budget });
    } catch (err) {
      // findPhotos never throws; a stub might. Keep the spend so far and say so.
      found = { photos: post.frames.map(() => null), traces: post.frames.map(() => [`compare: the finder threw (${err instanceof Error ? err.message : String(err)})`]) };
    }
    spent += budget.usd;
    log(`  $${budget.usd.toFixed(4)} (run total $${spent.toFixed(4)})`);
    out.push({
      ...planned(post, 'ran', ex.urls.size, notes),
      costUsd: budget.usd,
      frames: post.frames.map((f, i) => ({ id: f.id, label: f.label, copy: f.copy, need: f.need, old: f.old, new: found.photos[i] ?? null, trace: found.traces[i] ?? [] })),
    });
  }
  return { generatedAt: (o.now ?? (() => new Date()))().toISOString(), mode: o.mode, capUsd: o.capUsd, spentUsd: spent, posts: out, skipped };
}

/** The plan as plain lines for the terminal (dry mode). */
export function planLines(r: CompareResults): string[] {
  const lines: string[] = [];
  for (const p of r.posts) {
    lines.push(`${p.type.toUpperCase()} ${p.postId} ${p.date} [${p.status}] ${p.title.slice(0, 90)}`);
    lines.push(`  exclude: ${p.excludeCount} used URL(s); frames: ${p.frames.length}`);
    for (const f of p.frames) {
      const n = f.need;
      const subj = n.subjects.map((s) => `${s.name}/${s.type}`).join(', ') || '-';
      lines.push(`  - ${f.label}: ${n.kind} "${n.query.slice(0, 60)}" [${n.specificity}${n.cover ? ', cover' : ''}] subjects: ${subj}; urls ${n.storyUrls.length}; old: ${f.old ? f.old.src.slice(0, 70) : 'none'}`);
    }
    for (const note of p.notes) lines.push(`  note: ${note}`);
  }
  for (const s of r.skipped) lines.push(`SKIPPED ${s.type} ${s.postId}: ${s.reason}`);
  const needs = r.posts.reduce((a, p) => a + p.frames.length, 0);
  lines.push(`${r.posts.length} post(s), ${needs} need(s), ${r.skipped.length} skipped. ${r.mode === 'dry' ? 'Dry: no model or Serper calls.' : `Spent $${r.spentUsd.toFixed(4)} of $${r.capUsd.toFixed(2)}.`}`);
  return lines;
}
