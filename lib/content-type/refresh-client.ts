'use client';

/**
 * router.refresh() for pages that read the shared hub dataset: mark the cached
 * read stale first so the refresh shows what just changed. A failed mark still
 * refreshes (the read is at most a minute old).
 */
export async function refreshHubPage(router: { refresh: () => void }): Promise<void> {
  await fetch('/api/content-type/progress', { method: 'POST' }).catch(() => undefined);
  router.refresh();
}

/**
 * After a seed lands: refresh the hub dataset, and run the page's own reload when it keeps its list in browser state
 * (the /reels page loads its queue from /api/reels/overview, which router.refresh() does not touch, so a new seed
 * stayed out of the list until a manual reload).
 */
export async function refreshAfterSeed(router: { refresh: () => void }, onSeeded?: () => void | Promise<void>): Promise<void> {
  await Promise.all([refreshHubPage(router), onSeeded?.()]);
}
