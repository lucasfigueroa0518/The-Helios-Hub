import type { Format, Vertical } from '@/lib/social-hub/types';

export type VerticalInfo = {
  id: Vertical;
  label: string;
  short: string;
  format: Format;
  /** CSS custom property holding the vertical's calendar color (SH-12). */
  colorVar: string;
  /** The vertical's own workshop page (SH-25). */
  href: string;
  /** Where its review / approval lives when the hub doesn't approve it. */
  reviewHref: string;
};

export const VERTICALS: readonly VerticalInfo[] = [
  { id: 'reels', label: 'Text on Screen', short: 'Text', format: 'reel', colorVar: '--sh-v-reels', href: '/reels', reviewHref: '/reels' },
  { id: 'explainers', label: 'Explainer Reels', short: 'Explainer', format: 'reel', colorVar: '--sh-v-explainers', href: '/explainers', reviewHref: '/explainers/reels' },
  { id: 'carousels', label: 'Carousels', short: 'Carousel', format: 'feed', colorVar: '--sh-v-carousels', href: '/carousels', reviewHref: '/social' },
  { id: 'stories', label: 'IG Stories', short: 'Story', format: 'story', colorVar: '--sh-v-stories', href: '/stories', reviewHref: '/stories' },
  { id: 'last_few_days', label: 'Last Few Days', short: 'LFD', format: 'feed', colorVar: '--sh-v-last_few_days', href: '/last-few-days', reviewHref: '/last-few-days' },
  { id: 'ai_events', label: 'AI Events This Week', short: 'AI Events', format: 'feed', colorVar: '--sh-v-ai_events', href: '/ai-events', reviewHref: '/ai-events' },
];

export const VERTICAL_IDS: readonly Vertical[] = VERTICALS.map((v) => v.id);

export const FORMAT_LABEL: Record<Format, string> = {
  reel: 'Reel',
  feed: 'Feed post',
  story: 'Story',
};

export const FORMAT_PLURAL: Record<Format, string> = {
  reel: 'Reels',
  feed: 'Feed posts',
  story: 'Story sets',
};

export function verticalInfo(id: Vertical): VerticalInfo {
  const found = VERTICALS.find((v) => v.id === id);
  if (!found) throw new Error(`unknown vertical: ${id}`);
  return found;
}

export function isVertical(value: unknown): value is Vertical {
  return typeof value === 'string' && (VERTICAL_IDS as readonly string[]).includes(value);
}

/** The content types that have a page of their own (their idea pool, posts and settings): all of them. */
export const TYPE_PAGE_IDS: readonly Vertical[] = ['reels', 'explainers', 'carousels', 'stories', 'last_few_days', 'ai_events'];

/** A content type's own page (its `href`): /reels, /carousels, /stories, /explainers, /last-few-days and /ai-events. */
export function typeHref(vertical: Vertical, base = '/social'): string {
  // The fixture preview has its own mirror of the hub-hosted pages; Text on Screen is a separate app page.
  return base === '/social/preview' && vertical !== 'reels' ? `${base}/type/${vertical}` : verticalInfo(vertical).href;
}
