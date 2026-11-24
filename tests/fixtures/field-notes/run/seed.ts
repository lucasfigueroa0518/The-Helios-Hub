/**
 * Offline fixtures for the Field Notes run tests: the hub's PGlite (every real schema, plus the real
 * media_library and field_notes schemas), photos made with sharp, a stub Claude client with canned
 * tool_use responses, a stub Jev transport, and a stub render that runs the real planner (no
 * browser). No network, no model (CLAUDE.md Rule 1).
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { PGlite } from '@electric-sql/pglite';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

import type { JevTransport } from '@/lib/reels/jev/runner';
import type { HubQuery } from '@/lib/social-hub/db';
import type { FieldNotesEngineDeps } from '@/lib/field-notes/run';
import type { SlideInput } from '@/lib/field-notes/render/layout';
import { planSlide } from '@/lib/field-notes/render/layout';
import type { RenderedPost, RenderedSlide } from '@/lib/field-notes/render/render';
import { EDITOR_TOOL_NAME, FACT_CHECK_TOOL_NAME, WRITER_TOOL_NAME } from '@/lib/field-notes/write/prompts';
import type { PhotoKind } from '@/lib/field-notes/types';
import type { FieldNotesClient } from '@/lib/field-notes/write/call';

import { openHubTestDb } from '../../social-hub/pglite';

export const NOW = new Date('2026-11-04T16:00:00Z');

const sql = (file: string) =>
  readFileSync(path.join(process.cwd(), 'db', file), 'utf8')
    .split(/\r?\n/)
    .filter((line) => !line.startsWith('\\'))
    .join('\n');

/**
 * The Writer's canned answer slides, one per tip in request order (one tip per slide: a value headline and a plain
 * body for the slide, the name and tryIt for the caption; no numerals so the offline fact check passes against any
 * seed text; the first tryIt quotes a command the seed text states). The stub answers with the REAL tip ids it reads
 * from the request, so a test never hard-codes ids.
 */
export const CANNED_SLIDES = [
  { headline: 'Catch small slips before you rely on results', body: 'A built-in setting called the review option gives each run a second pass before it counts, so small mistakes get noticed.', name: 'Review option', tryIt: 'Switch it on in settings, then type `/review` after a run.' },
  { headline: 'Keep long chats quick by clearing old messages', body: 'A built-in command called trim shortens a long thread to its latest part, so replies stay fast and easy to follow.', name: 'Trim command', tryIt: 'Run it in the input box and keep only the latest messages.' },
  { headline: 'Pick up a crashed job where it stopped', body: 'A built-in option called snapshot saves the state of a run while it works, so a crash does not lose finished work.', name: 'Snapshot flag', tryIt: 'Pass it when you start, then resume where you left off.' },
  { headline: 'Restart a stopped run without starting over', body: 'A built-in option called resume picks a stopped run back up from its last save instead of starting from nothing.', name: 'Resume flag', tryIt: 'Pass it with the run name and carry on from the last save.' },
  // Slides 5 and 6: posts now take up to TIP_SLIDES_MAX = 6 tips (2026-11-08).
  { headline: 'Find any old note in seconds', body: 'A built-in search called recall looks through everything you saved before and brings back the note you meant.', name: 'Recall search', tryIt: 'Open the search box and type a few words from the note.' },
  { headline: 'Share your setup with the whole team', body: 'A built-in option called share sends your saved settings to a teammate, so everyone starts from the same place.', name: 'Share option', tryIt: 'Open the settings menu and pick share.' },
];
export const CANNED_CAPTION = 'Four tools worth trying this week. Save this post for your next long run.';

let shared: Promise<{ pg: PGlite; query: HubQuery }> | null = null;

const DEFAULT_SETTINGS = `INSERT INTO field_notes.settings (key, value) VALUES
  ('auto_run', 'false'), ('publishing_live', 'false'), ('require_approval', 'true'), ('run_cap_usd', '0.5'),
  ('photo_rest_posts', '8'), ('max_pending_drafts', '3'), ('tip_expiry_days', '30'), ('darken_cap', '0.45')`;

/** One database per test file (the hub schemas are slow to load), emptied and reset to the shipped settings for every test. */
export async function freshDb(): Promise<{ pg: PGlite; query: HubQuery }> {
  shared ??= (async () => {
    const db = await openHubTestDb();
    await db.pg.exec(sql('media_library_schema.sql'));
    await db.pg.exec(sql('field_notes_schema.sql'));
    return db;
  })();
  const db = await shared;
  FACE_PHOTOS.clear();
  FACELESS_PHOTOS.clear();
  await db.pg.exec(`
    TRUNCATE field_notes.runs, field_notes.tips, field_notes.pool, field_notes.posts, field_notes.settings RESTART IDENTITY CASCADE;
    TRUNCATE media_library.photos CASCADE;
    TRUNCATE social_hub.content_items CASCADE;
    ${DEFAULT_SETTINGS};`);
  return db;
}

export const setSetting = (q: HubQuery, key: string, value: unknown) =>
  q(`INSERT INTO field_notes.settings (key, value) VALUES ($1, $2::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`, [key, JSON.stringify(value)]);

// ── photos ──────────────────────────────────────────────────────────────────

const photoCache = new Map<number, Buffer>();

/** A small calm photo (a soft gradient; seeds differ in tone), enough for the real planner. */
export async function photoBytes(i: number): Promise<Buffer> {
  const hit = photoCache.get(i);
  if (hit) return hit;
  const w = 108;
  const h = 135;
  const raw = Buffer.alloc(w * h * 3);
  const base = [30, 60, 110, 190, 90, 40][i % 6]!;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.fill(Math.min(255, base + Math.round((y / h) * 20)), (y * w + x) * 3, (y * w + x) * 3 + 3);
  const out = await sharp(raw, { raw: { width: w, height: h, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  photoCache.set(i, out);
  return out;
}

export const masterPathOf = (i: number) => `field-notes/test/master-${i}.jpg`;

/** A pool photo (own licence) uploaded `daysAgo` days before NOW; `n` makes the newest photo the highest n by default. */
/** Photo ids whose bytes the stub face detector sees a face in (every `people` photo, unless marked faceless). */
export const FACE_PHOTOS = new Set<string>();
export const FACELESS_PHOTOS = new Set<string>();

export async function addPhoto(
  q: HubQuery,
  n: number,
  o: { daysAgo?: number; status?: 'live' | 'resting' | 'retired'; lastUsedPostSeq?: number | null; kind?: PhotoKind; opener?: boolean } = {},
): Promise<string> {
  const sha = createHash('sha256').update(`photo-${n}`).digest('hex');
  const { rows } = await q<{ id: string }>(
    `INSERT INTO media_library.photos (sha256, master_path, thumb_path, mime, bytes, width, height, credit, licence, reuse_ok)
     VALUES ($1, $2, $3, 'image/jpeg', 1000, 1080, 1350, 'Helios team', 'own', false) RETURNING id::text AS id`,
    [sha, masterPathOf(n), `field-notes/test/thumb-${n}.jpg`],
  );
  const id = rows[0]!.id;
  await q(
    `INSERT INTO field_notes.pool (photo_id, uploaded_by, uploaded_at, status, last_used_post_seq, kind, opener) VALUES ($1, 'tommy', $2::timestamptz, $3, $4, $5, $6)`,
    [id, new Date(NOW.getTime() - (o.daysAgo ?? 30 - n) * 86_400_000).toISOString(), o.status ?? 'live', o.lastUsedPostSeq ?? null, o.kind ?? 'working', o.opener ?? false],
  );
  if ((o.kind ?? 'working') === 'people') FACE_PHOTOS.add(id);
  return id;
}

/**
 * `count` live photos, photo n uploaded n days after photo 0 (so the highest n is the newest). By default photo 0 is
 * the one `people` photo (the cover's) and the rest cycle working, scenery, event; `kinds` overrides per index.
 */
export async function addPool(q: HubQuery, count: number, kinds?: PhotoKind[]): Promise<string[]> {
  const cycle: PhotoKind[] = ['working', 'scenery', 'event'];
  const ids: string[] = [];
  for (let n = 0; n < count; n++) ids.push(await addPhoto(q, n, { daysAgo: 30 - n, kind: kinds?.[n] ?? (n === 0 ? 'people' : cycle[(n - 1) % 3]!) }));
  return ids;
}

// ── stubs ───────────────────────────────────────────────────────────────────

type Usage = Partial<Anthropic.Usage>;

const message = (content: unknown[], stop: string, usage: Usage): Anthropic.Message =>
  ({
    id: 'msg_stub', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5', stop_reason: stop, stop_sequence: null, content,
    usage: { input_tokens: 1200, output_tokens: 400, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...usage },
  }) as unknown as Anthropic.Message;

/** The tip ids in a Writer request, in order (the request labels each `tip_id: <uuid>`). */
const tipIdsIn = (params: { messages: unknown }): string[] => {
  const text = JSON.stringify(params.messages).replace(/\\n/g, '\n');
  return [...text.matchAll(/tip_id: (tip-\d+|[0-9a-f-]{36})/g)].map((m) => m[1]!);
};

/** One canned fact-check claim: `tipId` is the slide's (the label the request carries) or `caption`. */
export type StubClaim = { claim: string; tipId: string; kind: string; supported: boolean; evidence: string };

/**
 * The fact check's default canned answer (used only when a test passes `factCheck: 'model'`): one supported claim per
 * slide in the request, filed under that slide's tipId, quoting the tip's subject line from the source block.
 */
export function supportedClaimsFor(request: string): StubClaim[] {
  const slideIds = [...request.matchAll(/"tipId": "([^"]+)"/g)].map((m) => m[1]!);
  return slideIds.map((tipId) => {
    const subject = new RegExp(`tip_id: ${tipId}\\n([^\\n]+)`).exec(request)?.[1] ?? tipId;
    return { claim: `the slide is about ${subject}`, tipId, kind: 'name', supported: true, evidence: subject };
  });
}

/**
 * Canned tool_use answers: the Writer writes a slide for the first `supported` tips (all of them by default) using the real
 * ids from the request and skips the rest; the Editor hands the same slides back uncut. The only Claude transport in a test.
 * `draft(tipIds)` replaces the Writer's whole answer. The fact check (only reached with `factCheck: 'model'`) answers
 * `claims(request)`, by default one supported claim per slide (supportedClaimsFor); every claim carries a tipId.
 */
export function stubClaude(o: { usage?: Usage; failWith?: string; supported?: number; draft?: (tipIds: string[]) => unknown; claims?: (request: string) => StubClaim[] } = {}): FieldNotesClient & { calls: string[]; tipIds: string[][]; writerRequests: string[] } {
  const calls: string[] = [];
  const seen: string[][] = [];
  const writerRequests: string[] = [];
  let last: unknown = null;
  return {
    calls,
    tipIds: seen,
    writerRequests,
    messages: {
      create: async (params) => {
        const tool = (params.tools as { name: string }[])[0]!.name;
        calls.push(tool);
        if (o.failWith) return message([{ type: 'text', text: o.failWith }], 'end_turn', o.usage ?? {});
        if (tool === FACT_CHECK_TOOL_NAME) {
          const request = JSON.stringify(params.messages).replace(/\\n/g, '\n').replace(/\\"/g, '"');
          return message([{ type: 'tool_use', id: 'tu', name: tool, input: { claims: (o.claims ?? supportedClaimsFor)(request) } }], 'tool_use', o.usage ?? {});
        }
        if (tool !== WRITER_TOOL_NAME && tool !== EDITOR_TOOL_NAME) throw new Error(`unexpected tool ${tool}`);
        if (tool === WRITER_TOOL_NAME) {
          const ids = tipIdsIn(params);
          seen.push(ids);
          writerRequests.push(JSON.stringify(params.messages).replace(/\\n/g, '\n'));
          const n = Math.min(o.supported ?? ids.length, ids.length);
          last = o.draft
            ? o.draft(ids)
            : {
                slides: ids.slice(0, n).map((tipId, i) => ({ tipId, ...CANNED_SLIDES[i]! })),
                skipped: ids.slice(n).map((tipId) => ({ tipId, missing: 'the source does not say what the helper is or what it does for the reader' })),
                caption: CANNED_CAPTION,
              };
          return message([{ type: 'tool_use', id: 'tu', name: tool, input: last }], 'tool_use', o.usage ?? {});
        }
        return message([{ type: 'tool_use', id: 'tu', name: tool, input: { ...(last as object), cut_notes: [] } }], 'tool_use', o.usage ?? {});
      },
    },
  };
}

/**
 * Jev answers yes (0.8) to every yes/no question (so `about_ai` passes the AI gate); each choice cycles through its
 * options call by call (so the n-th scored candidate gets the n-th want, and three candidates never share one), except
 * `leaf`, which is `skill` (neither a repo nor a feature leaf, so the post-mix rules stay out of tests that are not
 * about them); counts calls. `nouls(untrusted)` overrides yes/no answers per candidate (e.g. `about_ai`). `pick(untrusted)` overrides
 * the choices per candidate (it reads the state's untrusted text). The only Jev transport in a test.
 */
const cycle = (options: string[], i: number) => options[i % options.length];

export function stubJev(
  o: { pick?: (untrusted: string) => Record<string, string>; nouls?: (untrusted: string) => Record<string, number> } = {},
): JevTransport & { calls: number } {
  const t = {
    calls: 0,
    async systemOne(state: unknown, questions: Record<string, { type: string; criteria?: Record<string, unknown> }>) {
      t.calls += 1;
      const untrusted = String((state as { candidate?: { untrusted_content?: unknown } })?.candidate?.untrusted_content ?? '');
      const picks = o.pick?.(untrusted) ?? {};
      const nouls = o.nouls?.(untrusted) ?? {};
      const answers = Object.fromEntries(
        Object.entries(questions).map(([k, q]) =>
          q.type === 'choice'
            ? [k, { type: 'choice', choice: picks[k] ?? (k === 'leaf' ? 'skill' : cycle(Object.keys(q.criteria ?? {}), t.calls - 1)), confidence: 0.7, probabilities: {} }]
            : [k, { type: 'noul', noul: nouls[k] ?? (k === 'same_as_posted' ? 0 : 0.8) }],
        ),
      );
      return { answers, usage: { input_tokens: 800, output_tokens: 5 }, model: 'jev-stub' } as never;
    },
  };
  return t as unknown as JevTransport & { calls: number };
}

/** The real planner (placement, contrast, faces from an injected stub detector) and no browser. */
export async function stubRenderPost(inputs: SlideInput[], o: { darkenCap: number }): Promise<RenderedPost> {
  const layouts = [];
  const slides: RenderedSlide[] = [];
  for (const [i, input] of inputs.entries()) {
    // The stub detector sees one face in every `people` photo (not the faceless ones) and none anywhere else.
    const faces = input.photoId && FACE_PHOTOS.has(input.photoId) && !FACELESS_PHOTOS.has(input.photoId);
    const layout = await planSlide(input, { darkenCap: o.darkenCap, detectFaces: async () => (faces ? [{ x: 390, y: 640, w: 300, h: 300 }] : []) });
    layouts.push(layout);
    slides.push({
      png: layout.photo.jpeg, jpeg: layout.photo.jpeg, backdropPng: layout.photo.jpeg,
      problems: layout.problems.map((p) => ({ ...p, slide: i + 1 })),
      measure: { fontsLoaded: true, blocks: [], underline: [] },
    } as unknown as RenderedSlide);
  }
  return { slides, layouts, problems: slides.flatMap((s) => s.problems) };
}

export type StubEngine = FieldNotesEngineDeps & {
  claudeStub: ReturnType<typeof stubClaude>;
  jevStub: ReturnType<typeof stubJev>;
  uploaded: Map<string, Buffer>;
  collected: { calls: number };
};

/** Engine deps over stubs. `over` replaces any of them. */
export function stubEngine(
  query: HubQuery,
  over: Partial<FieldNotesEngineDeps> & { claudeStub?: ReturnType<typeof stubClaude>; jevStub?: ReturnType<typeof stubJev> } = {},
): StubEngine {
  const claudeStub = over.claudeStub ?? stubClaude();
  const jevStub = over.jevStub ?? stubJev();
  const uploaded = new Map<string, Buffer>();
  const collected = { calls: 0 };
  const { claudeStub: _drop, jevStub: _dropJev, ...rest } = over;
  return {
    query,
    claude: claudeStub,
    jev: jevStub,
    collect: async () => {
      collected.calls += 1;
      return [];
    },
    renderPost: stubRenderPost,
    loadPhoto: async (p) => {
      const i = Number(/master-(\d+)\.jpg$/.exec(p)?.[1]);
      return photoBytes(i);
    },
    upload: async (p, b) => {
      uploaded.set(p, b);
    },
    now: NOW,
    config: { questionsApproved: false },
    ...rest,
    claudeStub,
    jevStub,
    uploaded,
    collected,
  };
}

/** Change a pool photo's kind (and star) after the fact, keeping the stub face detector in step with it. */
export async function setKind(q: HubQuery, photoId: string, kind: PhotoKind, opener = false): Promise<void> {
  await q(`UPDATE field_notes.pool SET kind = $2, opener = $3 WHERE photo_id = $1`, [photoId, kind, opener]);
  if (kind === 'people') FACE_PHOTOS.add(photoId);
  else FACE_PHOTOS.delete(photoId);
}
