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
