# Instagram publish plan

Status: design, not built. Verified against Meta Graph API v21.0 on 2026-09-29.
Only the review screen invokes the publisher; nothing publishes automatically.

## Account + auth

- **Account:** `heliosgroup.ai` (Helios Group), IG business id `17841473504001687`.
- **Token identity:** Lucas. Scopes granted include `instagram_content_publish`,
  `instagram_basic`, `instagram_manage_comments`, `instagram_manage_insights`,
  `instagram_manage_contents`, `pages_manage_posts`, `business_management`.
- **Rate limit:** 100 published posts / 24 h per account (0 used).
- **Env vars used:** `META_APP_ID`, `META_APP_SECRET`, `META_USER_ACCESS_TOKEN`,
  `META_IG_BUSINESS_ACCOUNT_ID`.
- **App-secret staleness:** the current `META_APP_SECRET` in `.env.local` is
  stale (Meta's `/debug_token` returns "Invalid OAuth access token signature").
  Publish still works because it uses the user token, not the app token.
  Refresh the app secret before wiring long-lived-token exchange.

## What we publish

A carousel of 7–10 items (cover + 5–8 story + follow), matching Instagram's
10-item carousel cap. `LIMITS.storySlidesMax = 8` enforces the ceiling.

**Per image (before upload):**
- JPEG. Renderer outputs PNG today; publish converts PNG → JPEG with a
  quality-90 encoder (still well under the 8 MB per-image cap; measured
  finalizer PNGs were 150 KB–1.4 MB).
- 1080 × 1350 (4:5 aspect ratio, inside Meta's 4:5–1.91:1 range).
- Hosted at a public HTTP URL Meta can `cURL` server-side. Not signed, not
  a data URL, not file://.

**Caption:**
- ≤ 2200 chars including "Source:" line + appended image credits.
- ≤ 30 hashtags, ≤ 20 @mentions. Hashtags are banned in Helios voice
  (`code-checks.ts` `caption_hashtag` HARD).
- Appended by the publisher AFTER the Caption stage's output:
  `Photos: <credits>` and, when the post has any AI-illustrated slide,
  `Illustration: AI-generated`.

**AI info label** (Meta's AI-content flag):
- Parameter: `is_ai_generated: true` on the CAROUSEL container (parent).
- Not available on carousel children — set once on the parent.
- Trigger: the finalizer writes `ai-labeled.txt` in the post output dir
  when at least one slide is AI-illustrated. The publisher reads that
  flag and sets the parameter accordingly.

## Image hosting

Two options; we pick one when we wire it up:

**A. Supabase Storage public bucket.** We already have a Supabase project
with a `helios-social-images` bucket used by the image step for cached
Wikidata photos. Add a `helios-social-post-<slug>` folder per post,
upload the JPEGs, expose the folder as public. Public URL shape:
`https://okslkogkokdwylmcsygz.supabase.co/storage/v1/object/public/helios-social-images/post-<slug>/slide-<NN>.jpg`.

**B. Vercel `/public/publish/<slug>/*.jpg`.** Simpler but the images live
in the deploy bundle; each new post is a redeploy. Only workable while
we're low-volume.

**Recommendation: Supabase.** Same infra as the image cache, no redeploy
per post.

## The three-step publish flow

Meta requires three API calls per carousel. Meta v21.0 endpoints:

1. **Create each item container** (one call per slide):
   `POST /{IG_ID}/media`
   Params: `image_url=<public JPEG URL>`, `is_carousel_item=true`,
   `access_token=<user token>`.
   Returns `{ id: <container_id> }`.
   Poll `GET /{container_id}?fields=status_code` until `FINISHED` (Meta
   downloads and validates the image async). Failures come back as
   `ERROR` with a reason; publisher must surface these to the review
   screen, not silently retry.

2. **Create the carousel container:**
   `POST /{IG_ID}/media`
   Params: `media_type=CAROUSEL`,
   `children=<comma-separated container_ids in order>`,
   `caption=<full caption text>`,
   `access_token=<user token>`,
   optionally `is_ai_generated=true`.
   Returns `{ id: <carousel_container_id> }`.
   Poll `status_code` until `FINISHED`.

3. **Publish:**
   `POST /{IG_ID}/media_publish`
   Params: `creation_id=<carousel_container_id>`, `access_token=<user token>`.
   Returns `{ id: <media_id> }` — the post is live.

**Container expiry:** 24 h. If step 3 doesn't happen within 24 h of step 2,
the container is unusable and the whole flow restarts.

## Test mode

The publisher has three modes, chosen by an env / flag:

| Mode | Uses live Meta API | Publishes to Helios IG | Purpose |
|---|---|---|---|
| `dry-run` | no | no | Show the exact API calls that would go out; no HTTP. |
| `test` | yes (item container polling only) | no | Uploads JPEGs, creates item containers, verifies Meta's `status_code=FINISHED`, then stops. Confirms images are valid and reachable without ever publishing. Container expires unused in 24 h. |
| `live` | yes | yes | Full three-step flow. |

`test` and `live` are the same code path; `live` runs step 3, `test` does not.
Default is `dry-run` until Tommy switches it.

## Trigger

Only the review screen's **Approve** button invokes the publisher, and
only in the mode configured for that deploy. There is no scheduled/
automatic publish. The publisher never runs from the pipeline
orchestrator, the ingest job, or a cron.

## Failure handling

- **Image validation fails at Meta (step 1):** publisher aborts, review
  screen shows the specific slide + reason. No cleanup needed (Meta
  hasn't stored anything permanent).
- **Carousel container fails (step 2):** same — abort, surface.
- **Publish fails (step 3):** abort. Because the media hasn't been posted,
  there's nothing to delete. The container expires in 24 h.
- **Rate-limit hit (429 / `code: 613` per Meta):** show the current
  quota via `content_publishing_limit` and refuse to try again for the
  quota_duration window.

## What this plan does NOT cover (leave for later)

- Comment moderation / auto-reply.
- Insights fetch / analytics.
- Scheduled publishing (Meta's `scheduled_publish_time` — allowed but not
  needed while we're one Approve → publish per day).
- Multi-account posting.
- Story or Reels publishing.
- Re-publishing a corrected post (Instagram doesn't support edit-in-place
  for posts; workflow would be delete + republish, and we don't need it).

## Env + code shape (proposal)

- `lib/social/publish/instagram.ts` — the publisher. Exports
  `publishCarousel({ postId, imagesDir, caption, isAiGenerated, mode })`.
- `lib/social/publish/image-host.ts` — Supabase upload helper. Uploads
  a directory of PNGs, returns the ordered list of public JPEG URLs.
- `lib/social/publish/png-to-jpeg.ts` — sharp-based converter (quality 90,
  4:2:0 chroma).
- `scripts/publish_post.ts` — CLI wrapper for manual runs (`--mode=test`).

The review-screen Approve button calls `publishCarousel` server-side via a
Next.js route handler; nothing publishes from the client.
