/**
 * The photo bank (DECISIONS_LOG D49; Tommy, 2026-10-08: "Store images going
 * forward across ALL photo-finder runs … accumulating our own bank of
 * seeded, tagged images").
 *
 * Never blocking: `offer()` is synchronous, returns nothing and never
 * throws. It turns the finder's vetted photos into rows right away (pure
 * policy), then, in the background: reads the settings once (nothing
 * happens while `capture` is false), writes one multi-row INSERT of pending
 * sources and one of sightings, and starts the single ingest loop (2 at a
 * time, 30 s per photo). Every background promise ends in `.catch(log)`.
 *
 * `drain(ms)` waits at most `ms` for the queued writes and the ingest, after
 * importing new social.used_photos rows past the watermark (photos published
 * before capture was on, or by a run without a bank). It never throws; what
 * it didn't finish stays in the outbox for the next run.
 */
import { mediaBucket, type MediaBucket } from '@/lib/media-bucket';
import type { VettedPhoto } from '@/lib/social/photos/vetted';

import { importUsedPhotos } from './backfill';
import { runIngest } from './ingest';
import { licenceOf, shouldStore } from './policy';
import { createBankReader, type BankReader } from './reader';
import { cachedBankSettings } from './settings';
import { writeRows } from './store';
import { PHOTO_BANK_BUCKET, type BankRows, type Query, type RunKind, type SightingVision } from './types';

export type OfferInput = {
  runKind: RunKind;
  /** The run's own id for this post or set (a carousel's story id; a Stories build). */
  runRef: string;
  /** The story's SUBJECTS names (the licence pass's brief). */
  subjects: string[];
  /** The organizations among them (who a "company's own photo" credit may name); default: the subjects. */
  organizations?: string[];
  items: VettedPhoto[];
  at?: Date;
};

export type PhotoBank = {
  offer(input: OfferInput): void;
  drain(ms: number): Promise<void>;
  /** The bank as a finder source (gated by settings.finder_source). */
  readonly reader: BankReader;
};

export type PhotoBankDeps = {
  query: Query;
  bucket?: Pick<MediaBucket, 'upload'>;
  http?: typeof fetch;
  log?: (line: string) => void;
  /** How long a settings read is reused (default 5 minutes: a one-shot run reads once). */
  settingsTtlMs?: number;
  /** Ingest workers (default 2) and the per-photo limit (default 30 s). */
  concurrency?: number;
  itemMs?: number;
  /** used_photos rows imported per drain (default 200). */
  importLimit?: number;
};

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The finder's vetted photos as bank rows: a sighting for each, a pending source for each the policy keeps. Pure. */
export function planOffer(input: OfferInput): BankRows {
  const at = (input.at ?? new Date()).toISOString();
  const rows: BankRows = { sources: [], sightings: [] };
  for (const item of input.items) {
    const c = item.candidate;
    if (!c?.url) continue;
    const vision: SightingVision | null = item.vision
      ? { scene: item.vision.scene, pass: item.vision.pass, what_it_shows: item.vision.verdict?.what_it_shows ?? null, verdict: (item.vision.verdict as Record<string, unknown> | null) ?? null, ...(item.vision.error ? { error: item.vision.error } : {}) }
      : null;
    rows.sightings.push({
      url: c.url,
      run_kind: input.runKind,
      run_ref: input.runRef,
      slide: item.slide,
      request_query: item.request.query ?? '',
      request_kind: item.request.kind ?? null,
      request_qid: c.verified && c.subject === item.request.query ? c.qid : null,
      qid: c.verified ? c.qid : null,
      subject: c.verified ? c.subject : null,
      verified: Boolean(c.verified),
      outcome: item.outcome,
      vision,
      tile_tags: (item.tileTags ?? []).map((t) => t.toLowerCase()),
      fit: item.fit,
      faces: c.faces ?? null,
      plate: c.plate ?? null,
      at,
    });
    if (item.outcome === 'rejected') continue;
    const licence = licenceOf(c, input.subjects, input.organizations);
    if (!shouldStore(item.outcome, c, licence) || !licence.licence) continue;
    rows.sources.push({ url: c.url, source: c.source, lane: c.lane, title: c.title || null, date: c.date, credit: c.credit, licence: licence.licence, reuse_ok: licence.reuseOk });
  }
  return rows;
}

export function createPhotoBank(deps: PhotoBankDeps): PhotoBank {
  const log = (line: string) => {
    try {
      deps.log?.(line);
    } catch {
      // A broken logger never breaks the bank.
    }
  };
  const settings = cachedBankSettings(deps.query, { ttlMs: deps.settingsTtlMs, onError: (err) => log(`settings: ${errText(err)}`) });
  const reader = createBankReader({ query: deps.query, settings });
  let bucket: Pick<MediaBucket, 'upload'> | null = deps.bucket ?? null;
  const ingestDeps = () => ({ query: deps.query, bucket: (bucket ??= mediaBucket(PHOTO_BANK_BUCKET)), http: deps.http ?? fetch, log });

  let writes: Promise<void> = Promise.resolve();
  let loop: Promise<void> | null = null;
  let again = false;

  /** The single ingest loop: started once, run until the outbox is empty, restarted if work arrived meanwhile. */
  const kick = () => {
    if (loop) {
      again = true;
      return;
    }
    again = false;
    loop = runIngest(ingestDeps(), { concurrency: deps.concurrency ?? 2, itemMs: deps.itemMs })
      .then((s) => {
        if (s.stored || s.failed || s.gone || s.skipped) log(`ingest: ${s.stored} stored, ${s.failed} failed, ${s.gone} gone, ${s.skipped} skipped`);
      })
      .catch((err) => log(`ingest: ${errText(err)}`))
      .finally(() => {
        loop = null;
        if (again) kick();
      });
  };

  const within = async (p: Promise<unknown>, deadline: number) => {
    const left = deadline - Date.now();
    if (left <= 0) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([p.catch(() => undefined), new Promise((r) => { timer = setTimeout(r, left); timer.unref?.(); })]);
    if (timer) clearTimeout(timer);
  };

  return {
    reader,
    offer(input) {
      let rows: BankRows;
      try {
        rows = planOffer(input);
      } catch (err) {
        log(`offer: ${errText(err)}`);
        return;
      }
      if (!rows.sightings.length && !rows.sources.length) return;
      writes = writes
        .then(async () => {
          const s = await settings();
          if (!s.capture) return;
          const w = await writeRows(deps.query, rows);
          log(`offer ${input.runKind} ${input.runRef}: ${w.sightings} sightings, ${w.sources} sources queued`);
          if (w.sources) kick();
        })
        .catch((err) => log(`offer ${input.runKind} ${input.runRef}: ${errText(err)}`));
    },
    async drain(ms) {
      const deadline = Date.now() + Math.max(0, ms);
      try {
        await within(writes, deadline);
        const s = await settings();
        if (!s.capture) return;
        const imported = importUsedPhotos(deps.query, { limit: deps.importLimit ?? 200, log })
          .then((r) => {
            if (r.read) log(`used_photos: ${r.read} imported (${r.sources} to fetch), watermark ${r.watermark ?? '—'}`);
          })
          .catch((err) => log(`used_photos import: ${errText(err)}`));
        await within(imported, deadline);
        kick();
        while (loop && Date.now() < deadline) await within(loop, deadline);
      } catch (err) {
        log(`drain: ${errText(err)}`);
      }
    },
  };
}
