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
  { id: 'reels', label: 'Trial Reels', short: 'Trial', format: 'reel', colorVar: '--sh-v-reels', href: '/reels', reviewHref: '/reels' },
  { id: 'explainers', label: 'Explainer Reels', short: 'Explainer', format: 'reel', colorVar: '--sh-v-explainers', href: '/explainers', reviewHref: '/explainers/reels' },
  { id: 'carousels', label: 'Carousels', short: 'Carousel', format: 'feed', colorVar: '--sh-v-carousels', href: '/social', reviewHref: '/social/house?tab=approval' },
  { id: 'stories', label: 'IG Stories', short: 'Story', format: 'story', colorVar: '--sh-v-stories', href: '/stories', reviewHref: '/stories' },
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
