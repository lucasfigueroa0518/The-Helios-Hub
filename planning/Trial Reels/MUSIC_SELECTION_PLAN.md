# Reel music selection and trial-reel publishing: build plan

A standalone build plan for three things: keeping a pool of trending Instagram sounds, having Jev match one song to each reel, and publishing the reel as a trial reel. It is separate from the hook-SFX plan (`SFX_HOOK_SOUNDS_PLAN.md`) and from the numbered builds in `BUILD_PLAN.md`.

The operating rules in `BUILD_PLAN.md` Sections 1–3 apply in full. That includes R6 (prompts and Jev question sets need Lucas's approval) and the Jev guidance in Section 3. Lucas makes the product decisions. Every decision below came from the planning interview on 2026-09-27. Anything not written here is open: ask Lucas before building it. Carry the decisions in Section 4 into the Decision Log per R8.

## 1. Goal

Every day, the system watches Instagram's trending sounds and keeps a pool of up to 50 songs. Each song is tagged with its genre, BPM, instruments, and vibe descriptors.

For each finished reel:

1. A semantic layer narrows the pool to exactly 12 candidates.
2. Jev picks the one song that best matches the vibe of the reel's copy in an Instagram reel context.
3. The reel is published as a trial reel with the song attached and the caption and hashtags included.

## 2. Removed from the original request

Lucas's original request put the song's climax 3.5 s into the reel. **That's out**, along with climax detection.

The reason: Meta's API has no field for where a song starts. Lucas chose to attach songs by `audio_id` (MUS-01), which lets Instagram decide the start point. Don't build climax detection or offset logic.

## 3. Verified facts (2026-09-27, re-check per R10 before building)

### Instagram Audio API

It was released on 2026-06-01 and works only on Instagram API with Facebook Login. Docs: https://developers.facebook.com/documentation/instagram-platform/content-publishing/audio-api

- **Search / trending:** `GET /ig_audio?audio_type={music|original_sound}&user_id=…`. With no `search_query`, it returns trending audio.
- **Fields returned:**
  - `audio_id`, `title`, `display_artist` (music only)
  - `duration_in_ms`, `audio_type`
  - `download_url`, a temporary preview file that expires in about 1.5 days and can be null
  - `ig_username` and `profile_picture_url` (original_sound only)
  - `cover_artwork_thumbnail_uri`, `is_ads_eligible`, `on_platform_audio_preview_link`
- **Nothing about genre, mood, BPM, or climax.** All tags come from our own analysis.
- **Only audio authorized for third-party use** is returned. The selection can differ from what's trending in the app.
- **No preview** of a reel with attached audio exists on Meta's side.

### Attaching and publishing

Docs: https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/

- `POST /{ig-user-id}/media` with `media_type=REELS`, `video_url`, `caption`, and `audio_configuration={"audio_id", "audio_volume" 0–100, "video_volume" 0–100}`.
- **There's no start-offset field.**
- Trial reels use `trial_params.graduation_strategy`, set to `MANUAL` or `SS_PERFORMANCE`.
- Captions allow up to 2,200 characters and 30 hashtags.
- Publishing is two steps: create the container, wait for status `FINISHED`, then `POST /{ig-user-id}/media_publish`.

### Permissions

`instagram_basic` and `instagram_content_publish`, a Facebook Page linked to the IG Business or Creator account, and a user access token. Lucas confirms this is all set up.

### Jev

It reads text state only, so it can't hear audio. A single request can carry many questions. See `BUILD_PLAN.md` Section 3 for weak spots, including large irrelevant state.

### Existing pipeline

- Runs are scheduled in `America/New_York`. The main run is at 1 AM (`lib/reels/config.ts`).
- The worker is a GCP `e2-standard-2`.
- The caption writer returns the caption body, a call to action, and 3–5 hashtags separately. `fullCaption()` in `lib/reels/copy/report.ts` joins them the way they post.
- A published-status log per post idea already exists (D-005, D-061).

## 4. Decisions (planning interview, 2026-09-27)

### Ingestion and pool

| ID | Decision |
|---|---|
| MUS-01 | **Attach songs by `audio_id`** through `audio_configuration`. Don't bake the song into the video file. The climax rule is dropped (Section 2). |
| MUS-02 | **The daily ingest runs at 12:30 AM America/New_York**, before the 1 AM run. |
| MUS-03 | **It watches the top 10 trending `music` sounds and the top 20 trending `original_sound` sounds**, 30 in total. |
| MUS-04 | **Dedupe and merge by `audio_id` only.** A sound that appears in both lists is one song. A sound already in the pool is never re-ingested. |
| MUS-05 | **Day 1 fills the pool with exactly 30 songs.** If a sound is skipped (MUS-07) or merged away, bring in another in its place, so day 1 ends with exactly 30. After day 1, only new entrants to the top 30 are ingested and there's no quota. See OPEN-1 for where the replacement comes from. |
| MUS-06 | **The pool holds at most 50 songs.** "Oldest" means first ingested. When a new entrant would make a 51st song, the oldest is **hard-deleted**. That removes its metadata, tags, embeddings, and cached preview file. Reappearing in the trending list doesn't reset a song's age. |
| MUS-07 | **Skip sounds with no preview file** (null `download_url`). They don't enter the pool. If one shows up again later with a file, it's ingested then. |
| MUS-08 | **Keep every sound type**, including speech, voiceover, and meme sounds. Tag and match everything, and let Jev decide fit. |

### Tagging

| ID | Decision |
|---|---|
| MUS-09 | **Tags per song:** 1 genre, a BPM, 1–3 main instruments, and 5–10 vibe descriptors. This is the full state Jev uses for each song. |
| MUS-10 | **CLAP picks genre, instruments, and vibes from fixed vocabularies. A beat-tracking library measures BPM.** The agent drafts the three vocabularies, and Lucas approves them before any tagging runs (treat them like prompts under R6). |
| MUS-11 | **CLAP runs on a hosted inference API**, not on the worker and not as a new service. The agent researches the vendor options and cost per R10, and Lucas picks the vendor. |

### Matching

| ID | Decision |
|---|---|
| MUS-12 | **Narrowing compares the copy text with the song tags** using the CLAP text encoder, through the same hosted CLAP. The embedded inputs are the reel's on-screen copy plus the caption body on one side, and each song's tag text on the other. The top candidates by similarity go to Jev. |
| MUS-13 | **The narrowing layer passes exactly 12 songs to Jev.** This replaces an earlier answer of 15. |
| MUS-14 | **Jev decides with one request and one Choice question over the 12 songs. There's no escape option, so Jev must pick a song.** This goes against TypeSafe's general advice to include an escape option. Lucas chose it deliberately, so log it as such. |
| MUS-15 | **Jev's state:** the on-screen copy, the **caption body only** (no call to action, no hashtags), and each of the 12 songs' tags from MUS-09. The question Jev answers: *"How well does this song match the vibe of the copy in an Instagram reel context?"* The exact Choice wording goes to Lucas for approval (R6). |
| MUS-16 | **Always use Jev's pick**, even if it's a poor fit. |
| MUS-17 | **A song can be used once per assigned calendar day, per post idea.** The day is the slate's New York date, the reel's calendar-day assignment, not the day the reel was generated (D-194, D-197, D-200). Other ideas assigned to that day cannot use it. Regenerating that reel keeps the song. The next assigned day frees it. On a slate, the best selected idea is made first and picks its song before a worse idea (D-199). A worse idea waits while that better idea is still being made and has no song for that day. This replaces the original "no cooldown" rule. |

### Approval and publishing

| ID | Decision |
|---|---|
| MUS-18 | **The approval gate lives in the Hub.** A reel publishes only after Lucas approves it. This replaces D-061's "nothing auto-published" for reels that go through this gate. |
| MUS-19 | **The approval screen plays the video with the song synced from 0:00**, using the cached preview file. It's labeled to say Instagram may start the song at a different point. Clicking the video drills into the song details: title, artist, genre, BPM, instruments, and vibes. |
| MUS-20 | **The approval screen has one control: Approve.** Approving publishes the reel. There's no reject, dismiss, swap, or edit. An unapproved reel just stays unpublished. |
| MUS-21 | **An auto-publish setting is built now and is off by default.** When it's on, reels publish as soon as they're ready, with no approval. Lucas plans to turn it on later. |
| MUS-22 | **Publish as a trial reel** with `trial_params.graduation_strategy = SS_PERFORMANCE`. |
| MUS-23 | **The posted caption includes the hashtags.** Use the caption as it posts (`fullCaption()`: body, call to action, hashtags). |
| MUS-24 | **Song and SFX volumes** (`audio_volume` and `video_volume`) are set from evidence (MUS-V2). |

## 5. Values Lucas sets from evidence (R4, R5)

| ID | Value | How to bring it |
|---|---|---|
| MUS-V1 | The three CLAP vocabularies, and the rule for picking 5–10 vibes and 1–3 instruments per song (for example, top-k or a score threshold) | Tag the day-1 pool at 2–3 settings, and show each song's tags side by side. |
| MUS-V2 | `audio_volume` and `video_volume` | Publish a few test trial reels at 2–3 mixes, and Lucas picks by ear. This needs the finished SFX from `SFX_HOOK_SOUNDS_PLAN.md` Stage 3. |
| MUS-V3 | Hosted CLAP vendor | Options with cost per call, latency, and which CLAP checkpoint each one serves. |

## 6. Stages

### Stage 0: Spikes before code (R10)

Run these against the live Helios account and report back before building.

1. **Trending list size.** Call `/ig_audio` for `music` and for `original_sound` with no query. How many results come back per call, is there pagination, and how do we reliably get the top 10 and top 20 in trending order?
2. **Preview files.** How long is `download_url` compared with `duration_in_ms`? Is it the full track or a clip? How often is it null? This affects tag quality (MUS-10) and the approval preview (MUS-19).
3. **CLAP vendors.** Research the options for MUS-V3.
4. **BPM.** Where the beat-tracking step runs is still open. See OPEN-2.

### Stage 1: Data model

Schema `reels`. Add a table for the song pool with:

- the Meta fields
- the tags (MUS-09)
- the tag-text embedding (MUS-12)
- the path to the cached preview file
- the first-ingested timestamp

Then:

- Add a record per reel for the song decision: the 12 shortlisted `audio_id`s with their similarity scores, Jev's pick, the Choice probabilities and confidence, and the pinned Jev model version (per `BUILD_PLAN.md` Section 3).
- Add a record of each publish attempt.
- Add the auto-publish setting (MUS-21), off by default.

### Stage 2: Daily ingest (12:30 AM)

1. Fetch the trending lists (MUS-03).
2. Merge them and drop any `audio_id` already in the pool (MUS-04).
3. For each new entrant:
   - Skip it if there's no preview file (MUS-07).
   - Otherwise, download the preview immediately to Hub storage, before the link expires.
   - Tag it (Stage 3), embed its tag text, and store it.
4. On day 1, backfill to exactly 30 songs (MUS-05).
5. Enforce the 50-song cap by hard-deleting the oldest songs (MUS-06).

### Stage 3: Tagging (review gate 1)

- The agent drafts the three vocabularies (genre, instruments, vibes), and Lucas approves them.
- Tag the day-1 pool at the MUS-V1 settings, and Lucas picks the setting.
- Measure BPM with the beat-tracking library.
- Store the tags and the CLAP text embedding of each song's tag text.

### Stage 4: Narrow and pick (review gate 2)

Run this once a reel's on-screen copy and caption are final.

1. Embed the on-screen copy plus the caption body with the CLAP text encoder.
2. Rank the pool by similarity and take exactly 12 (MUS-12, MUS-13).
3. Send one Jev request with one Choice question over the 12 (MUS-14, MUS-15).
4. Store the full decision record.

Before this runs on real reels, show Lucas the Choice question set for approval (R6). Then show him Jev's picks for a batch of real reels, with the 12 candidates and their tags, for review.

### Stage 5: Approval screen and publishing (review gate 3)

- The Trial Reels page shows reels waiting for approval, as described in MUS-19 and MUS-20.
- **On Approve**, or immediately when auto-publish (MUS-21) is on:
  - Create the Reels container with the finished video, the full caption (MUS-23), `trial_params` (MUS-22), and `audio_configuration` with the picked `audio_id` and the MUS-V2 volumes.
  - Poll until the status is `FINISHED`, then publish.
  - Write the result to the published-status log per post idea (D-005, D-061).
- Show any publish failures on the Trial Reels page, following the existing notification pattern (D-025).
- Run the MUS-V2 mix test here, then have Lucas review a real published trial reel end to end.

## 7. Open items: ask Lucas, don't assume

| ID | Question |
|---|---|
| OPEN-1 | On day 1, when a sound is skipped or merged, where does the replacement come from? The working reading of MUS-05 is the next-ranked sound from the **same** list, which keeps 10 music and 20 original sounds. Confirm before building. |
| OPEN-2 | Where does the BPM beat-tracking step run: on the worker, in the hosted CLAP call, or somewhere else? |
| OPEN-3 | `share_to_feed` for trial reels: should it be set, and to what? |
| OPEN-4 | Should the published-status log also record which `audio_id` was used on each reel? The pool entry gets hard-deleted later, so without this the reel-to-song link is lost. |

## 8. Done when

- Day 1 fills the pool with exactly 30 tagged songs. Later runs add only new entrants and keep the pool at 50 or fewer, with the oldest deleted first.
- Every finished reel gets a 12-song shortlist and a Jev pick, stored with its full decision record.
- Lucas can play each reel with its song on the approval screen, drill into the song details, and press Approve to publish it as an `SS_PERFORMANCE` trial reel with its song, caption, and hashtags.
- The auto-publish setting exists and is off.
- Lucas has approved the vocabularies, the Jev question set, and the mix values, and has signed off on a real published trial reel.

## 9. Out of scope

- Climax detection and song start offsets (Section 2).
- Performance feedback loops, or learning from reel insights.
- Swapping or editing a reel at approval.
- Any gate other than the approval gate and its auto-publish setting.
