import { loadHome } from '@/lib/home/loadHome';
import { loadHubDataset } from '@/lib/social-hub/views/cached-dataset';

import { isDataWarmablePath, normalizeWarmPath } from '@/lib/hub/warm-paths';

export type WarmDataScope = 'home' | 'social-hub-dataset';

export type WarmDataResult = {
  scope: WarmDataScope;
  durationMs: number;
};

/**
 * Fill shared caches for a hub link target. Does not render RSC or run
 * page-specific reads (calendar week, analytics filters, trello workspace).
 */
export async function warmHubData(
  rawPath: string,
  userId: string,
  email: string,
): Promise<WarmDataResult | null> {
  const path = normalizeWarmPath(rawPath);
  if (!path || !isDataWarmablePath(path)) return null;
  const started = performance.now();
  if (path === '/') {
    await loadHome(userId, email);
    return { scope: 'home', durationMs: Math.round(performance.now() - started) };
  }
  await loadHubDataset();
  return { scope: 'social-hub-dataset', durationMs: Math.round(performance.now() - started) };
}
