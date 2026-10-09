import { isVertical } from '@/lib/social-hub/verticals';
import type { HubParams } from '@/lib/social-hub/links';

/**
 * Old hub URLs keep working (REDESIGN plan B1): the v1 Calendar landing,
 * Content House tabs, and the analytics `?v=` / `?tab=` shapes map to the
 * new places. Returns null when the URL is already current.
 */

function query(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
}

/** `/social` (the old Calendar landing) with calendar or drawer params. */
export function legacyRootRedirect(base: string, params: HubParams): string | null {
  if (params.post) {
    const from = params.day || params.month ? `${base}/calendar${query({ month: params.month, day: params.day })}` : base;
    return `${base}/post/${encodeURIComponent(params.post)}${query({ from })}`;
  }
  if (params.day || params.month) return `${base}/calendar${query({ month: params.month, day: params.day })}`;
  return null;
}

/** `/social/house?tab=…` → its new home. */
export function legacyHouseRedirect(base: string, params: HubParams): string {
  const v = isVertical(params.v) ? params.v : null;
  switch (params.tab) {
    case 'ideas':
      return `${base}/content/pools/${v ?? 'reels'}`;
    case 'all':
    case 'types':
    case 'sources':
      return v ? `${base}/analytics/${v}` : `${base}/analytics`;
    case 'deck':
      return `${base}/calendar`;
    default:
      return base;
  }
}

/** `/social/analytics?v=…&tab=…` → the routed shape. */
export function legacyAnalyticsRedirect(base: string, params: HubParams): string | null {
  const keep = { range: params.range, from: params.from, to: params.to, metric: params.metric };
  if (params.tab === 'compare') {
    return `${base}/analytics/compare${query({ ...keep, ids: params.cmp, mode: params.mode, factor: params.factor })}`;
  }
  if (isVertical(params.v)) {
    const filters = Object.fromEntries(Object.entries(params).filter(([k]) => k.startsWith('f.')));
    return `${base}/analytics/${params.v}${query({ ...keep, ...filters })}`;
  }
  if (params.tab === 'profile' || params.tab === 'content') return `${base}/analytics${query(keep)}`;
  return null;
}
