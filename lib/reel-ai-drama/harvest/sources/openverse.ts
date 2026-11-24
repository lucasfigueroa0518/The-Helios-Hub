import { buildStockCredit, searchOpenverse } from '@/lib/social/editorial/v2/image-step/openverse';

import type { Source } from '../types';

/** Openverse (research 04 §3 A): CC images from Flickr, museums and others, through the photo finder's client. */
export const OPENVERSE_LIMIT = 8;
export const OPENVERSE_MIN_SHORT_SIDE = 600;

export const openverseSource: Source = async (want, run) => {
  const found = await searchOpenverse(want.terms, { http: run.deps.http, limit: OPENVERSE_LIMIT, minShortSide: OPENVERSE_MIN_SHORT_SIDE });
  if (!found.length) run.notes.push(`openverse "${want.terms}": nothing found`);
  return found.map((c) => ({
    source: 'openverse' as const,
    want: want.id,
    kind: want.kind,
    url: c.url,
    source_page: c.foreignLandingUrl || null,
    credit: `${buildStockCredit(c)} · Openverse`,
    license: c.licenseVersion ? `${c.license} ${c.licenseVersion}` : c.license,
    caption: [c.title, ...(c.tags ?? []).slice(0, 8)].filter(Boolean).join(', '),
    people: [],
    qids: [],
    place: want.place?.name ?? null,
    date_taken: null,
    date_basis: 'unknown' as const,
    width: c.width,
    height: c.height,
    character_image: false,
    made: false,
    trusted: false,
    flags: [],
  }));
};
