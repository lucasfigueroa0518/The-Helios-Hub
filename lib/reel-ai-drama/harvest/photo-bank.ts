import fs from 'node:fs';

import type { DramaHit, DramaLookup, DramaOfferInput, DramaOfferItem } from '@/lib/media-library/drama';
import type { FactSheet, Pitch, VisualKind } from '@/lib/reel-ai-drama/types';

import type { Look } from './filters';
import type { DateBasis, HarvestPhotoBank, RawCandidate, Source, Want } from './types';

/**
 * The hub's central photo bank (Supabase `media_library`, lib/media-library/) as Reel AI Drama's first
 * stop and shared store for real photos (Lucas, 2026-11-03).
 *
 *   read   photoBankSource, asked before every other adapter (pipeline.ts gather): a photo want's cast
 *          QIDs, or its search words against the bank's tags. Hits go through the same screens as any
 *          find; one whose QID matched and whose look the bank already holds (a Reel AI Drama look that
 *          passed) reuses that look instead of paying for a new one. The original URL is offered when the
 *          bank fetched it within its freshness window; otherwise the bank's own copy is read from the
 *          photo-bank bucket.
 *   write  offerToBank: every kept photo (and every wish-search find that passed but wasn't taken) with
 *          its QIDs, verified people, credit, source page, date and look. The bank licenses it (an
 *          unknown licence is stored with reuse_ok false, so carousels never get it).
 *
 * Fails open everywhere: no bank, a bank that throws or times out, or switches off, and the harvest runs
 * exactly as before. Only photos and their metadata go to the bank.
 */

/** Wants the bank can answer: real photos (pages, posts, documents, maps, frames and logos have their own sources). */
const BANKABLE = new Set<VisualKind>(['person_photo', 'event_photo', 'place_photo', 'product', 'archival', 'object']);
/** Bank hits looked at per want. */
export const BANK_HITS_PER_WANT = 4;

export const bankable = (want: Pick<Want, 'kind'>) => BANKABLE.has(want.kind);

const DATE_BASES: readonly DateBasis[] = ['event', 'exif', 'commons', 'caption', 'capture', 'article', 'unknown'];

/** A look recorded in the bank, if it has every field a look needs. */
function storedLook(v: Record<string, unknown> | null | undefined): Look | null {
  if (!v || typeof v.shows !== 'string') return null;
  for (const k of ['watermark', 'tv_logo', 'ai_generated', 'text_heavy'] as const) if (typeof v[k] !== 'boolean') return null;
  if (typeof v.faces !== 'number') return null;
  return v as unknown as Look;
}

function toCandidate(h: DramaHit, want: Want): Omit<RawCandidate, 'localFile'> {
  const matched = h.qids.filter((q) => want.qids.includes(q));
  const byId = matched.length > 0;
  const look = byId ? storedLook(h.verdict?.look) : null;
  const basis = h.verdict?.date_basis as DateBasis | undefined;
  return {
    source: 'photo_bank',
    want: want.id,
    kind: want.kind,
    url: h.url,
    source_page: h.verdict?.source_page ?? null,
    credit: h.credit,
    license: h.licence === 'unknown' ? null : h.licence,
    caption: [h.title, h.subjects.join(', ')].filter(Boolean).join(' — '),
    // A QID match is the identity: the want's people. A tag match names nobody; the screens decide.
    people: byId ? [...want.people] : [],
    qids: byId ? matched : [],
    place: null,
    date_taken: h.date,
    date_basis: h.date ? (basis && DATE_BASES.includes(basis) ? basis : 'caption') : 'unknown',
    width: h.width || undefined,
    height: h.height || undefined,
    character_image: false,
    made: false,
    trusted: false,
    flags: ['photo_bank', `bank_photo:${h.photoId}`, `bank_licence:${h.licence}`, ...(h.source ? [`bank_source:${h.source}`] : []), ...(look ? ['look:from_bank'] : [])],
    // The stored look answered another story: "about this story" is the QID match itself; no key moment claimed.
    prior_look: look ? { ...look, about_story: true, key_moment: false, namesake: false } : null,
  };
}

export const photoBankSource: Source = async (want, run) => {
  const bank = run.deps.photoBank;
  if (!bank || !bankable(want)) return [];
  const qids = want.qids.filter(Boolean);
  const hits = await bank.lookup({ qids, words: qids.length ? [] : [want.terms], limit: BANK_HITS_PER_WANT });
  const out: RawCandidate[] = [];
  for (const h of hits) {
    const c = toCandidate(h, want);
    if (h.fresh) {
      out.push(c);
      continue;
    }
    // The original URL is past the bank's freshness window: use the bank's own copy.
    try {
      const file = run.nextName('jpg');
      fs.writeFileSync(file, await bank.fetchStored(h.masterPath));
      out.push({ ...c, localFile: file, flags: [...c.flags, 'bank_copy'] });
    } catch (error) {
      run.notes.push(`photo bank: copy of ${h.photoId} unreadable (${error instanceof Error ? error.message.slice(0, 80) : String(error)})`);
    }
  }
  if (hits.length) run.notes.push(`photo bank ${want.id}: ${hits.length} found, ${out.length} offered${out.some((c) => c.prior_look) ? `, ${out.filter((c) => c.prior_look).length} with a stored look` : ''}`);
  return out;
};

/** The screened candidate fields an offer reads (pipeline.ts Cand). */
export type OfferCand = Pick<RawCandidate, 'url' | 'source' | 'credit' | 'license' | 'source_page' | 'date_taken' | 'date_basis' | 'kind' | 'people' | 'qids' | 'made' | 'flags' | 'shows' | 'caption'> & {
  wants: string[];
  look: Look | null;
  faces: unknown[] | null;
};

/** Sources whose finds are photos from the web (the bank fetches the URL itself). */
const OFFERABLE = new Set<string>(['wikidata', 'commons', 'openverse', 'serper', 'article', 'newsroom', 'photo_bank']);

/** The harvest's photos as bank offer items. Pure. */
export function offerItems(
  kept: ReadonlyArray<{ c: OfferCand; slide: number; outcome: 'picked' | 'passed' }>,
  wants: readonly Want[],
): DramaOfferItem[] {
  const qidOf = new Map<string, string>();
  for (const w of wants) if (w.people.length === 1 && w.qids.length === 1) qidOf.set(w.people[0], w.qids[0]);
  const wantById = new Map(wants.map((w) => [w.id, w]));
  const items: DramaOfferItem[] = [];
  for (const { c, slide, outcome } of kept) {
    if (!c.url || c.made || !OFFERABLE.has(c.source) || !BANKABLE.has(c.kind)) continue;
    const verified = c.flags.includes('identity:verified')
      ? c.people.map((name) => ({ name, qid: (c.people.length === 1 && c.qids.length === 1 ? c.qids[0] : null) ?? qidOf.get(name) ?? null }))
      : [];
    const credit = c.license && !c.credit.toLowerCase().includes(c.license.toLowerCase()) ? `${c.credit} (${c.license})` : c.credit;
    const bankSource = c.flags.find((f) => f.startsWith('bank_source:'))?.slice('bank_source:'.length) ?? null;
    items.push({
      url: c.url,
      source: c.source,
      bankSource,
      credit,
      sourcePage: c.source_page,
      date: c.date_taken,
      dateBasis: c.date_basis,
      kind: c.kind,
      request: wantById.get(c.wants[0])?.what ?? c.kind,
      shows: (c.look?.shows || c.shows || c.caption || '').trim(),
      outcome,
      verified,
      look: c.look ? { ...c.look } : null,
      faces: c.faces,
      slide,
    });
  }
  return items;
}

/** The story's people and companies, for the bank's licence pass. */
export function storySubjects(pitch: Pitch, facts: FactSheet | null): { subjects: string[]; organizations: string[] } {
  const cast = [...pitch.cast, ...(facts?.cast ?? [])];
  return { subjects: [...new Set(cast.map((m) => m.name))], organizations: [...new Set(cast.filter((m) => m.kind === 'company').map((m) => m.name))] };
}

/** Hands the kept photos to the bank. Never throws; a note says what was offered. */
export function offerToBank(
  bank: HarvestPhotoBank | null | undefined,
  input: { jobId: string | null; pitch: Pitch; facts: FactSheet | null; wants: readonly Want[]; kept: ReadonlyArray<{ c: OfferCand; slide: number; outcome: 'picked' | 'passed' }>; at: Date },
  notes: string[],
): void {
  if (!bank || !input.jobId) return;
  try {
    const items = offerItems(input.kept, input.wants);
    if (!items.length) return;
    bank.offer({ runRef: input.jobId, ...storySubjects(input.pitch, input.facts), items, at: input.at });
    notes.push(`photo bank: offered ${items.length} photo(s)`);
  } catch (error) {
    notes.push(`photo bank: offer failed (${error instanceof Error ? error.message.slice(0, 120) : String(error)})`);
  }
}

/** What the guarded bank wraps: the media library's own calls (photo-bank-live.ts), or a stub in tests. */
export type BankBackend = {
  settings(): Promise<{ present: boolean; capture: boolean; finderSource: string }>;
  lookup(q: DramaLookup): Promise<DramaHit[]>;
  download(masterPath: string): Promise<Buffer>;
  offer(input: DramaOfferInput): void;
  drain(ms: number): Promise<void>;
};

/** One bank call's limit: an unreachable bank costs the harvest at most this, once. */
export const BANK_CALL_MS = 8_000;

class BankTimeout extends Error {}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BankTimeout(`no answer in ${ms} ms`)), ms);
    timer.unref?.();
  });
  return Promise.race([p, limit]).finally(() => clearTimeout(timer));
}

/**
 * The bank behind every fail-open rule: reads only while `finder_source` isn't "off" (writes are gated by
 * `capture` inside the media library); the first failed or slow call marks the bank down for the rest of
 * the run, so the harvest goes on exactly as without it.
 */
export function guardedPhotoBank(backend: BankBackend, opts: { timeoutMs?: number; log?: (line: string) => void } = {}): HarvestPhotoBank {
  const ms = opts.timeoutMs ?? BANK_CALL_MS;
  const log = (line: string) => {
    try {
      opts.log?.(line);
    } catch {
      // a broken logger never breaks the harvest
    }
  };
  let down: string | null = null;
  // One settings read per guarded bank (one harvest): concurrent lookups share it, so a dead bank costs one timeout.
  let settings: Promise<Awaited<ReturnType<BankBackend['settings']>>> | null = null;
  const fail = (what: string, error: unknown) => {
    if (!down) {
      down = `${what}: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}`;
      log(`photo bank down (${down}); the harvest goes on without it`);
    }
  };
  return {
    async lookup(q) {
      if (down) return [];
      try {
        const s = await (settings ??= within(backend.settings(), ms));
        if (!s.present || s.finderSource === 'off') return [];
        return await within(backend.lookup(q), ms);
      } catch (error) {
        fail('lookup', error);
        return [];
      }
    },
    async fetchStored(masterPath) {
      if (down) throw new Error('photo bank down');
      return within(backend.download(masterPath), ms);
    },
    offer(input) {
      if (down) return;
      try {
        backend.offer(input);
      } catch (error) {
        fail('offer', error);
      }
    },
    async flush(limit) {
      if (down) return;
      try {
        await within(backend.drain(limit), limit + 1_000);
      } catch (error) {
        fail('flush', error);
      }
    },
  };
}
