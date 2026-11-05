/** Paths where hover may call /api/hub/warm (data only, no RSC render). */
export function normalizeWarmPath(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//') || trimmed.includes('\\')) return null;
  const path = trimmed.split('?')[0]?.split('#')[0] ?? '';
  if (!path) return null;
  return path.length > 1 ? path.replace(/\/$/, '') : path;
}

export function isDataWarmablePath(pathname: string): boolean {
  const path = normalizeWarmPath(pathname);
  if (!path) return false;
  if (path === '/') return true;
  if (path === '/social' || path.startsWith('/social/')) {
    return !path.startsWith('/social/render');
  }
  return false;
}
