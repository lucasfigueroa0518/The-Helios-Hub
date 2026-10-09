import type { Vertical } from '@/lib/social-hub/types';
import { isVertical, verticalInfo } from '@/lib/social-hub/verticals';
import { monthLabel } from '@/lib/social-hub/time';

/**
 * Where the person is (REVISIONS G10): the active hub tab and the breadcrumb
 * trail, derived from the path. A post remembers the list it was opened from
 * through `?from=`, so its tab, breadcrumb and Back all point there.
 */

export type HubTab = 'content' | 'calendar' | 'analytics';

export const HUB_TABS: ReadonlyArray<{ id: HubTab; label: string; path: string }> = [
  { id: 'content', label: 'Content', path: '' },
  { id: 'calendar', label: 'Calendar', path: '/calendar' },
  { id: 'analytics', label: 'Analytics', path: '/analytics' },
];

/** The path after the base: "/social/preview/analytics/reels" → "/analytics/reels". */
export function restOf(base: string, path: string): string {
  const bare = path.split(/[?#]/)[0] ?? '';
  return bare.startsWith(base) ? bare.slice(base.length) : bare;
}

export function sectionOf(rest: string): HubTab | 'post' {
  if (rest.startsWith('/post/')) return 'post';
  if (rest.startsWith('/calendar')) return 'calendar';
  if (rest.startsWith('/analytics')) return 'analytics';
  return 'content';
}

export function activeHubTab(base: string, path: string, from: string | null): HubTab {
  const section = sectionOf(restOf(base, path));
  if (section !== 'post') return section;
  if (!from) return 'content';
  const origin = sectionOf(restOf(base, from));
  return origin === 'post' ? 'content' : origin;
}

/**
 * A `from` value is trusted only when it is a hub path under the same base:
 * no scheme, no protocol-relative `//`, no backslashes, not itself a post.
 */
export function safeFrom(base: string, raw: string | null | undefined): string | null {
  if (!raw || raw.length > 500) return null;
  // A content type's own page (live hub only) is a place a post can be opened from.
  const typePage = base === '/social' && /^\/(carousels|stories|explainers)(\?|$)/.test(raw);
  if (!typePage && !(raw === base || raw.startsWith(`${base}/`) || raw.startsWith(`${base}?`))) return null;
  if (typePage) return raw.includes('\\') ? null : raw;
  if (raw.includes('\\') || raw.slice(base.length).includes('//') || /[a-z][a-z0-9+.-]*:/i.test(raw.slice(0, raw.indexOf('?') === -1 ? raw.length : raw.indexOf('?')))) return null;
  if (sectionOf(restOf(base, raw)) === 'post') return null;
  return raw;
}

export type Crumb = { label: string; href: string | null };

const LIBRARY_LABEL: Record<string, string> = { music: 'Music pool', photos: 'Photo bank' };

/** The trail for a hub path; the last crumb is the current page (no href). */
const isTypePage = (part: string | undefined): part is Exclude<Vertical, 'reels'> => part === 'carousels' || part === 'stories' || part === 'explainers';

export function crumbsFor(base: string, href: string): Crumb[] {
  const rest = restOf(base, href);
  const search = new URLSearchParams(href.includes('?') ? href.slice(href.indexOf('?') + 1) : '');
  const parts = rest.split('/').filter(Boolean);
  const trail: Crumb[] = [];
  const push = (label: string, path: string) => trail.push({ label, href: `${base}${path}` });

  if (parts[0] === 'calendar') {
    push('Calendar', '/calendar');
    const month = search.get('month');
    const day = search.get('day');
    if (day) trail.push({ label: monthLabel(day.slice(0, 7)), href: `${base}/calendar?month=${day.slice(0, 7)}` });
    else if (month) trail[trail.length - 1] = { label: `Calendar · ${monthLabel(month)}`, href: `${base}/calendar?month=${month}` };
  } else if (parts[0] === 'analytics') {
    push('Analytics', '/analytics');
    if (parts[1] === 'compare') push('Compare', '/analytics/compare');
    else if (isVertical(parts[1])) push(verticalInfo(parts[1]).label, `/analytics/${parts[1]}`);
  } else if (isTypePage(parts[0])) {
    // A content type's own page lives outside the hub base (/carousels …): Content › its name.
    trail.push({ label: 'Content', href: base }, { label: verticalInfo(parts[0]).label, href: `/${parts[0]}` });
  } else {
    push('Content', '');
    if (parts[0] === 'content' && parts[1] === 'pools' && isVertical(parts[2])) push(`${verticalInfo(parts[2]).label} pool`, `/content/pools/${parts[2]}`);
    if (parts[0] === 'content' && parts[1] === 'library' && parts[2] && LIBRARY_LABEL[parts[2]]) push(LIBRARY_LABEL[parts[2]]!, `/content/library/${parts[2]}`);
  }
  if (trail.length) trail[trail.length - 1] = { ...trail[trail.length - 1]!, href: null };
  return trail;
}

/** The trail for a post: its origin's trail (linked), then the post name. */
export function postCrumbs(base: string, from: string | null, name: string): Crumb[] {
  const origin = crumbsFor(base, from ?? base).map((c, i, all) => (i === all.length - 1 ? { ...c, href: from ?? base } : c));
  return [...origin, { label: name, href: null }];
}
