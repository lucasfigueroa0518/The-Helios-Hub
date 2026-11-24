# Field Notes UI rework: shared contract (2026-11-23)

Decisions: `UI-REWORK-PLAN.md` D1–D6. This file names everything more than one owner touches. Nothing here calls a model.

## C1. Photo Bank section param
- URL search param `section` on `/social/content/library/photos` (live) and `/social/preview/content/library/photos` (preview).
- Values: absent or anything unknown = `online` (today's screen, unchanged); `field-notes` = the Field Notes section.
- Switching section clears `used`, `lane`, `tag`, `page` (they belong to the online section).
- The canonical link to our photos: `/social/content/library/photos?section=field-notes`. Export it as
  `FIELD_NOTES_PHOTOS_HREF` from `lib/social-hub/links.ts`.

## C2. Section switch UI
- Two pills at the top of the Photo Bank, under the page head: **Found online** | **Field Notes**, `sh-pills` / `sh-pill` with `aria-current="page"` on the active one, `HubLink` with `history="replace"`. Same look as the existing All / Not used yet / Used pills.
- Page head meta and the explanatory `sh-note` follow the active section.

## C3. Field Notes section component
- `components/social-hub/library/FieldNotesPhotosSection.tsx`, client component, props:
  `{ pool: PoolPhoto[] | null; error: string | null; readOnly: boolean }`.
- Shows, in order: one meta line (`<live> of about <POOL_TARGET> live · <resting> resting · <retired> retired`), the upload box (`UploadBox`, hidden when `readOnly`), the grid (`PoolGrid`, actions hidden when `readOnly`).
- `pool: null` + `error`: the same plain message the old panel used ("Could not load the Field Notes photos… schema may not be applied yet").
- Looks like the Photo Bank (`sh-` panels and type). The old `rh-`/`fn-` markup may stay inside UploadBox/PoolGrid, but the section must render correctly on the hub page, which does not load `app/reels/reels.css`: whatever classes those components rely on are styled for this page.
- Loader: live page calls `listPool` from `lib/field-notes/photos/store.ts` only when `section=field-notes` (no extra query on the online section). Preview uses fixture photos, `readOnly: true`.

## C4. Field Notes type page
- `app/field-notes/page.tsx` renders `<ContentTypePage vertical="field_notes" />` with no `top`.
- Removed: `components/field-notes/FieldNotesTop.tsx`, `FieldNotesTopView.tsx`, `FieldNotesReviewPanel.tsx`, and `loadPanelData` + `ReviewPost`/`ReviewTip`/`PanelData`/`toReviewPost` in `components/field-notes/load.ts` if nothing else uses them (delete the file if empty).
- Header actions for `field_notes` in `components/content-type/type-parts.tsx`: `<FieldNotesRunButton />` then `<Link className="rh-btn" href={FIELD_NOTES_PHOTOS_HREF}>Photos</Link>` (same pattern as the "Lab" links).
- Update the `TypeParts` doc comment: no type uses the `top` slot any more; remove the `top` prop from `ContentTypePage` if no caller remains.

## C5. Tip notes on a Field Notes post
- New optional field on `HubPost` (`lib/social-hub/types.ts`):
  ```ts
  /** Field Notes: every tip on the post, in slide order, for the post panel. */
  tipNotes?: TipNote[];
  export type TipNote = { subject: string; kind: string | null; want: string | null; knowHow: string | null; name: string | null; tryIt: string | null };
  ```
  `kind`, `want`, `knowHow` are display labels (already plain words), null when not tagged.
- Source: `FIELD_NOTES_POSTS_SQL` tips jsonb gains `leaf`, `want`, `tier`; the adapter (`lib/social-hub/adapters/field-notes.ts` `shell`) builds `tipNotes` using `LEAF_LABEL`/`WANT_LABEL`/`TIER_LABEL` and `parseHowToTry(row.caption)` (index i = tip i), exactly like the old `toReviewPost`. `FieldNotesTipRow`/post tip row types updated.
- Rendered by `components/field-notes/TipNotes.tsx` (`{ notes: TipNote[] }`): per tip, the tool name in bold + ": " + how to try it, then the three tags as small chips ("Kind not tagged" etc. when null). Nothing rendered for an empty list.
- Wired through `FieldNotesHub` as `postExtras={(post) => post.tipNotes?.length ? <TipNotes notes={post.tipNotes} /> : null}`.

## Owners
- **A — Photo Bank:** C1 (param handling, not the links.ts export), C2, C3; live + preview photo pages; `PhotosScreen.tsx`; new section component; preview fixture photos; styling; its own new test file `tests/photo-bank-field-notes-section.test.ts`.
- **B — Field Notes page:** C1 export in `lib/social-hub/links.ts`, C4, C5; `types.ts`, field-notes query + adapter, `TipNotes.tsx`, `FieldNotesHub.tsx`, `type-parts.tsx`, `ContentTypePage.tsx`, `app/field-notes/page.tsx`, deletions; its own new test file `tests/field-notes-tip-notes.test.ts`.
- **Integrator (main session):** `tests/field-notes-ui.test.ts` and any other existing test that breaks; cross-check names; typecheck; review.
