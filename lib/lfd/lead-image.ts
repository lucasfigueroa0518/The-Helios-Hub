/**
 * The article's own lead image, tried before the Stories finder (approved
 * 2026-10-13 after the finder's generic fallback reached 4 of 5 slides). A
 * credited in-body figure at least 600px wide (largest first), else the
 * page's og:image credited to the outlet. Obvious
 * non-photos (svg, gif, logos, icons, avatars, sprites) and photos already
 * used in the set or the last 7 days are skipped. Null: the finder takes over.
 */
import type { ArticlePhoto, PageRead } from '@/lib/social/reporter/read-page';
import type { Photo } from '@/lib/stories/render/types';

import type { Pick } from './types';

export const LEAD_MIN_WIDTH = 600;

const NOT_A_PHOTO = /\.(svg|gif)(?:$|[?#])|logo|icon|avatar|sprite/i;

function usable(p: ArticlePhoto, exclude: Set<string>): boolean {
  return Boolean(p.src) && !exclude.has(p.src) && !NOT_A_PHOTO.test(p.src);
}

export async function leadImage(
  read: (url: string) => Promise<PageRead>,
  pick: Pick,
  exclude: Set<string>,
): Promise<{ photo: Photo; note: string } | null> {
  const page = await read(pick.url).catch(() => null);
  if (!page || !page.ok) return null;
  const figure = page.photos
    .filter((p) => p.from === 'figure' && usable(p, exclude) && (p.credit ?? '').trim() !== '' && (p.width ?? 0) >= LEAD_MIN_WIDTH)
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0))[0];
  if (figure) {
    const credit = figure.credit!.trim();
    return { photo: { src: figure.src, credit, kind: 'scene' }, note: `lead image: article figure, ${figure.width}px, credit "${credit}": ${figure.src}` };
  }
  const og = page.photos.find((p) => p.from === 'og:image' && usable(p, exclude) && (p.width == null || p.width >= LEAD_MIN_WIDTH));
  if (og) {
    const credit = `Image via ${pick.sourceName}`;
    return { photo: { src: og.src, credit, kind: 'scene' }, note: `lead image: og:image${og.width ? `, ${og.width}px` : ''}, credit "${credit}": ${og.src}` };
  }
  return null;
}
