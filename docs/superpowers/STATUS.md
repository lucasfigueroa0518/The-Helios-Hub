# Helios Social rebuild: STATUS

**Updated:** 2026-10-07, after Step A, photo Link 1 and their live check (runs/link1-live-check-2026-10-07T18-52-08-820Z, $0.97 of a $2.00 cap). Committed.
Claude keeps this page current after every step.

- **Authorities:** the spec (`specs/2026-10-01-helios-social-rebuild.md`), the plan (`plans/2026-10-04-helios-social-rebuild.md`, M8 link map and exit criteria) and the prompts file (`specs/2026-10-04-helios-social-prompts.md`).
- **The photo system:** `specs/2026-10-07-photo-spec.md` is the **only photo authority** (DRAFT until Tommy approves it line by line). Every other description of photos is superseded: "Photo chain v1" in spec §5.1, §5.1a and §5.3a, plan M8, the handoff and code headers.
- **Tests:** 226 social tests pass, offline. The full suite is 1193/1194; the one failure is the known reels-visual test, which is outside Social. The frozen stock link still replays unchanged.
- **Sign-off:** Tommy alone signs off on everything (Lucas is out of the workflow, 2026-10-07).

## Photo code today (not the target)

The code still runs "Photo chain v1" (commits `d114151` → `f991cd6`) until the links are rebuilt against the photo spec.
- How the code differs from the spec: `photo-map-2026-10-07.md`.
- The build plan: `plans/2026-10-07-photo-links.md`.

**Correction (2026-10-07):** commit `32b3234` says official-image rows for Google and Microsoft were approved "per Tommy". That claim is wrong: Tommy never approved those rows.

## Link map (M8)

| Link | Status |
|---|---|
| Reporter → Editor → Fact-checker | **Accepted, frozen** |
| Renderer mechanics (text fit, bounds, contrast, faces clear, framing, rotation) | **Accepted, frozen** |
| Step A: every speaker is a SUBJECT; each SUBJECT marked person or organization (Reporter prompt + code check) | **Built; live check passed** (2 stories re-run: every speaker in SUBJECTS, every SUBJECT typed, no retries; $0.40). |
| Photo Link 1: the Writer's IMAGE request (subject tags and the naming rule, headshot/logo/company-photo flags, ARTICLE PHOTOS by the caption rules, official images from news/blog paths, quote slides by speaker, type-led quote slide, tags re-checked after the Editor) | **Built; live check run** (4 saved briefs: 4 drafts pass, 2 after one retry; $0.57). Waiting for Tommy's acceptance. |
| Photo links 2–6 (identity → search → screening → placement → render review) | **Planned** (`plans/2026-10-07-photo-links.md`). Not started. Until Link 5, the finder still runs "Photo chain v1". |
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
- **The icon set and the cover icon look** (photo spec §5, OPEN): needed before Link 5 and the end-to-end run.
- **Review the Hook pass** content and look (PREVIEW run `runs/daily-2026-10-07T03-45-32-722Z`).
- **The M8 acceptance batch**, after the photo links pass.
