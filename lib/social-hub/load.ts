import { AsyncLocalStorage } from 'node:async_hooks';

import { explainersHubQuery, liveHubQuery, type HubQuery } from '@/lib/social-hub/db';
import { buildCostPart, buildDataset, type CostPart, type HubDataset, type VerticalReads } from '@/lib/social-hub/dataset';
import { readCarousels } from '@/lib/social-hub/queries/carousels';
import { readLastFewDays } from '@/lib/social-hub/queries/last-few-days';
import { readAiEvents } from '@/lib/social-hub/queries/ai-events';
import { readAccount } from '@/lib/social-hub/queries/account';
import { readCosts } from '@/lib/social-hub/queries/costs';
import { readExplainers } from '@/lib/social-hub/queries/explainers';
import { readLatestQuota } from '@/lib/social-hub/queries/quota';
import { latestQuotaSnapshot } from '@/lib/social-hub/refresh';
import { readReels } from '@/lib/social-hub/queries/reels';
import { forVertical, readSpine, type SpineRead } from '@/lib/social-hub/queries/spine';
import { readStories } from '@/lib/social-hub/queries/stories';
import type { Vertical } from '@/lib/social-hub/types';
import { consumeMoves, readAdjustments, readDayQuotas } from '@/lib/social-hub/queries/day';
import { readLfdSettings } from '@/lib/lfd/settings';
import { readDeleted, withoutDeleted } from '@/lib/social-hub/deleted';
import { readRejected, withRejections } from '@/lib/social-hub/rejected';
import { nyDateOf } from '@/lib/social-hub/time';

function settle<T>(work: Promise<T>): Promise<T | Error> {
  return work.catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
}

/** Live reads use the explainers' own handle (D19); tests pass one PGlite for everything. */
function explainersHandle(q: HubQuery): Promise<HubQuery> {
  const handle = q === liveHubQuery ? explainersHubQuery() : Promise.resolve(q);
  handle.catch(() => undefined); // each reader reports the failure itself
  return handle;
}

/** Explainers share the main database (tests pass one handle; live: EXPLAINERS_DB=supabase with no own URL). */
function explainersShareMain(q: HubQuery): boolean {
  if (q !== liveHubQuery) return true;
  return process.env.EXPLAINERS_DB === 'supabase' && !process.env.EXPLAINERS_DATABASE_URL?.trim();
}

const SPINE_WITH_EXPLAINERS: readonly Vertical[] = ['carousels', 'reels', 'explainers', 'last_few_days', 'ai_events'];
const SPINE_WITHOUT_EXPLAINERS: readonly Vertical[] = ['carousels', 'reels', 'last_few_days', 'ai_events'];

type SpineLazy = { get: () => Promise<SpineRead> };
const spineSlot = new AsyncLocalStorage<SpineLazy>();

/**
 * Share one spine read across the verticals that miss in this rebuild.
 * A single-type refresh still reads the spine once; a full miss does not
 * read it once per type. The read starts only when a type actually misses.
 */
export function withSharedSpine<T>(q: HubQuery, run: () => Promise<T>): Promise<T> {
  const verticals = explainersShareMain(q) ? SPINE_WITH_EXPLAINERS : SPINE_WITHOUT_EXPLAINERS;
  let pending: Promise<SpineRead> | null = null;
  return spineSlot.run({ get: () => (pending ??= readSpine(q, verticals)) }, run);
}

async function spineFor(q: HubQuery, vertical: Vertical): Promise<SpineRead> {
  const shared = spineSlot.getStore();
  if (shared) return forVertical(await shared.get(), vertical);
  return readSpine(q, [vertical]);
}

/**
 * One content type (an action refresh). Stories have no spine. Explainers on
 * their own database read their spine there; on the shared database they use
 * the same spine as the other types.
 */
export async function readOne(q: HubQuery, vertical: Vertical, now = new Date(), explainersQ?: Promise<HubQuery>): Promise<NonNullable<VerticalReads[Vertical]>> {
  if (vertical === 'stories') return readStories(q);
  if (vertical === 'explainers') {
    const eq = await (explainersQ ?? explainersHandle(q));
    const spine = explainersShareMain(q) ? await spineFor(q, 'explainers') : await readSpine(eq, ['explainers']);
    return readExplainers(eq, spine);
  }
  const spine = await spineFor(q, vertical);
  if (vertical === 'reels') return readReels(q, spine);
  if (vertical === 'carousels') return readCarousels(q, spine);
  if (vertical === 'last_few_days') return readLastFewDays(q, spine);
  return readAiEvents(q, spine, now);
}

/**
 * Read every vertical side by side (SELECT only). The lifecycle comes from ONE
 * shared spine read for every type on the main database (D48); Explainers on a
 * database of their own get their own spine read there. Each type's own
 * queries read only its content. A failing schema degrades to an error note.
 */
export async function readAll(q: HubQuery = liveHubQuery, explainersQ: Promise<HubQuery> = explainersHandle(q), now = new Date()): Promise<VerticalReads> {
  const shared = explainersShareMain(q);
  const mainSpine = readSpine(q, shared ? ['carousels', 'reels', 'explainers', 'last_few_days', 'ai_events'] : ['carousels', 'reels', 'last_few_days', 'ai_events']);
  mainSpine.catch(() => undefined); // each reader reports the failure itself
  const explainersSpine = (eq: HubQuery) => (shared ? mainSpine : readSpine(eq, ['explainers']));
  const [reels, explainers, carousels, stories, lastFewDays, aiEvents] = await Promise.all([
    settle(mainSpine.then((spine) => readReels(q, spine))),
    settle(explainersQ.then(async (eq) => readExplainers(eq, await explainersSpine(eq)))),
    settle(mainSpine.then((spine) => readCarousels(q, spine))),
    settle(readStories(q)),
    settle(mainSpine.then((spine) => readLastFewDays(q, spine))),
    settle(mainSpine.then((spine) => readAiEvents(q, spine, now))),
  ]);
  return { reels, explainers, carousels, stories, last_few_days: lastFewDays, ai_events: aiEvents };
}

/** Read and allocate the cost ledger on its own (it is cached apart from the content; views/cached-dataset.ts). */
export async function loadCostPart(q: HubQuery = liveHubQuery, explainersQ: Promise<HubQuery> = explainersHandle(q)): Promise<CostPart> {
  return buildCostPart(await settle(readCosts(q, explainersQ)));
}

/**
 * `costs`: a cost part already read (the cached one); left out, the ledger is read here.
 * `reads`: per-type reads already in hand (the per-type cache). Left out, every type is read.
 */
export async function loadDataset(q: HubQuery = liveHubQuery, now = new Date(), costs?: Promise<CostPart>, reads?: VerticalReads): Promise<HubDataset> {
  const explainersQ = explainersHandle(q);
  const [verticals, costPart, quota, snapshot, account, adjustments, dayQuotas, deleted, lfdPublishingLive, rejected] = await Promise.all([
    reads ?? readAll(q, explainersQ, now),
    costs ?? loadCostPart(q, explainersQ),
    readLatestQuota(q).catch(() => null),
    latestQuotaSnapshot(q, now).catch(() => null),
    readAccount(q).catch((error: unknown) => ({ present: false as const, error: error instanceof Error ? error.message : String(error) })),
    readAdjustments(q, nyDateOf(now)!).catch(() => []),
    readDayQuotas(q, explainersQ, now).catch(() => null),
    // Before the column exists (or if the read fails) nothing is hidden, so the hub never fails on it.
    readDeleted(q).catch(() => []),
    // SELECT only (lib/lfd/settings.ts); an unreadable lfd schema reads as off.
    readLfdSettings(q).then((s) => s.publishingLive).catch(() => false),
    readRejected(q).catch(() => []),
  ]);
  // The sweep's snapshot wins over a publisher's refusal message when it is newer.
  const newest = [snapshot, quota].filter((x): x is { text: string | null; at: string | null } => Boolean(x?.at))
    .sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!))[0] ?? null;
  const dataset = withRejections(withoutDeleted(buildDataset(verticals, costPart, now, newest, account), deleted), rejected);
  // B8: moves last until their idea is made; used ones are marked here and drop out. A failure never fails the page.
  const active = await consumeMoves(q, adjustments, dataset.posts).catch(() => adjustments);
  return { ...dataset, adjustments: active, dayQuotas, lfdPublishingLive };
}
