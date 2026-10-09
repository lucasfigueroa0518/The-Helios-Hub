/**
 * The photo bank as a source (DECISIONS_LOG D49): photos earlier finder runs
 * vetted and stored (lib/media-library/). Searched only when a bank reader
 * is passed (`deps.bank`) and `media_library.settings.finder_source` isn't
 * "off"; it then returns nothing new to judge: the same tag fit, close-up and
 * 7-day rules apply to its candidates as to any other.
 *
 *   person            first: that verified person's headshots and second
 *                     photos (by Wikidata ID, never by name or tags)
 *   thematic, setting first: scenes whose tags share the request's words,
 *                     most shared words first, then the least recently used
 *                     (the used-photo log), then the bigger image
 *   company, logo     a fallback when the online sources leave nothing
 *                     usable: its headquarters, its logo
 *   product, event    never (they need today's photos)
 *
 * Candidates keep their original lane and source (the 7-day rule's
 * exemptions follow the lane) and offer the original URL. Scenes stay
 * unverified, so they go through the contact sheet and the close-up check
 * again for the new request.
 *
 * "compete": bank candidates join the online ones and the ranking decides.
 * "first": once the bank alone has MAX_CANDIDATES usable ones, the online
 * sources for that request are skipped.
 */
import type { BankHit } from '@/lib/media-library/reader';
import type { VisualKind, VisualRequest } from '@/lib/social/writer/draft';

import { MAX_CANDIDATES, SPREAD_MIN_ASPECT, type Candidate, type PhotoSource, type Source, type SourceRun } from '../find';
import { identityOf } from '../p18';

/** Where the bank sits in each kind's route. */
export const BANK_ROUTE: Partial<Record<VisualKind, 'first' | 'fallback'>> = {
  person: 'first',
  thematic: 'first',
  setting: 'first',
  company: 'fallback',
  logo: 'fallback',
};

/** Hits fetched per request before the final ordering. */
const LOOK_AT = 12;

const SOURCES = new Set<PhotoSource>(['article', 'official', 'commons', 'second', 'logo', 'ceo', 'hq', 'commons-search', 'stock']);

/** The latest use of any of a photo's URLs ('' when never used). */
const lastUse = (urls: string[], lastUsed: Map<string, string>) => urls.reduce<string>((max, u) => {
  const t = lastUsed.get(u) ?? '';
  return t > max ? t : max;
}, '');

/** Most shared words, then least recently used (never used first), then the bigger image. */
export function orderHits(hits: BankHit[], lastUsed: Map<string, string>): BankHit[] {
  return [...hits].sort((a, b) => b.overlap - a.overlap || lastUse(a.urls, lastUsed).localeCompare(lastUse(b.urls, lastUsed)) || b.width * b.height - a.width * a.height);
}

function toCandidate(h: BankHit, request: VisualRequest, qid: string | null): Candidate {
  const scene = h.lane === 'stocksnap' || h.lane === 'openverse' || h.lane === 'commons-search';
  const source = (SOURCES.has(h.source as PhotoSource) ? h.source : scene ? 'stock' : 'commons') as PhotoSource;
  return {
    url: h.url,
    credit: h.credit,
    source,
    width: h.width,
    height: h.height,
    qid: scene ? null : qid,
    // People and companies: the verified subject asked for (the bank matched its Wikidata ID).
    subject: scene ? null : request.query,
    lane: h.lane,
    date: h.date,
    title: h.title,
    verified: !scene,
    ...(h.plate ? { plate: h.plate } : {}),
    ...(h.faces ? { faces: h.faces } : {}),
  };
}

export const bankSource: Source = async function bank(request: VisualRequest, run: SourceRun) {
  const reader = run.deps.bank;
  if (!reader) return [];
  const mode = await reader.mode();
  if (mode === 'off') return [];
  let qid: string | null = null;
  if (request.kind === 'person' || request.kind === 'company' || request.kind === 'logo') {
    // The same identity check (and cache) as the online sources: never a match by name.
    const id = await identityOf(request.query, run.ctx.brief, run.deps, run.ctx.identities);
    const want = request.kind === 'person' ? 'person' : 'organization';
    if (!id.ok || id.type !== want) {
      run.steps.push(`bank: no verified ${want} "${request.query}"`);
      return [];
    }
    run.identity ??= { subject: request.query, ok: true, detail: `${id.qid} "${id.label}" — ${id.description} (${id.type}, ${id.via})`, scores: id.scores };
    qid = id.qid;
  }
  const hits = await reader.find({ kind: request.kind, query: request.query, qid, recent: run.ctx.recent, cover: Boolean(run.cover), limit: LOOK_AT });
  const fits = (h: BankHit) => !run.wide || (h.width && h.height && h.width / h.height >= SPREAD_MIN_ASPECT);
  const ordered = orderHits(hits.filter(fits), run.ctx.lastUsed).slice(0, MAX_CANDIDATES);
  const out = ordered.map((h) => toCandidate(h, request, qid));
  run.steps.push(`bank (${mode}) ${request.kind} "${request.query}": ${hits.length} found, ${out.length} offered${out.length ? ` (${ordered.map((h) => `${h.lane}${h.overlap ? ` ${h.overlap} tags` : ''} ${h.width}×${h.height}`).join('; ')})` : ''}`);
  if (mode === 'first' && BANK_ROUTE[request.kind] === 'first' && out.length >= MAX_CANDIDATES) run.stop = true;
  return out;
};
