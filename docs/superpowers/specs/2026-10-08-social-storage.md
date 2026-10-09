# Helios Social: Postgres storage (spec)

**Status:** DECIDED (Tommy, 2026-10-08: "migrate to Postgres … execute autonomously").
**Why now:** a second machine writes to this repo and wants to read the carousel data. Today every store is a JSON file
committed to git, so two machines running the pipeline overwrite each other's logs (the 7-day photo rule and the
already-posted check silently break) or hit merge conflicts.

## 1. What moves, what stays

| Store today | Moves to | Notes |
|---|---|---|
| `Claude outputs/social-used-photos.json` | `social.used_photos` | The 7-day no-repeat rule and the photo bank tags |
| `Claude outputs/social-posted.json` | `social.posted_stories` | Jev's "already posted?" question (14-day lookback) |
| `Claude outputs/social-set-aside.jsonl` | `social.set_asides` | Pattern-spotting only (§2.3 of the rebuild spec) |
| `Claude outputs/social-feed-health.jsonl` | `social.feed_health` | Per-feed counts per run |
| `exports/social/generated/*.json` (rendered posts) | `social.posts` | Read by the `/social` preview pages and other systems |
| `runs/daily-*/run.json` (new runs) | `social.runs` (summary columns + full record as jsonb) | Old run folders stay as files; not imported |
| Screenshots, contact sheets, `post-N.md`, `preview-report.md` | **stay on disk** in the run folder | Artifacts for eyes, not data |

Nothing else changes: no pipeline stage, prompt, check or threshold.

## 2. Schema `social` (own schema in the shared Supabase, like `reels`)

Additive only: `CREATE SCHEMA/TABLE/INDEX IF NOT EXISTS`. No statement touches another schema. File: `db/social_schema.sql`,
applied with `npm run db:social` (never through `db:setup`, which also runs the bootstrap drops).

- `social.runs`: `id uuid`, `started_at`, `finished_at`, `kind` (`daily` | `preview`), `hook_pass`, `cap_usd`,
  `claude_usd`, `total_usd`, `stop_reason`, `run_dir` (the local folder, for screenshots), `machine` (hostname, so two
  machines' runs are told apart), `record jsonb` (the full run.json).
- `social.posts`: `id uuid`, `run_id` → runs, `slug` unique, `story_id`, `title`, `status` (`preview` | `review` |
  `published` | `rejected`), `brief jsonb`, `draft jsonb` (the final draft), `render jsonb` (the render Post the preview
  pages draw), `caption`, `created_at`, `published_at`.
- `social.used_photos`: one row per photo used on a slide: `url`, `used_at`, `story_id`, `slide`, `source`, `qid`,
  `subject`, `credit`, `scene`, `post_id` (nullable). Index on `(url, used_at desc)`.
- `social.posted_stories`: `headline`, `posted_at`, `story_id`, `post_id` (nullable). Index on `posted_at`.
- `social.set_asides`: the SetAsideEntry fields (`day date`, `story_id`, `stage`, `reason_code`, `kind`, `detail`, `at`).
- `social.feed_health`: the FeedHealthEntry fields plus `run_id` (nullable).

Authorization is app code, not RLS (planning/02 §Authorization), the same as every other schema.

## 3. How the code uses it

- The existing interfaces stay: `UsedPhotoLog`, `PostedStories`, `SetAsideLog`, `FeedHealthLog`. New Postgres
  implementations sit beside the file ones in `lib/social/store/`. The pipeline doesn't know which one it has.
- **Choice:** `createSocialStore()` uses Postgres when `DATABASE_URL` (or `DIRECT_DATABASE_URL`) is set and
  `SOCIAL_STORE` isn't `file`; otherwise the files, exactly as today. Offline tests use the in-memory versions and a fake
  query function: no database, no network.
- **Daily runner:** writes the run row, one post row per shipped post (`status` `preview` on a PREVIEW run, `review`
  otherwise; slug `post-<run timestamp>-<n>`, unique per run), the used photos (non-preview only, as today),
  set-asides and feed health.
  It still writes the run folder (screenshots and reports) and, for now, the `exports/social/generated` file too,
  so the local preview keeps working during the switch.
- **Preview API** (`/api/social/generated`): reads `social.posts` by slug first, then the file.
- **Reads for other systems** (`lib/social/store/read.ts`): `listPosts({ since, status })`, `getPost(slug)`,
  `recentUsedPhotos(days)`, `recentPostedHeadlines(days)`. Other systems call these or query the tables; they never
  write `used_photos` except by recording a photo they actually published.

## 4. One-time import

`scripts/social_import_files.ts`: copies the four logs and the rendered posts in `exports/social/generated` into the
tables. Idempotent (skips rows already there by natural key: url+used_at, headline+posted_at, story_id+stage+at,
day+slug, slug). Old `runs/` folders are not imported.

## 5. Not in this change (flagged)

- `runs/`, `Claude outputs/` and `exports/social/generated/` are still tracked by git (570 MB+). Untracking them is a
  separate decision (Tommy): it stops repo bloat and merge conflicts on artifacts, but the other machine then sees runs
  only through the database.
- Rendered slide images in Supabase Storage (needed for Instagram publishing, rebuild spec Q8) come with the review UI.
- No schedule: the carousel still runs only when started.
- The old v1 schema `helios_social` (article_queue 1,000 rows, image_cache 4, posts/slides/assets empty) is still in the
  database. No current code uses it. It is left untouched; dropping it is Tommy's call.

## 6. Risks and safeguards

- Shared production database (outreach lives there). Safeguards: own schema, additive DDL only, small row counts
  (logs < 50 KB, ~110 posts at ~10 KB, run records ≤ 3 MB each), the runtime pool from `lib/db.ts` (transaction pooler),
  no long transactions.
- A database outage must not lose a run: the run folder is written first; if the run or post write then fails, the
  runner logs it. (The logs read during the run, such as used photos and posted stories, need the database when it is
  chosen; `SOCIAL_STORE=file` runs without it.)
