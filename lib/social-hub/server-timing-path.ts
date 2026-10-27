/** Request header that ties one Social Hub render to its Server-Timing spans. */
export const HUB_TIMING_HEADER = 'x-hub-timing';

/**
 * Full RSC responses for these routes carry Server-Timing. A partial prefetch
 * (the shell) is not one of them and is never held for the seal.
 */
export function isTimedHubPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/$/, '') : pathname;
  if (path === '/social' || path === '/social/calendar') return true;
  if (path === '/social/analytics' || path.startsWith('/social/analytics/')) return true;
  if (path === '/social/health' || path.startsWith('/social/health/')) return true;
  if (path.startsWith('/social/post/')) return true;
  if (path.startsWith('/social/content/pools/')) return true;
  return false;
}
