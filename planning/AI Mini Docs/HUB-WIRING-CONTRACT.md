# Reel AI Drama: Social Hub wiring contract

Status: contract for three parallel builders (2026-11-08). Branch `reels-iterations`, which has a large
uncommitted working tree. **Nobody commits, deploys, calls the live Claude API or `web_search`, or runs a
worker.** Read `CLAUDE.md` first. Product decisions are settled (top of the brief), so don't relitigate them.

Goal: Reel AI Drama becomes a first-class Social Hub content type that mirrors Explainers at every
touchpoint. Each file has exactly one owner (§7). Every shared name, field, signature and SQL object is
pinned here. If something you need is not in this contract, add it inside your own files. Never edit
another builder's file.

---

## 0. Sequencing (the only two sync points)

| Step | Owner | Must land first, before anything else that depends on it |
|---|---|---|
| **A0** | A | `lib/reel-ai-drama/hub.ts` with **every export in §4**. Bodies may `throw new Error('not implemented')` at first. Types must be final. Also the SQL appended to `db/reel_ai_drama_schema.sql` (§3.1). |
| **B0** | B | Type widenings: `Vertical`, `SpineVertical`, `FillVertical`, slots `FeedVertical`, `FeedSchema`, `REEL_TYPES`, `ContentType`/`POSTING_TYPES`. Plus the `openSettings` / `defaultOpen` props (§6). |

A codes against the B0 names, and B and C code against the A0 names. Run tsc for acceptance only after both
steps have landed. Signatures in this file are frozen. If one turns out to be wrong, the owner adds a
new export next to it and leaves the old one in place.

---

## 1. Shared names

| Thing | Value |
|---|---|
| Vertical id | `reel_ai_drama` |
| Label / short | `AI Drama Reels` / `AI Drama` |
| Format | `reel` |
| Type page / review href | `/reel-ai-drama` / `/reel-ai-drama` |
| Advanced view (kept) | `/reel-ai-drama/lab` |
| CSS var | `--sh-v-reel_ai_drama: #d1495b` (same value in the dark theme). Cost page `TYPE_COLOR.reel_ai_drama = '#d1495b'` |
| Icon (`TYPE_ICON`) | lucide `Clapperboard` |
| `TYPE_NAME` | `{ one: 'AI Drama reel', many: 'AI Drama reels' }` |
| `VERTICAL_LABELS` (revisions) | `'AI Drama Reels'` |
| Hub post id (ids.ts) | content `reel_ai_drama:<jobId>`. Other kinds: `reel_ai_drama:job:<jobId>`, `reel_ai_drama:schedule:<id>`, attempt `reel_ai_drama:<attemptId>`. `KINDS.reel_ai_drama = ['content','attempt','schedule','job']` |
| Hub idea id | `reel_ai_drama:pitch:<pitchId>` (deleted.ts `IDEA_ID`, idea-queue / idea-rank regexes) |
| Spine item | `content_items(vertical='reel_ai_drama', format='reel', native_ref=<job id text>, idea_ref=<pitch id text>)` |
| `HubPost.refs` | `{ jobId, pitchId }`, plus `attemptId` / `scheduleId` when present. `REF_KEY` (slots/write.ts) and `REVISION_REF_KEY` = `'jobId'` |
| `pipelineHref` | `/reel-ai-drama/lab?job=<jobId>` |
| Video src | `/api/reel-ai-drama/artifacts/<videoArtifactId>` |
| Database handle | The explainers connection (`explainersDb()` / `explainersHubQuery()`), schema `reel_ai_drama`. Production: `EXPLAINERS_DB=supabase`, no `EXPLAINERS_DATABASE_URL` (shared DB). Every "explainers share main" guard applies to drama unchanged. |
| Storage | `ArtifactStore` from `lib/explainers/storage.ts`. Bucket `explainers`, keys `reel-ai-drama/jobs/<jobId>/<file>` (already the prefix). |

### 1.1 Settings (`reel_ai_drama.settings`, typed in `ReelAiDramaSettings`)

New typed keys. The defaults hold the launch decisions.

| Key | Default | Parser | Meaning (mirrors explainers) |
|---|---|---|---|
| `auto` (existing) | `false` | bool | Generate switch: nightly fill + weekly development. Hub "Generate" maps here (explainers: `auto_render`). |
| `require_approval` | `true` | bool | Off = auto-publish. |
| `publishing_live` | `false` | bool | Master switch. Nothing is booked or posted while it is off. |
| `posts_per_day` | `1` | int 1–`DRAMA_WINDOWS.length` | Legacy quota. |
| `daily_render_cap` | `2` | int ≥ 1 | Jobs requested per NY day (night + clicks). |
| `daily_spend_cap_usd` | `20` | num ≥ 0 | Production spend per NY day. |
| `per_week` (existing) | — | — | **Retired**: no longer editable, and `weeklyTick` stops requesting production jobs. Production comes only from the nightly fill or clicks. Weekly development stays. |

`EDITABLE_KEYS` covers every typed key **except** `mode`, `per_week`, `publishing_live` and `require_approval`.
The last two are written only by `writeDramaPosting`.

### 1.2 Slots and cadence (Builder B's files; values are pinned here)

| Record | `reel_ai_drama` value |
|---|---|
| `USUAL` | `[{ start: 1170, end: 1245, name: 'Evening' }]` |
| `DEFAULT_TIMES` | `[1200]` (8:00 PM) |
| `DEFAULT_CAPS` | `1` (`maxCapFor` → 3) |
| `RUN_HOUR_LABEL` | `'12 AM'` |
| `DEFAULT_FEED_MODE` | `'main'`. `REEL_TYPES` gains it, so it takes Trial/Main. |
| `DEFAULT_DAY_QUOTAS` | `1` |
| `PLAN` / legacy window | `evening`, 8:00–8:45 PM (`DRAMA_WINDOWS`, §4) |
| approvals `WINDOWS` | `{ first: [20, 0], lastEnd: [20, 45] }` |
| seed.ts | **Not seeded** (opt-in like carousels: no template slot means quota 0). No `rules.ts` gap. |
| `QUEUE_LIVE` | includes it (pins, drags and archive all honored by the night, §4.6) |
| `REFILL_CADENCE` | `'Weekly development session (Mondays) while Generate is on; the pool is re-ranked daily.'` |
| `daily_caps` row | No SQL change. `DEFAULT_CAPS` covers the missing key. |

Night clock (Builder A): `DRAMA_NIGHT_HOUR_NY = 0`. Production requests for the NY day go out from 00:00, once per day.

---

## 2. Routes

### 2.1 Pages (B unless marked)
- `app/reel-ai-drama/page.tsx`: `<ContentTypePage vertical="reel_ai_drama" openSettings={tab === 'settings'} />`, `dynamic = 'force-dynamic'`, title "AI Drama Reels".
- `app/reel-ai-drama/layout.tsx`: pass-through `<>{children}</>`. Imports nothing the lab doesn't already use.
- `app/reel-ai-drama/lab/**` (C): unchanged path.
- `middleware.ts` (B): `isProtectedPage` adds `/reel-ai-drama` and `/reel-ai-drama/*`. Matcher adds `'/reel-ai-drama'` and `'/reel-ai-drama/:path*'`.

### 2.2 API (A owns all of `app/api/reel-ai-drama/**`)
All routes use `reelAiDramaRoute` (session check; the dev bypass stays). JSON errors look like `{ error: string, fields?: Record<string,string> }`.

| Method & path | Body | 2xx response | Errors |
|---|---|---|---|
| GET `/api/reel-ai-drama/lab` | — | `LabData` (+ `requests`, `calibration`, `settingsProblems`, §4.8) | |
| GET `/api/reel-ai-drama/settings` | — | `{ settings: ReelAiDramaSettings, editable: string[], problems: SettingProblem[] }` | |
| POST `/api/reel-ai-drama/settings` | `{ values: Partial<Record<key, unknown>> }`. The legacy `{ key, value }` form is still accepted. | `{ settings }` | 400 `{ error, fields }` (per-key + cross-field). Nothing is saved on a 400. |
| POST `/api/reel-ai-drama/make` (existing) | `{ pitchId }` | `{ jobId }` | 409 `{ error: DRAMA_REFUSAL_TEXT[reason] }` |
| POST `/api/reel-ai-drama/develop` | — | 202 `{ requestId, status: 'requested' }` | 409 when one is already requested or running |
| POST `/api/reel-ai-drama/calibrate` | — | 202 `{ requestId, status: 'requested' }` | 409 likewise |
| POST `/api/reel-ai-drama/pitches/[id]/reject` | `{ note?: string }` | `{ pitch: { id, status: 'rejected' } }` | 409 when not `new`/`pooled`/`picked` without a live job |
| POST `/api/reel-ai-drama/pitches/[id]/revive` | — | `{ pitch: { id, status: 'pooled' } }` | 409 when not `rejected`/`retired`/`killed` |
| POST `/api/reel-ai-drama/jobs/[id]/cancel` | — | `{ status: 'killed' \| 'cancel_requested' }` | 409 when the job is already finished |
| POST `/api/reel-ai-drama/jobs/[id]/retry` | — | `{ jobId }` | 409 when not `failed` or another job is live |
| GET `/api/reel-ai-drama/artifacts/[id]` | — | file / text. Bucket copy that is not on this disk: 302 to a signed URL. | 404 |

Remove `maxDuration` from develop and calibrate. Neither runs a model in the request any more.

### 2.3 Hub routes (B)
No new hub routes. `app/api/social-hub/actions/*` and `app/api/content-type/*` pick up drama through
`Record<Vertical,…>` and `isPostingType`. The UI's Develop button calls A's `POST /api/reel-ai-drama/develop`.

---

## 3. Database

### 3.1 Appended to `db/reel_ai_drama_schema.sql` (A)

Loader rules (`reelAiDramaStatements`): no `$$`, and **no trailing comment on a line that ends a
statement** (a statement ends at a line ending in `;`). Comment lines must start with `--`.

```sql
-- ════ Hub wiring (planning/AI Mini Docs/HUB-WIRING-CONTRACT.md) ═════════════
-- Artifacts: where the stored file lives, and a strict order (the newest of a kind wins).
ALTER TABLE reel_ai_drama.artifacts ADD COLUMN IF NOT EXISTS storage_location text NOT NULL DEFAULT 'local';
ALTER TABLE reel_ai_drama.artifacts DROP CONSTRAINT IF EXISTS rad_artifacts_location_check;
ALTER TABLE reel_ai_drama.artifacts ADD CONSTRAINT rad_artifacts_location_check CHECK (storage_location IN ('local', 'bucket'));
ALTER TABLE reel_ai_drama.artifacts ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX IF NOT EXISTS ix_rad_artifacts_job_kind ON reel_ai_drama.artifacts (job_id, kind, seq DESC);

-- Jobs: order, who asked, a person's cancel, the night that requested it.
ALTER TABLE reel_ai_drama.jobs ADD COLUMN IF NOT EXISTS seq bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE reel_ai_drama.jobs ADD COLUMN IF NOT EXISTS requested_by text;
ALTER TABLE reel_ai_drama.jobs ADD COLUMN IF NOT EXISTS cancel_requested_at timestamptz;
ALTER TABLE reel_ai_drama.jobs ADD COLUMN IF NOT EXISTS night_date date;

-- One review verdict per reel (mirrors explainers.feedback); the spine's approval mirrors it.
CREATE TABLE IF NOT EXISTS reel_ai_drama.feedback (
    job_id      uuid PRIMARY KEY REFERENCES reel_ai_drama.jobs (id) ON DELETE CASCADE,
    verdict     text NOT NULL CHECK (verdict IN ('approved', 'rejected')),
    tags        text[] NOT NULL DEFAULT ARRAY[]::text[],
    note        text,
    created_by  text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE reel_ai_drama.feedback DROP CONSTRAINT IF EXISTS rad_feedback_tags_check;
ALTER TABLE reel_ai_drama.feedback ADD CONSTRAINT rad_feedback_tags_check
    CHECK (tags <@ ARRAY['hook', 'story', 'accuracy', 'pacing', 'visuals', 'voice', 'captions', 'sound', 'brand']::text[]);

-- A person's click queued for the worker (develop, calibrate): never run inside a web request.
CREATE TABLE IF NOT EXISTS reel_ai_drama.requests (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          text NOT NULL CHECK (kind IN ('develop', 'calibrate')),
    status        text NOT NULL DEFAULT 'requested' CHECK (status IN ('requested', 'running', 'ok', 'failed', 'cancelled')),
    requested_by  text,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    started_at    timestamptz,
    finished_at   timestamptz,
    error         text,
    result        jsonb
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rad_requests_live ON reel_ai_drama.requests (kind) WHERE status IN ('requested', 'running');

-- Calibration reports (replaces .explainers-local/.../calibration/latest.json).
CREATE TABLE IF NOT EXISTS reel_ai_drama.calibration_reports (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id  uuid REFERENCES reel_ai_drama.requests (id) ON DELETE SET NULL,
    report      jsonb NOT NULL,
    usd         numeric NOT NULL DEFAULT 0,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- One nightly fill per New York day (mirrors explainers.idea_cycles for the health report).
CREATE TABLE IF NOT EXISTS reel_ai_drama.nights (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    ny_date      date NOT NULL,
    status       text NOT NULL CHECK (status IN ('running', 'ok', 'failed', 'skipped')),
    quota        integer NOT NULL DEFAULT 0,
    placed       integer NOT NULL DEFAULT 0,
    requested    jsonb NOT NULL DEFAULT '[]'::jsonb,
    allocated    jsonb NOT NULL DEFAULT '[]'::jsonb,
    skip_reason  text,
    error        text,
    started_at   timestamptz NOT NULL DEFAULT now(),
    finished_at  timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS ux_rad_nights_day ON reel_ai_drama.nights (ny_date) WHERE status IN ('running', 'ok');

-- Small worker bookkeeping (e.g. pool_tended: {"nyDate": "..."}).
CREATE TABLE IF NOT EXISTS reel_ai_drama.worker_state (
    key         text PRIMARY KEY,
    value       jsonb NOT NULL,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Launch defaults, written once (the typed defaults say the same).
INSERT INTO reel_ai_drama.settings (key, value) VALUES ('publishing_live', 'false'::jsonb) ON CONFLICT (key) DO NOTHING;
INSERT INTO reel_ai_drama.settings (key, value) VALUES ('require_approval', 'true'::jsonb) ON CONFLICT (key) DO NOTHING;
```

Also update the file's header comment, which says "Local only until Lucas approves a reel".

No spine-link column: the item id comes from `ensureContentItem` (as in explainers), so the id never drifts.

`scripts/apply_reel_ai_drama_schema.js` (A): a copy of `scripts/apply_explainers_schema.js` with
schema `db/reel_ai_drama_schema.sql`, which prints `reel_ai_drama schema applied`. It uses
`DIRECT_DATABASE_URL`. `package.json` (A, these two lines only):
`"db:reel-ai-drama": "node scripts/apply_reel_ai_drama_schema.js"` and
`"reel-ai-drama:worker": "tsx scripts/reel_ai_drama_worker.ts --yes"`.

**Schema-on-request must stop (A).** `ensureReelAiDramaSchema` currently runs DDL on every new connection,
from Vercel routes and the worker. With the DROP/ADD CONSTRAINT statements above, that would take ACCESS
EXCLUSIVE locks on production. New rule: it applies DDL only when the handle is local PGlite, or when
`REEL_AI_DRAMA_AUTO_SCHEMA=1`. Otherwise it only checks `to_regclass('reel_ai_drama.feedback')` and throws
`Reel AI Drama schema is not applied (npm run db:reel-ai-drama).` Production applies the schema only through
`npm run db:reel-ai-drama`, and Lucas runs it.

### 3.2 `db/social_hub_schema.sql` (B): one block appended at the end of the file

Later definitions win. Every statement drops the constraint and adds it again, so the block is idempotent.

```sql
-- ════ AI Drama Reels (reel_ai_drama), planning/AI Mini Docs/HUB-WIRING-CONTRACT.md ════
ALTER TABLE social_hub.content_items DROP CONSTRAINT IF EXISTS content_items_vertical_check;
ALTER TABLE social_hub.content_items ADD CONSTRAINT content_items_vertical_check
    CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'reel_ai_drama'));
ALTER TABLE social_hub.idea_adjustments DROP CONSTRAINT IF EXISTS idea_adjustments_vertical_check;
ALTER TABLE social_hub.idea_adjustments ADD CONSTRAINT idea_adjustments_vertical_check
    CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'reel_ai_drama'));
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_slot_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_slot_check CHECK (
    (vertical = 'carousels' AND slot IN ('morning', 'afternoon'))
    OR (vertical = 'explainers' AND slot IN ('afternoon', 'late'))
    OR (vertical = 'reels' AND slot IN ('morning', 'midday', 'evening'))
    OR (vertical = 'stories' AND slot IN ('morning_download', 'guess_the_number', 'free_vs_paid'))
    OR (vertical = 'last_few_days' AND slot IN ('morning'))
    OR (vertical = 'ai_events' AND slot IN ('evening', 'night'))
    OR (vertical = 'reel_ai_drama' AND slot IN ('evening'))
    OR slot ~ '^t[0-9]{4}(:[a-z_]+)?$'
);
ALTER TABLE social_hub.schedule DROP CONSTRAINT IF EXISTS schedule_feed_mode_check;
ALTER TABLE social_hub.schedule ADD CONSTRAINT schedule_feed_mode_check CHECK (
    feed_mode IS NULL OR (vertical IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IN ('trial', 'main'))
);
ALTER TABLE social_hub.publish_attempts DROP CONSTRAINT IF EXISTS publish_attempts_trigger_check;
ALTER TABLE social_hub.publish_attempts ADD CONSTRAINT publish_attempts_trigger_check CHECK (
    (vertical IN ('carousels', 'explainers', 'last_few_days', 'ai_events', 'reel_ai_drama') AND trigger IN ('approve', 'auto', 'force'))
    OR (vertical = 'reels' AND trigger IN ('approve', 'auto', 'mix_test', 'force'))
    OR (vertical = 'stories' AND trigger IN ('approve', 'auto'))
);
ALTER TABLE social_hub.slot_template DROP CONSTRAINT IF EXISTS slot_template_feed_mode_check;
ALTER TABLE social_hub.slot_template ADD CONSTRAINT slot_template_feed_mode_check CHECK (
    (vertical IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IS NOT NULL AND feed_mode IN ('trial', 'main'))
    OR (vertical NOT IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IS NULL)
);
ALTER TABLE social_hub.slot_override DROP CONSTRAINT IF EXISTS slot_override_feed_mode_check;
ALTER TABLE social_hub.slot_override ADD CONSTRAINT slot_override_feed_mode_check CHECK (
    (action = 'remove' AND feed_mode IS NULL)
    OR (action = 'add' AND vertical IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IS NOT NULL AND feed_mode IN ('trial', 'main'))
    OR (action = 'add' AND vertical NOT IN ('reels', 'explainers', 'reel_ai_drama') AND feed_mode IS NULL)
);
```

`db/revisions_schema.sql` (B), appended:
```sql
ALTER TABLE revisions.requests DROP CONSTRAINT IF EXISTS requests_vertical_check;
ALTER TABLE revisions.requests ADD CONSTRAINT requests_vertical_check
    CHECK (vertical IN ('carousels', 'explainers', 'reels', 'stories', 'last_few_days', 'ai_events', 'reel_ai_drama'));
```
B checks the actual inline constraint name on a PGlite apply (`\d revisions.requests`). If it differs, B drops by the real name.

---

## 4. `lib/reel-ai-drama/hub.ts`: the one interface the hub calls (A)

Every hub-side import of drama logic goes through `@/lib/reel-ai-drama/hub`. B may also import the
types from `@/lib/reel-ai-drama/settings`. `hub.ts` may re-export from new A files
(`lib/reel-ai-drama/publish/*`, `review.ts`, `night.ts`, `requests.ts`), but this path and these names are frozen.

```ts
import type { Queryable } from '@/lib/explainers/db';
import type { ReelMetaClient } from '@/lib/explainers/publish/meta';
import type { ExplainerInsightsClient, ExplainerInsightsResult } from '@/lib/explainers/publish/insights';
import type { ApprovalVia } from '@/lib/social-hub/spine';
import type { PostingWindow } from '@/lib/instagram/window';

export type DramaDb = Queryable;                                   // explainersDb()
export type DramaQuery = (text: string, params?: unknown[]) => Promise<{ rows: any[] }>; // HubQuery satisfies it

export const DRAMA_VERTICAL = 'reel_ai_drama' as const;
export const DRAMA_WINDOWS: readonly PostingWindow[];              // [{ id: 'evening', label: '8:00–8:45 PM', startMinute: 1200, endMinute: 1245 }]
export const DRAMA_NIGHT_HOUR_NY: 0;
export const DRAMA_INSIGHTS_HOUR_NY: 5; export const DRAMA_INSIGHTS_MINUTE_NY: 30;

/** to_regclass check; never DDL. The publisher and hub reads skip drama when false. */
export function dramaSchemaReady(q: DramaQuery): Promise<boolean>;
```

### 4.1 Identity and review
```ts
export function dramaItemId(db: DramaDb, jobId: string): Promise<string | null>;        // ensureContentItem; null if job gone
export function syncDramaApproval(db: DramaDb, jobId: string, via?: ApprovalVia): Promise<void>;
export function latestDramaJobId(db: DramaDb, pitchId: string): Promise<string | null>; // newest status 'ok'
export function dramaVerdictOf(db: DramaDb, jobId: string): Promise<'approved' | 'rejected' | null>;

export type DramaReviewTag = 'hook' | 'story' | 'accuracy' | 'pacing' | 'visuals' | 'voice' | 'captions' | 'sound' | 'brand';
export const DRAMA_REVIEW_TAGS: readonly DramaReviewTag[];
/** Upsert feedback, then syncDramaApproval. Without a review the earlier tags and note are kept. Unknown tag → Error with status 400. */
export function setDramaVerdict(
  db: DramaDb, jobId: string, verdict: 'approved' | 'rejected', by: string | null,
  review?: { tags?: readonly string[]; note?: string | null },
): Promise<void>;
```

### 4.2 Scheduling and publishing (mirrors lib/explainers/publish/*)
```ts
export type DramaScheduleOutcome = { scheduled: true; id: string; publishAt: string } | { scheduled: false; note: string };
export type DramaQueued =
  | { queued: true; id: string }
  | { queued: false; note: string; terminal?: boolean; alreadyPublished?: boolean; status?: number };

export function dramaPublishingLive(db: DramaDb): Promise<boolean>;
export function dramaRequireApproval(db: DramaDb): Promise<boolean>;
/** Next free drama slot (template: chooseTemplateSlot 'reel_ai_drama'; legacy: DRAMA_WINDOWS × posts_per_day), or the slot it already has. */
export function scheduleDramaJob(db: DramaDb, jobId: string, source: 'auto' | 'user', now?: Date, throughDate?: string): Promise<DramaScheduleOutcome>;
/** Cancel the waiting slot and withdraw approval (feedback 'approved' deleted, spine cleared). Refused while posting or posted. */
export function unscheduleDramaJob(db: DramaDb, jobId: string): Promise<{ ok: boolean; note: string }>;
/** A click counts as approval. A rejected reel is refused (terminal). The waiting slot is cancelled. Queues attempt trigger 'force'. */
export function hardPublishDramaJob(db: DramaDb, jobId: string, by: string): Promise<DramaQueued>;
export function dramaQueuePublish(db: DramaDb, jobId: string, trigger: 'approve' | 'auto' | 'force'): Promise<DramaQueued>;
/** Driver steps. */
export function dramaFailStaleAttempts(db: DramaDb): Promise<void>;
export function dramaReleaseDue(db: DramaDb): Promise<number>;   // reject wins (either place); approval gate; else queue
export type DramaPublishDeps = { db: DramaDb; meta: ReelMetaClient; signVideo: (objectPath: string, expiresIn: number) => Promise<string>; sleep?: (ms: number) => Promise<void>; now?: () => number };
export function dramaCarryAttempt(deps: DramaPublishDeps, attemptId: string): Promise<{ id: string; status: 'published' | 'failed' }>;
export function pollDramaInsights(db: DramaDb, client: ExplainerInsightsClient, now?: Date, limit?: number): Promise<ExplainerInsightsResult>;
/** Approved, unbooked, video in bucket → book (worker; also used after publishing_live turns on). */
export function scheduleApprovedDrama(db: DramaDb, now?: Date): Promise<number>;
/** The caption that posts: newest 'post_caption' artifact, else composed from newest 'post_text'. ≤ 2200 chars. */
export function dramaCaption(db: DramaDb, jobId: string): Promise<string | null>;
```
Readiness for `dramaQueuePublish`: the job is `ok`, its newest `video` artifact has `storage_location='bucket'`, it has a caption, it was not rejected, and approval is satisfied (approved, or `require_approval` false, or trigger `force`).
Payload: `{ video_object: <storage_path>, ...explainerPayloadFlags(feedMode) }`. Reuse the export from `lib/explainers/publish/publish.ts` without editing it. No episode stamp.

### 4.3 Making content
```ts
export type DramaRefusal = 'not_found' | 'not_makeable' | 'already_running' | 'daily_render_cap' | 'daily_spend_cap';
export const DRAMA_REFUSAL_TEXT: Record<DramaRefusal, string>;
/** Hub Regenerate / Make it / Run now. trigger 'click'. Obeys per-reel, daily render and daily spend caps. A 'made' pitch may be made again. */
export function requestDramaJob(db: DramaDb, input: { pitchId: string; by: string; now?: Date }): Promise<{ ok: true; jobId: string } | { ok: false; reason: DramaRefusal }>;
export function requestDramaJobs(db: DramaDb, pitchIds: readonly string[], input: { by: string; now?: Date }): Promise<{ queued: string[]; refused: Array<{ pitchId: string; reason: DramaRefusal }> }>;
export function dramaInFlightPitchIds(db: DramaDb): Promise<string[]>;    // jobs queued|running
export function dramaRunCostUsd(db: DramaDb): Promise<number>;            // per_reel_cap_usd
```

### 4.4 Posting settings (what `lib/content-type/posting.ts` calls)
```ts
export type DramaPosting = { generate: boolean; autoPublish: boolean; live: boolean; perDay: number; maxPerDay: number; dailyRenderCap: number; dailySpendCapUsd: number };
export function readDramaPosting(db: DramaDb): Promise<DramaPosting>;
/** One transaction. generate→auto, autoPublish→require_approval=!v, live→publishing_live, perDay (1..maxPerDay) also raises daily_render_cap to ≥ perDay. live:true then runs scheduleApprovedDrama. */
export function writeDramaPosting(db: DramaDb, patch: { generate?: boolean; autoPublish?: boolean; live?: boolean; perDay?: number }): Promise<DramaPosting>;
```

### 4.5 Read SQL for the hub (B runs these through its own handle; columns frozen)

The SQL is SELECT only. Timestamps come back as `::text`, NY dates as `YYYY-MM-DD` text.
```ts
export type DramaJobRow = {
  job_id: string; pitch_id: string; status: string; trigger: string; mode: string; stage: string | null;
  spend_usd: number | string; spend_cap_usd: number | string; requested_at: string; started_at: string | null; finished_at: string | null;
  error: string | null; kill_reason: string | null; flags: number;
  title: string; brief: string | null; story_type: string | null; era: string | null; central_player_id: string | null;
  rank_score: number | string | null; drama_score: number | string | null; material_score: number | string | null; visuals_grade: string | null;
  sources: Array<{ url: string; title: string | null }>;
  verdict: string | null; tags: string[] | null; note: string | null; feedback_at: string | null;
  video_artifact_id: string | null; video_location: string | null; sheet_artifact_id: string | null;
  caption: string | null; seconds: number | null;
};
export const DRAMA_JOBS_SQL: string;            // pitches not 'killed'/'retired'; ORDER BY j.seq DESC; no params
export type DramaPitchRow = {
  pitch_id: string; title: string; brief: string | null; status: string; origin: string;
  rank_score: number | string | null; drama_score: number | string | null; material_score: number | string | null; visuals_grade: string | null;
  event_date: string | null; central_player_id: string | null; created_at: string;
  ok_jobs: number; last_made_at: string | null; published: boolean; scheduled: boolean;
  job_id: string | null; job_status: string | null; job_stage: string | null; job_error: string | null; job_requested_at: string | null; job_started_at: string | null;
  reject_reason: string | null; revive_when: string | null;
};
export const DRAMA_PITCHES_SQL: string;         // status IN ('pooled','picked','made'); rank_score DESC; LIMIT 200; no params
export const DRAMA_REQUIRE_APPROVAL_SQL: string; // SELECT value FROM reel_ai_drama.settings WHERE key = 'require_approval'
export const DRAMA_POSTS_PER_DAY_SQL: string;    // SELECT value … key = 'posts_per_day'
```

### 4.6 Night and worker logic (A only; the hub never calls these)
```ts
export type DramaNightResult =
  | { status: 'skipped'; reason: 'auto_off' | 'already_ran_today' | 'quota_filled' | 'daily_spend_cap' | 'pool_empty' }
  | { status: 'ok'; nightId: string; nyDate: string; quota: number; placed: number; requested: string[]; allocated: Array<{ pitchId: string; jobId: string; scheduled: DramaScheduleOutcome | null }> }
  | { status: 'failed'; nightId: string; error: string };
export function runDramaNight(deps: { db: DramaDb; moves?: DramaQuery; now?: Date; log?: (e: string, f?: Record<string, unknown>) => void }): Promise<DramaNightResult>;
```
Rules (mirrors `runIdeaCycle`'s fill):
- The quota is `quotaFromSlots(q,'reel_ai_drama',day) ?? posts_per_day`, and `dailyFillOrQuota` subtracts the user-placed slots.
- Candidates are surviving approved, unposted renders plus pooled pitches, ranked by `rank_score`. Then `readMoves`/`queueOrder` apply (pins, drags, promote/demote), archived ideas are excluded, and the `spread_days` player rule applies.
- A surviving render is allocated (`scheduleDramaJob` while live) and never made again. A pitch is requested with `trigger 'auto'` and `night_date`, under the daily caps.
- `finishNightPlacements` runs at the end. One `nights` row is written per day.

### 4.7 Health, cost, progress, misses (B maps these into its own types)
```ts
export type DramaNightHealth = {
  nights: Array<{ id: string; status: string; quota: number; requested: number; skipReason: string | null; error: string | null; at: string }>;
  jobs: Array<{ id: string; status: string; stage: string | null; error: string | null; capped: boolean; spend: number; trigger: string; at: string }>;
  requests: Array<{ id: string; kind: 'develop' | 'calibrate'; status: string; error: string | null; at: string }>;
  cost: { usd: number; unknown: number };   // all modes
};
export function readDramaNightHealth(q: DramaQuery, w: { nyDate: string; start: string; end: string }): Promise<DramaNightHealth>;

export type DramaCostEventRow = { id: string; job_id: string | null; session_id: string | null; component: string; vendor: string; production: boolean; unknown: boolean; usd: string; ny_date: string };
export type DramaRenderedRow = { job_id: string; ny_date: string; spend_usd: string };
export function readDramaCosts(q: DramaQuery): Promise<{ events: DramaCostEventRow[]; rendered: DramaRenderedRow[] }>;
export function readDramaCacheTokens(q: DramaQuery, f: { mode: 'production' | 'development' | null; from: string | null; to: string | null }): Promise<Array<{ readTokens: number; writeTokens: number }>>;
export function readDramaDailySpendCap(q: DramaQuery): Promise<number | null>;
/** Cost components (cost_events.component) for the cost-page stage map; anything else → 'other'. */
export const DRAMA_COST_COMPONENTS: readonly string[]; // producer drama_score material_score same_event visuals_check rebrief reporting harvest_look harvest_search harvest_sketch harvest_wish_search writer writer_revise story_notes director creative_pass make voice sound_design facts_check integrity_check first_viewer design_review_fast design_review_judge post_text

export type DramaProgressRow = { id: string; pitchId: string; label: string; state: 'queued' | 'running' | 'failed'; stage: string | null; error: string | null; requestedAt: string; startedAt: string | null };
export function readDramaProgress(q: DramaQuery): Promise<{ rows: DramaProgressRow[]; typicalSeconds: number | null }>;
/** Latest job per pitch that failed and was requested today (NY). key = pitch id. */
export function readDramaMisses(q: DramaQuery, todayNy: string): Promise<Array<{ key: string; reason: string | null }>>;
```

### 4.8 Lab data additions (A, consumed by C)
`LabData` gains:
- `requests: Array<{ id; kind; status; requestedAt; startedAt; finishedAt; error; requestedBy }>`: the newest 20.
- `calibration: { at: string; report: unknown; usd: number } | null`: from the DB.
- `settingsProblems: SettingProblem[]`.
- Each job gains `cancelRequestedAt: string | null` and `verdict: 'approved' | 'rejected' | null`.
- Each pitch keeps `status`, `reject_reason` and `revive_when`.

```ts
export type SettingProblem = { key: string; stored: unknown; error: string };  // exported from lib/reel-ai-drama/settings.ts
```

### 4.9 Revisions (A file, B registers it)
`lib/reel-ai-drama/revisions.ts` exports `reelAiDramaDescription: ContentTypeDescription`.
- It is caption-only: part `{ kind: 'caption', key: 'caption' }`, fix `wording`, $0, no model call in `revise`. It adds a `post_caption` artifact row, and `restore` re-adds the old text.
- `unschedule` delegates to `unscheduleDramaJob`. Scene fixes are out of scope (§8).
- The social worker runs it as it is, because it only touches the DB.

---

## 5. Publishing

- **Who posts:** only the shared publisher (`scripts/publisher_worker.ts`, `helios-publisher`). It runs a
  `reelAiDramaDriver` when `EXPLAINERS_DB=supabase`, there is no `EXPLAINERS_DATABASE_URL`, and `dramaSchemaReady`.
  Otherwise it logs `reel_ai_drama_not_driven`. The drama worker has **no** fallback publish loop. While
  `publisher_mode` ≠ `live`, drama never posts. The hub settings note says so.
- Driver (B, `lib/publishing/drivers/reel-ai-drama.ts`):
  `reelAiDramaDriver(deps: { db: DramaDb; meta: () => ReelMetaClient; signVideo: (p: string, s: number) => Promise<string>; token: () => string }): PublishDriver`
  with `vertical 'reel_ai_drama'` and `refusesAtRelease: 'cancel'`. Its methods map to `dramaPublishingLive`, `dramaRequireApproval`,
  `dramaFailStaleAttempts`, `dramaReleaseDue`, `dramaCarryAttempt` and
  `pollDramaInsights(db, createExplainerInsightsClient({ token }))`. Publisher meta is `createLiveReelClient`; `signVideo` is `signArtifact`.
- Carry (A): it mirrors `carryAttempt`. That means a rejected-after-slot check (spine or `reel_ai_drama.feedback`),
  `checkAccountQuota`, a signed URL, `CAPTION_MAX_CHARS`, the container, the poll, the publish, and a permalink.
  Insights go to `social_hub.media_insights` with vertical `reel_ai_drama`.
- Caption source: `dramaCaption` (§4.2). A writes a `post_caption` artifact when a job finishes, made from `post_text`:
  caption, a blank line, `question`, a blank line, then `credits` joined `\n`.
- Booking: when a night job (`trigger 'auto'`) finishes, it books today's next open slot unapproved (B2 rule). A
  person's job waits for Approve, which books it (B1: today, through `nyDateOf(now)`). `releaseDue` cancels
  a slot nobody approved while `require_approval` is on.

---

## 6. Builder B's hub wiring, item by item (A and C don't touch these)

Every `Record<Vertical,…>` gains `reel_ai_drama`, as do these: `ids.ts KINDS`, `factors.ts VERTICAL_FACTORS`
(story_type category, era category, visuals_grade category, drama_score number, seconds number), `health/brief.ts FILES`,
`cost-page/model.ts TYPE_COLOR` + `INTERACTIONS` (`['totalInteractions']`), `cost-page/normalize.ts BY_TYPE` (new
`cost-page/stages/reel-ai-drama.ts`), `cost.ts byVertical`, `deleted.ts IDEA_ID`, `views/pools.ts REFILL_CADENCE`,
`views/plan.ts PLAN`/`PAD_WINDOWS`, `health/approvals.ts WINDOWS`, `health/night.ts REPORTERS` (new
`health/reporters/reel-ai-drama.ts` on `readDramaNightHealth`, explainers handle + hub handle for publishing),
`queries/spine.ts METRICS` (= explainers'), `slots/times.ts` (all records), `slots/write.ts REF_KEY`, `house.ts PUBLISH_CONFIRM`
(`'This reel goes out now instead of in its slot. Publishing counts as your approval unless it was rejected in review.'`),
`marks.tsx TYPE_ICON`, `PoolScreen HOW`, `revisions/box-state REVISION_REF_KEY`, `revisions/labels`, `revisions/registry STATIC`,
`run-misses NO_MISSES` + read, `publishing/actions/live.ts`, `TypeControls NOUN`, `ContentTypePage TITLE/BENCH_NOTE`.
Plus the non-Record lists: `VERTICALS`, `TYPE_PAGE_IDS`, `SpineVertical`, `FillVertical`, `FeedVertical`, `FeedSchema` + its
SQL map (`vertical = 'reel_ai_drama' AND coalesce(feed_mode,'main') = 'main'`), `REEL_TYPES`, `QUEUE_LIVE`,
`ContentType`/`POSTING_TYPES`, idea-queue/idea-rank `VERTICALS` + `IDEA_ID`, `run-today RUN_TYPES`, `dataset ORDER`,
`load.ts` spine vertical lists (drama goes wherever `explainers` goes, under the same shared-DB guard),
`views/nav.ts` type pages (`'reel-ai-drama': 'reel_ai_drama'`), `components/hub-shell/nav.ts`, `bookingFeedMode`,
`placement.ts` names/windows, `queries/day.ts` quotas, `lib/instagram/feed-spacing.ts`.

New B files:
- `lib/social-hub/queries/reel-ai-drama.ts` (`readReelAiDrama(q, spine): ReelAiDramaRead`)
- `lib/social-hub/adapters/reel-ai-drama.ts` (`dramaPosts`, `dramaIdeas`, `dramaBreakdown`)
- `lib/publishing/actions/reel-ai-drama.ts`
- `lib/publishing/drivers/reel-ai-drama.ts`
- `health/reporters/reel-ai-drama.ts`
- `cost-page/stages/reel-ai-drama.ts`
- `components/content-type/ReelAiDramaSettingsForm.tsx`
- the `app/reel-ai-drama/page.tsx` + `layout.tsx` pages

Actions, `lib/publishing/actions/reel-ai-drama.ts`:
```ts
export function reelAiDramaActions(deps: {
  db: () => Promise<DramaDb>;
  setVerdict: typeof setDramaVerdict; hardPublishJob: typeof hardPublishDramaJob; requestJob: typeof requestDramaJob;
  itemId: typeof dramaItemId; unscheduleJob: typeof unscheduleDramaJob; latestJobId: typeof latestDramaJobId;
  verdictOf: typeof dramaVerdictOf; scheduleJob: typeof scheduleDramaJob; publishingLive: typeof dramaPublishingLive;
  placeItem: Place; rescheduleItem: Place; revisionsQuery?: () => Promise<Query | null>; now?: () => Date;
}): ContentActions
```
- Verbs and notes copy `explainerActions` exactly. Regenerate uses `refs.pitchId` and `DRAMA_REFUSAL_TEXT`.
- Revisions are guarded the same way, and the not-shared note names AI Drama.
- `revisionsQuery` uses the same env rule as explainers.

Posting, `lib/content-type/posting.ts`: the `reel_ai_drama` branch uses `readDramaPosting` and `writeDramaPosting`, with series `null`.
`quota()` min is 1 and max is `DRAMA_WINDOWS.length`.

Run today, `lib/social-hub/run-today.ts`:
- `RunInputs.reelAiDrama?: TypeDay`, `inFlight.dramaPitches?: string[]`, `cost.dramaCap?: number`.
- `PlanStep.action` gains `'drama_jobs'`, whose targets are pitch ids. Its notes copy the explainers block.
- `run-today-live.ts` executes it with `requestDramaJobs`.
- `narrowStep` splits the estimate per target.

Progress: `AllProgress` gains `reel_ai_drama` (from `readDramaProgress`, with `topicId = pitchId`).

Type page and controls:
- `ContentTypePage` drama branch: `generate` is `<DramaDevelopButton />` (POST `/api/reel-ai-drama/develop`, with a confirm showing
  "one development session, up to $<weekly_dev_cap_usd>") plus a `Lab` link to `/reel-ai-drama/lab`.
- `settings` is `<PostingSettings type="reel_ai_drama" />` plus `<h3>Rendering</h3><ReelAiDramaSettingsForm />`. The form uses
  GET/POST `/api/reel-ai-drama/settings`, shows only `editable` keys, and reports `fields` errors inline. An empty number
  field is a validation error and is never sent as 0. Drama uses `TypeHub`.

Prop shared with C (lands in B0):
```ts
export async function ContentTypePage(props: { vertical: PageVertical; openSettings?: boolean }): Promise<JSX.Element>;
export function SettingsButton(props: { children: ReactNode; defaultOpen?: boolean }): JSX.Element;
```
`ContentTypePage` passes `defaultOpen={openSettings}`.

Explainers "Run the idea cycle now" button (B renders it, C serves it):
- `IdeaCycleButton` in `TypeControls.tsx`, shown only in the explainers branch of `ContentTypePage`.
- It POSTs `/api/explainers/idea-cycle`, with a confirm that states the estimate the route returns on GET.
- It shows the `note` text that comes back.

Docs: `docs/social-overnight.md` gains a row in the type table and a "who posts" note.
`scripts/publisher_worker.ts` adds the driver.
`scripts/backfill_spine.ts` + `lib/social-hub/backfill.ts`: `backfillReelAiDrama` ensures items for `ok` jobs that have
feedback and mirrors the verdicts. It reads `reel_ai_drama.jobs`/`feedback` only.
No edit to `scripts/social_worker.ts` is expected. Its morning report picks drama up from `REPORTERS`.

---

## 7. File ownership (one owner per file)

| Builder A: drama backend | Builder B: hub wiring | Builder C: lab UI + explainers gaps |
|---|---|---|
| `lib/reel-ai-drama/**` (incl. new `hub.ts`, `publish/*`, `review.ts`, `night.ts`, `requests.ts`, `revisions.ts`) | `lib/social-hub/**` | `app/reel-ai-drama/lab/**` |
| `scripts/reel_ai_drama_worker.ts` | `lib/content-type/**` | `app/explainers/**` (except `settings/settings-form.tsx` and `explainers.css`, which B imports; C must not rename them) |
| `db/reel_ai_drama_schema.sql` | `lib/publishing/**` | delete `app/explainers/topics-view.tsx`; remove `loadTopicsView` + `TopicsView` type from `lib/explainers/overview.ts` (only that change) |
| `scripts/apply_reel_ai_drama_schema.js` (new) | `lib/revisions/**` | `lib/explainers/ideas/cycle.ts` (only the `force` option), new `lib/explainers/ideas/cycle-request.ts` |
| `package.json` (the 2 script lines) | `lib/instagram/feed-spacing.ts` | `scripts/explainers_worker.ts` (only the cycle request poll) |
| `scripts/gcp/helios-reel-ai-drama.service` (new), `scripts/gcp/deploy-reel-ai-drama-worker.sh` (new), `scripts/gcp/deploy-social-worker.sh` (only: in-flight line for `reel_ai_drama.jobs` + `reel_ai_drama.requests`, guarded by `to_regclass`; **default `UNITS` unchanged**) | `scripts/publisher_worker.ts`, `scripts/backfill_spine.ts`, `scripts/bench_social_hub.ts` / `scripts/overnight_check.ts` (only if types break) | new `app/api/explainers/idea-cycle/route.ts` |
| `app/api/reel-ai-drama/**` | `app/social/**`, `app/api/social-hub/**`, `app/api/content-type/**`, `app/social-hub.css` | `tests/explainers-{kit-stacking,build-runner,openers,code-frames}.test.ts` |
| `tests/reel-ai-drama-*.test.ts` (new and existing) | `components/social-hub/**`, `components/content-type/**`, `components/hub-shell/**` | `tests/explainers-idea-cycle-request.test.ts`, `tests/reel-ai-drama-lab-form.test.ts` |
| | `db/social_hub_schema.sql`, `db/revisions_schema.sql`, `middleware.ts`, `app/reel-ai-drama/page.tsx`, `app/reel-ai-drama/layout.tsx`, `docs/social-overnight.md` | |
| | `tests/social-*`, `tests/content-type-*`, `tests/publisher-*`, `tests/revisions-*`, `tests/slots-*`, `tests/idea-*`, plus **any other existing test** broken by widening `Vertical` | |

Read-only imports anyone may use, without editing them: `lib/explainers/{db,connection,storage}.ts` and
`lib/explainers/publish/{meta,insights,publish,config}.ts`. A may import the social-hub helpers `ensureContentItem`,
`approveItem`, `rejectItem`, `clearDecision`, `bookSlot`, `findContentItem`, `slotPlan`, `quotaFromSlots`, `chooseTemplateSlot`,
`readMoves`, `queueOrder`, `finishNightPlacements`, `dailyFillOrQuota`, `busyFeedTimes` and `ownFeedTimes`, plus `lib/instagram/window` and
`lib/instagram/account-gate`. Their signatures don't change, only the vertical unions widen (B0).

### 7.1 Builder A's must-fixes
1. **Settings.**
   - `EDITABLE_KEYS`.
   - `validateSettingsPatch(current, patch): { ok: true; next } | { ok: false; fields: Record<string,string> }` with these cross-field checks: `max_seconds ≥ target_seconds ≥ hook_seconds`, `rung_max_seconds ≤ max_seconds`, `fresh_days ≤ news_window_days`, `solver_limit_usd ≤ per_reel_cap_usd`, `visuals_check_cap_usd ≤ per_reel_cap_usd`, `daily_spend_cap_usd ≥ per_reel_cap_usd`, `daily_render_cap ≥ posts_per_day`, `posts_per_day ≤ DRAMA_WINDOWS.length`.
   - `saveSettings(db, patch, by)` writes all keys in **one transaction** (`db.transaction` when available, else `BEGIN/COMMIT`).
   - `loadSettings` never throws on a bad stored row. It falls back to the default for that key. `loadSettingsReport(db): Promise<{ settings; problems: SettingProblem[] }>`.
2. **Artifacts.** `addArtifact` records `storage_location` from `store.put().location`. The artifacts route serves the local file, else 302s to `signArtifact(key)` when the location is `bucket` (the explainers route pattern, which also validates UUID v1–8).
3. **Calibration.** The report is written to `calibration_reports`, and `CALIBRATION_FILE` is removed from reads (one-time import of the old file if present is optional).
4. **Worker tick.**
   - Every poll: claim and run `requests` (develop → `runLiveDevelopment(db,'click')`; calibrate → `runLiveCalibration` → report row).
   - Once per NY day, **regardless of `auto`**: `tendPool`. Track it in `worker_state.pool_tended`.
   - From `DRAMA_NIGHT_HOUR_NY`, when `auto`: `runDramaNight`.
   - Weekly development, when `auto`.
   - While live: `scheduleApprovedDrama`.
   - Then the next job. When the job finishes `ok` with trigger `auto`, book it (§5).
   - Cancel: a queued job → `killed`, `kill_reason 'cancelled by a person'`, and the pitch back to `pooled` (not `killed`). A running job gets `cancel_requested_at`, which the runner checks at every `setStage` and stops with `failed`, error `Cancelled by a person`. The pitch goes back to `pooled`. `retry` = `requeueJob`.
5. **Pool actions.** `rejectPitch(db, id, by, note?)` → `rejected`, `reject_reason 'by <by>: <note>'`. `revivePitch(db, id)` → `pooled` and re-ranks.
6. **Host-agnostic.**
   - `holdAwake` is already a no-op off darwin. Keep it, and test it.
   - `REEL_AI_DRAMA_LOCAL_DIR` (default `.explainers-local/reel-ai-drama`) roots the logs and dev files. `REEL_AI_DRAMA_JOBS_DIR` defaults to `<LOCAL_DIR>/jobs`.
   - The worker logs `storage` and refuses to book or publish videos whose location is not `bucket`.
7. **Unit** `helios-reel-ai-drama.service`: a copy of `helios-explainers.service`. Its `Description` is "Helios Reel AI Drama worker (one job at a time)" and `ExecStart=/usr/bin/npm run reel-ai-drama:worker`, with the comment that `REEL_AI_DRAMA_LOCAL_DIR=/opt/helios-social/reel-ai-drama`, `EXPLAINERS_STORAGE=bucket` and `EXPLAINERS_DB=supabase` go in `worker.env`. Memory limits stay as in the explainers unit, marked PROVISIONAL. `deploy-reel-ai-drama-worker.sh` = `SOCIAL_UNITS="${SOCIAL_UNITS:-helios-reel-ai-drama}" exec …/deploy-social-worker.sh "$@"`.

### 7.2 Builder C's tasks
- **Lab:**
  - Errors persist after reload. They come from `LabData.requests[].error` and the jobs' `error`/`kill_reason`, not component state.
  - An empty number field shows "Enter a number" and is never saved as 0.
  - One batch save through `{ values }`, with each `fields[key]` error shown beside its input.
  - Calibration cost text reads from `calibration.usd` and the estimate in one place: "about $0.10–0.30".
  - Reject/Revive on pitches and Cancel/Retry on jobs, each calling §2.2.
  - Develop/Calibrate show "queued" and then poll `GET /lab` every 10 s while a request is live.
  - Remove the "Local; nothing publishes" copy.
- **Explainers:**
  - `app/explainers/page.tsx` becomes `async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> })` and passes `openSettings={tab === 'settings'}`.
  - Delete the dead topics view as described in §7.
  - Fix the 8 type errors in the four tests. These are the only tsc errors at baseline.
- **Idea cycle now:**
  - `GET /api/explainers/idea-cycle` returns `{ estimateUsd, maxRenders, ranToday: boolean, requested: boolean }`. `POST` returns 202 `{ queued: true, note }`, 409 `{ error: 'Today’s idea cycle already ran.' }`, or 409 when already requested.
  - The request is stored as the `explainers.settings` key `idea_cycle_request` = `{ at, by }`.
  - The worker polls it, runs `runIdeaCycle({ …, force: true })` once (bypassing only the `auto_render` gate; the one-cycle-per-day index and spend caps stay), and then deletes the key.
  - `cycle-request.ts` exports `requestIdeaCycle(db, by, now?)`, `pendingIdeaCycleRequest(db)` and `clearIdeaCycleRequest(db)`.

---

## 8. Acceptance (pass/fail per builder)

All builders:
- `npx tsc --noEmit -p .` reports **0 errors** once A, B and C have all landed. The baseline is exactly 8, all in C's four tests. Before integration, a builder passes if the only errors left are in another builder's unfinished files.
- No test calls the live Claude API, HeyGen, Meta or `web_search`. Model and HTTP are stubbed, and the database is PGlite.
- No commit, no deploy, no worker run.
- Run tests with the output filtered to pass/fail counts and the names of failing tests.

| Builder | Must pass |
|---|---|
| A | New: `reel-ai-drama-hub-settings` (allowlist, every cross-field check, batch rollback, a bad row reported and not thrown), `reel-ai-drama-hub-review` (verdict/tags/spine sync, hard publish, unschedule), `reel-ai-drama-hub-schedule` (legacy + template booking, releaseDue gate, `runDramaNight` with moves, caps, quota-filled), `reel-ai-drama-hub-publish` (queue readiness, caption source, carry with stub meta, rejected-after-slot), `reel-ai-drama-requests` (develop/calibrate queue + worker claim with stubbed runners, reject/revive, cancel queued/running, retry), `reel-ai-drama-artifacts-route` (bucket redirect), `reel-ai-drama-schema` (applies twice on PGlite; `ensureReelAiDramaSchema` does no DDL without the PGlite/env flag). **All existing `tests/reel-ai-drama-*.test.ts` still pass.** |
| B | New: `social-hub-reel-ai-drama-wiring` (verticals, ids round-trip, every `Record<Vertical,…>` has the key, idea id regexes), `social-hub-reel-ai-drama-adapter` (rows → HubPost/HubIdea, statuses, refs, media), `social-hub-reel-ai-drama-actions` (every verb with stub deps; revision guard), `publisher-reel-ai-drama-driver`, `content-type-reel-ai-drama` (posting read/write, run-today `drama_jobs` plan + narrowStep, progress, misses), `social-hub-schema-drama-checks` (both schema files apply twice on PGlite; drama rows accepted; explainers rows unchanged). **All existing `tests/social-*`, `content-type-*`, `publisher-*`, `revisions-*`, `slots-*`, `idea-*`, `explainers-*` still pass.** |
| C | The 4 explainers tests pass; new `explainers-idea-cycle-request` (request/clear, 409 rules, `force` bypasses only `auto_render`); `reel-ai-drama-lab-form` (number parsing helper: empty → error; batch payload). `/explainers?tab=settings` opens the drawer (checked by a render test or a manual note). |

No Explainers behavior change: every `explainers` branch, SQL and note is unchanged. The only exceptions are C's
`force` option (absent means the old behavior) and the shared prop defaults (`openSettings` false, `defaultOpen` false).

After integration, not done by the builders: Lucas runs `npm run db:reel-ai-drama` and the social_hub/revisions
schema apply, then redeploys the social VM (publisher + explainers worker changed, per CLAUDE.md worker sync). The drama unit stays off
until a host is picked.

---

## 9. Risks and open questions (not decided here)

1. **Worker host.** Is it a separate VM or Lucas's Mac?
   - The render needs HeyGen, ffmpeg, rembg (Python), the HyperFrames/Chrome kit and the cutout banks under the repo. None of these are measured on the e2-medium (4 GB), which already runs explainers at 2 AM.
   - A Mac host needs `EXPLAINERS_STORAGE=bucket`, or nothing can publish. It also has to be awake at 00:00 for the night fill.
2. **Night hour vs. render time.** A 00:00 request, plus an unknown job length, plus a morning approval: is that enough for an 8:00 PM slot? And does 00:00 collide with explainers renders if the host is the social VM?
3. **Instagram:** one account is shared by every type.
   - The account-gate quota now has one more daily reel.
   - Do 60–80 s reels behave the same as explainers for Trial (`graduation_strategy`) and for Main?
   - Credits and source attribution in captions: is there a legal or brand rule?
   - Is the `CAPTION_MAX_CHARS` budget enough with credits included?
4. **Publisher mode.** Drama posts only when `publisher_mode = 'live'`. The current production mode was not checked, so confirm it before turning on `publishing_live`.
5. **Retiring `per_week`.** It is replaced by the daily quota. Confirm that the weekly cadence (3/week) is fully superseded by 1/day slots.
6. **Revisions.** Only caption fixes are covered. Scene or frame redo would need deep render-pipeline hooks (cf. `lib/revisions/explainers-folder.ts`). Should that be in scope for a later pass?
7. **`mode` (development / production).** It is only a tag on drama costs. Health and cost read all modes. Should production-only reporting be the rule, as in explainers?
8. **Bucket.** Drama files share the `explainers` bucket (prefix `reel-ai-drama/`). Is a separate bucket or a retention policy wanted?
9. **Spend.** Default daily caps are 2 renders and $20/day. The per-reel cap is $8, plus the solver's $4 `solver_limit_usd`; is the solver inside or outside the per-reel cap? Confirm this before `auto` is ever turned on.
10. **Calendar.** No drama slots are seeded, so Lucas adds them on the week board. Legacy mode books `evening` 8:00–8:45 PM. Confirm the time against the Reels evening window and the AI Events Sunday 7 PM slot.

---

## 10. Builder notes

**Builder C (2026-11-08)**
- Lab types the §4.8 additions locally (`LabView` in `reel-ai-drama-lab.tsx`: `requests?`, `settingsProblems?`, job `cancelRequestedAt?`/`verdict?`, `calibration.usd?`) so it compiles before and after A lands them. A: keep the field names exactly as §4.8 says.
- Lab polls `GET /lab` every 10 s while a request is `requested`/`running` **or** a job is `queued`/`running` (so Cancel/Retry states refresh too).
- The lab settings tab reads `GET /api/reel-ai-drama/settings` (`editable`, `problems`) and saves one `{ values }` batch of changed keys only; pure helpers live in `app/reel-ai-drama/lab/form.ts`.
- Idea cycle: `ideaCycleStatus(db, now?)` (extra export in `cycle-request.ts`) feeds GET. `maxRenders = daily_render_cap`; `estimateUsd` = the average idea-pipeline cost of the last 10 ok cycles (fallback $0.25) + `maxRenders × per_reel_cap_usd`. A request from an earlier NY day is replaced on POST, and the worker drops it (`idea_cycle_request_expired`) instead of running it. The 409 for a waiting request says "The idea cycle is already requested. The worker runs it on its next poll."
- `/explainers?tab=settings`: checked by reading code (page passes `openSettings`, B's `ContentTypePage` passes `defaultOpen`); no render test.

**Builder B (2026-11-08)**
- Beyond the listed records, drama was added to `slots/schedule.ts SCHEDULE_ENTRIES`, the WeekBoard tray, `views/day-rank.ts DAY_TYPES` (today's cards) and `run-misses.ts` (failed pitch job today → that idea's card). Without them drama would have no calendar row or Content-page card.
- Type page: an extra `components/content-type/ReelAiDramaHub.tsx` wraps `TypeHub` so a bench card gets a "Make it" button (`POST /api/reel-ai-drama/make {pitchId}`), the Explainers bench-action pattern. Generate is the Develop button (confirms the `weekly_dev_cap_usd` ceiling) plus a Lab link.
- `ReelAiDramaSettingsForm` hides `auto` and `posts_per_day`; the Posting panel above owns them (through `writeDramaPosting`).
- Review tags are checked per vertical in `content-action.ts`: drama → `DRAMA_REVIEW_TAGS`, everything else → the old `FAILURE_TAGS` (Explainers unchanged).
- The hub read skips drama (an empty read, no error) while `dramaSchemaReady` is false, so an unapplied schema doesn't mark the whole hub as partial. Waste and caching reads of drama are wrapped and fall back to nothing.
- Client-safe code (plan, legacy slots, placement) keeps literal 8:00–8:45 PM windows instead of importing server code. `tests/social-hub-reel-ai-drama-wiring.test.ts` pins them to `DRAMA_WINDOWS`.
- `app/reel-ai-drama/layout.tsx` imports `@/app/reels/reels.css` (as the Explainers layout does), so the type page's `rh-*` controls are styled. The lab under it gets that sheet too (C: check that nothing in `lab.css` clashes).
- `revisions.requests`: the inline CHECK's real name is `requests_vertical_check`. A PGlite test confirms only one vertical CHECK remains after the append.
- `backfillReelAiDrama` writes 0 for attempts, schedule and insights: drama has no legacy tables, so its lifecycle is spine-native. `scripts/backfill_spine.ts reel_ai_drama --apply` runs it on the explainers handle.
- Publisher: the drama driver is added under the explainers DB rule, plus `dramaSchemaReady`. Otherwise it logs `reel_ai_drama_not_driven` with a reason.

### Builder A (drama backend)
- Schema DDL runs only on local PGlite, a localhost `EXPLAINERS_DATABASE_URL`, or `REEL_AI_DRAMA_AUTO_SCHEMA=1`. Everywhere else `ensureReelAiDramaSchema` checks `to_regclass('reel_ai_drama.feedback')` and throws `SchemaNotAppliedError`; drama routes map that to a 503 with "run npm run db:reel-ai-drama". `dramaSchemaReady` checks both `feedback` and `requests`.
- The daily render and spend caps apply in every mode, not only production. Daily spend counts all job costs on the NY day. The render count leaves out killed jobs. The kill-refill in `run.ts` goes through `requestDramaJob`, so it obeys the caps too.
- `nights`: a skipped night writes at most one row per NY day. A later ok night that day deletes it.
- `weeklyTick` now runs weekly development only. The worker tends the pool once a day (`worker_state.pool_tended`), and the night makes the production requests.
- Cancel: `setStage` throws `CancelledByPerson` at the job's next stage. Stages wrapped in fail-open try blocks can delay that by one stage. A cancelled failure sends the pitch back to `pooled` and never counts toward retiring it.
- Calibration `usd` = cost_events with no job and no session, recorded since the request started.
- The develop route keeps the weekly-cap 409 (Explainers pattern) and also returns 409 while a develop request is live.
- `lib/reel-ai-drama/revisions.ts` uses the explainersDb handle (wording fix = caption only, estimate 0).
- `CALIBRATION_FILE` / `saveCalibrationReport` stay in `lab.ts` only for `scripts/reel_ai_drama_calibrate.ts` (not A's file). The lab now reads calibration from `calibration_reports`.
- Known red test, not caused by this build: `tests/reel-ai-drama-development.test.ts` "score combination: drama v7" (0.45 vs 0.5). It comes from pre-existing uncommitted edits to `development/scores.ts`, so A left it untouched.
