/**
 * Targeted Revisions for IG Stories: a person's fix to ONE frame of a `stories.sets` set (the
 * motivating case: "frame 3 repeats frame 1's photo, use a different one"). Only that frame's row
 * (`stories.frames`) and what the set derives from its frames change:
 *   - `frames.photo` is a copy of the frame's `copy.photo` (`copy.logo` on Free vs. Paid): kept in sync;
 *   - `payload.photo_log[*].picked` says which photo each frame shows (recomputed from the frames);
 *   - `payload.stories[*].headline` is each Morning Download story frame's headline (recomputed).
 * The frame's new JPEG goes to a NEW key (`sets/<id>/03-story.rev<id>.jpg`); the old one is never
 * overwritten or removed and stays in `before.files` for undo.
 *
 * Order (nothing is written on any non-ok path): checks → the billable calls → render of the one
 * frame (its own fit and render checks fail it) → ONE guarded write of the frame and the set payload
 * (repository saveFrameRevision). A JPEG uploaded before a lost guarded write stays in storage
 * unreferenced, by design (the never-delete rule). The whole-set Haiku render review is NOT run: it
 * can only move a backdrop, crop or photo, never words, and a person just chose those.
 *
 *   color    the frame's backdrop (black | white | orange | green): render only, 0 model calls
 *   layout   the photo's crop (photo.focus): render only
 *   wording  Morning Download story frames only: the frame's length/sentence rule → the news writer's Haiku
 *            fact check (lib/news-writer checkFacts) over the person's words; a miss gets ONE news-writer
 *            rewrite (writeStories('md'), the build's writer, with the person's request as an added
 *            instruction), whose own fact check must pass (else the story is dropped and nothing changes).
 *            Free vs. Paid words came through gates this path can't re-run (the pair score), so they are refused.
 *
 * AI Trivia frames are videos rendered as a pair (lib/stories/trivia/render), Real or AI? frames are its
 * screened images and their answers (planning/Real or AI/CONTRACT.md), and Guess the Number is retired
 * (AT-14): none takes a revision; Regenerate makes a new set.
 *   photo    Morning Download story frames only: ONE news photo finder run (lib/news-photos findStoryPhoto, the
 *            build's; a person's hint adds one image search's results as extra candidates), then the build's
 *            band fit (bandPhotoFor: fitToBand/decideBand, stored under the set). Never a photo another frame
 *            of the set shows, the replaced photo, or one in the used-photo ledger (CI-32: published in the
 *            last 20 days). The opener draws every story's photo (no photo of its own); Free vs. Paid is retired.
 *
 * Parts: `{ kind: 'frame', key: '<seq>' }` (the frame's real seq, 1-based).
 */
import { randomUUID } from 'node:crypto';

import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { Query } from '@/lib/social/store/pg';
import type { PhotoResult } from '@/lib/news-photos';
import type { PhotoBankSink } from '@/lib/news-photos/bank-offer';
import type { PhotoStory } from '@/lib/news-photos/candidates';
import type { Queryable } from '@/lib/stories/db';
import { BACKDROPS, MAX_JPEG_BYTES, VIDEO_SERIES, framePhoto, type Backdrop, type Frame, type FrameData, type Photo, type Series, type Style } from '@/lib/stories/render/types';
import type { FrameRevisionState, SetStatus } from '@/lib/stories/repository';

import type { ContentTypeDescription, FixKind, PartState, PostSnapshot } from '../types';
import { seriesLabel } from '@/lib/content-type/story-series';
import type { StoryVertical } from '@/lib/social-hub/story-types';
import { VERTICAL_LABELS } from '../labels';

import type { Metered } from './carousels';
import { liveStoriesDeps } from './stories-live';

export type { Metered };

/** The Stories build's stages (lib/stories/build/*, render-stage.ts): pick → write → ground → photo → backdrop → render. */
export const STORIES_STAGE_TAGS = ['pick', 'write', 'ground', 'photo', 'backdrop', 'render'] as const;

/**
 * A wording fix's worst case: one Haiku fact check, then one news-writer rewrite of one story (Opus 5.5 at
 * $4 in / $20 out per MTok: up to three turns of ~5K input incl. the 9,000-char article, ~1K output in all,
 * ≈ $0.10) with its own one or two Haiku checks, rounded up. Under the approved $0.15 Stories wording cap.
 */
export const STORIES_WORDING_ESTIMATE_USD = 0.12;

/**
 * A photo swap: one news photo finder run (Haiku brief + AI check, Jev grades of up to ~15 candidates, one or
 * two Serper searches) and one Jev band check. Priced like Carousels' and Last Few Days' $0.05 photo search,
 * doubled for the grades; under the approved $0.20 Stories photo cap.
 */
export const STORIES_PHOTO_SWAP_ESTIMATE_USD = 0.1;

/** The build's headline rule (lib/stories/build/morning-download.ts `ok`): at most 260 characters, one or two sentences. */
const HEADLINE_MAX = 260;
/** The build's article cut for the writer and grounding (morning-download.ts BODY_CHARS). */
export const STORIES_BODY_CHARS = 9000;
/** The person's request, added to the news writer's conversation (writeStories `instruction`); the W12 text is unchanged. */
export function storiesRewriteInstruction(value: string): string {
  return `A person reviewing this Morning Download frame asked for it to say: "${value}". Keep that change as far as the source supports it.`;
}

/** Crop positions for a frame photo (photo.focus as object-position fractions, render/types.ts). */
const CROPS = {
  top: { x: 0.5, y: 0 },
  center: { x: 0.5, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  left: { x: 0, y: 0.5 },
  right: { x: 1, y: 0.5 },
} as const;

/** Statuses a revision (and its undo) may write in: built and in review. Approved or scheduled sets are sent back first by the engine. */
const WRITABLE: SetStatus[] = ['ready'];

export type StoriesDeps = {
  /**
   * Draw ONE frame (the renderer takes Frame[]; index/total keep its place in the set) and, when its
   * own checks pass, store its JPEG under `key`. Returns the stored path ('' when not stored), the
   * JPEG size and every problem the renderer's code checks found (fonts, images, text fit, bounds,
   * safe zones, contrast). No model call, no cost.
   */
  renderFrame: (input: { frame: Frame; key: string }) => Promise<{ file: string; bytes: number; problems: string[] }>;
  /** Photo URLs published in the last 20 days (the CI-32 ledger; the build's `held` set). Free. */
  heldPhotos: (q: Query) => Promise<Set<string>>;
  /**
   * The story's article (its stories.pool entry, else the page): its text and the source's own headline (null when
   * only the page could be read), or null when it can't be read. Free.
   */
  sourceText: (q: Query, story: { key: string; url: string }) => Promise<{ text: string; headline: string | null } | null>;
  /**
   * The news writer's Haiku fact check (lib/news-writer checkFacts) on the frame's words against the article: `ok`
   * when every claim is supported, else the failing claims in `why`. An error THROWS. Charges `meter` as it pays.
   */
  factCheck: (input: { setId: string; story: MdSource; words: string }, meter: Metered) => Promise<{ ok: boolean; why: string }>;
  /**
   * ONE news-writer rewrite (writeStories('md'), the build's writer) of the story with the person's request as an
   * added instruction: the frame's line (frameCopy of the headline and body), or `dropped` with the reason when its
   * own fact check still failed. An outage, refusal or other error THROWS (reported as failed). Charges `meter`.
   */
  rewrite: (input: { setId: string; story: MdSource; instruction: string }, meter: Metered) => Promise<{ headline: string } | { dropped: string }>;
  /**
   * ONE news photo finder run (lib/news-photos findStoryPhoto) for the story, never a photo in `exclude`; `hint`'s
   * image search adds extra candidates. The pick is band-fitted and stored as the build does (bandPhotoFor): `src` is
   * the stored copy, `sourceUrl` the original. `photo` is null when nothing usable was found. Charges `meter`.
   */
  findPhoto: (input: { setId: string; story: PhotoStory; hint?: string; exclude: ReadonlySet<string> }, meter: Metered) => Promise<{ photo: Photo | null; log: string[]; result?: PhotoResult | null }>;
  /**
   * The photo bank (D49): the finder's `result` (pick and runner-ups) is offered with run ref
   * `stories-revision:<set>:<iso>` at the frame's slide (lib/news-photos/bank-offer.ts). Absent, or null: nothing is
   * offered. Never fails a revision.
   */
  photoBank?: () => Promise<PhotoBankSink | null>;
  /** The type's own un-approve: repository unscheduleSet (the set goes back to ready, its slot cancelled). */
  unschedule: (q: Query, setId: string) => Promise<{ ok: boolean; note: string }>;
  /** A short id for the revision's storage key. Default: random. */
  newId?: () => string;
};

type SetRow = { id: string; series: Series; ny_date: string; status: SetStatus; style: Style; payload: Record<string, unknown> };
type Row = {
  id: string;
  seq: number;
  role: FrameData['role'];
  template: string | null;
  backdrop: Backdrop;
  copy: FrameData;
  photo: Photo | null;
  storage_path: string | null;
  jpeg_bytes: number | null;
  ig_container_id: string | null;
  ig_media_id: string | null;
};
type MdStory = { key: string; headline: string; url: string; source: string; angle?: string };
/** A Morning Download story as the writer and fact check see it: the source's headline, its text and the build's angle. */
export type MdSource = { key: string; headline: string; text: string; angle: string };
type LogEntry = { frame: string; picked?: string; steps?: string[] };
/** The frame's state, plus its JPEG size and its own photo-log steps (this frame's, so replaying them is safe). */
type StoriesState = PartState & { jpegBytes?: number | null; logSteps?: string[] | null };

const setIdOf = (refs: ActionTarget) => refs.setId ?? '';
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const blocked = (note: string) => ({ ok: false as const, reason: 'blocked' as const, note });
const failed = (note: string) => ({ ok: false as const, reason: 'failed' as const, note });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const asDb = (q: Query): Queryable => ({ query: async (text, params) => ({ rows: (await q(text, params)).rows }) });
// SS-1: one label map for every series (lib/content-type/story-series.ts).
const SERIES_NAME = (series: Series): string => seriesLabel(series);

/** The build's sentence rule (lib/stories/build/common.ts sentenceCount), copied so the registry stays light. */
function sentenceCount(text: string): number {
  return text.split(/(?<=[.!?])\s+(?=[A-Z0-9"“$])/).filter((s) => !/\b(Gov|Sen|Rep|Dr|Mr|Mrs|Ms|St|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|Inc|Corp|No)\.$/.test(s.trim())).length;
}

async function readSet(q: Query, setId: string): Promise<{ set: SetRow; rows: Row[] } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(setId)) return null;
  const { rows: sets } = await q(`SELECT id::text AS id, series, to_char(ny_date, 'YYYY-MM-DD') AS ny_date, status, style, payload FROM stories.sets WHERE id = $1::uuid`, [setId]);
  if (!sets[0]) return null;
  const { rows } = await q(
    `SELECT id::text AS id, seq, role, template, backdrop, copy, photo, storage_path, jpeg_bytes, ig_container_id, ig_media_id
       FROM stories.frames WHERE set_id = $1::uuid ORDER BY seq`,
    [setId],
  );
  return { set: sets[0] as SetRow, rows: rows as Row[] };
}

/** The engine's vocabulary. stories.sets is the source of truth (the spine is its projection). */
function statusOf(s: SetStatus): PostSnapshot['status'] {
  if (s === 'ready') return 'review';
  if (s === 'approved' || s === 'scheduled') return s;
  if (s === 'publishing' || s === 'published') return 'published';
  // A failed or skipped set is not live any more (a regenerate makes a new set): locked like a rejection.
  if (s === 'rejected' || s === 'failed' || s === 'skipped') return 'rejected';
  return 'preview'; // requested / building: not built yet
}

/** The frame with a different photo (Free vs. Paid frames carry theirs as `logo`). */
function withPhoto(copy: FrameData, photo: Photo | undefined): FrameData {
  const next = clone(copy) as FrameData & { photo?: Photo; logo?: Photo };
  const key = copy.role === 'paid' || copy.role === 'free' ? 'logo' : 'photo';
  if (photo) next[key] = photo;
  else delete next[key];
  return next;
}

/** A frame's name in the build's photo log: 'opener', 'story 1', … (morning-download.ts photoLog). */
function logLabel(rows: Row[], row: Row): string {
  if (row.role === 'opener') return 'opener';
  if (row.role === 'story') return `story ${rows.filter((r) => r.role === 'story' && r.seq <= row.seq).length}`;
  return `${row.role} ${row.seq}`;
}

const storyIndex = (rows: Row[], row: Row) => rows.filter((r) => r.role === 'story' && r.seq <= row.seq).length - 1;

/**
 * The set payload as it follows from `rows`: each photo-log entry's `picked` is the photo its frame
 * shows now, and each Morning Download story's headline is its frame's. `steps` (one frame's log)
 * replaces that frame's entry steps. Recomputed from the current frames on revise AND restore, so
 * undoing frames out of order never drops another frame's entry.
 */
function derivePayload(set: SetRow, rows: Row[], steps?: { label: string; steps: string[] }): Record<string, unknown> {
  const p = clone(set.payload);
  if (Array.isArray(p.photo_log)) {
    for (const e of p.photo_log as LogEntry[]) {
      const row = rows.find((r) => logLabel(rows, r) === e.frame);
      if (!row) continue;
      // The build logs the original (a band-fitted photo's `sourceUrl`), not the stored copy.
      const p = framePhoto(row.copy);
      const src = p?.sourceUrl ?? p?.src;
      if (src) e.picked = src;
      else delete e.picked;
      if (steps && steps.label === e.frame) e.steps = steps.steps;
    }
  }
  if (set.series === 'morning_download' && Array.isArray(p.stories)) {
    const stories = p.stories as MdStory[];
    rows.filter((r) => r.role === 'story').forEach((r, k) => {
      const h = (r.copy as { headline?: unknown }).headline;
      if (stories[k] && typeof h === 'string') stories[k]!.headline = h;
    });
  }
  return p;
}

const logOf = (set: SetRow, label: string): LogEntry | undefined =>
  Array.isArray(set.payload.photo_log) ? (set.payload.photo_log as LogEntry[]).find((e) => e.frame === label) : undefined;

function stateOf(set: SetRow, rows: Row[], row: Row): StoriesState {
  return {
    copy: row.copy,
    photo: row.photo,
    colors: { backdrop: row.backdrop },
    layout: { template: row.template },
    files: row.storage_path ? [row.storage_path] : [],
    jpegBytes: row.jpeg_bytes,
    logSteps: logOf(set, logLabel(rows, row))?.steps ?? null,
  };
}

const revState = (r: Row): FrameRevisionState => ({ copy: r.copy, photo: r.photo, backdrop: r.backdrop, template: r.template, storagePath: r.storage_path, jpegBytes: r.jpeg_bytes });

/** What a person would call the frame's words, for the snapshot and the photo search. */
function wordsOf(d: FrameData): string {
  switch (d.role) {
    case 'opener': return `the opener: "${d.date}", ${d.storyCount} stories`;
    case 'story': return `${d.headline} (${d.source.verb} ${d.source.name})`;
    case 'closer': return 'the closer: the fixed sign-off';
    case 'intro': return 'the intro';
    case 'question': return `question: ${d.question} (${d.options.map((o) => `${o.letter}. ${o.text}`).join(', ')})`;
    case 'answer': return `answer: ${d.correct}. ${d.answerLine}`;
    case 'paid': return `paid tool: ${d.tool}, ${d.price} ${d.period}. ${d.tease}`;
    case 'free': return `free tool: ${d.tool}. ${d.what} ${d.how} (${d.platforms})`;
    case 'roa_question': return `round ${d.round} question: Real or AI?`;
    case 'roa_reveal': return `round ${d.round} reveal: ${d.truth === 'ai' ? 'AI' : 'Real'}. ${d.payoff === 'prompt' ? `Prompt: ${d.prompt ?? '(none)'}` : d.payoff === 'effort' ? d.line ?? '' : `${d.receipt?.head ?? 'Camera'}: ${(d.receipt?.rows ?? []).join(' / ') || '(none)'}`} (${d.proof})`;
  }
}

function layoutOf(p: Photo | undefined): string {
  if (!p) return 'no photo';
  if (p.kind === 'logo') return 'logo shown whole';
  return `photo cropped at ${p.focus ? `${Math.round(p.focus.x * 100)}% ${Math.round(p.focus.y * 100)}%` : 'center'}`;
}

/** The meter as a billable dep sees it: once it has thrown, `stopped()` is true and every spend re-throws. */
function metered(meter: { spend(usd: number): void }): Metered & { check(): void } {
  let stop: unknown = null;
  const halt = (): never => {
    throw stop;
  };
  return {
    spend(usd) {
      if (stop) halt();
      try {
        meter.spend(usd);
      } catch (e) {
        stop = e;
        throw e;
      }
    },
    stopped: () => stop !== null,
    halt,
    check: () => {
      if (stop) halt();
    },
  };
}

/** A photo's addresses: the stored copy and, for a band-fitted photo, its original. */
const photoUrls = (p: Photo | null | undefined): string[] => [p?.src, p?.sourceUrl].filter((u): u is string => Boolean(u));

const REPLACED = /^revision: replaced (\S+) with /;

/**
 * Photos this frame showed before a "different photo" revision replaced them: from the frame's photo-log
 * steps (`revision: replaced X with Y`) and from the revisions log (applied revisions of this frame,
 * their `before` photo), which also covers sets without a photo log.
 */
async function rejectedPhotos(q: Query, set: SetRow, label: string, seq: number): Promise<Set<string>> {
  const out = new Set<string>();
  for (const step of logOf(set, label)?.steps ?? []) {
    const m = REPLACED.exec(step);
    if (m && m[1] !== 'no') out.add(m[1]!);
  }
  try {
    const { rows } = await q(
      `SELECT before FROM revisions.requests
        WHERE vertical IN ('stories', 'ai_trivia', 'real_or_ai') AND refs->>'setId' = $1 AND part->>'kind' = 'frame' AND part->>'key' = $2
          AND fix_kind = 'photo' AND status = 'applied' AND before IS NOT NULL`,
      [set.id, String(seq)],
    );
    for (const r of rows) {
      const before = r.before as { copy?: FrameData; photo?: Photo | null } | null;
      for (const u of photoUrls((before?.copy ? framePhoto(before.copy) : undefined) ?? before?.photo)) out.add(u);
    }
  } catch {
    // The revisions log is not there (a database without revisions_schema.sql): the photo log alone counts.
  }
  return out;
}

/**
 * One description per Stories-format type (SS-1): all three revise a set the same way; only the type they
 * file under differs. Morning Download keeps `stories` and its label.
 */
export function createStoriesDescription(deps: StoriesDeps, vertical: StoryVertical = 'stories'): ContentTypeDescription {
  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));

  async function save(q: Query, set: SetRow, row: Row, next: FrameRevisionState, payload: Record<string, unknown>): Promise<boolean> {
    const { saveFrameRevision } = await import('@/lib/stories/repository');
    return saveFrameRevision(asDb(q), row.id, { expect: revState(row), next, expectPayload: set.payload, payload, statuses: WRITABLE });
  }

  return {
    vertical,
    label: vertical === 'stories' ? 'stories' : VERTICAL_LABELS[vertical],
    stageTags: STORIES_STAGE_TAGS,
    fixKinds: ['photo', 'wording', 'color', 'layout'],
    argsGuide: {
      wording:
        'Only a Morning Download story frame\'s headline can be reworded: args.field is headline and args.value is the exact new headline (one or two sentences).',
      color: 'args.backdrop is the frame\'s new background color: one of black, white, orange or green.',
      layout:
        'args.crop is where the frame\'s photo is cropped to: one of top, center, bottom, left or right.',
      photo: 'No args are needed; args.hint is an optional short description of the photo wanted (for example "Dario Amodei on stage").',
    },

    async load(q, refs) {
      const got = await readSet(q, setIdOf(refs));
      if (!got) return null;
      const { set, rows } = got;
      const parts: Array<PostSnapshot['parts'][number]> = rows.map((r) => {
        const p = framePhoto(r.copy);
        const twin = p ? rows.find((o) => o.seq < r.seq && framePhoto(o.copy)?.src === p.src) : undefined;
        return {
          ref: { kind: 'frame', key: String(r.seq) },
          text: `Frame ${r.seq} of ${rows.length} (${r.role}): ${wordsOf(r.copy)}${twin ? ` [same photo as frame ${twin.seq}]` : ''}`,
          ...(p?.src ? { photoUrl: p.src } : {}),
          ...(p?.credit ? { photoCredit: p.credit } : {}),
          color: r.backdrop,
          layout: layoutOf(p),
        };
      });
      return { vertical, refs, status: statusOf(set.status), parts };
    },

    /** Color and layout are a render only; wording is grounding plus at most one rewrite; a photo is at most two searches. */
    estimate(fix: FixKind) {
      if (fix === 'wording') return STORIES_WORDING_ESTIMATE_USD;
      if (fix === 'photo') return STORIES_PHOTO_SWAP_ESTIMATE_USD;
      return 0;
    },

    async revise({ q, refs, interpretation: it, meter }) {
      const got = await readSet(q, setIdOf(refs));
      if (!got) return failed('This Story set could not be found, so nothing was changed.');
      const { set, rows } = got;
      const series = SERIES_NAME(set.series);
      if (set.status === 'publishing' || set.status === 'published') return blocked(`This ${series} set is posting or has posted, so it was not changed.`);
      if (set.status === 'rejected' || set.status === 'failed' || set.status === 'skipped') return blocked(`This ${series} set was ${set.status}, so it was not changed.`);
      if (set.status === 'requested' || set.status === 'building') return failed(`This ${series} set is still being built, so nothing was changed. Try again once it is ready.`);
      if (!WRITABLE.includes(set.status)) return failed(`This ${series} set is ${set.status}; it must be back in review before a frame can change, so nothing was changed.`);
      if (VIDEO_SERIES.has(set.series)) return blocked(`${series} frames are videos rendered together, so a frame can't be revised on its own; nothing was changed. Regenerate the set instead.`);
      if (set.series === 'guess_the_number') return blocked('Guess the Number is retired, so its sets are not revised; nothing was changed.');
      if (set.series === 'real_or_ai') return blocked('Real or AI? frames show the round\'s own screened image and its checked answer, so a frame can\'t be revised on its own; nothing was changed. Regenerate the set instead.');
      const seq = it.part.kind === 'frame' && /^\d+$/.test(it.part.key) ? Number(it.part.key) : 0;
      const row = rows.find((r) => r.seq === seq);
      if (!row) return failed(`There is no frame ${it.part.key} in this set (it has ${rows.length}), so nothing was changed.`);
      if (row.ig_container_id || row.ig_media_id) return blocked(`Frame ${seq} has already gone to Instagram, so it was not changed.`);
      const args = it.args ?? {};
      const m = metered(meter);
      let copy = clone(row.copy);
      let backdrop = row.backdrop;
      const template = row.template;
      let logSteps: { label: string; steps: string[] } | undefined;
      const cur = framePhoto(row.copy);

      if (it.fixKind === 'color') {
        const want = args.backdrop?.trim().toLowerCase();
        if (!want) return failed(`I could not tell which background color frame ${seq} should have (black, white, orange or green), so nothing was changed.`);
        if (!(BACKDROPS as readonly string[]).includes(want)) return failed(`"${want}" is not a Stories background. Choose black, white, orange or green; nothing was changed.`);
        if (want === row.backdrop) return failed(`Frame ${seq} is already ${want}, so nothing was changed.`);
        backdrop = want as Backdrop;
      } else if (it.fixKind === 'layout') {
        if (row.role === 'closer' || row.role === 'intro' || row.role === 'paid' || row.role === 'free') {
          return blocked(`Frame ${seq} (the ${row.role}) has a fixed layout with nothing to crop, so it was not changed.`);
        }
        const crop = args.crop?.trim().toLowerCase();
        if (crop) {
          if (!(crop in CROPS)) return failed(`"${crop}" is not a crop I know. Choose top, center, bottom, left or right; nothing was changed.`);
          if (!cur?.src) return blocked(`Frame ${seq} has no photo, so there is nothing to crop.`);
          if (cur.kind === 'logo') return blocked(`Frame ${seq}'s picture is a logo, which is always shown whole, so it can't be cropped.`);
          const focus = CROPS[crop as keyof typeof CROPS];
          if (same(cur.focus ?? CROPS.center, focus)) return failed(`Frame ${seq}'s photo is already cropped at the ${crop}, so nothing was changed.`);
          copy = withPhoto(row.copy, { ...cur, focus: { ...focus } });
        } else {
          return failed(`I could not tell how frame ${seq}'s layout should change (a crop: top, center, bottom, left or right), so nothing was changed.`);
        }
      } else if (it.fixKind === 'wording') {
        if (set.series === 'free_vs_paid') return blocked('Free vs. Paid words come from the checked tool pair and its prices, which a revision can\'t re-check, so they were not changed. Regenerate the set instead.');
        if (row.copy.role !== 'story') return blocked(`Frame ${seq} (the ${row.role}) has no headline to reword: its words are fixed or follow from the stories, so it was not changed.`);
        const field = args.field?.trim().toLowerCase();
        if (field !== 'headline') return failed(`I could not tell which words of frame ${seq} to change (only the headline can be reworded), so nothing was changed.`);
        const value = args.value?.trim().replace(/\s+/g, ' ');
        if (!value) return failed(`I could not tell what frame ${seq}'s headline should say, so nothing was changed.`);
        if (value === row.copy.headline) return failed(`Frame ${seq}'s headline already says that, so nothing was changed.`);
        const fits = (h: string) => h.length <= HEADLINE_MAX && sentenceCount(h) >= 1 && sentenceCount(h) <= 2;
        if (!fits(value)) return blocked(`That headline is ${value.length} characters and ${sentenceCount(value)} sentence(s); a story frame takes one or two sentences and at most ${HEADLINE_MAX} characters, so it was not changed.`);
        const story = (Array.isArray(set.payload.stories) ? (set.payload.stories as MdStory[]) : [])[storyIndex(rows, row)];
        if (!story?.url) return failed(`I could not find which article frame ${seq} came from, so its new headline could not be fact-checked; nothing was changed.`);
        const article = await deps.sourceText(q, { key: story.key, url: story.url });
        if (!article) return failed(`I could not re-read frame ${seq}'s article to fact-check the new headline, so nothing was changed.`);
        const source: MdSource = { key: story.key, headline: article.headline ?? story.headline, text: article.text.slice(0, STORIES_BODY_CHARS), angle: story.angle ?? '' };
        // An outage or error from the fact check or the writer is "could not do it" (failed), never a
        // fact-check rejection; a ceiling stop re-throws.
        type Called<T> = { ok: true; value: T } | { ok: false; error: string };
        const call = async <T,>(f: () => Promise<T>): Promise<Called<T>> => {
          try {
            const value = await f();
            m.check();
            return { ok: true, value };
          } catch (e) {
            m.check();
            return { ok: false, error: errText(e) };
          }
        };
        const unreachable = (what: string, error: string) => failed(`I couldn't reach the ${what} (${error}), so frame ${seq}'s headline was not changed.`);
        let headline = value;
        const first = await call(() => deps.factCheck({ setId: set.id, story: source, words: value }, m));
        if (!first.ok) return unreachable('fact check', first.error);
        if (!first.value.ok) {
          // The build's writer, once: the person's request rides along as an instruction, and the writer's own fact
          // check (with its one rewrite turn) must pass, or the story is dropped.
          const retry = await call(() => deps.rewrite({ setId: set.id, story: source, instruction: storiesRewriteInstruction(value) }, m));
          if (!retry.ok) return unreachable('writer', retry.error);
          if ('dropped' in retry.value) {
            return blocked(`The fact check could not match frame ${seq}'s new headline to its article (${first.value.why}), and the writer's rewrite did not pass it either, so it was not changed. Try words the article states.`);
          }
          const again = retry.value.headline.trim();
          if (!again) return failed(`The fact check did not match the new headline, and the writer returned no rewrite for frame ${seq}, so nothing was changed.`);
          if (!fits(again)) return blocked(`The fact check did not match the new headline, and the one rewrite ran past two sentences or ${HEADLINE_MAX} characters, so frame ${seq} was not changed.`);
          headline = again;
        }
        copy = { ...row.copy, headline };
      } else if (it.fixKind === 'photo') {
        if (row.role === 'closer' || row.role === 'intro') return blocked(`Frame ${seq} (the ${row.role}) shows no photo, so there is nothing to replace.`);
        if (row.role === 'paid' || row.role === 'free') return blocked(`Frame ${seq} shows the tool's own logo, so it was not replaced.`);
        if (row.role === 'opener') return blocked(`Frame ${seq} (the opener) shows every story's own photo, so it has none of its own to replace. Ask for a new photo on a story frame instead.`);
        if (set.series !== 'morning_download' || row.copy.role !== 'story') return blocked(`Frame ${seq} (the ${row.role}) takes no new photo: only Morning Download story frames do, so it was not changed.`);
        const story = (Array.isArray(set.payload.stories) ? (set.payload.stories as MdStory[]) : [])[storyIndex(rows, row)];
        if (!story?.url) return failed(`I could not find which article frame ${seq} came from, so no new photo was looked for; nothing was changed.`);
        // Never a photo another frame shows, the one being replaced, or one published in the last 20 days (original or stored copy).
        const exclude = new Set<string>(await deps.heldPhotos(q));
        for (const r of rows) {
          for (const p of [framePhoto(r.copy), r.photo]) for (const u of photoUrls(p)) exclude.add(u);
        }
        const label = logLabel(rows, row);
        // Nor a photo the person already turned down on this frame (an earlier "different photo" revision).
        for (const u of await rejectedPhotos(q, set, label, seq)) exclude.add(u);
        // The build's story: the source's headline and its article text (the photo brief reads both). Free.
        const article = await deps.sourceText(q, { key: story.key, url: story.url });
        const photoStory: PhotoStory = { id: story.key, headline: article?.headline ?? row.copy.headline, text: (article?.text ?? row.copy.headline).slice(0, STORIES_BODY_CHARS), url: story.url, duplicateUrls: [] };
        const hint = args.hint?.trim();
        m.check();
        let got: { photo: Photo | null; log: string[]; result?: PhotoResult | null };
        try {
          got = await deps.findPhoto({ setId: set.id, story: photoStory, ...(hint ? { hint } : {}), exclude }, m);
        } catch (e) {
          m.check();
          return failed(`I couldn't search for another photo for frame ${seq} (${errText(e)}), so the original was kept.`);
        }
        // The photo bank (D49): what the finder found, the swapped-in pick as `picked` at this frame. Best effort.
        if (got.result && deps.photoBank) {
          try {
            const [bank, { offerToBank }] = await Promise.all([deps.photoBank(), import('@/lib/news-photos/bank-offer')]);
            const at = new Date();
            offerToBank(bank, got.result, { runRef: `stories-revision:${set.id}:${at.toISOString()}`, slide: seq, posted: Boolean(got.photo), headline: photoStory.headline, at });
          } catch {
            /* the bank never fails a revision */
          }
        }
        m.check();
        const photo = got.photo;
        const original = photo?.sourceUrl ?? photo?.src;
        if (!photo?.src || !original || !photo.credit?.trim() || photoUrls(photo).some((u) => exclude.has(u))) {
          return failed(`I searched for another photo for frame ${seq}${hint ? ` ("${hint}")` : ''} and couldn't find a different usable one (not shown on another frame of this set, turned down before, or published in the last 20 days), so the original was kept.`);
        }
        const found: Photo = clone(photo);
        copy = withPhoto(row.copy, found);
        const old = logOf(set, label)?.steps ?? [];
        const was = cur?.sourceUrl ?? cur?.src;
        logSteps = { label, steps: [...old, `revision: replaced ${was ?? 'no photo'} with ${original} (a person asked for a different photo)`] };
      } else {
        return blocked(`${it.fixKind} fixes are not available for Stories.`);
      }

      const id = newId();
      const { frameObjectPath } = await import('@/lib/stories/storage');
      const key = frameObjectPath(set.id, row.seq, row.role).replace(/\.jpg$/, `.rev${id}.jpg`);
      const frame: Frame = { series: set.series, style: set.style, backdrop, index: row.seq, total: rows.length, data: copy };
      let out: { file: string; bytes: number; problems: string[] };
      try {
        out = await deps.renderFrame({ frame, key });
      } catch (e) {
        return failed(`Frame ${seq} could not be drawn with that change (${errText(e)}), so the original was kept.`);
      }
      if (out.problems.length) return failed(`Frame ${seq} did not draw cleanly with that change (${out.problems[0]}), so the original was kept.`);
      if (!out.file) return failed(`Frame ${seq}'s new image was not stored, so the original was kept.`);
      if (out.bytes > MAX_JPEG_BYTES) return failed(`Frame ${seq}'s new image is over Instagram's 8 MB, so the original was kept.`);

      const nextRow: Row = { ...row, copy, photo: framePhoto(copy) ?? null, backdrop, template, storage_path: out.file, jpeg_bytes: out.bytes };
      const nextRows = rows.map((r) => (r.id === row.id ? nextRow : r));
      const payload = derivePayload(set, nextRows, logSteps);
      if (!(await save(q, set, row, revState(nextRow), payload))) return failed('The set changed or left review while the fix ran, so it was not changed.');
      return { ok: true, before: stateOf(set, rows, row), after: stateOf({ ...set, payload }, nextRows, nextRow) };
    },

    async restore({ q, refs, part, state }) {
      const got = await readSet(q, setIdOf(refs));
      if (!got) throw new Error('The Story set is gone.');
      const { set, rows } = got;
      const seq = part.kind === 'frame' && /^\d+$/.test(part.key) ? Number(part.key) : 0;
      const row = rows.find((r) => r.seq === seq);
      if (!row) throw new Error(`There is no frame ${part.key} to restore.`);
      const s = state as StoriesState;
      const copy = (s.copy as FrameData | undefined) ?? row.copy;
      const backdrop = (s.colors as { backdrop?: Backdrop } | undefined)?.backdrop ?? row.backdrop;
      const layout = s.layout as { template?: string | null } | undefined;
      const template = layout && 'template' in layout ? (layout.template ?? null) : row.template;
      const nextRow: Row = { ...row, copy, photo: framePhoto(copy) ?? null, backdrop, template, storage_path: s.files[0] ?? row.storage_path, jpeg_bytes: s.jpegBytes ?? row.jpeg_bytes };
      const nextRows = rows.map((r) => (r.id === row.id ? nextRow : r));
      // Undo is per frame: the payload is rebuilt from the frames as they are now; only this frame's own log steps come back.
      const label = logLabel(rows, row);
      const payload = derivePayload(set, nextRows, Array.isArray(s.logSteps) ? { label, steps: s.logSteps } : undefined);
      // Already in that state: nothing to write (idempotent).
      if (same(revState(nextRow), revState(row)) && same(payload, set.payload)) return;
      if (row.ig_container_id || row.ig_media_id) throw new Error(`Frame ${seq} has already gone to Instagram, so it was not restored.`);
      if (!(await save(q, set, row, revState(nextRow), payload))) throw new Error('The set changed or left review, so the frame could not be restored.');
    },

    unschedule: (q, refs) => deps.unschedule(q, setIdOf(refs)),
  };
}

export const storiesDescription: ContentTypeDescription = createStoriesDescription(liveStoriesDeps);
export const aiTriviaDescription: ContentTypeDescription = createStoriesDescription(liveStoriesDeps, 'ai_trivia');
export const realOrAiDescription: ContentTypeDescription = createStoriesDescription(liveStoriesDeps, 'real_or_ai');
