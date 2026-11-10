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
 *   wording  Morning Download story headlines only: the writer's length/sentence rule → Jev md-grounding
 *            (bar 0.6) over the frame's words; a miss gets ONE Sonnet md-headlines rewrite, which must
 *            ground again (the build's rule). Free vs. Paid words came through gates this path can't
 *            re-run (the pair score), so they are refused.
 *
 * AI Trivia frames are videos rendered as a pair (lib/stories/trivia/render) and Guess the Number is
 * retired (AT-14): neither takes a revision; Regenerate makes a new set.
 *   photo    one finder search (createLivePhotoFinder().find) per request, at most two requests, never a
 *            photo another frame of the set shows (the opener counts), the replaced photo, or one in
 *            the used-photo ledger (CI-32: published in the last 20 days)
 *
 * Parts: `{ kind: 'frame', key: '<seq>' }` (the frame's real seq, 1-based).
 */
import { randomUUID } from 'node:crypto';

import type { ActionTarget } from '@/lib/publishing/actions/types';
import type { Query } from '@/lib/social/store/pg';
import type { Queryable } from '@/lib/stories/db';
import type { PhotoRequest } from '@/lib/stories/photos';
import { BACKDROPS, MAX_JPEG_BYTES, VIDEO_SERIES, framePhoto, type Backdrop, type Frame, type FrameData, type Photo, type Series, type Style } from '@/lib/stories/render/types';
import type { FrameRevisionState, SetStatus } from '@/lib/stories/repository';

import type { ContentTypeDescription, FixKind, PartState, PostSnapshot } from '../types';

import type { Metered } from './carousels';
import { liveStoriesDeps } from './stories-live';

export type { Metered };

/** The Stories build's stages (lib/stories/build/*, render-stage.ts): pick → write → ground → photo → backdrop → render. */
export const STORIES_STAGE_TAGS = ['pick', 'write', 'ground', 'photo', 'backdrop', 'render'] as const;

/**
 * A wording fix's worst case: one Sonnet 5.5 md-headlines rewrite for one story at Stories' own rates
 * (lib/stories/cost.ts RATES: $2 in / $10 out per MTok; ~8K input incl. the 9,000-char article and
 * ~2K output ≈ $0.036) plus two Jev md-grounding calls (fractions of a cent), rounded up.
 * NEEDS TOMMY'S CONFIRMATION before caps are approved.
 */
export const STORIES_WORDING_ESTIMATE_USD = 0.05;

/**
 * A photo swap: at most two finder searches (Jev picks + Haiku 5.5 photo vision, priced by
 * lib/stories/cost.ts). No constant exists for one search; Carousels and Last Few Days price one
 * photo search at $0.05, so two are $0.10. NEEDS TOMMY'S CONFIRMATION before caps are approved.
 */
export const STORIES_PHOTO_SWAP_ESTIMATE_USD = 0.1;

/** The build's headline rule (lib/stories/build/morning-download.ts `ok`): at most 260 characters, one or two sentences. */
const HEADLINE_MAX = 260;
/** The build's article cut for the writer and grounding (morning-download.ts BODY_CHARS). */
export const STORIES_BODY_CHARS = 9000;
/** The build's rewrite note (morning-download.ts, the second writeFor), verbatim. */
const REWRITE_NOTE =
  'Each of these stories had no headline last time, or its headline made a claim the source does not support, or ran past two sentences or 240 characters. Write one headline for each, stating only what the source says.';

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
  /** The story's article text (its stories.pool entry, else the page), or null when it can't be read. Free. */
  sourceText: (q: Query, story: { key: string; url: string }) => Promise<string | null>;
  /** Jev md-grounding@1 on a headline: the `supported` probability. Charges `meter` as it pays. */
  grounded: (input: { setId: string; headline: string; source: string }, meter: Metered) => Promise<number>;
  /**
   * ONE Sonnet md-headlines rewrite of the story with `note`; null only when the writer answered with no
   * headline. An outage, refusal or other error THROWS (reported as failed, not as a fact-check miss).
   * Charges `meter` as it pays.
   */
  rewrite: (
    input: { setId: string; story: { key: string; headline: string; outlet: string; url: string; body: string }; note: string },
    meter: Metered,
  ) => Promise<{ headline: string } | null>;
  /** ONE finder search (createLivePhotoFinder().find) for `request`, or null. Charges `meter` as it pays. */
  findPhoto: (input: { setId: string; request: PhotoRequest }, meter: Metered) => Promise<Photo | null>;
  /**
   * A photo's pixel size (the finder's own size probe, lib/social/photos/size.ts createSizeProbe), or
   * null when it can't be read. Free (an HTTP read, no model). Used for the opener's cover floor.
   */
  photoSize: (url: string) => Promise<{ w: number; h: number } | null>;
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
type MdStory = { key: string; headline: string; url: string; source: string };
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
const SERIES_NAME: Record<Series, string> = { morning_download: 'Morning Download', guess_the_number: 'Guess the Number', free_vs_paid: 'Free vs. Paid', ai_trivia: 'AI Trivia' };

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
      const src = framePhoto(row.copy)?.src;
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

/** The request the build made for this frame (its photo-log trace starts `kind: "query"`), if logged. */
function loggedAsk(set: SetRow, label: string): { kind: string; query: string } | null {
  const first = logOf(set, label)?.steps?.[0];
  const m = first ? /^([a-z]+): "(.*)"$/.exec(first) : null;
  return m ? { kind: m[1]!, query: m[2]! } : null;
}

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
        WHERE vertical = 'stories' AND refs->>'setId' = $1 AND part->>'kind' = 'frame' AND part->>'key' = $2
          AND fix_kind = 'photo' AND status = 'applied' AND before IS NOT NULL`,
      [set.id, String(seq)],
    );
    for (const r of rows) {
      const before = r.before as { copy?: FrameData; photo?: Photo | null } | null;
      const src = (before?.copy ? framePhoto(before.copy)?.src : undefined) ?? before?.photo?.src;
      if (src) out.add(src);
    }
  } catch {
    // The revisions log is not there (a database without revisions_schema.sql): the photo log alone counts.
  }
  return out;
}

export function createStoriesDescription(deps: StoriesDeps): ContentTypeDescription {
  const newId = deps.newId ?? (() => randomUUID().replace(/-/g, '').slice(0, 10));

  async function save(q: Query, set: SetRow, row: Row, next: FrameRevisionState, payload: Record<string, unknown>): Promise<boolean> {
    const { saveFrameRevision } = await import('@/lib/stories/repository');
    return saveFrameRevision(asDb(q), row.id, { expect: revState(row), next, expectPayload: set.payload, payload, statuses: WRITABLE });
  }

  return {
    vertical: 'stories',
    label: 'stories',
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
      return { vertical: 'stories', refs, status: statusOf(set.status), parts };
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
      const series = SERIES_NAME[set.series];
      if (set.status === 'publishing' || set.status === 'published') return blocked(`This ${series} set is posting or has posted, so it was not changed.`);
      if (set.status === 'rejected' || set.status === 'failed' || set.status === 'skipped') return blocked(`This ${series} set was ${set.status}, so it was not changed.`);
      if (set.status === 'requested' || set.status === 'building') return failed(`This ${series} set is still being built, so nothing was changed. Try again once it is ready.`);
      if (!WRITABLE.includes(set.status)) return failed(`This ${series} set is ${set.status}; it must be back in review before a frame can change, so nothing was changed.`);
      if (VIDEO_SERIES.has(set.series)) return blocked(`${series} frames are videos rendered together, so a frame can't be revised on its own; nothing was changed. Regenerate the set instead.`);
      if (set.series === 'guess_the_number') return blocked('Guess the Number is retired, so its sets are not revised; nothing was changed.');
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
        const source = await deps.sourceText(q, { key: story.key, url: story.url });
        if (!source) return failed(`I could not re-read frame ${seq}'s article to fact-check the new headline, so nothing was changed.`);
        const { GROUNDING_BAR } = await import('@/lib/stories/build/morning-download');
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
        const was = row.copy.headline;
        const first = await call(() => deps.grounded({ setId: set.id, headline, source }, m));
        if (!first.ok) return unreachable('fact check', first.error);
        if (!(first.value >= GROUNDING_BAR)) {
          // The build's rule: a grounding miss gets ONE rewrite, which must ground again.
          const note = `${REWRITE_NOTE}\n\nA person asked for this headline: "${value}". Keep that change as far as the source supports it.`;
          const retry = await call(() => deps.rewrite({ setId: set.id, story: { key: story.key, headline: was, outlet: story.source, url: story.url, body: source }, note }, m));
          if (!retry.ok) return unreachable('writer', retry.error);
          const again = retry.value?.headline?.trim();
          if (!again) return failed(`The fact check did not match the new headline, and the writer returned no rewrite for frame ${seq}, so nothing was changed.`);
          if (!fits(again)) return blocked(`The fact check did not match the new headline, and the one rewrite ran past two sentences or ${HEADLINE_MAX} characters, so frame ${seq} was not changed.`);
          const second = await call(() => deps.grounded({ setId: set.id, headline: again, source }, m));
          if (!second.ok) return unreachable('fact check', second.error);
          if (!(second.value >= GROUNDING_BAR)) return blocked(`The fact check could not match frame ${seq}'s new headline to its article, even after one rewrite, so it was not changed. Try words the article states.`);
          headline = again;
        }
        copy = { ...row.copy, headline };
      } else if (it.fixKind === 'photo') {
        if (row.role === 'closer' || row.role === 'intro') return blocked(`Frame ${seq} (the ${row.role}) shows no photo, so there is nothing to replace.`);
        if (row.role === 'paid' || row.role === 'free') return blocked(`Frame ${seq} shows the tool's own logo, so it was not replaced.`);
        // Never a photo another frame shows (the opener counts), the one being replaced, or one published in the last 20 days.
        const exclude = new Set<string>(await deps.heldPhotos(q));
        for (const r of rows) {
          for (const p of [framePhoto(r.copy), r.photo]) if (p?.src) exclude.add(p.src);
        }
        const label = logLabel(rows, row);
        // Nor a photo the person already turned down on this frame (an earlier "different photo" revision).
        for (const u of await rejectedPhotos(q, set, label, seq)) exclude.add(u);
        const stories = Array.isArray(set.payload.stories) ? (set.payload.stories as MdStory[]) : [];
        const url = row.role === 'story' ? stories[storyIndex(rows, row)]?.url : row.role === 'opener' ? stories[0]?.url : (set.payload.url as string | undefined);
        const words = row.copy.role === 'story' ? row.copy.headline : row.copy.role === 'opener' ? (stories[0]?.headline ?? wordsOf(row.copy)) : wordsOf(row.copy);
        const fallback = { kind: 'thematic', query: words.slice(0, 200) };
        const hint = args.hint?.trim();
        const asks = hint ? [{ kind: 'thematic', query: hint }, loggedAsk(set, label) ?? fallback] : [loggedAsk(set, label) ?? fallback, fallback];
        const unique = asks.filter((a, i) => asks.findIndex((b) => b.kind === a.kind && b.query === a.query) === i).slice(0, 2);
        const tried: string[] = [];
        let found: Photo | null = null;
        for (const ask of unique) {
          m.check();
          const request: PhotoRequest = {
            kind: ask.kind,
            query: ask.query,
            subjects: ask.kind === 'person' ? [{ name: ask.query, type: 'person' }] : [],
            storyDate: set.ny_date,
            sourceUrls: url ? [url] : [],
            exclude: new Set(exclude),
            copy: words,
            ...(row.role === 'opener' ? { cover: true } : {}),
          };
          let photo: Photo | null = null;
          try {
            photo = await deps.findPhoto({ setId: set.id, request }, m);
          } catch (e) {
            m.check();
            tried.push(`"${ask.query}" (${errText(e)})`);
            continue;
          }
          m.check();
          if (!photo?.src || !photo.credit?.trim()) {
            tried.push(`"${ask.query}" (nothing usable)`);
            continue;
          }
          if (exclude.has(photo.src)) {
            tried.push(`"${ask.query}" (only a photo already used)`);
            continue;
          }
          if (row.role === 'opener') {
            // The cover rules the build's design stage applies to the opener (photos.ts findSet `cover`; size.ts):
            // never a logo, and at least COVER_MIN_SHORT_SIDE on the short side. find() does not apply them.
            exclude.add(photo.src);
            if (photo.kind === 'logo') {
              tried.push(`"${ask.query}" (a logo, which the opening frame never shows)`);
              continue;
            }
            const { COVER_MIN_SHORT_SIDE, clearsFloor } = await import('@/lib/social/photos/size');
            const floor = await clearsFloor({ url: photo.src, width: null, height: null }, COVER_MIN_SHORT_SIDE, deps.photoSize);
            if (!floor.ok) {
              tried.push(`"${ask.query}" (too small for the opening frame: ${floor.size}; needs ${COVER_MIN_SHORT_SIDE})`);
              continue;
            }
          }
          found = { src: photo.src, credit: photo.credit, kind: photo.kind };
          break;
        }
        if (!found) {
          return failed(`I searched for another photo for frame ${seq} (${tried.join('; ')}) and couldn't find a different usable one (not shown on another frame of this set, turned down before, or published in the last 20 days), so the original was kept.`);
        }
        copy = withPhoto(row.copy, found);
        const old = logOf(set, label)?.steps ?? [];
        logSteps = { label, steps: [...old, `revision: replaced ${cur?.src ?? 'no photo'} with ${found.src} (a person asked for a different photo)`] };
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
