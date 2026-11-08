/**
 * The engine's live dependencies, wired one way for the worker (scripts/social_worker.ts) and any
 * human one-shot. This is the ONLY file in lib/field-notes that builds a real Claude client, Jev
 * transport, browser or bucket handle. The run cap is enforced by the engine's budget meter
 * (lib/field-notes/budget.ts) over the clients built here. Network modules load only when this is
 * called; tests never call it (CLAUDE.md Rule 1).
 */
import type { HubQuery } from '@/lib/social-hub/db';

import type { FieldNotesEngineDeps } from './run';
import type { TipCandidate } from './sources/candidate';

export async function liveFieldNotesDeps(query: HubQuery, o: { capUsd: number; now?: Date }): Promise<FieldNotesEngineDeps> {
  // A NaN or Infinity cap would switch off the budget: refuse it before anything is built.
  if (!Number.isFinite(o.capUsd) || o.capUsd <= 0) throw new Error(`Field Notes run cap must be a positive number (got ${String(o.capUsd)})`);
  const { mediaBucket } = await import('@/lib/media-bucket');
  const { SLIDE_BUCKET } = await import('@/lib/social/overnight/config');
  const { PHOTO_BANK_BUCKET } = await import('@/lib/media-library/types');
  const { newAnthropic } = await import('@/lib/anthropic-client');
  const { liveJevTransport } = await import('@/lib/reels/jev/client');
  const { fetchJson, fetchText, fetchPageFollowingRedirects } = await import('@/lib/reels/net/http');
  const { planAndRenderPost, withBrowser } = await import('./render/render');
  const { createMediaPipeDetectFaces } = await import('./render/faces');
  const { SOURCE_REGISTRY, collectThinCandidates } = await import('./sources/registry');
  const { PAGE_MAX_BYTES } = await import('./sources/enrich');
  const { FIELD_NOTES_SOURCES_CONFIG } = await import('./sources/config');
  const { parseDocsPage } = await import('./sources/docs-adapter');

  const now = o.now ?? new Date();
  const anthropic = newAnthropic();
  const slides = mediaBucket(SLIDE_BUCKET);
  const bank = mediaBucket(PHOTO_BANK_BUCKET);
  const SINCE_DAYS = 45;
  /** Feeds and docs pages (the largest audited is 4.8 MB): a byte cap well above them, so nothing real is cut. */
  const SOURCE_MAX_BYTES = 16_000_000;
  // The enrichment of the last collect: the run calls it only for the candidates it is about to score.
  let enrichFound: ((subset: readonly TipCandidate[]) => Promise<TipCandidate[]>) | null = null;

  return {
    query,
    claude: { messages: { create: (params) => anthropic.messages.create(params) } },
    // The model-backed fact check is a hard gate; writePost builds it over the budget-guarded client, so it is metered.
    factCheck: 'model',
    jev: liveJevTransport,
    // Thin candidates only: no README or linked page is fetched here. The run drops stored links, takes the scoring
    // slots, then calls `enrich` for just those (CLAUDE.md Rule 2: nothing stored is fetched for).
    collect: async (): Promise<TipCandidate[]> => {
      const thin = await collectThinCandidates(SOURCE_REGISTRY, {
        fetchText: (url) => fetchText(url, { retries: 0, timeoutMs: 15_000, maxBytes: SOURCE_MAX_BYTES }),
        fetchJson: <T>(url: string) => fetchJson<T>(url, { retries: 0, timeoutMs: 15_000, maxBytes: SOURCE_MAX_BYTES }),
        fetchEnrichText: (url) => fetchText(url, { retries: 0, timeoutMs: 15_000, maxBytes: PAGE_MAX_BYTES }),
        fetchPage: (url) => fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000, blockPrivate: true, maxBytes: PAGE_MAX_BYTES }),
        now,
        since: new Date(now.getTime() - SINCE_DAYS * 86_400_000),
      });
      enrichFound = thin.enrich;
      return thin.candidates;
    },
    enrich: async (candidates) => (enrichFound ? enrichFound(candidates) : [...candidates]),
    // A seeded link's page text, read like the docs adapter reads one. No model. A person supplied the link, so
    // private and internal addresses are refused at the first URL and at every redirect hop, and the page is capped.
    fetchSource: async (url) => {
      const page = await fetchPageFollowingRedirects(url, { retries: 0, timeoutMs: 15_000, blockPrivate: true, maxBytes: PAGE_MAX_BYTES });
      const html = page.html.slice(0, PAGE_MAX_BYTES);
      const [item] = parseDocsPage(html, { name: new URL(page.finalUrl).hostname, pageUrl: page.finalUrl, format: 'auto' });
      return item ? `${item.headline}\n\n${item.body}` : null;
    },
    renderPost: (inputs, r) =>
      withBrowser((browser) => planAndRenderPost(inputs, { browser, detectFaces: createMediaPipeDetectFaces(browser), darkenCap: r.darkenCap })),
    loadPhoto: (masterPath) => bank.download(masterPath),
    upload: (p, b) => slides.upload(p, b, 'image/jpeg'),
    now,
    config: FIELD_NOTES_SOURCES_CONFIG,
  };
}
