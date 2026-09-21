/**
 * Atmospheric photo fallback — the Path B source.
 *
 * When a story has no named subject to portrait, we reach for editorial
 * photography that matches the beat's context. Curated Unsplash photo IDs
 * mapped to keyword themes — hotlink-friendly, no auth, stable URLs.
 *
 * Photo IDs are Unsplash's internal identifier (the slug after
 * `/photos/`). Building the URL keeps that ID visible so attribution is
 * one lookup away. When we move to the paid Unsplash API (Phase 3d), swap
 * this file for a search-by-keyword call and keep the same picker API.
 *
 * Attribution: every Unsplash photo requires photographer credit under
 * their license. The `attribution` field carries the required strings;
 * compose pipeline surfaces them in the post caption and alt text.
 */

export type AtmospherePhoto = {
  /** Unsplash photo ID — the slug after `/photos/`. */
  id: string;
  /** Direct image CDN URL, 1200px wide (hotlink-safe). */
  url: string;
  /** Required Unsplash attribution shown in caption + alt text. */
  attribution: { photographer: string; profileUrl: string };
};

/**
 * Curated by keyword theme. Each entry chosen for editorial neutrality —
 * no logos, no dated fashion, no faces of specific real people (that's
 * what Path A is for). Keywords should read as one word or a short phrase.
 */
export const ATMOSPHERE_LIBRARY: Record<string, AtmospherePhoto> = {
  boardroom: {
    id: 'g1Kr4Ozfoac',
    url: 'https://images.unsplash.com/photo-1517048676732-d65bc937f952?w=1200',
    attribution: { photographer: 'Jason Goodman', profileUrl: 'https://unsplash.com/@jasongoodman_youxventures' },
  },
  office: {
    id: 'wD1LRb9OeEo',
    url: 'https://images.unsplash.com/photo-1497366216548-37526070297c?w=1200',
    attribution: { photographer: 'Copernico', profileUrl: 'https://unsplash.com/@copernicowip' },
  },
  code: {
    id: 'OqtafYT5kTw',
    url: 'https://images.unsplash.com/photo-1461749280684-dccba630e2f6?w=1200',
    attribution: { photographer: 'Luca Bravo', profileUrl: 'https://unsplash.com/@lucabravo' },
  },
  data: {
    id: 'iar-afB0QQw',
    url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=1200',
    attribution: { photographer: 'Carlos Muza', profileUrl: 'https://unsplash.com/@kmuza' },
  },
  chip: {
    id: 'FnA5pAzqhMM',
    url: 'https://images.unsplash.com/photo-1518770660439-4636190af475?w=1200',
    attribution: { photographer: 'Michael Dziedzic', profileUrl: 'https://unsplash.com/@lazycreekimages' },
  },
  conference: {
    id: 'Q1p7bh3SHj8',
    url: 'https://images.unsplash.com/photo-1540575467063-178a50c2df87?w=1200',
    attribution: { photographer: 'Product School', profileUrl: 'https://unsplash.com/@productschool' },
  },
  cityscape: {
    id: 'mR1CIDduGLc',
    url: 'https://images.unsplash.com/photo-1449824913935-59a10b8d2000?w=1200',
    attribution: { photographer: 'Mike Kononov', profileUrl: 'https://unsplash.com/@lazycreekimages' },
  },
  research: {
    id: 'aVvZJC0ynBQ',
    url: 'https://images.unsplash.com/photo-1532094349884-543bc11b234d?w=1200',
    attribution: { photographer: 'Alex Kondratiev', profileUrl: 'https://unsplash.com/@alexkondratiev' },
  },
};

/**
 * Return the atmospheric photo for a keyword, or null if unknown. The
 * compose pipeline should fall through to a story-type default (see
 * picker.ts) when the specific keyword isn't in the library.
 */
export function resolveAtmosphere(keyword: string): AtmospherePhoto | null {
  return ATMOSPHERE_LIBRARY[keyword.trim().toLowerCase()] ?? null;
}
