# Helios Social rebuild: STATUS

**Updated:** 2026-10-07, after photo Links 2–6 (committed) and before the first end-to-end run.
Claude keeps this page current after every step.

- **Authorities:** the spec (`specs/2026-10-01-helios-social-rebuild.md`), the plan (`plans/2026-10-04-helios-social-rebuild.md`, M8 link map and exit criteria) and the prompts file (`specs/2026-10-04-helios-social-prompts.md`).
- **The photo system:** `specs/2026-10-07-photo-spec.md` is the **only photo authority** (DRAFT until Tommy approves it line by line). Every other description of photos is superseded: "Photo chain v1" in spec §5.1, §5.1a and §5.3a, plan M8, the handoff and code headers.
- **Tests:** 235 social tests pass, offline. The full suite is 1202/1203; the one failure is the known reels-visual test, which is outside Social. The frozen stock link still replays unchanged.
- **Sign-off:** Tommy alone signs off on everything (Lucas is out of the workflow, 2026-10-07).

## Photo code today

The photo chain follows the photo spec (Links 1–6 built; Links 2–6 not yet run live). "Photo chain v1", the starter set, the designed bank and the cover card are gone.
- How the code differs from the spec: `photo-map-2026-10-07.md`.
- The build plan: `plans/2026-10-07-photo-links.md`.

**Correction (2026-10-07):** commit `32b3234` says official-image rows for Google and Microsoft were approved "per Tommy". That claim is wrong: Tommy never approved those rows.

**Correction (2026-10-07):** company main photos (headquarters) were added after Tommy's go-ahead in chat, then reversed by him the same day: companies get their logo only (photo spec §4). Removed from the code.

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
| Hook pass (separate track) | Built; tested on saved drafts and one PREVIEW run. Runs only with `--hook`. Waiting for Tommy's review. |

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
  - It runs only via `--hook`.
- **PREVIEW runs:** labelled in `run.json`; they don't write the used-photo log.

## Open items (Tommy)

- **Approve the photo spec** line by line, including its OPEN item: the cover icon look and the icon set (§5).
- **Accept Link 1** (live check report, 2026-10-07).
- **SUBJECT names with qualifiers** ("Google (Google Workspace / Gemini)", "Gemini (app)", "Google AI Plus / AI Pro / AI Ultra"): their tags can never match the naming rule. Seen in 3+ briefs: a Reporter-side fix candidate for Tommy.
- **The cover icon's exact look** (photo spec §5, OPEN): built to the decided format; judge it on the first end-to-end run.
- **The first end-to-end run** with the render review on (its calibration): needs Tommy's OK and cost cap.
- **Review the Hook pass** content and look (PREVIEW run `runs/daily-2026-10-07T03-45-32-722Z`).
- **The M8 acceptance batch**, after the photo links pass.
