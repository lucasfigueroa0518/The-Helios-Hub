import type { Query } from '@/lib/social/store/pg';

import { createRequest } from './requests';
import type { OneBoxInput, SeedVerticalKey, StorySeries } from './types';

export const MAX_BLURB_CHARS = 600;
const VERTICALS: SeedVerticalKey[] = ['reels', 'carousels', 'last_few_days', 'stories', 'explainers'];
const SERIES: StorySeries[] = ['morning_download', 'guess_the_number', 'free_vs_paid'];
/** Open seeds a pool holds before the add function would refuse (Text on Screen has no cap). */
export const OPEN_CAP = 10;

export type PostDeps = {
  q: Query;
  approved: () => boolean;
  hasKey: () => boolean;
  /** Open seeds already waiting in this pool (series for Stories). */
  openCount: (vertical: SeedVerticalKey, series?: StorySeries) => Promise<number>;
  /** Start the work after the response; the route passes `after`. */
  schedule: (id: string, input: OneBoxInput) => void;
};

export type PostResult = { status: number; body: { id: string } | { error: string } };
const no = (status: number, error: string): PostResult => ({ status, body: { error } });

/** Validate a click and open its request. Everything refused here is refused before any spend. */
export async function handlePost(raw: unknown, deps: PostDeps): Promise<PostResult> {
  if (!deps.approved()) return no(403, 'The one-box seed isn’t switched on yet.');
  const b = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const vertical = b.vertical as SeedVerticalKey;
  if (!VERTICALS.includes(vertical)) return no(400, 'Choose a pool that takes seeds.');
  const blurb = typeof b.blurb === 'string' ? b.blurb.trim() : '';
  if (!blurb) return no(400, 'Write a sentence or two about the idea.');
  if (blurb.length > MAX_BLURB_CHARS) return no(400, `That is ${blurb.length - MAX_BLURB_CHARS} characters over the ${MAX_BLURB_CHARS} limit. Cut that much.`);
  let series: StorySeries | undefined;
  if (vertical === 'stories') {
    if (!SERIES.includes(b.series as StorySeries)) return no(400, 'Choose a series.');
    series = b.series as StorySeries;
  }
  const link = typeof b.link === 'string' ? b.link.trim() : '';
  if (link && !/^https?:\/\//i.test(link)) return no(400, 'The link must start with http:// or https://');
  if (!deps.hasKey()) return no(500, 'ANTHROPIC_API_KEY is not set.');
  if (vertical !== 'reels' && (await deps.openCount(vertical, series)) >= OPEN_CAP) return no(409, `You have ${OPEN_CAP} seeded ideas waiting here; make or archive one first. Nothing was spent.`);
  const input: OneBoxInput = { vertical, blurb, ...(series ? { series } : {}), ...(link ? { link } : {}) };
  try {
    const { id, reused } = await createRequest(deps.q, input);
    if (!reused) deps.schedule(id, input);
    return { status: 200, body: { id } };
  } catch (error) {
    return no(409, error instanceof Error ? error.message : String(error));
  }
}
