/**
 * One Field Notes run (a person's Generate; auto_run ships off): one post from TIP_SLIDES_MIN to TIP_SLIDES_MAX (3 to 6) tips, one per tip slide.
 *
 *   room for a draft (max_pending_drafts) -> expire old unused tips -> the tips:
 *     a person's seeded tip goes first (no scoring; it keeps the seeder's leaf and want), then other
 *     unused seeds oldest first, under the same post rules as found tips (DISTINCT subjects, at most half the post
 *     (rounded up, never under two) of one want: sources/select admitSeeds; a seed that does not fit waits for a later post), then, only when
 *     the scoring questions are approved, new candidates (public pages, no model): collected thin, links already
 *     stored dropped (one lookup), at most MAX_CANDIDATES_PER_SOURCE per source, MAX_SCORED_PER_RUN slots shared
 *     round-robin in registry order (sources/select scoringOrder); only those slots are enriched (README or linked
 *     page: `enrich`), then each is scored and tagged by Jev under the cap and saved only once scored (the rest are
 *     found again by a later run). Then selection: DISTINCT subjects (normalized title, one per GitHub repo), nothing
 *     already posted (URL, repo, subject, or a head naming a posted subject or repo), at most half the post of one
 *     want (rounded up, never under two: maxPerWant) and at most half the post from repo leaves (rounded down, never
 *     under two: maxRepoTips; each relaxed only to reach TIP_SLIDES_MIN), a feature-leaf tip
 *     (coding agent, chat app, technique) on every post that has one eligible, feature leaves then the least recently
 *     used want on near ties, up to TIP_SLIDES_MAX (scores carry the about_ai gate: a non-AI tip scores 0)
 *   -> a people photo and enough rested photos before anything is paid for -> one Writer call over all
 *   the tips, Editor, gates (write/writePost; a tip the source cannot support is skipped, and fewer
 *   than TIP_SLIDES_MIN supported slides ends the run `insufficient_source` with no draft) -> pick
 *   photos (cover: people; the rest rule) -> place and render (render/planAndRenderPost via the
 *   injected `renderPost`; a cover with no face swaps for another people photo) -> JPEGs to Storage
 *   -> the post row, then the photos rest and each used tip is drafted with its slide's headline as its subject.
 *
 * Re-pay guards: a tip the Writer skips is rejected (reason 'writer-skipped'), and so is a tip whose slide the fact
 * check dropped while the rest of the post passed (reason 'fact-check: <first problem>'; it is never on the post), so
 * neither is paid for again; every
 * other tip the Writer was paid for in a run that then saved no post (a gate, too few supported tips, a failed or
 * invalid write, an Editor error, the cap, a later failure) gets one attempt (store.recordTipAttempt, with the
 * reason) and is set aside at MAX_TIP_ATTEMPTS, so one transient failure never sinks a seed for good.
 *
 * Only new work is touched (CLAUDE.md Rule 2): the paid scoring call goes only to candidates this run just found
 * that are not stored yet; seeds are never scored (they carry the seeder's tags). Tips stored earlier are read as a lookup only
 * (already scored candidates may be selected); nothing here scores or tags a row this run did not save.
 * Every paid call goes through the budget meter (lib/field-notes/budget.ts) on the injected
 * clients; this file builds no client and reaches no network (the live wiring is live.ts).
 *
 * The engine never finishes the run row: the worker (worker.ts) puts the post on the spine and
 * records the outcome and its spend.
 */
import type { FieldNotesBudget } from './budget';
import { createFieldNotesBudget, FieldNotesBudgetExhausted } from './budget';
import { buildFieldNotesCaption, withSourceLinks } from './caption';
import { FIELD_NOTES_SLIDE_PREFIX, MAX_SCORED_PER_RUN } from './config';
import { asIntakeQuery, saveIntakeTips, type FieldNotesIntakeDeps, type FieldNotesIntakeMode } from './intake';
import { draftToSlideInputs, layoutsToSlides, splitProblems } from './post';
import { calendarDateKey, SOCIAL_TIMEZONE } from '@/lib/instagram/clock';
import type { HubQuery } from '@/lib/social-hub/db';
import type { JevTransport } from '@/lib/reels/jev/runner';
import { checkPhotoPool, MIN_POST_PHOTOS, pickPhotos, pickPostPhotos, pickReplacement, publishedPhotoIds } from './photos/pool';
import { readUsedLedger, USED_PHOTO_DAYS } from '@/lib/photos/used';
import { listPool, recordUse, releaseRested } from './photos/store';
import type { RenderedPost } from './render/render';
import { storeFieldNotesJpegs } from './render/render';
import type { SlideInput } from './render/layout';
import type { TipCandidate } from './sources/candidate';
import { FIELD_NOTES_SOURCES_CONFIG, type FieldNotesSourcesConfig } from './sources/config';
import { dedupeCandidates } from './sources/candidate';
import { scoreCandidate } from './sources/score';
import { admitSeeds, MAX_CANDIDATES_PER_SOURCE, scoringOrder, selectTips } from './sources/select';
import {
  expireOldTips,
  freeSlug,
  getTip,
  insertPost,
  listSelectableTips,
  listUnusedSeedTips,
  nextPostSeq,
  pendingDraftCount,
  postedSourceUrls,
  postedSubjects,
  recentPostWants,
  recordTipAttempt,
  rejectTip,
  saveCandidateTip,
  setTipContent,
  setTipStatus,
  setTipSubject,
  storedSourceUrls,
  type RunKind,
  type StoredTip,
} from './store';
import type { ParsedFieldNotesSettings } from './settings';
import { TIP_SLIDES_MAX, TIP_SLIDES_MIN, type Tip, type Want } from './types';
import { DUPE_CHECK_MAX, findPostedDuplicates } from './sources/dupe-check';
import { COVER_HOOK_GAP, pickCoverHeadline } from './write/caps';
import { INSUFFICIENT_SOURCE_REASON, writePost, type FieldNotesClient } from './write/call';
import { UNTRUSTED_EXCERPT_CAP } from './write/caps';
import type { FactChecker } from './write/types';

/** The fewest photos a post can need: cover, three tip slides and the Follow slide (checked before the Writer is paid). Each further tip, up to TIP_SLIDES_MAX, needs one more (6 tips: 8 photos). */
export { MIN_POST_PHOTOS };
/** Rounds of swapping a photo whose slide found no calm region for the text. */
export const MAX_PHOTO_SWAPS = 3;
export { MAX_SCORED_PER_RUN };
export { MAX_CANDIDATES_PER_SOURCE };

export type FieldNotesEngineDeps = {
  query: HubQuery;
  /** Writer and Editor transport (live: live.ts; tests: a stub with canned tool_use responses). */
  claude: FieldNotesClient;
  /** Jev transport for scoring found candidates (tests: a stub). Absent: nothing is scored, so nothing found is saved. */
  jev?: JevTransport;
  /** New candidate tips from the source registry (public pages, no model), thin: nothing enriched yet. Unseeded runs only. */
  collect?: () => Promise<TipCandidate[]>;
  /**
   * Enrich the candidates about to be scored (README or linked page; public pages, no model). Called only with the
   * scoring slots, after stored links are dropped. Absent: they are scored as collected.
   */
  enrich?: (candidates: TipCandidate[]) => Promise<TipCandidate[]>;
  /** Told the tips the moment the Writer is about to be paid for them (the local runner settles them if it is cut off). */
  onWriteStarted?: (tipIds: string[]) => void;
  /** The page text for a seeded link that came without text (public page, no model). */
  fetchSource?: (url: string) => Promise<string | null>;
  /** Plan and render a post's slides (live: render/planAndRenderPost with the MediaPipe face detector; tests: stub). */
  renderPost: (inputs: SlideInput[], o: { darkenCap: number }) => Promise<RenderedPost>;
  /** The bytes of a bank photo by its master path. */
  loadPhoto: (masterPath: string) => Promise<Buffer>;
  upload: (objectPath: string, body: Buffer) => Promise<void>;
  now: Date;
  /** questionsApproved (live: the real config). Scoring refuses while false. */
  config?: FieldNotesSourcesConfig;
  /** The fact checker for the writing gates (default: the numeral check). 'model' = the model-backed hard gate, built over the SAME metered client the Writer uses. */
  factCheck?: FactChecker | 'model';
  /**
   * Central intake (Phase 2): the 'field-notes' consumer switch and the order's scored stories (live: lib/intake/read).
   * In 'intake' mode a run neither collects nor scores: it saves the intake's scored stories as candidate tips
   * (intake.ts). Absent, 'legacy' or 'stale-fallback' (or an intake read that throws): the collect + score path.
   */
  intake?: FieldNotesIntakeDeps;
};

export type FieldNotesRunInput = {
  runId: string;
  kind: RunKind;
  /** The person's seeded tip (it goes first), or null to start from the unused seeds, else the best scored tips. */
  seedTipId: string | null;
  capUsd: number;
  settings: Pick<ParsedFieldNotesSettings, 'photoRestPosts' | 'maxPendingDrafts' | 'tipExpiryDays' | 'darkenCap'>;
};

export type FieldNotesRunRecord = Record<string, unknown> & { kind: RunKind; seedTipId: string | null };

type Spend = { claudeUsd: number; jevUsd: number };

export type FieldNotesRunResult =
  | ({ ok: true; outcome: 'saved'; postId: string; seq: number; slug: string; slides: number; tipId: string; tipIds: string[]; record: FieldNotesRunRecord } & Spend)
  | ({ ok: true; outcome: 'skipped'; stopReason: string; note: string; record: FieldNotesRunRecord } & Spend)
  | ({ ok: false; error: string; stopReason?: string; record: FieldNotesRunRecord } & Spend);

/** The day a post is dated: today in New York. */
export function postDateFor(now: Date): string {
  return calendarDateKey(now, SOCIAL_TIMEZONE);
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** A stored tip as the scorer and the selector read it (with the source's publish date when stored). Scraped text stays in `untrustedContent`. */
export function tipToCandidate(t: Tip & { publishedAt?: string | null }): TipCandidate {
  return {
    sourceUrl: t.sourceUrl ?? `tip:${t.id}`,
    sourceKind: t.sourceKind,
    sourceLabel: t.sourceLabel ?? '',
    publishedAt: t.publishedAt ?? null,
    item: {} as TipCandidate['item'],
    untrustedContent: t.untrustedContent ?? '',
  };
}

export async function runFieldNotes(d: FieldNotesEngineDeps, input: FieldNotesRunInput): Promise<FieldNotesRunResult> {
  const q = d.query;
  const budget: FieldNotesBudget = createFieldNotesBudget({ capUsd: input.capUsd });
  const record: FieldNotesRunRecord = { kind: input.kind, seedTipId: input.seedTipId };
  const spend = (): Spend => ({ claudeUsd: budget.claudeUsd(), jevUsd: budget.jevUsd() });
  const finalRecord = () => ({ ...record, spend: { ...spend(), totalUsd: budget.spent(), capUsd: budget.capUsd, calls: budget.calls() } });
  const skipped = (stopReason: string, note: string): FieldNotesRunResult => ({ ok: true, outcome: 'skipped', stopReason: `${stopReason}: ${note}`, note, record: finalRecord(), ...spend() });
  const failed = (error: string, stopReason?: string): FieldNotesRunResult => ({ ok: false, error, ...(stopReason ? { stopReason } : {}), record: finalRecord(), ...spend() });
  const nyDate = postDateFor(d.now);
  // A paid run that saves no post settles its tips so the next Generate does not pay for them forever: a tip the
  // Writer skipped is already rejected; every other attempted tip (seeds included) counts an attempt with the reason
  // (store.recordTipAttempt: set aside, with that reason, at MAX_TIP_ATTEMPTS). Never a bare reject: one failed write
  // (an Editor 529, an invalid draft, the cap mid-Editor) must not sink a tip for good. A person puts one back by
  // seeding the same link again. Failures before any spend leave them waiting.
  let attemptedTipIds: string[] = [];
  let draftedTipIds: string[] = [];
  const skippedTipIds = new Set<string>();
  let postSaved = false;
  let settled = false;
  // Tips are claimed ('selected') the moment this run picks them, so a run that overlaps it never picks the same
  // tips (Tommy's one-time parallel test, 2026-11-08); the finally block releases what did not reach a post.
  const claimedTipIds: string[] = [];
  const claimTips = async (ids: string[]) => {
    if (!ids.length) return;
    await q(`UPDATE field_notes.tips SET status = 'selected', updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'candidate'`, [ids]);
    claimedTipIds.push(...ids);
  };
  const settleUnsavedTips = async (why: string) => {
    // Only a paid Claude call counts against a tip: a rejected key, an outage or a refused cap before any Claude spend
    // says nothing about the tip (first local runs, 2026-11-08). Scoring spend (Jev) does not count.
    if (settled || postSaved || !attemptedTipIds.length || budget.claudeUsd() <= 0) return;
    settled = true;
    for (const id of attemptedTipIds) {
      if (skippedTipIds.has(id)) continue;
      await recordTipAttempt(q, id, why).catch(() => undefined);
    }
  };

  try {
    // 1. Room for a draft (the review queue is never allowed to pile up).
    const pending = await pendingDraftCount(q);
    if (pending >= input.settings.maxPendingDrafts) {
      return skipped('pending-drafts', `${pending} Field Notes posts are waiting for review (the limit is ${input.settings.maxPendingDrafts}); approve or reject one first.`);
    }

    // 2. Unused tips older than the expiry go (housekeeping on the type's own candidates).
    record.expiredTips = await expireOldTips(q, d.now, input.settings.tipExpiryDays);

    // 3. The tips: a person's seeded tip first, other unused seeds next (oldest first), then (scoring approved) new
    // candidates. Seeds obey the post rules too: distinct subjects and at most maxPerWant(post size) of one want; a seed that
    // does not fit waits for a later post. A post needs TIP_SLIDES_MIN and takes up to TIP_SLIDES_MAX.
    const config = d.config ?? FIELD_NOTES_SOURCES_CONFIG;
    const seeds: StoredTip[] = [];
    if (input.seedTipId) {
      const seed = await getTip(q, input.seedTipId);
      if (!seed || seed.status !== 'candidate') return skipped('seed-unavailable', `the seeded tip ${input.seedTipId} is missing or already used.`);
      seeds.push(seed);
    }
    for (const seed of await listUnusedSeedTips(q)) if (!seeds.some((t) => t.id === seed.id)) seeds.push(seed);
    const seedFit = admitSeeds(seeds, TIP_SLIDES_MAX);
    let tips: Tip[] = seedFit.admitted;
    if (seedFit.waiting.length) record.seedsWaiting = seedFit.waiting.map((t) => t.id);
    record.seeded = tips.length > 0;
    if (!tips.length && !config.questionsApproved) {
      return skipped('scoring-not-approved', 'there is no seeded tip and the scoring questions are not approved yet (Tommy approves them for Lucas), so nothing is scored. Paste seed links, or approve the questions.');
    }

    // 4. A people photo and enough rested photos before anything is paid for. The tip count is capped by the photos
    // (cover + one per tip + Follow), so a draft is never written that cannot be placed.
    const nextSeq = await nextPostSeq(q);
    await releaseRested(q, nextSeq, input.settings.photoRestPosts);
    // CI-32: team photos any post published in the last 20 days sit out too (the ledger, by bank key or dHash).
    const fullPool = await listPool(q);
    let published = new Set<string>();
    try {
      const ledger = await readUsedLedger(q, d.now);
      const { rows: hashed } = await q<{ id: string; dhash: string | null }>(`SELECT id::text AS id, dhash FROM media_library.photos WHERE id = ANY($1::uuid[])`, [fullPool.map((p) => p.photoId)]);
      published = publishedPhotoIds(fullPool, ledger, new Map(hashed.map((r) => [r.id, r.dhash])));
    } catch (err) {
      record.photoLedger = `the used-photo ledger could not be read (${err instanceof Error ? err.message : String(err)}); only the rest rule applies`;
    }
    if (published.size) record.photosPublishedRecently = [...published];
    const pool = fullPool.filter((p) => !published.has(p.photoId));
    const available = pickPhotos({ pool, nextSeq, restPosts: input.settings.photoRestPosts, count: 100 });
    record.photosAvailable = available.length;
    record.peoplePhotosAvailable = available.filter((p) => p.kind === 'people').length;
    const poolCheck = checkPhotoPool({ pool, nextSeq, restPosts: input.settings.photoRestPosts });
    if (!poolCheck.ok) {
      if (published.size) console.log(`field notes: photo pool short; ${published.size} photo(s) are held back as published in the last ${USED_PHOTO_DAYS} days (CI-32)`);
      return skipped('photos-short', published.size ? `${poolCheck.message} (${published.size} more are held back: published in the last ${USED_PHOTO_DAYS} days.)` : poolCheck.message);
    }
    const maxTips = Math.min(TIP_SLIDES_MAX, available.length - 2);

    // Only seeds are used while the scoring questions are not approved; with them approved the rest is found and scored.
    // Re-admitted at the photo-capped size: the per-want cap scales with the post, so a smaller post may hold fewer
    // seeds of one want (the rest wait for a later post, like any seed that does not fit).
    if (tips.length) {
      const fit = admitSeeds(tips, maxTips);
      tips = fit.admitted;
      if (fit.waiting.length) {
        const waiting = new Set([...((record.seedsWaiting as string[] | undefined) ?? []), ...fit.waiting.map((t) => t.id)]);
        record.seedsWaiting = seeds.filter((t) => waiting.has(t.id)).map((t) => t.id);
      }
    }
    if (config.questionsApproved && tips.length < maxTips) {
      tips.push(...(await pickScoredTips(d, input, budget, record, { count: maxTips - tips.length, taken: tips })));
    }
    if (tips.length < TIP_SLIDES_MIN) {
      return skipped(
        'no-tip',
        `a post needs at least ${TIP_SLIDES_MIN} tips with different subjects and ${tips.length} ${tips.length === 1 ? 'is' : 'are'} available (seeded links, plus scored ones once the questions are approved). Paste more seed links.`,
      );
    }
    record.tipIds = tips.map((t) => t.id);
    await claimTips(tips.map((t) => t.id));
    record.tipId = tips[0]!.id;
    record.tipSources = tips.map((t) => ({ id: t.id, kind: t.sourceKind, url: t.sourceUrl, label: t.sourceLabel }));

    // A seeded link that came without text gets its page text (public page, no model).
    for (const [i, t] of tips.entries()) {
      if (t.sourceKind === 'seed' && !t.untrustedContent?.trim() && t.sourceUrl && d.fetchSource) {
        const text = (await d.fetchSource(t.sourceUrl).catch(() => null))?.trim();
        if (text) {
          const clipped = text.slice(0, UNTRUSTED_EXCERPT_CAP);
          await setTipContent(q, t.id, clipped);
          tips[i] = { ...t, untrustedContent: clipped };
        }
      }
    }

    // 5. Write: one Writer call over all the tips, Editor, gates, on the metered client. When the Writer skips tips and
    // too few are left, ONE refill round swaps in the next stored tips under the same post rules and writes again
    // (first local runs, 2026-11-08: two honest skips ended a run that had dozens of good candidates).
    let written!: Awaited<ReturnType<typeof writePost>>;
    let skippedTips: NonNullable<typeof written.skipped> = [];
    let droppedTips: NonNullable<typeof written.dropped> = [];
    for (let round = 1; round <= 2; round++) {
      attemptedTipIds = [...new Set([...attemptedTipIds, ...tips.map((t) => t.id)])];
      d.onWriteStarted?.(tips.map((t) => t.id));
      written = await writePost(budget.guardClaude(d.claude), tips, { factCheck: d.factCheck });
      const roundSkips = written.skipped ?? [];
      skippedTips = [...skippedTips, ...roundSkips];
      const roundDropped = written.dropped ?? [];
      droppedTips = [...droppedTips, ...roundDropped];
      record.write = {
        notes: written.notes,
        calls: (((record.write as { calls?: number } | undefined)?.calls) ?? 0) + written.usage.length,
        skippedTips,
        ...(droppedTips.length ? { dropped: droppedTips } : {}),
        ...(round > 1 ? { refilled: true } : {}),
      };
      // A tip the Writer skipped (its source does not say what the thing is and does, or it is not about AI) is set aside for
      // good: no run pays for it again.
      for (const sk of roundSkips) {
        if (!attemptedTipIds.includes(sk.tipId) || skippedTipIds.has(sk.tipId)) continue;
        skippedTipIds.add(sk.tipId);
        await rejectTip(q, sk.tipId, `writer-skipped: ${sk.missing || 'the source does not say what the thing is and does'}`);
      }
      // A slide the fact check dropped (the rest of the post passed) is set aside the same way: its tip is never on
      // the post and no run pays for it again.
      for (const dr of roundDropped) {
        if (!attemptedTipIds.includes(dr.tipId) || skippedTipIds.has(dr.tipId)) continue;
        skippedTipIds.add(dr.tipId);
        await rejectTip(q, dr.tipId, `fact-check: ${dr.problems[0] ?? 'a claim on its slide is not supported by the source'}`);
      }
      const supported = written.ok ? written.draft.slides.length : tips.filter((t) => !skippedTipIds.has(t.id)).length;
      const short = (!written.ok && written.reason === INSUFFICIENT_SOURCE_REASON) || (written.ok && supported < TIP_SLIDES_MIN);
      // Refill whenever the Writer skipped a tip and the post has room, not only when it fell below the minimum: a post
      // that reaches the fact check with spare slides can lose one there and still stand (local run, 2026-11-08).
      const roomLeft = supported < maxTips;
      if (round > 1 || !(short || roomLeft) || !roundSkips.length || !config.questionsApproved || !budget.canSpend()) break;
      const kept = tips.filter((t) => !skippedTipIds.has(t.id));
      const keptIds = new Set(kept.map((t) => t.id));
      const more = (await selectStoredTips(d, input, { count: maxTips - kept.length, taken: kept, recentWants: (((record.found as { recentWants?: Want[] } | undefined)?.recentWants) ?? []), budget, record }))
        .filter((t) => !keptIds.has(t.id) && !skippedTipIds.has(t.id))
        .slice(0, maxTips - kept.length);
      if (kept.length + more.length < TIP_SLIDES_MIN) break;
      tips = [...kept, ...more];
      record.tipIds = tips.map((t) => t.id);
      await claimTips(more.map((t) => t.id));
      record.tipId = tips[0]!.id;
      record.tipSources = tips.map((t) => ({ id: t.id, kind: t.sourceKind, url: t.sourceUrl, label: t.sourceLabel }));
    }
    // The tips the Writer wrote a slide for (the run record's count): the draft's, or every attempted tip it did not skip.
    draftedTipIds = written.draft ? [...new Set(written.draft.slides.map((sl) => sl.tipId))] : attemptedTipIds.filter((id) => !skippedTipIds.has(id));
    const insufficient = async (reason: string) => {
      // Spend is recorded; no draft. Skipped tips are rejected above; the supported ones count an attempt.
      record.insufficientSource = { supported: written.ok ? written.draft.slides.length : draftedTipIds.length, needed: TIP_SLIDES_MIN, skippedTips };
      await settleUnsavedTips('insufficient_source');
      return skipped('insufficient_source', reason);
    };
    if (!written.ok) {
      if (written.reason === INSUFFICIENT_SOURCE_REASON) return await insufficient(`the sources support fewer than ${TIP_SLIDES_MIN} tips the source can explain, so no draft was written (${skippedTips.map((x) => x.missing).filter(Boolean).slice(0, 3).join('; ') || 'no source said what the thing is and does'}).`);
      if (budget.exhausted()) {
        await settleUnsavedTips('cap');
        return failed(`the run cap stopped the writing: ${written.reason}`, 'cap');
      }
      if (written.gates?.hard.length) {
        // The draft's tips count an attempt (one near-duplicate slide must not sink every tip for good).
        await settleUnsavedTips(`gate: ${written.gates.hard.map((h) => h.gate).join(', ')}`);
        return failed(`the draft failed a hard gate: ${written.reason}`, 'gate');
      }
      await settleUnsavedTips('write-failed');
      return failed(`writing failed: ${written.reason}`, 'write-failed');
    }
    const draft = written.draft;
    if (draft.slides.length < TIP_SLIDES_MIN) return await insufficient(`only ${draft.slides.length} tip(s) were supported by their sources; a post needs ${TIP_SLIDES_MIN}.`);
    // The tips on the post, in slide order (a tip the Writer skipped or the fact check dropped was rejected above and
    // has no slide; the cover count and the photos follow these slides).
    const tipIds = [...new Set(draft.slides.map((sl) => sl.tipId))];
    if (tipIds.some((id) => !tips.some((t) => t.id === id))) throw new Error('the Writer named a tip that was not on the request');
    record.tipIds = tipIds;
    record.tipId = tipIds[0];

    // 6. Photos: cover + one per tip slide + Follow. The picker (photos/pool.ts) puts a people photo first (a starred
    // opener preferred), spreads working, scenery and event over the tip slides and never repeats a photo; newest upload
    // wins ties. Its warnings are kept on the run record. A slide the renderer cannot place text on gets a replacement
    // photo (step 7); a cover with no face gets another people photo.
    const need = draft.slides.length + 2;
    if (available.length < need) {
      if (published.size) console.log(`field notes: photo pool short for ${need} photos; ${published.size} photo(s) are held back as published in the last ${USED_PHOTO_DAYS} days (CI-32)`);
      await settleUnsavedTips('photos-short');
      return skipped('photos-short', `the post has ${draft.slides.length} tip slides and needs ${need} photos; ${available.length} are ready. Upload more.`);
    }
    const pick = pickPostPhotos({ pool: await listPool(q), nextSeq, restPosts: input.settings.photoRestPosts, count: need, published });
    record.photoWarnings = pick.warnings;
    const byId = new Map(available.map((p) => [p.photoId, p]));
    const chosen = pick.photoIds.map((id) => byId.get(id)!);
    const { rows: paths } = await q<{ id: string; master_path: string }>(`SELECT id::text AS id, master_path FROM media_library.photos WHERE id = ANY($1::uuid[])`, [chosen.map((p) => p.photoId)]);
    const masterOf = new Map(paths.map((r) => [r.id, r.master_path]));
    const photos: Array<{ photoId: string; bytes: Buffer }> = [];
    for (const p of chosen) {
      const master = masterOf.get(p.photoId);
      if (!master) throw new Error(`photo ${p.photoId} is not in the photo bank`);
      photos.push({ photoId: p.photoId, bytes: await d.loadPhoto(master) });
    }
    const photoIds = chosen.map((p) => p.photoId);

    // 7. Place and render. A slide whose text found no calm region (even after reframing), or a cover whose photo
    // shows no face (`cover_no_face`), gets a different photo (the cover's is always a people photo), up to MAX_PHOTO_SWAPS rounds; if nothing else is available the problem is stored and shown on review.
    // Fonts that did not load make the fit meaningless: nothing is stored then.
    const rejectedPhotoIds: string[] = [];
    const swaps: Array<{ slide: number; from: string; to: string }> = [];
    // The cover hook rotates and never repeats within COVER_HOOK_GAP posts (Tommy, 2026-11-08).
    const recentCovers = (
      await q<{ h: string | null }>(
        `SELECT slides->0->'blocks'->-1->>'text' AS h FROM field_notes.posts ORDER BY seq DESC LIMIT $1`,
        [COVER_HOOK_GAP - 1],
      )
    ).rows.map((r) => r.h ?? '');
    const coverHeadlineText = pickCoverHeadline(draft.slides.length, recentCovers);
    record.coverHeadline = coverHeadlineText;
    const renderOnce = () => d.renderPost(draftToSlideInputs({ draft, photos, coverHeadline: coverHeadlineText }), { darkenCap: input.settings.darkenCap });
    let rendered = await renderOnce();
    for (let round = 0; round < MAX_PHOTO_SWAPS; round += 1) {
      const failed = rendered.layouts.map((l, i) => (l.placementFailed ? i : -1)).filter((i) => i >= 0);
      if (!failed.length) break;
      let swapped = false;
      for (const i of failed) {
        rejectedPhotoIds.push(photoIds[i]!);
        const replacement = pickReplacement({ pool: await listPool(q), nextSeq, restPosts: input.settings.photoRestPosts, chosen: photoIds, index: i, exclude: [...rejectedPhotoIds, ...published] });
        if (!replacement) continue;
        record.photoWarnings = [...((record.photoWarnings as string[] | undefined) ?? []), ...replacement.warnings];
        const { rows: found } = await q<{ master_path: string }>(`SELECT master_path FROM media_library.photos WHERE id = $1::uuid`, [replacement.photoId]);
        const master = found[0]?.master_path;
        if (!master) throw new Error(`photo ${replacement.photoId} is not in the photo bank`);
        swaps.push({ slide: i + 1, from: photoIds[i]!, to: replacement.photoId });
        photoIds[i] = replacement.photoId;
        photos[i] = { photoId: replacement.photoId, bytes: await d.loadPhoto(master) };
        swapped = true;
      }
      if (!swapped) break;
      rendered = await renderOnce();
    }
    record.photoIds = photoIds;
    if (swaps.length) record.photoSwaps = swaps;
    const problems = splitProblems(rendered.problems);
    if (problems.fatal.length) throw new Error(`the render is broken: ${problems.fatal.slice(0, 3).join('; ')}`);
    const slides = layoutsToSlides(rendered.layouts);
    const softNotes = written.notes;
    record.fit = { fit: problems.fit.length, render: problems.render.length, notes: softNotes.length };

    // 8. Storage, then the row.
    const slug = await freeSlug(q, nyDate);
    const slideObjects = await storeFieldNotesJpegs(`${slug}/v1`, rendered.slides.map((s) => s.jpeg), { upload: d.upload, prefix: FIELD_NOTES_SLIDE_PREFIX });
    const saved = await insertPost(q, slug, {
      runId: input.runId,
      tipIds,
      nyDate,
      slides,
      photoIds,
      caption: buildFieldNotesCaption(draft.caption, withSourceLinks(draft.slides, tips)),
      slideObjects,
      fitProblems: problems.fit,
      renderProblems: problems.render,
      softNotes,
    });
    postSaved = true;
    // The post exists, so its seq is known: now the photos rest and the tip is used.
    await recordUse(q, photoIds, saved.seq);
    for (const id of tipIds) await setTipStatus(q, id, 'drafted');
    // Each tip's subject becomes its slide's headline, so the same feature found again elsewhere is not posted twice.
    for (const sl of draft.slides) await setTipSubject(q, sl.tipId, sl.name);
    record.post = { id: saved.id, seq: saved.seq, slug, slides: slideObjects.length };
    return { ok: true, outcome: 'saved', postId: saved.id, seq: saved.seq, slug, slides: slideObjects.length, tipId: tipIds[0]!, tipIds, record: finalRecord(), ...spend() };
  } catch (error) {
    await settleUnsavedTips(`error: ${errorText(error).slice(0, 120)}`);
    if (error instanceof FieldNotesBudgetExhausted) return failed(errorText(error), 'cap');
    return failed(errorText(error));
  } finally {
    // Tips this run claimed but did not put on a post go back to the pool (rejected and drafted ones keep their status).
    if (claimedTipIds.length) await q(`UPDATE field_notes.tips SET status = 'candidate', updated_at = now() WHERE id = ANY($1::uuid[]) AND status = 'selected'`, [claimedTipIds]).catch(() => undefined);
  }
}

/**
 * Find new candidates and score the ones not stored yet (CLAUDE.md Rule 2: never a row an earlier run left), then
 * select up to `count` with distinct subjects (not already on the post) from the scored candidates.
 *
 * Collect (thin) -> drop links already stored (one lookup) -> at most MAX_CANDIDATES_PER_SOURCE per source -> the
 * MAX_SCORED_PER_RUN slots round-robin across sources in registry order -> only those slots enriched -> each slot
 * scored, then saved with its score and tags. A candidate that is not scored (no slot, the cap, a failed call) is NOT saved, so a later run finds
 * it again. Spend stops at the cap.
 *
 * Intake mode (Central Intake Phase 2, `d.intake` says 'intake'): no collect, no enrich, no scoring here; the order's
 * scored stories not yet stored are saved as candidates (intake.ts saveIntakeTips), then the same selection.
 */
async function pickScoredTips(
  d: FieldNotesEngineDeps,
  input: FieldNotesRunInput,
  budget: FieldNotesBudget,
  record: FieldNotesRunRecord,
  o: { count: number; taken: Tip[] },
): Promise<Tip[]> {
  const q = d.query;
  // Intake mode: the intake already fetched and scored Field Notes' sources; save what is new to field_notes.tips and
  // select. A failed intake read falls back to the legacy path below (contract: switch + fallback).
  const mode: FieldNotesIntakeMode = d.intake ? await d.intake.readConsumerMode(asIntakeQuery(q), 'field-notes', d.now).catch(() => 'legacy' as const) : 'legacy';
  if (mode === 'intake') {
    const fromIntake = await saveIntakeTips(q, d.intake!, d.now).catch((error: unknown) => {
      record.intake = { mode, fallback: errorText(error).slice(0, 200) };
      return null;
    });
    if (fromIntake) {
      record.intake = { mode };
      const recentWants = await recentPostWants(q);
      record.found = { ...fromIntake, recentWants };
      return selectStoredTips(d, input, { count: o.count, taken: o.taken, recentWants, budget, record });
    }
  } else if (mode === 'stale-fallback') record.intake = { mode };
  const config = d.config ?? FIELD_NOTES_SOURCES_CONFIG;
  const found = dedupeCandidates(d.collect ? await d.collect() : []);
  const stored = await storedSourceUrls(q, found.map((c) => c.sourceUrl));
  const fresh = found.filter((c) => !stored.has(c.sourceUrl));
  let queue = scoringOrder(fresh, { slots: MAX_SCORED_PER_RUN, perSource: MAX_CANDIDATES_PER_SOURCE });
  // Fetch pages and READMEs only for what will be scored now (never for a stored link), and only when it can be.
  const enriching = !!(d.jev && d.enrich && queue.length && budget.canSpend());
  if (enriching) {
    const thin = queue;
    queue = await d.enrich!(thin).catch(() => thin);
  }
  const today = postDateFor(d.now);
  const failures: Array<{ sourceUrl: string; error: string }> = [];
  let scored = 0;
  let added = 0;
  if (d.jev) {
    const jev = budget.guardJev(d.jev);
    for (const c of queue) {
      if (!budget.canSpend()) break;
      try {
        const r = await scoreCandidate(c, { transport: jev, today, config });
        scored += 1;
        // Saved only now, with its score and tags (found tips are never seeds). A link another writer saved meanwhile is skipped.
        if (await saveCandidateTip(q, c, r.score, r)) added += 1;
      } catch (error) {
        if (error instanceof FieldNotesBudgetExhausted) break;
        failures.push({ sourceUrl: c.sourceUrl, error: errorText(error) });
      }
    }
  }
  const recentWants = await recentPostWants(q);
  record.found = {
    collected: found.length,
    alreadyStored: found.length - fresh.length,
    queued: queue.length,
    enriched: enriching ? queue.length : 0,
    scored,
    added,
    leftForLater: fresh.length - added,
    failures: failures.slice(0, 10),
    recentWants,
  };
  return selectStoredTips(d, input, { count: o.count, taken: o.taken, recentWants, budget, record });
}

/**
 * Choose up to `count` stored, selectable tips under the post rules, around the tips already `taken`. No fetching and
 * no scoring: it reads what earlier steps stored. Also used to refill a post after the Writer skips tips.
 */
async function selectStoredTips(
  d: FieldNotesEngineDeps,
  input: FieldNotesRunInput,
  o: { count: number; taken: Tip[]; recentWants: Want[]; budget?: FieldNotesBudget; record?: FieldNotesRunRecord },
): Promise<Tip[]> {
  const q = d.query;
  const recentWants = o.recentWants;
  // A tip already on the post is never a candidate for another of its slots.
  const takenIds = new Set(o.taken.map((t) => t.id));
  let tips = (await listSelectableTips(q)).filter((t) => !takenIds.has(t.id));
  // Reworded duplicates (field-notes-dupe@1, Tommy 2026-11-08): the top candidates each get one cheap question,
  // "the same feature as anything already posted?"; a yes sets the tip aside for good. Only this run's top picks.
  if (o.budget && d.jev && o.budget.canSpend()) {
    const posted = await postedSubjects(q);
    const top = tips.filter((t) => (t.score ?? 0) > 0).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, DUPE_CHECK_MAX);
    if (posted.length && top.length) {
      const { duplicates, asked } = await findPostedDuplicates(top.map((t) => ({ id: t.id, untrustedContent: t.untrustedContent })), posted, { jev: o.budget.guardJev(d.jev) });
      for (const id of duplicates) await rejectTip(q, id, 'duplicate-of-posted: the same feature as something already posted');
      const dup = new Set(duplicates);
      tips = tips.filter((t) => !dup.has(t.id));
      if (o.record) {
        const prev = (o.record.dupeCheck as { asked: number; duplicates: number } | undefined) ?? { asked: 0, duplicates: 0 };
        o.record.dupeCheck = { asked: prev.asked + asked, duplicates: prev.duplicates + duplicates.length };
      }
    }
  }
  const byUrl = new Map(tips.map((t) => [tipToCandidate(t).sourceUrl, t]));
  const choice = selectTips(
    {
      scored: tips
        .filter((t) => t.score !== null)
        .map((t) => ({
          candidate: tipToCandidate(t), score: t.score as number, answers: {}, usd: 0, questionSetVersion: '',
          leaf: t.leaf, want: t.want, tier: t.tier, purposes: t.purposes, fresh: t.fresh,
          firstSeenAt: t.createdAt, subject: t.subject,
        })),
      now: d.now,
      tipExpiryDays: input.settings.tipExpiryDays,
      postedUrls: await postedSourceUrls(q),
      postedSubjects: await postedSubjects(q),
      takenSubjects: o.taken.map((t) => t.subject),
      takenUrls: o.taken.map((t) => t.sourceUrl),
      takenWants: o.taken.map((t) => t.want),
      takenLeaves: o.taken.map((t) => t.leaf),
      recentWants,
      minTotal: TIP_SLIDES_MIN,
    },
    o.count,
  );
  return choice.map((c) => byUrl.get(c.candidate.sourceUrl)).filter((t): t is StoredTip => !!t);
}
