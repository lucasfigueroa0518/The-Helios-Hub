# Helios Social rebuild: STATUS

**Updated:** 2026-10-07, after the sixth round: the slide design overhaul (two-tier photo request, contact-sheet tags, Jev buckets and variants).
Claude keeps this page current after every step.

- **Authorities:** the spec (`specs/2026-10-01-helios-social-rebuild.md`), the plan (`plans/2026-10-04-helios-social-rebuild.md`, M8 link map and exit criteria) and the prompts file (`specs/2026-10-04-helios-social-prompts.md`).
- **The photo system:** `specs/2026-10-07-photo-spec.md` is the **only photo authority** (DRAFT until Tommy approves it line by line). Every other description of photos is superseded: "Photo chain v1" in spec §5.1, §5.1a and §5.3a, plan M8, the handoff and code headers.
- **Tests:** 232 social tests pass, offline. The full suite is 1199/1200; the one failure is the known reels-visual test, which is outside Social. The frozen stock-link replay test is retired (sixth round: the search order changed; the close-up vision prompt itself is unchanged).
- **Sign-off:** Tommy alone signs off on everything (Lucas is out of the workflow, 2026-10-07).

## Photo code today

The photo chain follows the photo spec (Links 1–6 built; Links 2–6 not yet run live). "Photo chain v1", the starter set, the designed bank and the cover card are gone.
- How the code differs from the spec: `photo-map-2026-10-07.md`.
- The build plan: `plans/2026-10-07-photo-links.md`.

**Correction (2026-10-07):** commit `32b3234` says official-image rows for Google and Microsoft were approved "per Tommy". That claim is wrong: Tommy never approved those rows.

**Correction (2026-10-07):** company main photos (headquarters) were added after Tommy's go-ahead in chat, then reversed by him the same day: companies get their logo only (photo spec §4). Removed from the code.

**Fifth round (2026-10-07, photo spec §6a):** the first end-to-end run came out with no photos but logo cards (every article photo failed the caption/credit rules; the Writer asked for none on 11 of 16 slides; stat slides were always icons; the Hook pass was off). Tommy: "a photo in each of the slides". Now: every slide gets a photo, from the person quoted, the company's CEO, logo or headquarters (its main photo, kept only when the `org-hq@1` check says it shows its building; this reverses the correction above for headquarters only), or a conceptual stock scene; the Writer gives the post a `concept`; stat slides get a darkened backdrop; exactly one spread per post; at most 2 stat slides; official images from any page on a company's own domain; the render review keeps photos (its next photo before the icon) and never breaks a spread; the Hook pass runs by default.

## Link map (M8)

| Link | Status |
|---|---|
| Reporter → Editor → Fact-checker | **Accepted, frozen** |
| Renderer mechanics (text fit, bounds, contrast, faces clear, framing, rotation) | **Accepted, frozen** |
| Step A: every speaker is a SUBJECT; each SUBJECT marked person or organization (Reporter prompt + code check) | **Built; live check passed** (2 stories re-run: every speaker in SUBJECTS, every SUBJECT typed, no retries; $0.40). |
| Photo Link 1: the Writer's IMAGE request (subject tags and the naming rule, headshot/logo/company-photo flags, ARTICLE PHOTOS by the caption rules, official images from news/blog paths, quote slides by speaker, type-led quote slide, tags re-checked after the Editor) | **Built; live check run** (4 saved briefs: 4 drafts pass, 2 after one retry; $0.57). Waiting for Tommy's acceptance. |
| Photo Link 2: identity (headshots; company logos only, never their main photo; never P180 alone) | **Built, offline tests pass.** |
| Photo Links 3–4: search and screening (body photos with captions; official images from news/blog paths with the vision text check; second photos by QID, title and one face) | **Built, offline tests pass.** The face detector checked on local images. |
| Photo Link 5: placement (the spec §4 chains, icon backgrounds with the Writer's icon, full-bleed people when framed, story-slide logos, the bank tags) | **Built, offline tests pass.** Icon backgrounds rendered offline and compared with the mock-ups. |
| Photo Link 6: render review (Haiku on the contact sheet, fixed questions, settings menu, before/after saved) | **Built, offline tests pass** (stubbed model). Switched on with `--review`. |
| Stock search + screening (part of Links 3–4) | **Accepted, frozen** (2026-10-07). Replays offline with no live calls: 22/22 stock requests pick exactly what was accepted (`scripts/social_photo_bench.ts --replay`, and a test). |
| Hook pass (separate track) | **Signed off by Tommy (2026-10-07, fifth round): on in every daily run;** `--no-hook` turns it off. |
| **Sixth round: slide design overhaul** (photo spec §4; `specs/2026-10-08-slide-buckets.md`) | **Built, offline tests pass; not yet run live.** The Writer asks for a visual and a fallback by kind (person, company, logo, product, event, thematic, setting); every source for the kind is searched (article, Wikidata, the new Commons search and StockSnap lane, Openverse); up to 2 candidates ranked by date, then size; one contact sheet per post tagged by Haiku; Jev checks each tag-set fits its request (`photo-fit@1`, the §5A exception); the pick; then Jev picks the spread (`slide-bucket@1`) and each slide's variant (`slide-variant@1`) from the variants the renderer already draws. New variants (incl. the photo centred across a spread with text either side) wait for mock-ups. Removed one-off scripts that used the old finder: the hook prototypes, the Link 1 live check, the photo bench and its collector, the checkpoint photo and M5 photo runs. |
| Fifth round (photo on every slide, company pool, concept, spreads, stat cap) | Superseded by the sixth round. Its re-render: vision off, 15 of 16 slides got a photo and both spreads rendered ($0.0012); vision on, every "data center" stock photo failed the frozen vision check (building exteriors) ($0.052, $0.002 over its $0.05 cap; the script's cap now leaves room for one call). |

**No end-to-end runs until the photo links pass**, then the M8 acceptance batch (2 fresh runs, 4 posts).

## Decisions since the checkpoint (2026-10-06 → 07)

- **Testing:**
  - Design is tested one link at a time on fixed inputs: the photo-finder bench, with frozen Openverse results.
  - Its pass bar: 0 misleading photos, every miss explained, hit rate tracked.
- **Writer:**
  - C8 counts only NUMBERS values.
  - Aggregator-only facts are removed and logged.
  - `fillDraft` no longer gives an unattributed quote to the first subject.
- **Photos:** everything is in the photo spec. The photo fix note (`photo-fix-2026-10-07.md`) and "Photo chain v1" are superseded.
- **Hook pass:**
  - The prompt edits.
  - The Fact-checker checks hook lines first for types 1 and 4–5.
  - On by default since the fifth round; `--no-hook` turns it off.
- **PREVIEW runs:** labelled in `run.json`; they don't write the used-photo log.

## Open items (Tommy)

- **Approve the photo spec** line by line, including its OPEN item: the cover icon look and the icon set (§5).
- **Accept Link 1** (live check report, 2026-10-07).
- **SUBJECT names with qualifiers** ("Google (Google Workspace / Gemini)", "Gemini (app)", "Google AI Plus / AI Pro / AI Ultra"): their tags can never match the naming rule. Seen in 3+ briefs: a Reporter-side fix candidate for Tommy.
- **The cover icon's exact look** (photo spec §5, OPEN): built to the decided format; judge it on the first end-to-end run.
- **The first end-to-end run** with the render review on (its calibration): needs Tommy's OK and cost cap.
- **Judge the sixth round** on a live PREVIEW run (the Writer's new visual requests need the Writer), and approve mock-ups for the new variants (story +1, stat +1, quote +1, cover +1, the centred spread).
- **The M8 acceptance batch**, after the photo links pass.
