# Photo links: build plan (DRAFT, nothing built)

**Spec:** `specs/2026-10-07-photo-spec.md` (the only photo authority). **Map of today's code:** `photo-map-2026-10-07.md`.
**Method** (spec §7): one link at a time, on fixed inputs. Each link is accepted on the bench and frozen before the next starts. Tests are offline. Any live call needs Tommy's OK and a cost estimate. Every change carries the tag `cause/symptom · type · new stages · new AI calls`.

**Order:** 1 request → 2 identity → 3 search → 4 screening → 5 placement → 6 render review.

**Fixed inputs shared by all links**
- **Bench requests:** `fixtures/social/photo-bench/requests.json` (R01–R38, from the saved runs) + `company-stories.json`. Openverse results frozen in `openverse-cache.json`. The accepted stock link is in `accepted-stock.json`.
- **Saved posts:** briefs, pages and drafts from the four latest daily runs:
  - `daily-2026-10-06T16-00` (Altman; Mistral in its photo re-runs)
  - `daily-2026-10-06T21-17` (Mistral, Altman)
  - `daily-2026-10-07T03-45` (2 Anthropic posts)
  - `daily-2026-10-05T18-24` (Altman, Gemini)
- **Known failures, as fixed test cases** (spec §7 plus the older Altman and Mistral posts):

| Failure | Where it happened | Bench id | Link that must stop it |
|---|---|---|---|
| Wrong-person "depicts" (P180) photos: TechCrunch Disrupt stage shots, Village Global Altman, EC "OpenAI representatives" visit | 16:00 Altman post, slides 2, 5, 7, 9 | R02, R04, R06, R08 | 2 identity / 3 search |
| OpenAI's Wikidata main photo is a building (Pioneer Building) | 16:00 Altman post, slide 8 | R07 (and R08) | 1 request / 2 identity (organizations get a logo, never P18) |
| Soldier: an Air National Guard server-room shot | 16:00 Altman post, slide 4 | R09 | 4 screening |
| Navy medics (NavyMedicine "NMRTC San Diego") | 16:00 Mistral photo re-run 16:30, slide 4 | R12 | 4 screening |
| A bar for Anthropic ("Bar Brasserie – The Old Courthouse") | 16:00 Altman post, slide 6 | R05 | 1 request (Anthropic → logo) / 4 screening |
| 1930s building for Mistral: the brick building on the Mistral cover, subject "Mistral AI" (Tommy, 2026-10-07) | a Mistral cover (not in the saved run traces) | R10 | 1 request (Mistral AI → logo) / 5 placement |
| The same brick building for "laptop warning screen" (Flickr "BUILDING 33 … Biggin Hill") | 16:00 Altman post, slide 3 | R03 | 4 screening |
| The San Francisco townhouse for "government building exterior" | not in the saved run traces | R13 | 4 screening |
| Le Chonk cover: a biology lab with a WARNING sign, picked from the word "lab"; and its lab-bench inset | 21:17 Le Chonk post, cover and slide 2 (starter `lab-bench-…`) | R10 request on the cover and slide 2 | 1 request (Mistral AI → logo) / 5 placement (starter set OUT) |
| Hospital | 03:45 security post, slide 5 | R37 | 4 screening |
| Altman cropped to hands and legs | 16:00 Altman post renders | — (render fixture) | 5 placement |
| Same microchip on both covers | 03:45 covers (both starter `microchip-hitachi…`) | run-level fixture | 5 placement |
| Subject requests filled with unrelated starter scenes (lab bench for Mistral AI; data-center roof for Sam Altman; circuit boards for Anthropic and Ron DeSantis) | 21:17 Mistral and Altman posts | R10, R01, R05, R26 | 1 request / 5 placement (starter set is OUT) |
| Article photos that are title cards, charts or agency photos | 03:45 posts; 16:00 Altman post; Mistral re-runs | R33, R36, R15, R02 | 3 search / 4 screening (caption + credit rules) |

---

## Link 1: the Writer's IMAGE request (detailed)

**Classification:** cause · source fix (prompt + code) · 0 new stages · 0 new AI calls.
**Scope:** only what the Writer is told and allowed to request about photos, and the code checks on its requests. The Writer's accepted writing rules don't change. The one addition outside the IMAGE line is the slide-subject tags Tommy decided (spec §3 rule 3).

### Kept as is
- The request shape: `ImageRequest {kind: subject | article | stock | none, value}` in `writer/draft.ts`; `spread_with_next`; `fillDraft`.
- Words never change to fit a photo (`KEEP_WORDS`). The checks run on every attempt. On the final attempt a failing request becomes `none` and is logged (`image-request-dropped`).
- The stock word check (a stock scene must name a physical thing the slide mentions). It rejects R23 "abstract neural network".
- The one EDIT NOTES line per story-slide `none`.
- Stat slides: IMAGE `none`. Their icon background is automatic (Tommy, 2026-10-07).

### Rewritten
1. **Slide subject tags (new field, Tommy's decision).** Each cover option and each slide gets `subject_ids` (SUBJECTS IDs, like `quote_id` and `number_ids`). It is added to the `submit_draft` schema and the draft format. Code checks that every tagged subject is named on that slide (full name or a multi-word name's last word, the cover's existing `namedAt` rule). A tag the slide doesn't name is a handoff error.
2. **What the Writer sees about each subject** (`briefForWriter`). `photo_available` is replaced by two code-set flags from one shared function (the same one the finder calls):
   - `headshot_available`: a person whose verified P18 is usable.
   - `logo_available`: an organization whose verified P154 passes the licence check.

   An organization's P18 is never offered (the OpenAI → Pioneer Building case).
3. **What the Writer sees as ARTICLE PHOTOS.** Only photos the finder could actually use:
   - In the article body as the page reader extracts it. og:image counts only when it is the same photo as one in the body (Tommy's decision).
   - An allowed credit (`classifyCredit`, unchanged).
   - A caption.

   Code adds `names: [subject IDs]`, the SUBJECTS entries the caption names. **Official announcement images** are listed with `official_of: <subject ID>`. For them the page counts as the caption: the page's domain must be on the plain domain→company list (spec §2).
4. **The IMAGE rule** (`IMAGE_RULE`, rewritten), per slide type:
   - **Cover:** never `none`.
     - `article:` a listed photo whose `names` include the cover's subject, or an official image of the cover's company.
     - `subject:` the cover's subject (a person with a headshot, or a company with a logo).
     - `stock:` a literal scene.
   - **Story slide:**
     - `article:` a listed photo whose `names` meet the slide's `subject_ids`, or an official image only on a slide tagged with that company.
     - `subject:` a tagged subject with a headshot or a logo. At most one logo on story slides per post; each person at most once per post (the quote slide may show them again, from a second photo).
     - `stock:` a literal scene.
     - `none` with a note.
   - **Quote slide:** `subject: <the speaker>` when the speaker is a SUBJECTS entry, else `none`. Quote slides are allowed whether or not the speaker has a photo. The finder falls through: headshot → second photo → article photo naming the speaker → type-led slide. **Never another person or the company's logo in the speaker's spot.**
   - **Stat slide:** `none`.
   - **Spread:** the first slide asks for a wide literal `stock:` scene, the next `none` (unchanged).
5. **Handoff checks** (`imageHandoffFailures`, rewritten to call the same availability and article-list functions as the finder):
   - (a) A `subject:` request names a subject tagged on that slide, with the right flag.
   - (b) An `article:` request is in the list and its `names` (or `official_of`) meet the slide's tags.
   - (c) Logo and person limits per post.
   - (d) Quote: the speaker or none. Stat: none.
   - (e) Tags are named on the slide.
   - (f) The existing stock word and EDIT NOTES checks.

### Fixed test inputs (offline, canned Writer outputs, no model)
- **Saved briefs and pages** from the four runs above, with recorded availability: who has a headshot, who has a logo, and which article photos survive the filter. These are recorded once in Link 2 and stubbed here.
- **One canned draft per case**, checking that the handoff accepts or rejects with the right message:
  - `subject: OpenAI` / `Anthropic` / `Mistral AI` on a tagged story slide → accepted as a logo request (R05, R07, R08, R10). Untagged → rejected. A second logo on another story slide → rejected.
  - `subject: Sam Altman` on a slide not tagged with Altman → rejected. On a tagged slide → accepted once. On his quote slide as well → accepted (second photo).
  - The Verge Getty photo (R02) → never listed (agency credit), so a request for it is rejected.
  - Indian Express featured image (R33), SiliconANGLE program graphic (R36), the-decoder chart (R15) → listed only if they have a caption naming a tagged subject (expected: not listed).
  - Quote slides for Ron DeSantis, Pierre Stock and an unnamed former employee (no SUBJECTS ID) → all accepted. The last is `none` → type-led.
  - Stat slides with a stock backdrop (R11, R14, R20) → rejected; `none` required.
  - R23 "abstract neural network" → rejected (word check).
  - Words-stay: a draft that rewrites the slide to fit a request still fails (existing test kept).
- **Agreement test:** for every request the handoff accepts on these fixtures, the Link 5 finder (stubbed sources) returns that photo or a defined fallthrough. Nothing the Writer may ask for is impossible.

### Pass bar
- Every fixture case gives the expected accept or reject, with a message telling the Writer what to change.
- The agreement test passes on all fixtures.
- All social tests pass offline. Words never change.
- **Optional, only with Tommy's OK:** the live Writer on 4 saved briefs, to see the request mix and that the final attempts pass the handoff.

### Cost
- **$0** for the build and tests.
- **The optional live check:** the Writer (Sonnet) on 4 saved briefs, roughly **$0.40–0.80** including retries. Asked for separately.

---

## Link 2: identity

- **Kept:** `identity.ts` (resolver + Jev description match + P31), `subject-identity.v1`, the Wikidata resolver, `subjectP18`, `fetchLogo`, the per-story identity cache.
- **Rewritten:** one availability function per subject, used by both Link 1 and the finder:
  - person → headshot (P18), and a second photo (Link 3);
  - organization → logo (P154), never its P18;
  - unclear type or several matches → nothing (fail closed).
- **Fixed inputs:** every SUBJECTS entry in the saved briefs (Altman, OpenAI, Anthropic, Mistral AI, Pierre Stock, Ron DeSantis, Bernie Sanders, Dario Amodei, Donald Trump, Google…). Their Wikidata/Commons responses and Jev answers are recorded once into a fixture, then replayed with the network blocked (like the stock replay).
- **Failures it must stop:** P180 wrong-person photos (R02, R04, R06, R08); OpenAI's building (R07).
- **Pass bar:** 0 wrong identities. Every organization resolves to a logo or nothing. Every miss is explained.
- **Cost:** recording the Jev identity answers once, about 15 subjects × fractions of a cent ≈ **$0.01–0.02**, then $0. It's an existing step on saved data under $0.05, so it's pre-approved per Tommy's standing rule; reported after.

## Link 3: search

- **Kept:** Wikidata/Commons/Openverse fetchers; the page reader's photo extraction, which copies caption and credit exactly; the frozen Openverse cache.
- **Rewritten or new:**
  - Article photos limited to body photos, with og:image only when it is the same photo as a body photo.
  - The plain domain→company list for official images (data, no approval column).
  - The second-photo fetch: Commons files tagged as depicting the verified QID.
- **Fixed inputs:**
  - The saved pages from the four runs: Verge, Indian Express, SiliconANGLE, the-decoder, Engadget, Yahoo/Gemini.
  - Frozen Commons responses for the second-photo cases (Altman, Amodei, Trump).
  - Anthropic and Google announcement pages from `company-stories.json`.
- **Failures:** related-story thumbnails, title cards and charts listed as article photos (R33, R36, R15, R17, R18).
- **Pass bar:** each page yields exactly its body photos. og:image is kept only on a match. The official list maps anthropic.com → Anthropic and not 9to5google.com → Google. Every candidate carries the caption and credit exactly as shown.
- **Cost:** **$0** (saved pages, frozen responses).
- **Flag for Tommy:** the second-photo rule's "tagged on Commons as depicting that exact person" is Commons' own "depicts" tag (by Wikidata ID). Spec §3 and §6 say "never depicts (P180)". The three checks make it safe, but the two lines should be reconciled in the spec's wording.

## Link 4: screening

- **Kept:**
  - The credit check (`classifyCredit`).
  - The frozen stock link (pre-screen v4 + the vision check, prompt unchanged), replayed offline.
  - The face detector (MediaPipe).
  - C6 as the backstop.
- **Rewritten or new (code):**
  - Caption rules: no caption, no use; the caption must name a subject tagged on the slide (rule 3).
  - Second-photo checks: the title contains the person's name; exactly one face.
  - Official images: reject mostly-text images using the existing vision check's banner answer. **New use of an existing AI call: needs Tommy's OK.** Alternative: code only (e.g. the image's text-area share). To decide.
- **Fixed inputs:** the bench stock requests (accepted replay) plus the Link 3 candidates.
- **Failures it must stop:** soldier (R09), Navy medics (R12), the bar (R05), the 1930s building (R13 or R03, to confirm), the hospital (R37).
- **Pass bar:** 0 misleading photos; every miss explained; the stock replay still picks exactly what was accepted (22/22).
- **Cost:** **$0** for code checks and the replay. If the banner check is approved: one Haiku call per official image on the fixtures, ≈ **$0.01–0.02** once, then frozen.

## Link 5: placement

- **Kept:**
  - The renderer layouts: logo card with the grid restored, split, bleed, backdrop, quote round spot, spreads.
  - `from-draft.ts`, the render-fit check, C7.
  - Face-centred crops; the used-photo log (7-day rule, logos exempt).
- **Rewritten:**
  - The chain in `find.ts`, per spec §4, with full fall-through (the Writer's request is tried first, then the spec order).
  - Logo on at most one story slide.
  - The no-repeat set across the run (the microchip case).
  - Quote fall-through to the type-led layout.
  - **Icon backgrounds** as their own layout in the rotation (story, stat, cover format).
  - **Full-bleed people** when the face box can be placed in the upper part, clear of the text and the HELIOS mark; else split or inset.
  - The **photo bank** grows from used photos with tags (verified QID, scene tags), extending the used-photo log.
- **Removed:**
  - The starter set; the cover card; designed backgrounds.
  - The C6 cover fallback to the starter set (it becomes the cover icon).
- **Blocked on:** the OPEN item, the cover icon look and the icon set (spec §5).
- **Fixed inputs:** the saved drafts of the four runs, with Link 2–4 outputs frozen, re-rendered offline.
- **Failures:** Altman cropped to hands and legs; the same microchip on both covers; unrelated starter scenes on subject slides (21:17 posts).
- **Pass bar:**
  - Every slide has a visual (no bare text slide). Render-fit and C7 pass. 0 faces under text or cut off. No repeats.
  - Layouts rotate like the Oct 4 reference (§5a).
  - Tommy judges the contact sheets.
- **Cost:** **$0** (offline renders).

## Link 6: render review (spec §5b; the written exception for a new AI step)

- **Kept:** the contact sheet from the render-fit check; the code checks first (fit, contrast, faces, over-zoom, near-identical images, bare slides).
- **New:**
  - One Haiku call per post on the contact sheet, with the reference look in the cached prefix (prompt caching per CLAUDE.md).
  - Fixed questions → fixed actions.
  - One round, at most 2 calls per post. Everything logged.
- **Fixed inputs:** posts Tommy has already judged (the six contact sheets from the last three full runs + the Link 5 re-renders), with Tommy's own flags written down first as labels.
- **Pass bar:** report-only first. Haiku agrees with Tommy on most flags (Tommy sets the number) before the loop is switched on.
- **Cost:** about $0.006 per call. Calibration on ~10 posts ≈ **$0.06–0.12**. Needs Tommy's OK (a new step).

---

## Answered (Tommy, 2026-10-07)
1. Everyone quoted must be a SUBJECT: a Reporter prompt rule plus a code check (built as Step A). If a speaker still has no verified photo, the quote gets the type-led quote slide.
2. The "1930s building" is R10. R03 and R13 are fixed cases too (table above), recorded with the Le Chonk cover and inset in `fixtures/social/photo-bench/annotations.json` → `forbidden`.
3. Official-image text check: the existing vision call's "mostly text or banner" question.
4. §3 wording: "never 'depicts' (P180) photos on their own; the only exception is the second-photo rule, where all three checks must agree."
5. §5a now matches §4.

## Status
- **Step A (every speaker is a SUBJECT; SUBJECTS typed):** built; live check passed (2 stories, $0.40).
- **Link 1:** built; offline tests pass; live check on 4 saved briefs: 4 drafts pass ($0.57). Run: `runs/link1-live-check-2026-10-07T18-52-08-820Z`. The full agreement test (every accepted request resolves in the finder) waits for Link 5.
- **Links 2–6:** built offline and committed; companies get their logo only (Tommy, 2026-10-07: no company main photos, reversing the headquarters go-ahead from earlier that day); all offline tests pass; the frozen stock link replays unchanged. Next: the first end-to-end run with the render review on, with Tommy's OK.
- **Added in this round (Tommy, 2026-10-07):** the naming rule (people: full or last name; organizations: full name, or an unshared first word); the cover stays the logo card; official images from news/blog paths only; tags re-checked right after the Editor; the Reporter marks SUBJECTS person or organization.
