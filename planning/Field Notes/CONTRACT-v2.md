# Field Notes contract v2 (2026-11-05): one tip per slide
Supersedes CONTRACT.md wherever they differ. Decisions: PLAN.md "Decision 2026-11-05". Already edited by the lead: `lib/field-notes/types.ts` (SLIDE_KINDS cover|tip|follow, BLOCK_ROLES headline|body|eyebrow, MARK_KINDS underline|circle|inline_underline, Post.tipIds, TIP_SLIDES_MIN/MAX 3/4, PHOTO_KINDS unchanged) and `lib/field-notes/write/types.ts` (DraftSlide {kind:'tip', headline, line, tipId}; PostDraft {slides, caption}; InsufficientSource {tipId, missing}). Builders do not edit those two files; ask the lead.

## Post shape
cover (code-written text, photo of our faces) + 3-4 tip slides (one tip each) + follow (code-written). 5-6 slides.
- Cover text, code-written, no model: eyebrow `FIELD NOTES`, headline `${n} AI tips to try` (n = tip slide count). Plain and literal.
- Tip slide: headline = the tool/skill/repo's real name (<= 40 chars, command keeps its casing); one body line of about 20 words (cap 140 chars, 24 words hard) saying what it is, the problem it solves for the reader, how to use it. Lucas's register: "makes sure X keeps working until it finishes exactly what you want. Step away, come back to a finished task." Never put that wording in a prompt.
- Marks annotate text only: `underline` under the headline, `circle` round the first backticked command in the body, `inline_underline` for a command's own underline. No arrows, no margin notes, no saliency, no pointing at the photo. Step markers are gone.
- Caption <= 700 chars. 

## Names
- caps.ts exports `TIP_SLIDE_CAPS = { headline: 40, line: 140, words: 24, slide: 180 }`, `CAPTION_CAP`, `OVERRUN_HARD_RATIO`, `FOLLOW_SLIDE_HEADLINE`, `UNTRUSTED_EXCERPT_CAP`, `COVER_EYEBROW = 'FIELD NOTES'`, `coverHeadline(n: number): string`. `SLIDE_CAPS`, `NOTE_CAP`, `STEPS_SLIDES` are deleted.
- Writer entry: `buildWriterRequest(tips: Tip[])` (3-4 tips in one call; stable system prompt cached; tips as labelled blocks, scraped text delimited). Tool output: `{ slides: [{tipId, headline, line}], skipped: [{tipId, missing}], caption }`. A tip the source cannot support is skipped, never padded. Fewer than TIP_SLIDES_MIN supported slides => the run ends `insufficient_source` (no draft).
- Editor cuts only (headline/line/caption), code-enforced as before.
- Gates: fact check over all slides against all tips' text; repeat (no two slides share a headline or line); overrun (>50% over a cap is hard).
- Render input: `SlideInput` kinds `cover | tip | follow`; the planner places text in calm regions away from faces and the logo; contrast rule unchanged; Cover requires the photo to contain at least one detected face (else `placementFailed` reason `cover_no_face`, which triggers the existing photo-swap loop with a `people`-kind replacement).
- Photo pick: slide 1 must be a `people` photo (starred opener preferred); tip slides vary across the other kinds (working, scenery, event) with max 2 per kind; Follow = calmest. UI label for `people` is "Faces".
- DB: `field_notes.posts` gains `tip_ids uuid[] NOT NULL DEFAULT '{}'` (idempotent ALTER); `tip_id` stays the first tip. Selection takes the top 3-4 candidate tips with distinct subjects; each used tip -> status drafted.
- Upload: browser -> signed URL -> bucket `photo-bank` path `incoming/field-notes/<uuid>`, then POST finalize `{path, name, kind, opener}`; server downloads, converts, reads EXIF, strips location, dedupes, stores, deletes the incoming object. Sequential, per-file progress, no size cap beyond 25 MB.

## Ownership (no one edits outside their set)
A Upload: app/api/field-notes/photos/**, components/field-notes/UploadBox.tsx, PoolGrid.tsx ("Faces" label, kind select), lib/field-notes/photos/{ingest,store,heic,exif}.ts, tests/field-notes-photos.test.ts.
B Writer: lib/field-notes/write/** (not types.ts), tests/field-notes-write.test.ts, tests/fixtures/field-notes/write/**.
C Render: lib/field-notes/render/**, lib/field-notes/post.ts, tests/field-notes-render.test.ts.
D Pipeline: lib/field-notes/{run,store,schedule,publish,caption,items,worker,live}.ts, lib/field-notes/photos/pool.ts, lib/field-notes/sources/select.ts, db/field_notes_schema.sql, components/field-notes/{load.ts,FieldNotesReviewPanel.tsx,FieldNotesSeedForm.tsx}, app/api/field-notes/{seed,run,slides}/**, lib/social-hub/{adapters,queries}/field-notes.ts, tests/field-notes-run.test.ts, tests/field-notes-ui.test.ts, tests/field-notes-sources.test.ts.
E Sources: lib/field-notes/sources/{registry,config,docs-adapter}.ts only (verified URLs).

Rules for every builder: CLAUDE.md Rules 1-2 (no live Claude API, no web_search, no DB sweep); prompt-review lens (no example copy in prompts, no topic named); prompt caching preserved; do not commit, do not touch git branches, do not apply schema to a real DB, do not deploy; run only your own tests with `npx tsx --test <file>` plus `npx tsc --noEmit -p .` filtered to your files (other owners' files will be broken while the build is mid-way: that is expected). Report what you changed, anything you needed from another owner's files, and anything unverified.
