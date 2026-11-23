# Field Notes UI/UX rework: living plan (Bald-Eagle-Iteration, started 2026-11-23)

Owner of every decision: Tommy. Nothing is built until the flow (stage 5) is approved.

## Tommy's qualms (verbatim)
- "it's a messy clump"
- "the photo upload should be a section in the photo bank, not the content type's page"

## Map of today's Field Notes page (`app/field-notes/page.tsx`), top to bottom
1. **Header**: title + Beta, Run button (`FieldNotesRunButton`), Seed form (`FieldNotesSeedForm` via `SeedButton`).
2. **`top` slot** (`FieldNotesTopView`), Field Notes only:
   a. Upload box (`UploadBox`): drop files, pick Working / Scenery / Event per batch or per file, per-file progress, duplicate/fail reasons, faces + posting notices.
   b. Posts to review (`FieldNotesReviewPanel`).
   c. Photo pool grid (`PoolGrid`): uploaded photos, used/unused, how many posts are left.
3. **Standard pool screen** (`PoolScreen`, shared by every type): next three days, Ideas | Made | Settings tabs, idea and post panels. Settings holds `FieldNotesSettingsPanel`.

## Map of today's Photo Bank (`/social/content/library/photos`, `PhotosScreen`)
- Finder-vetted photos from carousel + Stories (credit, tags, reusable vs library-only), filters All / Not used / Used, Kind, Tag, paging. No upload.

## Decisions
- **D1 (2026-11-23):** The upload box AND the photo grid move to the Photo Bank as a Field Notes section. Tommy: "yes".
- **D2 (2026-11-23):** The Field Notes page becomes the standard type page; nothing Field-Notes-only sits on top. Tommy: "yes, ... it should fit the standard set that the other content types have".
- **D3 (2026-11-23):** Scope is the Field Notes page + the Photo Bank. Field-Notes-specific bits may only use the standard slots every type has (header actions, post/idea extras, Settings type section). No new slot.

- **D4 (2026-11-23):** Photo Bank gets two sections: "Found online" (today's finder photos) and "Field Notes" (upload box + grid). Stores stay separate; no data migration. Tommy: "All recommended".
- **D5 (2026-11-23):** `FieldNotesReviewPanel` is removed. Its tool name + "how to try it" + tip tags move into the standard post panel via `postExtras`. Tommy: "All recommended".
- **D6 (2026-11-23):** A "Photos" link button in the Field Notes header (same pattern as "Lab"), opening the Photo Bank's Field Notes section. Pool-health line (how many posts the photos can still feed) lives in that section. Tommy: "All recommended".

- **D7 (2026-11-23):** Tip notes stay where the standard `postExtras` slot puts them (bottom of the post panel, under Details and "Open the full post"), not moved up under the slides. Tommy: "keep the tips where they are".

## Build notes (2026-11-23)
- Hub scope guard (`tests/social-hub-scope.test.ts`): the Photo Bank is hub read code. `PoolGrid` and `upload-client` are registered as hub controls (their endpoints `/api/field-notes/pool`, `/api/field-notes/photos/{sign,finalize}` added to CONTROL_ENDPOINTS), and `listPool` moved to `lib/field-notes/photos/read.ts` (no writes); `store.ts` re-exports it, behaviour unchanged.
- Preview mirror: `/social/preview/type/field_notes` uses `FieldNotesReadOnlyHub` (tip notes, Photos link, nothing that writes) over a fixture Field Notes post (`previewDatasetWithFieldNotes`).

## Stage 4: inventory
**Stays (moved, behaviour unchanged)**
- `UploadBox`: drop/choose, Working / Scenery / Event per batch and per file, per-file progress, duplicate (with match + why) and failure reasons, faces and posting notices. Same `/api/field-notes/photos` endpoints.
- `PoolGrid`: every uploaded photo, kind, live / resting / retired, faces check, rest and retire with reason, pool variety vs target.
- Run button, Seed a tip, Settings tab (incl. `FieldNotesSettingsPanel`), Ideas | Made tabs, post panel approve / reject: untouched.

**Goes**
- `FieldNotesTop` + `FieldNotesTopView` (the clump) and the `top` slot use in `app/field-notes/page.tsx`.
- `FieldNotesReviewPanel` (its approve / reject duplicates the post panel).
- Tests that render the removed pieces get rewritten against the new homes, not deleted.

**New**
- Photo Bank section switch ("Found online" | "Field Notes"), as a URL param so links can open either.
- Field Notes section on the Photo Bank: summary line (photos, live, enough for N posts), upload box, grid; styled in the Photo Bank's `sh-` look, not the old `rh-`/`fn-` look.
- Preview mirror of that section with fixture photos (no uploads in preview).
- `postExtras` for `field_notes`: tool name, how to try it, tip tags under the slides. The hub's Field Notes post data doesn't carry these yet, so the adapter/query gains those fields.
- "Photos" header button on Field Notes.

## Facts found while grounding
- Photo Bank reads `media_library.*` (finder photos). Field Notes photos live in their own store (`lib/field-notes/photos/store.ts`). Two separate stores today.
- The standard post panel (`PostPanel`) already has the post's own action bar (approve / reject), so `FieldNotesReviewPanel` duplicates it. Its only unique bits: the tip's tags (kind, want, know-how) and the tool name + "how to try it" under the slides.
- Standard slots in use by other types: header actions (Real or AI and AI Drama add a "Lab" link button), `postExtras`/`ideaExtras` (Text on Screen), `settingsSection` (Explainers, AI Drama).

## Stage 2: one-line responsibility per part (draft, pending Tommy)
| Part | Responsible for | Never decides |
|---|---|---|
| Field Notes type page | Tips, posts and settings, same as every type | Photo upload or photo inventory |
| Header actions | Run, Seed a tip, link to the Field Notes photos | — |
| Post panel (standard) | Reviewing a post: approve, reject, see slides | — |
| Photo Bank page | Every photo we hold, by source | How a type uses its photos |
| Photo Bank → Field Notes section | Upload our iPhone photos (kind, progress, duplicates), see / rest / retire them, how many posts the pool can still feed | Which photo goes into which post (the pipeline does) |

## Open questions
See the latest turn in chat; answers land here with Tommy's words quoted.

## Stage 5: new flow (pending Tommy)
```
Field Notes page (standard type page)             Photo Bank  /social/content/library/photos
┌──────────────────────────────────────┐          ┌───────────────────────────────────────────┐
│ Title · [Run] [Seed a tip] [Photos]──┼────────▶ │ [Found online] [Field Notes]  (?section=)  │
│ Next three days                      │          │ Field Notes:                               │
│ Ideas | Made | Settings              │          │   31 photos · 24 live · enough for ~6 posts│
│ Post panel: slides, approve/reject,  │          │   Upload box                               │
│   + tool name, how to try, tip tags  │          │   Grid (rest / retire)                     │
└──────────────────────────────────────┘          └───────────────────────────────────────────┘
```
| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Upload (Photo Bank → Field Notes) | files, kind picks | getting photos into the Field Notes store | new pool photos |
| Grid (same section) | Field Notes photo store | showing, resting, retiring photos; pool health | pool the run picks from |
| Run / Generate (Field Notes page) | tips + pool | making a post (unchanged) | a post waiting for approval |
| Post panel (Field Notes page, Made) | post + its tip | review: slides, tool name, how to try, tags, approve/reject | approved post to the calendar |
