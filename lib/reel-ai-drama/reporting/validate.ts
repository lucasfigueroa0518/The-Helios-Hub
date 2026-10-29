import type { FactSheet } from '@/lib/reel-ai-drama/types';

/**
 * Code checks on the reporter's fact sheet (PROCESS P2; research 01 §9). The model's sheet is never taken
 * on trust: ids must line up, every fact names a real source, a confirmed key fact has two independent
 * sources, and quotes and artifacts are word for word from a page the reporter actually fetched.
 * A broken item is dropped (or a confidence lowered) with a plain-language problem; a key fact with no
 * source left kills the story.
 */

export type ValidateOptions = {
  /** Text of every page the reporter fetched, by URL (from the web_fetch results). */
  fetched?: ReadonlyMap<string, string>;
};

export type ValidatedSheet = { sheet: FactSheet; problems: string[] };

/** A URL as a comparison key: no scheme, www, hash, query or trailing slash. */
export function urlKey(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/+$/, '');
}

const TWO_PART_SUFFIXES = new Set(['co', 'com', 'org', 'net', 'ac', 'gov', 'edu']);

/** The registrable domain, roughly: `news.bbc.co.uk` → `bbc.co.uk`, `blog.example.com` → `example.com`. */
export function siteOf(url: string): string {
  const host = urlKey(url).split('/')[0].split(':')[0];
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  const [second, tld] = parts.slice(-2);
  const take = tld.length === 2 && TWO_PART_SUFFIXES.has(second) ? 3 : 2;
  return parts.slice(-take).join('.');
}

/** Words only, for verbatim checks: case, quote marks, dashes and spacing never count as a change. */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** True when every ellipsis-separated part of `quote` appears in `page`. */
export function isVerbatim(quote: string, page: string): boolean {
  const hay = normalizeText(page);
  const parts = quote
    .split(/\.\.\.|…|\[\s*\.\.\.\s*\]/)
    .map(normalizeText)
    .filter((p) => p.length > 0);
  return parts.length > 0 && parts.every((p) => hay.includes(p));
}

function dedupeById<T extends { id: string }>(items: readonly T[], what: string, problems: string[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) {
      problems.push(`${what} id "${item.id}" repeats or is empty; the later one was dropped`);
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

/** How many independent sources a list of source ids represents: different sites and different publishers. */
export function independentCount(sourceIds: readonly string[], sources: FactSheet['sources']): number {
  const groups: { site: string; publisher: string }[] = [];
  for (const id of sourceIds) {
    const s = sources.find((x) => x.id === id);
    if (!s) continue;
    const site = siteOf(s.url);
    const publisher = normalizeText(s.publisher);
    if (groups.some((g) => g.site === site || (publisher && g.publisher === publisher))) continue;
    groups.push({ site, publisher });
  }
  return groups.length;
}

function fetchedText(url: string | null | undefined, fetched: ReadonlyMap<string, string> | undefined): string | null {
  if (!url || !fetched) return null;
  const key = urlKey(url);
  for (const [u, text] of fetched) if (urlKey(u) === key) return text;
  return null;
}

export function validateFactSheet(raw: FactSheet, opts: ValidateOptions = {}): ValidatedSheet {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.facts) || !Array.isArray(raw.sources)) {
    throw new Error('fact sheet: not a fact sheet (facts or sources missing)');
  }
  const problems: string[] = [];
  const verdict = { ...raw.verdict };

  const sources = dedupeById(raw.sources, 'source', problems).filter((s) => {
    if (/^https?:\/\//i.test(s.url ?? '')) return true;
    problems.push(`source ${s.id} has no web address; dropped`);
    return false;
  });
  const sourceIds = new Set(sources.map((s) => s.id));

  const facts: FactSheet['facts'] = [];
  for (const fact of dedupeById(raw.facts, 'fact', problems)) {
    const known = fact.source_ids.filter((id) => sourceIds.has(id));
    const unknown = fact.source_ids.filter((id) => !sourceIds.has(id));
    if (unknown.length) problems.push(`fact ${fact.id} names unknown sources ${unknown.join(', ')}`);
    if (!known.length) {
      problems.push(`fact ${fact.id} names no real source; dropped`);
      if (fact.key) {
        verdict.holds = false;
        verdict.reason = `Key fact ${fact.id} has no source: ${fact.text}`;
      }
      continue;
    }
    let confidence = fact.confidence;
    const key = fact.key || fact.core === true;
    if (key && confidence === 'confirmed' && independentCount(known, sources) < 2) {
      confidence = 'single_source';
      problems.push(`key fact ${fact.id} is marked confirmed with fewer than two independent sources; now single_source`);
    }
    facts.push({ ...fact, key, source_ids: known, confidence });
  }
  // The core (the want, the scene, the turn) must be confirmed, or the story doesn't hold (reporting HARD 3, MD-31).
  const shaky = facts.filter((f) => f.core && f.confidence !== 'confirmed');
  if (shaky.length && verdict.holds) {
    verdict.holds = false;
    verdict.reason = `A core fact is not confirmed (${shaky.map((f) => `${f.id}, ${f.confidence}`).join('; ')}): ${shaky[0]!.text}`;
  }
  const droppedCore = raw.facts.filter((f) => f.core && !facts.some((g) => g.id === f.id));
  if (droppedCore.length && verdict.holds) {
    verdict.holds = false;
    verdict.reason = `Core fact ${droppedCore[0]!.id} has no source: ${droppedCore[0]!.text}`;
  }
  const factIds = new Set(facts.map((f) => f.id));

  const timeline = raw.timeline.flatMap((entry) => {
    const ids = entry.fact_ids.filter((id) => factIds.has(id));
    if (!ids.length) {
      problems.push(`timeline entry "${entry.event}" rests on no remaining fact; dropped`);
      return [];
    }
    return [{ ...entry, fact_ids: ids }];
  });

  const urlOfSource = (id: string) => sources.find((s) => s.id === id)?.url ?? null;
  /** Dropped (null), checked word for word on a fetched page (true), or kept unchecked (false: never shown as verbatim). */
  const verbatim = (what: string, text: string, sourceId: string, ownUrl: string | null = null): boolean | null => {
    if (!text.trim()) {
      problems.push(`${what} is empty; dropped`);
      return null;
    }
    if (!sourceIds.has(sourceId)) {
      problems.push(`${what} names unknown source ${sourceId}; dropped`);
      return null;
    }
    const pages = [fetchedText(urlOfSource(sourceId), opts.fetched), fetchedText(ownUrl, opts.fetched)].filter((p): p is string => p !== null);
    if (pages.length && !pages.some((page) => isVerbatim(text, page))) {
      problems.push(`${what} is not word for word on its fetched source page; dropped`);
      return null;
    }
    if (!pages.length) {
      problems.push(`${what}: its source page was not fetched, so the wording is unchecked; marked verified: false`);
      return false;
    }
    return true;
  };

  const quotes = dedupeById(raw.quotes, 'quote', problems).flatMap((q) => {
    const v = verbatim(`quote ${q.id}`, q.text, q.source_id);
    return v === null ? [] : [{ ...q, verified: v }];
  });
  const artifacts = dedupeById(raw.artifacts, 'artifact', problems).flatMap((a) => {
    const v = verbatim(`artifact ${a.id}`, a.text, a.source_id, a.url);
    return v === null ? [] : [{ ...a, verified: v }];
  });

  if (!facts.length && verdict.holds) {
    verdict.holds = false;
    verdict.reason = 'No fact on the sheet names a real source.';
  }
  if (!facts.some((f) => f.key)) problems.push('no fact is marked key');

  return { sheet: { ...raw, sources, facts, timeline, quotes, artifacts, verdict }, problems };
}
