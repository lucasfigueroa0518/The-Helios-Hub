/**
 * One candidate image into the Real or AI? pool, the same way for the daily
 * run and the import script (CONTRACT.md §4 steps 3–5):
 *
 *   check     truth, trap and provenance agree; provenance complete; never a used image   → rejected (nothing stored)
 *   screen    Jev roa-screen@4; a fail                                                    → archived, reason `screen`
 *   room      RA-28: the reveal must fit beside the subject (layout.ts hasRoom); no room  → archived, reason `screen`,
 *             problem `no_room_for_text`
 *   reveal    RA-26 payoff: AI → its prompt (an AI image not ours, or a prompt over the cap → archived, reason
 *             `screen`); real → roa-reveal@2 picks the effort line or the camera card (fails open, flagged)
 *   store     the JPEG at roa/candidates/<imageKey>.jpg in the stories bucket
 *   pool      one stories.pool row (key roa:<imageKey>, origin `model`, score = difficulty)
 *   bank      SS-24: the pooled candidate is offered to the photo bank (bankOffer): a real photo's original download
 *             under its image URL with its own licence and credit (reusable by every type); an AI image under its
 *             storage ref, licence `generated`, reuse_ok false, truth `ai`, with the model and prompt. A failed offer
 *             is logged and never drops the candidate.
 */
import type { FullPhotoBank } from '@/lib/media-library/bank';
import type { HeldOfferInput, HeldPhoto } from '@/lib/media-library/held';
import { REAL_OR_AI_LANE } from '@/lib/media-library/types';
import type { StoriesDb } from '@/lib/stories/db';
import { archiveRoa } from '@/lib/stories/pool';
import type { StoriesSettings } from '@/lib/stories/settings';
import { STORIES_BUCKET, type StoriesStorage } from '@/lib/stories/storage';
import type { WriterCreate } from '@/lib/stories/writer';

import { imageKeyOf, toJpeg } from './generate';
import { hasRoom, layoutOfImage } from './layout';
import { writeReveal } from './reveal';
import { screenImage, type RoaVisionTransport, type ScreenResult } from './screen';
import { ROA_SERIES, roaPoolKey, roaStoragePath, SUBJECTS, type Provenance, type RoaCandidate, type RoaPoolPayload, type RoaScreen, type Subject, type Trap, type Truth } from './types';
import { candidateProblems, provenanceProblems } from './validate';

export type IntakeDeps = {
  db: StoriesDb;
  write: WriterCreate;
  settings: StoriesSettings;
  vision: RoaVisionTransport;
  storage: Pick<StoriesStorage, 'upload'>;
  now: Date;
  /** The pool day the candidate is written on. */
  day: string;
  /** Image keys already in a published or live set. */
  used: ReadonlySet<string>;
  /** The photo bank a pooled candidate is offered to (SS-24); absent or null: nothing is offered. Tests stub it. */
  bank?: Pick<FullPhotoBank, 'offerHeld'> | null;
  log?: (msg: string) => void;
};

/** What intake offers the photo bank: one held photo. */
export type RoaBank = NonNullable<IntakeDeps['bank']>;

export type IntakeItem = {
  jpeg: Buffer;
  imageKey: string;
  truth: Truth;
  subject: Subject;
  trap: Trap;
  provenance: Provenance;
  twinOf?: string;
  /** Already screened (real cells screen several photos to pick one): reused instead of a second screen. */
  screened?: ScreenResult;
  /** What the source says about a real photo, for the reveal writer. */
  about?: { title?: string; description?: string; place?: string; year?: string };
  /** The writer's search words or prompt, kept so later days vary from it. */
  specText?: string;
  /** A real photo's original download, before the 9:16 cut (findRealPhotos): what the photo bank stores (SS-24). */
  original?: Buffer;
};

export type IntakeOutcome = {
  key: string;
  imageKey: string;
  truth: Truth;
  subject: Subject;
  trap: Trap;
  status: 'pooled' | 'archived' | 'rejected';
  difficulty?: number;
  problems: string[];
};

/** The pool row's payload: the contract's shape plus the columns every pool row carries. */
export type RoaPoolRowPayload = RoaPoolPayload & { story_key: null; source: string; url: string | null; breakdown: null; specText?: string };

const sourceLabel = (p: Provenance) => ({ bank: 'Photo bank', commons: 'Wikimedia Commons', nasa: 'NASA', generated: 'Real or AI? image model', dataset: 'AI image dataset', viral: 'Viral AI image' })[p.kind];

export async function intakeCandidate(deps: IntakeDeps, item: IntakeItem): Promise<IntakeOutcome> {
  const key = roaPoolKey(item.imageKey);
  const base = { key, imageKey: item.imageKey, truth: item.truth, subject: item.subject, trap: item.trap };
  const c: RoaCandidate = {
    imageKey: item.imageKey, truth: item.truth, subject: item.subject, trap: item.trap, provenance: item.provenance,
    storagePath: roaStoragePath(item.imageKey), ...(item.twinOf ? { twinOf: item.twinOf } : {}),
  };
  const problems = candidateProblems(c, { used: deps.used });
  if (problems.length) return { ...base, status: 'rejected', problems };

  // Screen.
  const screened = item.screened ?? (await screenImage({ db: deps.db, vision: deps.vision }, item));
  const screen: RoaScreen = {
    pass: screened.pass, reasons: screened.reasons, difficulty: screened.difficulty,
    ...(screened.tellBox ? { tellBox: screened.tellBox } : {}), ...(screened.subjectBox ? { subjectBox: screened.subjectBox } : {}),
  };
  const row = (reveal: string, s: RoaScreen, payoff?: RoaPoolRowPayload['payoff']): RoaPoolRowPayload => ({
    kind: 'roa', c, screen: s, reveal, ...(payoff ? { payoff } : {}), writtenOn: deps.day,
    story_key: null, source: sourceLabel(item.provenance), url: 'url' in item.provenance ? item.provenance.url : null, breakdown: null,
    ...(item.specText ? { specText: item.specText } : {}),
  });
  if (!screen.pass) {
    await archiveRoa(deps.db, key, { ...row('', screen), answers: screened.answers }, 'screen', deps.now);
    return { ...base, status: 'archived', difficulty: screen.difficulty, problems: screen.reasons };
  }

  // Room for the text beside the subject (RA-28), before the reveal writer is paid for.
  try {
    if (!hasRoom(await layoutOfImage(item.jpeg, screen.subjectBox))) {
      const problems = ['no_room_for_text'];
      await archiveRoa(deps.db, key, { ...row('', screen), answers: screened.answers, problems }, 'screen', deps.now);
      return { ...base, status: 'archived', difficulty: screen.difficulty, problems };
    }
  } catch (err) {
    // An unreadable size is not a reason to drop it: the renderer still places the text away from the subject.
    deps.log?.(`${key}: layout check skipped (${(err as Error).message})`);
  }

  // Reveal.
  const rv = await writeReveal({ db: deps.db, write: deps.write, settings: deps.settings }, { jpeg: item.jpeg, truth: item.truth, provenance: item.provenance, about: item.about });
  if (!rv.ok) {
    if (rv.archive) {
      await archiveRoa(deps.db, key, { ...row('', screen), answers: screened.answers, problems: rv.problems }, 'screen', deps.now);
      return { ...base, status: 'archived', difficulty: screen.difficulty, problems: rv.problems };
    }
    return { ...base, status: 'rejected', difficulty: screen.difficulty, problems: rv.problems };
  }
  // The screen's tell box is never drawn (RA-26): the pool keeps the verdict, the difficulty and the subject box (RA-28).
  const finalScreen: RoaScreen = { pass: true, reasons: [], difficulty: screen.difficulty, ...(screen.subjectBox ? { subjectBox: screen.subjectBox } : {}) };

  // Store, then pool.
  await deps.storage.upload(c.storagePath, item.jpeg, 'image/jpeg');
  const { rows } = await deps.db.query<{ id: string }>(
    `INSERT INTO stories.pool (series, key, origin, ref, title, payload, score, refreshed_at)
     VALUES ($1, $2, 'model', $3, $4, $5::jsonb, $6, $7::timestamptz)
     ON CONFLICT (series, key) DO UPDATE SET
       origin = EXCLUDED.origin, ref = EXCLUDED.ref, title = EXCLUDED.title,
       payload = EXCLUDED.payload, score = EXCLUDED.score, refreshed_at = EXCLUDED.refreshed_at
     WHERE stories.pool.used_at IS NULL
     RETURNING id`,
    [ROA_SERIES, key, item.imageKey, `${item.truth === 'real' ? 'Real' : 'AI'} · ${item.subject} · ${item.trap}`, JSON.stringify({ ...row(rv.line, finalScreen, rv.payoff), ...(rv.flags ? { revealFlags: rv.flags } : {}) }), finalScreen.difficulty, deps.now.toISOString()],
  );
  if (!rows.length) return { ...base, status: 'rejected', difficulty: finalScreen.difficulty, problems: ['pool key already used'] };
  if (deps.bank) {
    try {
      const offer = bankOffer(item, key, deps.now, finalScreen.difficulty);
      if (offer) deps.bank.offerHeld(offer);
    } catch (err) {
      deps.log?.(`bank offer ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return { ...base, status: 'pooled', difficulty: finalScreen.difficulty, problems: rv.flags ?? [] };
}

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** An AI image's bank credit: what made it and where it came from. */
function aiCredit(p: Extract<Provenance, { kind: 'generated' | 'dataset' | 'viral' }>): string {
  if (p.kind === 'generated') return clip(`AI image (${p.model}), Real or AI?`, 120);
  if (p.kind === 'dataset') return clip(`AI image${p.model ? ` (${p.model})` : ''}, ${p.dataset} dataset`, 120);
  return clip(`AI image${p.model ? ` (${p.model})` : ''}, shared online`, 120);
}

/**
 * The photo bank offer for a pooled candidate (SS-24), or null when there is nothing to store: a photo that came from
 * the bank is already there, and a real photo without its original download (an older caller) is not stored cut.
 */
export function bankOffer(item: IntakeItem, key: string, at: Date, difficulty: number): HeldOfferInput | null {
  const p = item.provenance;
  const common: Pick<HeldPhoto, 'request' | 'requestKind' | 'slide' | 'outcome' | 'pass' | 'verdict'> = {
    request: item.specText || item.subject,
    requestKind: item.subject,
    slide: 1,
    outcome: 'picked',
    pass: true,
    verdict: { truth: item.truth, trap: item.trap, difficulty, image_key: item.imageKey, ...(item.twinOf ? { twin_of: item.twinOf } : {}) },
  };
  const offer = (photo: HeldPhoto): HeldOfferInput => ({ runKind: 'real_or_ai', runRef: key, at, items: [photo] });
  if (p.kind === 'bank') return null;
  if (p.kind === 'commons' || p.kind === 'nasa') {
    if (!p.src || !item.original?.length) return null;
    const shows = [item.about?.title, item.about?.description].filter(Boolean).join('. ') || null;
    return offer({
      ...common,
      url: p.src,
      bytes: item.original,
      // A searched scene: the lane every type's thematic request reads, so a real find is reusable by everyone.
      source: p.kind === 'commons' ? 'commons-search' : 'nasa',
      lane: 'commons-search',
      title: item.about?.title ?? null,
      date: p.year ?? null,
      credit: p.credit,
      licence: p.kind === 'nasa' ? 'government' : 'open',
      reuseOk: true,
      shows,
      truth: 'real',
    });
  }
  const ai = p as Extract<Provenance, { kind: 'generated' | 'dataset' | 'viral' }>;
  return offer({
    ...common,
    url: `storage:${STORIES_BUCKET}/${roaStoragePath(item.imageKey)}`,
    bytes: item.jpeg,
    source: ai.kind,
    lane: REAL_OR_AI_LANE,
    title: null,
    date: ai.kind === 'generated' ? ai.createdAt.slice(0, 10) : ai.kind === 'viral' ? ai.firstSeen ?? null : null,
    credit: aiCredit(ai),
    licence: 'generated',
    reuseOk: false,
    shows: ai.kind === 'generated' ? ai.prompt : null,
    truth: 'ai',
    genModel: ai.model ?? null,
    genPrompt: ai.kind === 'generated' ? ai.prompt : null,
  });
}

/* ── Import (scripts/roa-import.ts, RA-5): dataset and viral AI images from a local folder ── */

export type ImportEntry = { file: string; subject: Subject; trap: Extract<Trap, 'mundane' | 'amateur'>; provenance: Extract<Provenance, { kind: 'dataset' | 'viral' }> };
export type ImportRefusal = { file: string; problems: string[] };

/**
 * Read a provenance.json manifest: an array of `{ file, subject, trap?, truth?, provenance }`. Imports are AI images only
 * (RA-5): an entry without provenance, without a provenance `kind`, with a kind other than dataset or viral, or marked
 * real is refused. trap defaults to mundane.
 */
export function parseImportManifest(json: unknown): { entries: ImportEntry[]; refused: ImportRefusal[] } {
  const entries: ImportEntry[] = [];
  const refused: ImportRefusal[] = [];
  const list = Array.isArray(json) ? json : [];
  if (!Array.isArray(json)) refused.push({ file: '(manifest)', problems: ['provenance.json is not an array of entries'] });
  for (const raw of list as Array<Record<string, unknown>>) {
    const file = typeof raw?.file === 'string' ? raw.file.trim() : '';
    const problems: string[] = [];
    if (!file || file.includes('/') || file.includes('..')) problems.push('file: missing or not a plain file name');
    const subject = String(raw?.subject ?? '') as Subject;
    if (!(SUBJECTS as readonly string[]).includes(subject)) problems.push(`subject: ${subject || 'missing'}`);
    const trap = String(raw?.trap ?? 'mundane') as ImportEntry['trap'];
    if (trap !== 'mundane' && trap !== 'amateur') problems.push(`trap: ${trap} is not an AI trap (mundane, amateur)`);
    if (raw?.truth !== undefined && raw.truth !== 'ai') problems.push(`truth: ${String(raw.truth)}; imports are AI images only`);
    const prov = raw?.provenance as Record<string, unknown> | undefined;
    if (!prov || typeof prov !== 'object') problems.push('provenance: missing');
    else if (typeof prov.kind !== 'string' || !prov.kind) problems.push('provenance: no kind');
    else if (prov.kind !== 'dataset' && prov.kind !== 'viral') problems.push(`provenance: ${prov.kind} cannot be imported (dataset or viral only)`);
    else problems.push(...provenanceProblems(prov));
    if (problems.length) refused.push({ file: file || '(no file)', problems });
    else entries.push({ file, subject, trap, provenance: prov as ImportEntry['provenance'] });
  }
  return { entries, refused };
}

export type ImportResult = { refused: ImportRefusal[]; outcomes: IntakeOutcome[] };

/** Screen and pool each manifest entry like the daily run. `read` returns a file's bytes (PNG or JPEG). */
export async function runRoaImport(deps: IntakeDeps, manifest: unknown, read: (file: string) => Promise<Buffer>): Promise<ImportResult> {
  const { entries, refused } = parseImportManifest(manifest);
  const outcomes: IntakeOutcome[] = [];
  for (const e of entries) {
    try {
      const jpeg = await toJpeg(await read(e.file));
      outcomes.push(await intakeCandidate(deps, { jpeg, imageKey: imageKeyOf(jpeg), truth: 'ai', subject: e.subject, trap: e.trap, provenance: e.provenance }));
    } catch (err) {
      refused.push({ file: e.file, problems: [err instanceof Error ? err.message : String(err)] });
    }
  }
  return { refused, outcomes };
}
