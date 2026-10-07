# Helios Social rebuild: STATUS

**Updated:** 2026-10-07, after the photo fix (`docs/superpowers/photo-fix-2026-10-07.md`).
Claude keeps this page current after every step.

- **Authorities:** the spec (`specs/2026-10-01-helios-social-rebuild.md`), the plan (`plans/2026-10-04-helios-social-rebuild.md`, M8 link map and exit criteria) and the prompts file (`specs/2026-10-04-helios-social-prompts.md`).
- **The photo system:** spec §5.1 **Photo chain v1** is its only description. The table below is a copy of it.
- **Tests:** 198 social tests pass, offline. The full suite is 1165/1166; the one failure is the known reels-visual venv test, which is outside Social.
- **Sign-off:** Tommy alone signs off on everything (Lucas is out of the workflow, 2026-10-07).

## Photo chain v1 (spec §5.1)

| Slide | Chain |
|---|---|
| **Cover** | article photo (credit check) → the subject person's P18 (identity check) → logo card (identity-verified organization, Commons licence check) → stock → starter set (AI-compute photos). The branded cover card replaces the starter set once Tommy approves it. |
| **Story slides** (text, landing, image) | article photo or the subject's P18 or stock, as the Writer's request says → text-only |
| **Quote slides** | the verified speaker's P18 → text-only (a stock request is a darkened background) |
| **Stat slides** | a Helios-designed background from the bank, by the 7-day rule, even when IMAGE is `none`. Plain dark until Tommy approves the set. |

**The pieces:**
- **Stock:** Openverse → Jev pre-screen v4 (fit, people) → the vision check on the top 3. A candidate passes only if it shows the thing, with no main-subject person or face, no landmark, no outside logo and no named institution.
- **No repeats:** never twice in a post, within 7 days, or earlier in the same run, for every source.
- **The Writer and the finder agree:** `photo_available` is exactly "P18 usable", from one shared check (`lib/social/photos/p18.ts`).
- **Fully automatic.** Only sources with no rights questions. When nothing is found, the slide is a designed slide.

**Off, dropped or not planned:** official company images (off); more Commons/Openverse photos per subject (dropped); charts and post screenshots (not planned); per-company approvals and hand-picked photo banks (none).

## Link map (M8)

| Link | Status |
|---|---|
| Reporter → Editor → Fact-checker | **Accepted, frozen** |
| Renderer mechanics (text fit, bounds, contrast, faces clear, framing, rotation) | **Accepted, frozen** |
| **(A) Writer IMAGE requests** | Built; offline tests only. Matches Photo chain v1, including: stat slides take IMAGE `none`, article and stock requests only on text, landing and image slides, quote slides take the speaker or none, and a failing request on the final attempt becomes `none`. |
| **(B) Photo finder: stock** | **Accepted, frozen** (2026-10-07). Replays offline with no live calls: 22/22 stock requests pick exactly what was accepted (`scripts/social_photo_bench.ts --replay`, and a test). |
| **(B) Photo finder: covers** | Built to Photo chain v1: logo cards for any verified organization. The PREVIEW re-render shows the Anthropic logo card. |
| **(C) Renderer visuals** | Waiting for Tommy's review: text-only slides, the logo card, and the designed graphics. |
| Hook pass (separate track) | Built; tested on saved drafts and one PREVIEW run. Runs only with `--hook`. Waiting for Tommy's review. |

**No end-to-end runs until A, B and C each pass**, then the M8 acceptance batch (2 fresh runs, 4 posts).

## Decisions since the checkpoint (2026-10-06 → 07)
- **Testing:**
  - Design is tested one link at a time on fixed inputs: the photo-finder bench, with frozen Openverse results.
  - Its pass bar: 0 misleading photos, every miss explained, hit rate tracked.
- **Photo finder:**
  - Face crops fill the frame, never bands.
  - The stock pre-screen is v4 (fit and people).
  - The vision check: Haiku, its own model setting.
  - Starter photos are for covers only, AI-compute only.
  - No repeats within a run.
- **Writer:**
  - the handoff rules in (A);
  - C8 counts only NUMBERS values;
  - aggregator-only facts are removed and logged;
  - `fillDraft` no longer gives an unattributed quote to the first subject.
- **Photo fix (Tommy, 2026-10-07; `photo-fix-2026-10-07.md`):**
  - Photo chain v1 is written in the spec as the only chain.
  - Official images are off, (c) is dropped, and the allow-list and logo permission gate are removed.
  - Logos are allowed for any verified organization whose Commons file passes the licence check.
  - The bank holds Helios-designed graphics only.
  - Lucas is out; Tommy alone signs off.
- **Hook pass:** the prompt edits; the Fact-checker checks hook lines first for types 1 and 4–5; it runs only via `--hook`.
- **PREVIEW runs:** labelled in `run.json`; they don't write the used-photo log.

## Open items (Tommy)
- **Approve the Helios-designed graphics once.** The samples are in `runs/designed-graphics-2026-10-07/`: 15 stat backgrounds and 3 stat slides, plus 3 branded cover cards. Until then, stat slides are plain dark and covers end at the starter set.
- **Review renderer visuals (link C):**
  - the PREVIEW re-render under Photo chain v1: `runs/daily-2026-10-07T03-45-32-722Z/rerender-chain-v1-2026-10-07T14-48-38-225Z/`;
  - text-only slides;
  - the logo card.
- **Review the Hook pass** content and look (same PREVIEW run).
- **The M8 acceptance batch**, after A, B and C pass.
