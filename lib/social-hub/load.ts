import { explainersHubQuery, liveHubQuery, type HubQuery } from '@/lib/social-hub/db';
import { buildDataset, type HubDataset, type VerticalReads } from '@/lib/social-hub/dataset';
import { readCarousels } from '@/lib/social-hub/queries/carousels';
import { readAccount } from '@/lib/social-hub/queries/account';
import { readCosts } from '@/lib/social-hub/queries/costs';
import { readExplainers } from '@/lib/social-hub/queries/explainers';
import { readLatestQuota } from '@/lib/social-hub/queries/quota';
import { latestQuotaSnapshot } from '@/lib/social-hub/refresh';
import { readReels } from '@/lib/social-hub/queries/reels';
import { readSpine } from '@/lib/social-hub/queries/spine';
import { readStories } from '@/lib/social-hub/queries/stories';

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

/**
 * Read every vertical side by side (SELECT only). The lifecycle comes from ONE
 * shared spine read for every type on the main database (D48); Explainers on a
 * database of their own get their own spine read there. Each type's own
 * queries read only its content. A failing schema degrades to an error note.
 */
export async function readAll(q: HubQuery = liveHubQuery, explainersQ: Promise<HubQuery> = explainersHandle(q)): Promise<VerticalReads> {
  const shared = explainersShareMain(q);
  const mainSpine = readSpine(q, shared ? ['carousels', 'reels', 'explainers'] : ['carousels', 'reels']);
  mainSpine.catch(() => undefined); // each reader reports the failure itself
  const explainersSpine = (eq: HubQuery) => (shared ? mainSpine : readSpine(eq, ['explainers']));
  const [reels, explainers, carousels, stories] = await Promise.all([
    settle(mainSpine.then((spine) => readReels(q, spine))),
    settle(explainersQ.then(async (eq) => readExplainers(eq, await explainersSpine(eq)))),
    settle(mainSpine.then((spine) => readCarousels(q, spine))),
    settle(readStories(q)),
  ]);
  return { reels, explainers, carousels, stories };
}

export async function loadDataset(q: HubQuery = liveHubQuery, now = new Date()): Promise<HubDataset> {
  const explainersQ = explainersHandle(q);
  const [reads, costs, quota, snapshot, account] = await Promise.all([
    readAll(q, explainersQ),
    settle(readCosts(q, explainersQ)),
    readLatestQuota(q).catch(() => null),
    latestQuotaSnapshot(q, now).catch(() => null),
    readAccount(q).catch((error: unknown) => ({ present: false as const, error: error instanceof Error ? error.message : String(error) })),
  ]);
  // The sweep's snapshot wins over a publisher's refusal message when it is newer.
  const newest = [snapshot, quota].filter((x): x is { text: string | null; at: string | null } => Boolean(x?.at))
    .sort((a, b) => Date.parse(b.at!) - Date.parse(a.at!))[0] ?? null;
  return buildDataset(reads, costs, now, newest, account);
}
