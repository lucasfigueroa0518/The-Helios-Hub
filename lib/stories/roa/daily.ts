/**
 * The Real or AI? daily run (CONTRACT.md §4 Owner A, RA-16): ROA_PER_DAY candidates a
 * pool day (8 since 2026-11-18), half real and half AI.
 *
 *   specs   one roa-write@3 call (Sonnet, settings.models.copy, no web search); validate.ts keeps the balance
 *   images  AI: gpt-image-2 portrait. Real: the bank, then Commons Featured/Quality and NASA. Twin: the real photo,
 *           then the AI image from the same scene's prompt (skipped whole when no real photo is found). An AI image
 *           that fails the screen is made once more from the same prompt (RA-22: lost AI images left the sets
 *           mostly real, which made the answer guessable)
 *   intake  screen (Jev), reveal, validate, store, pool (intake.ts)
 *   cap     the pool holds the ROA_POOL_CAP (40) hardest; the rest go to stories.roa_archive (reason 'cap')
 *
 * Stories Split (SS-22..SS-24): the real photos come through the shared photo finder when
 * `photo_finders.roa = 'shared'` (else this series' own path), both refuse what the used-photo ledger (CI-32)
 * holds, and every pooled candidate is offered to the photo bank (intake.ts bankOffer). The switch, the ledger and the
 * bank live in the shared database (`sourceDb`, default `db`).
 *
 * Real or AI?'s pool refill (settings standard D16): it runs in every state, held to the type's refill cap (`refill`,
 * D14): the writer call and each spec's images start only while the cap has room, and the record says `capped`.
 *
 * Runs once per pool day (the record in stories.settings 'roa_daily', written in
 * a `finally` so a broken day is not retried and paid for on every worker
 * pass); a second call the same day does nothing unless forced. Nothing in the
 * database is swept: the only rows read are this series' pool, archive and sets.
 */
import type { FullPhotoBank } from '@/lib/media-library/bank';
import type { BankReader } from '@/lib/media-library/reader';
import type { UsedLedger } from '@/lib/photos/used-match';
import type { Queryable, StoriesDb } from '@/lib/stories/db';
import { capRoaPool, poolDay } from '@/lib/stories/pool';
import { material } from '@/lib/stories/prompts';
import type { StoriesSettings } from '@/lib/stories/settings';
import { createStoriesStorage, type StoriesStorage } from '@/lib/stories/storage';
import type { RefillBudget } from '@/lib/stories/trivia/daily';
import { writeStructured, type WriterCreate } from '@/lib/stories/writer';

import { generateAiImage, liveImageGen, type RoaImageGen } from './generate';
import { readRoaHistory, readRoaKnown } from './history';
import { intakeCandidate, type IntakeDeps, type IntakeItem, type IntakeOutcome } from './intake';
import { readPoolMix, thinSubjects } from './map';
import { ROA_WRITE, type RoaWriteMaterial, type RoaWriteOut } from './prompts';
import { findRealPhotos } from './real';
import { liveRoaVisionTransport, screenImage, type RoaVisionTransport, type ScreenResult } from './screen';
import { ROA_PER_DAY, TRAP_TRUTH } from './types';
import { validateSpecs, type RoaSpec } from './validate';

export const RECORD_KEY = 'roa_daily';
/** An AI cell makes at most this many images: the first, and one more when the screen fails it (RA-22). */
export const AI_ATTEMPTS = 2;

export type RoaDailyDeps = {
  db: StoriesDb;
  write: WriterCreate;
  settings: StoriesSettings;
  now: Date;
  /** Run even if today's run is recorded. */
  force?: boolean;
  /** Jev vision (default: the live transport with the images header). */
  vision?: RoaVisionTransport;
  /** The AI image generator (default: gpt-image-2). */
  image?: RoaImageGen;
  /** Network reads for Commons, NASA and the photos (default: global fetch). */
  fetch?: typeof fetch;
  /** Where candidate images are stored (default: the stories bucket). */
  storage?: Pick<StoriesStorage, 'upload'>;
  /** The photo bank; absent or off means Commons and NASA only. */
  bank?: BankReader | null;
  /** The shared database: the photo bank, the used-photo ledger and intake.settings (default `db`). */
  sourceDb?: Queryable;
  /** `photo_finders.roa` (default: read from sourceDb; any error reads 'legacy'). */
  finder?: 'legacy' | 'shared';
  /** The used-photo ledger, read once per run (default readUsedLedger on sourceDb; unreadable: the series' own history only). */
  used?: () => Promise<UsedLedger>;
  /**
   * Where pooled candidates are offered (SS-24). Default: a photo bank on sourceDb, drained at the end of the run
   * (nothing is stored while the bank's `capture` switch is off). Null: nothing is offered.
   */
  photoBank?: (Pick<FullPhotoBank, 'offerHeld'> & { drain?: (ms: number) => Promise<void> }) | null;
  /** The refill cap (D14): asked before the writer call and before each spec's images. Absent: no refill cap. */
  refill?: RefillBudget;
};

/** How long the run waits at its end for the photo bank's stores. */
export const BANK_DRAIN_MS = 30_000;

export type RoaDailyRecord = {
  day: string;
  at: string;
  specs: Array<{ subject: string; trap: string; words: string; prompt: string }>;
  pooled: Array<{ key: string; truth: string; subject: string; trap: string; difficulty: number }>;
  archived: Array<{ key: string; reason: 'screen'; problems: string[] }>;
  rejected: Array<{ cell: string; problems: string[] }>;
  dropped: string[];
  imageUsd: number;
  notes: string[];
  /** The refill cap stopped the day before every spec was made (D14). */
  capped?: boolean;
  error?: string;
};

export type RoaDailyResult = { ran: false; reason: string } | ({ ran: true } & RoaDailyRecord);

async function saveRecord(db: StoriesDb, rec: RoaDailyRecord): Promise<void> {
  await db.query(
    `INSERT INTO stories.settings (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, 'worker', now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [RECORD_KEY, JSON.stringify(rec)],
  );
}

const msg = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** The twin whose real photo was not found: skipped whole (the daily record's and the seed's reason). */
export const NO_REAL_TWIN = 'twin: no real photo found';
/** An AI image call the caller's `beforeImage` refused (a one-box seed at its limit). */
export const IMAGE_REFUSED = 'image: not made (spend limit)';

/** Where a spec's outcomes are recorded: the daily record, or a seed's own scratch record. */
export type RoaSpecSink = Pick<RoaDailyRecord, 'pooled' | 'archived' | 'rejected' | 'notes' | 'imageUsd'>;

/** Everything one spec's images and intake need, built once per run (openRoaRun). */
export type RoaSpecCtx = {
  db: StoriesDb;
  now: Date;
  image: RoaImageGen;
  vision: RoaVisionTransport;
  fetch: typeof fetch;
  bank?: BankReader | null;
  finder: 'legacy' | 'shared';
  used: UsedLedger | null;
  avoidKeys: Set<string>;
  avoidUrls: Set<string>;
  intake: IntakeDeps;
  rec: RoaSpecSink;
};

export type RoaSpecOpts = {
  /** Mark each pooled image's payload `seed: true` (a one-box seed: Yours, never cut by a cap). */
  seed?: boolean;
  /** Asked before each AI image call; false skips the call (the spec ends there). */
  beforeImage?: () => boolean;
  /** Told each AI image's actual cost right after it is made. */
  onImageUsd?: (usd: number) => void;
};

/** What one spec added: the pooled keys (a twin's real photo first), its rejections, and its image spend. */
export type RoaSpecResult = { pooled: string[]; rejected: { problems: string[] }[]; usd: number };

export type RoaKnownRun = Awaited<ReturnType<typeof readRoaKnown>>;

/**
 * The run's shared setup: what is known (every image and URL seen, what has posted), the shared photo finder's switch, the
 * used-photo ledger (once for the run) and the photo bank (SS-22..SS-24). Reads only this series' pool, archive and sets.
 */
export async function openRoaRun(deps: RoaDailyDeps, rec: RoaSpecSink, day: string): Promise<{ ctx: RoaSpecCtx; known: RoaKnownRun; photoBank: RoaDailyDeps['photoBank'] }> {
  const { db, now } = deps;
  const fetchFn = deps.fetch ?? fetch;
  const src = deps.sourceDb ?? db;
  const query = (text: string, params?: unknown[]) => src.query(text, params) as never;
  const [known, history] = await Promise.all([readRoaKnown(db), readRoaHistory(db)]);
  const avoidKeys = new Set([...known.keys, ...history.usedKeys]);
  const avoidUrls = new Set(known.urls);

  // The shared photo finder's switch, the used-photo ledger (once for the run) and the photo bank (SS-22..SS-24).
  const finder = deps.finder ?? (await import('@/lib/photos/switch').then((m) => m.readPhotoFinderModes(src)).then((m) => m.roa, () => 'legacy' as const));
  let used: UsedLedger | null = null;
  try {
    used = await (deps.used ?? (async () => (await import('@/lib/photos/used')).readUsedLedger(query, now)))();
  } catch (err) {
    rec.notes.push(`used-photo ledger not read (${msg(err)}): the series' own history only`);
  }
  let photoBank = deps.photoBank;
  if (photoBank === undefined) {
    const { createPhotoBank } = await import('@/lib/media-library/bank');
    photoBank = createPhotoBank({ query, http: fetchFn, log: (m) => rec.notes.push(`bank: ${m}`) });
  }
  const vision = deps.vision ?? liveRoaVisionTransport;
  const intake: IntakeDeps = { db, write: deps.write, settings: deps.settings, vision, storage: deps.storage ?? createStoriesStorage(), now, day, used: history.usedKeys, bank: photoBank ?? null, log: (m) => rec.notes.push(m) };
  const ctx: RoaSpecCtx = { db, now, image: deps.image ?? liveImageGen, vision, fetch: fetchFn, bank: deps.bank, finder, used, avoidKeys, avoidUrls, intake, rec };
  return { ctx, known, photoBank };
}

/**
 * One spec's images and intake, the same for the daily run and a one-box seed. Real cells: the best of several found photos.
 * AI cells: one image, and once more when the screen fails it (RA-22). Twin: the real photo, then (only when it pooled) the
 * AI image from the same scene's prompt; no real photo skips the twin whole. A failure is recorded as a rejection, never thrown.
 */
export async function runRoaSpec(ctx: RoaSpecCtx, s: RoaSpec, opts: RoaSpecOpts = {}): Promise<RoaSpecResult> {
  const { db, now, rec } = ctx;
  const before = { pooled: rec.pooled.length, rejected: rec.rejected.length, usd: rec.imageUsd };
  const seedFlag = opts.seed ? { seed: true as const } : {};
  const take = async (item: IntakeItem): Promise<IntakeOutcome> => {
    ctx.avoidKeys.add(item.imageKey);
    if ('url' in item.provenance) ctx.avoidUrls.add(item.provenance.url);
    const o = await intakeCandidate(ctx.intake, { ...item, ...seedFlag });
    if (o.status === 'pooled') rec.pooled.push({ key: o.key, truth: o.truth, subject: o.subject, trap: o.trap, difficulty: o.difficulty ?? 0 });
    else if (o.status === 'archived') rec.archived.push({ key: o.key, reason: 'screen', problems: o.problems });
    else rec.rejected.push({ cell: `${o.subject}.${o.trap}`, problems: o.problems });
    return o;
  };
  // Real cells: fetch several photos, screen them all (Jev is near-free), keep the one most viewers would call AI (R1).
  const real = async () => {
    const photos = await findRealPhotos({ fetch: ctx.fetch, bank: ctx.bank, avoidUrls: ctx.avoidUrls, avoidKeys: ctx.avoidKeys, log: (m) => rec.notes.push(m), finder: ctx.finder, used: ctx.used }, { subject: s.subject, words: s.searchWords });
    if (!photos.length) return null;
    const scored: Array<{ photo: (typeof photos)[number]; screened: ScreenResult }> = [];
    for (const photo of photos) {
      try {
        scored.push({ photo, screened: await screenImage({ db, vision: ctx.vision }, { ...photo, truth: 'real' }) });
      } catch (err) {
        rec.notes.push(`real screen ${photo.imageKey}: ${msg(err)}`);
      }
    }
    if (!scored.length) return null;
    const rank = (x: (typeof scored)[number]) => (x.screened.pass ? 1 : 0) * 10 + x.screened.difficulty;
    scored.sort((a, b) => rank(b) - rank(a));
    const best = scored[0]!;
    rec.notes.push(`real ${s.subject}.${s.trap}: screened ${scored.length}, kept ${best.screened.difficulty.toFixed(2)} (others ${scored.slice(1).map((x) => x.screened.difficulty.toFixed(2)).join(', ') || 'none'})`);
    return { ...best.photo, screened: best.screened };
  };
  const ai = async () => {
    if (opts.beforeImage && !opts.beforeImage()) return null;
    const made = await generateAiImage({ db, image: ctx.image, now }, s.aiPrompt);
    rec.imageUsd = Number((rec.imageUsd + made.usd).toFixed(4));
    opts.onImageUsd?.(made.usd);
    if (made.costNote) rec.notes.push(made.costNote);
    return made;
  };

  // AI cells: one image, and once more when the screen fails it.
  const aiCell = async (twinOf?: string) => {
    for (let attempt = 1; attempt <= AI_ATTEMPTS; attempt++) {
      const made = await ai();
      if (!made) {
        rec.rejected.push({ cell: `${s.subject}.${s.trap}`, problems: [IMAGE_REFUSED] });
        return null;
      }
      const o = await take({ ...made, truth: 'ai', subject: s.subject, trap: s.trap, ...(twinOf ? { twinOf } : {}), specText: s.aiPrompt });
      if (o.status !== 'archived' || attempt === AI_ATTEMPTS) return o;
      rec.notes.push(`ai ${s.subject}.${s.trap}: screen failed (${o.problems.join(', ')}), made again`);
    }
    return null;
  };

  const cell = `${s.subject}.${s.trap}`;
  try {
    if (s.trap === 'twin') {
      const photo = await real();
      if (!photo) {
        rec.rejected.push({ cell, problems: [NO_REAL_TWIN] });
      } else {
        const realOut = await take({ ...photo, truth: 'real', subject: s.subject, trap: 'twin', specText: s.searchWords });
        if (realOut.status === 'pooled') await aiCell(photo.imageKey); // no twin for a photo that did not make the pool
      }
    } else if (TRAP_TRUTH[s.trap] === 'real') {
      const photo = await real();
      if (!photo) rec.rejected.push({ cell, problems: ['no real photo found'] });
      else await take({ ...photo, truth: 'real', subject: s.subject, trap: s.trap, specText: s.searchWords });
    } else {
      await aiCell();
    }
  } catch (err) {
    rec.rejected.push({ cell, problems: [msg(err)] });
  }
  return {
    pooled: rec.pooled.slice(before.pooled).map((p) => p.key),
    rejected: rec.rejected.slice(before.rejected).map((r) => ({ problems: r.problems })),
    usd: Number((rec.imageUsd - before.usd).toFixed(4)),
  };
}

export async function runRoaDaily(deps: RoaDailyDeps): Promise<RoaDailyResult> {
  const { db, now } = deps;
  const day = poolDay(now);
  if (!deps.force) {
    const { rows } = await db.query<{ value: { day?: string } | null }>(`SELECT value FROM stories.settings WHERE key = $1`, [RECORD_KEY]);
    if (rows[0]?.value?.day === day) return { ran: false, reason: `already ran for ${day}` };
  }
  const rec: RoaDailyRecord = { day, at: now.toISOString(), specs: [], pooled: [], archived: [], rejected: [], dropped: [], imageUsd: 0, notes: [] };
  try {
    // 1. What is known: the pool's mix, every image and URL seen, what has posted; the shared finder, ledger and bank.
    const [mix, { ctx, known, photoBank }] = await Promise.all([readPoolMix(db), openRoaRun(deps, rec, day)]);

    // 2. One writer call; code keeps the balance. Nothing starts once the refill cap is spent.
    if (deps.refill && !(await deps.refill.canSpend())) {
      rec.capped = true;
      return { ran: true, ...rec };
    }
    const mat: RoaWriteMaterial = { today: day, thin_subjects: thinSubjects(mix), pool: mix, recent: known.recent };
    const out = (await writeStructured<RoaWriteOut>({
      create: deps.write, db, setId: null, component: 'roa-write', model: deps.settings.models.copy,
      system: ROA_WRITE.system, tool: ROA_WRITE.tool, user: material(mat),
    })).value;
    const { specs, rejected } = validateSpecs(out?.specs, ROA_PER_DAY / 2);
    rec.rejected.push(...rejected);
    rec.specs = specs.map((s) => ({ subject: s.subject, trap: s.trap, words: s.searchWords, prompt: s.aiPrompt }));

    // 3. Images, then intake one by one (runRoaSpec); a failing spec never stops the others.
    for (const s of specs) {
      if (deps.refill && !(await deps.refill.canSpend())) {
        rec.capped = true;
        rec.notes.push(`refill cap $${deps.refill.capUsd} reached before ${s.subject}.${s.trap}`);
        break;
      }
      await runRoaSpec(ctx, s);
    }

    // 4. The cap: the ROA_POOL_CAP hardest stay.
    rec.dropped = await capRoaPool(db, now);
    // 5. The photo bank's stores, within a bound (drain never throws; what it leaves stays for the next run).
    if (photoBank?.drain) await photoBank.drain(BANK_DRAIN_MS).catch(() => undefined);
    return { ran: true, ...rec };
  } catch (err) {
    rec.error = msg(err);
    throw err;
  } finally {
    await saveRecord(db, rec).catch(() => undefined);
  }
}
