# Helios Social: project status

Last updated 2026-09-29 (evening). Read this first in any new session.

## What this is

Helios Social turns one AI news story into an Instagram carousel for smart, busy readers who don't follow AI closely. Owner: Tommy (Helios Group). Repo: The-Helios-Hub, branch `feature/helios-social-pipeline-v2` (unpushed). Production DB: Supabase project okslkogkokdwylmcsygz.

## Source-of-truth docs (in docs/)

- `HELIOS-PIPELINE-V2-HANDOFF.md`: writing pipeline, handoff formats, fact-check loop, all five prompts.
- `DESIGN-V1-HANDOFF.md`: slide types, type and color rules, the reference "target look" fixture.
- `IMAGES-V1-HANDOFF.md`: photo sourcing, including the accuracy rules.
- `design-inventory.md`: what the renderer contained before the redesign.

## Pipeline

Reporter (web search) → Writer → Editor → image step → Caption → code checks → Fact-checker (flags only, 2 rounds max) → render. Anything unresolved goes to human review with the flags attached. Nothing posts without Tommy's review.

## Rules Tommy has set (don't relax these)

- **Main story only.** Earlier statements, later announcements and other companies' news are separate stories, even when sources connect them. Strict: not even a passing clause.
- **Nothing the sources don't say.** No invented comparisons, framings, descriptors or quotes. "Unlike X, Y" and "not X, it's Y" are banned.
- **Quotes word for word** from a fetched source (trailing punctuation is ignored).
- **Photos must be accurate.** Identity comes only from Wikidata P18 or a Commons P180 link to the exact entity, never from a model looking at a face. Wikimedia (public domain, CC0, CC BY, then CC BY-SA) and U.S. federal images only. No AI images, drawn shapes, stock, or news-article photos. A wrong photo is worse than none.
- **Terms explained** on the slide where they appear or the next one.
- **Length:** 5 to 10 story slides between the cover and the follow slide. Body text is 220 characters, fixed at 44px, never shrinks.
- **Design:** the cover template is untouched. Slide kinds rotate (text, landing line, stat, split stat, quote, image slide), never the same kind twice in a row, and at least 3 kinds in a 6+ slide post. Photos on the cover and up to 3 slides. The follow slide uses the Helios sun-mark logo.
- **Quality over targets.** Tommy dislikes arbitrary numeric goals; limits exist only where the layout needs them.
- **Test broadly, not by re-running one story.** Every fix must be a general rule.

## Where things stand

Working: the Reporter keeps to the main story; the Fact-checker catches unsupported claims; the design with its rotating slide types and real photos; the sun-logo follow slide; the photo accuracy rules; the test runner (`npm run social:v2:test`, with `--from-brief`, `--render-preview`, `--articles`).

Open, as of the render-fix pass (post-2026-09-29 evening):
0. **Test the render-truth + past-statement + sequence checks on a live run** — planned as a Suleyman `--no-persist --render-preview` pass. Confirm the cover renders with an orange highlight, the last three slides aren't all text, and if the pipeline still writes "earlier writing on model welfare" it now bails with a `past_statement_reference` hard error instead of shipping it.

Open, as of the Google CC re-run from saved brief (runs/2026-09-29T03-38-05-457Z, $0.63):
1. Sources rarely hit the 6K per-source trim cap. Google run: 3/3 sources kept, all bodies at 4.0–4.7K chars, no trims applied. Trim helps when sources are longer.
2. **Test broadly**: run `--articles` on 5+ different stories and report cost, fact-check flags, and photos per story. One story per fix isn't enough evidence a rule generalizes.
3. **Per-stage cost table vs the California run** ($0.882 baseline) — kept up to date across new runs so cost cuts are visible as they land.
4. **Cover subject must be the main subject of THE NEWS, not the longest TERMS match, and no fallback to a related entity.** Current `buildPhotoRequests` sorts eligible TERMS longest-first and picks the first one in `brief.news`; that put "Google Labs" on the cover for the Google CC story instead of the actual main subject (CC itself, or Tom Shane if that's the human face of the news). Rewrite to identify the main subject of THE NEWS directly rather than by TERMS-substring match, and drop the "related entity" fallback so a story with no photographable main subject stays type-only.
5. Add `"not X, it's Y"` framing to `BANNED_ALWAYS`. The Writer's voice block bans it in prose, but there's no code check yet; a mirror of the `Unlike X, Y` regex added on 2026-09-29 pm.
6. **Editor scratchpad blow-up (max_tokens).** Initial Editor pass on the Google re-run emitted 45KB of chain-of-thought reasoning before writing COVER: and hit `max_tokens` twice (8K + 12K budget). Fix: instruct the Editor "write COVER: on the first line, reason after"; or add a stop-sequence at the end of EDIT NOTES; or both.
7. **Confirm Haiku is used only for the caption and length repairs** — not for fact-check reruns, not for Writer / Editor first passes, not for BIG-flag reruns. Audit `orchestrate.ts` call sites for `mode: 'repair'` and `HELIOS_V2_CAPTION_MODEL` to prove the boundary is respected.

Recent shipped:
- **Preview renders the FINAL post, not the initial editor pass (2026-09-29 pm).** Root cause of "cover lost its orange highlight" and "three text slides in a row before follow" on the Suleyman preview (runs/2026-09-29T06-45-36-973Z): `reconstructPost` in `render-preview.ts` was reading `debug.edited.post` (the initial editor output) whenever the pipeline bailed to human review, so previews rendered a stale post that disagreed with the FINAL post in the summary. Fix: added `debug.finalPost` + `debug.finalCaption` as the single canonical snapshot of what render sees, written at both the bail and the ship path. `reconstructPost` now prefers `debug.finalPost` → `debug.rounds[last].post` → `debug.edited.post`. Summary formatter (`formatPostWithLengths`) now also prints QUOTE / NOTE / NUMBER NOTE / SECOND NUMBER / SECOND NOTE / QUOTE BY and each slide's classified kind, so future summaries stop hiding the fields that made this bug invisible.
- **`past_statement_reference` HARD code check (2026-09-29 pm).** Any of "earlier writing/wrote/said/argued", "has long argued", "previously said", "in an earlier essay/post/statement" fails the run. Enforces the main-story-only rule already stated in the Writer + Editor prompts. Slide 11 of the Suleyman run ("...its earlier writing on model welfare...") would have been caught.
- **`sequence_incomplete` HARD code check (2026-09-29 pm).** Scans slide headlines / bodies / notes / quotes for `<ordinal> <noun>` patterns ("first objection", "second phase"). Flags missing beats and out-of-order sequences. Suleyman run shipped "first objection" on SLIDE 7 + "third objection" on SLIDE 9 with no "second objection" — a broken sequence the reader notices instantly. Deny-list on common false-positive nouns (time, place, half, quarter, party, etc.) so "for the first time" doesn't false-fire.
- 3 cost cuts built (2026-09-29 pm): shared cached [BRIEF+SOURCES] / [SLIDES+BRIEF] / [SOURCES+BRIEF] prefixes on Writer/Editor/Caption/Fact-checker; per-source trim capped at 6K chars (env `HELIOS_V2_MAX_SOURCE_CHARS`) and sources capped at 4 (env `HELIOS_V2_MAX_SOURCES`); Caption stage runs on Haiku 4.5 (env `HELIOS_V2_CAPTION_MODEL`), Editor CHECK ERRORS length-repairs run on Haiku 4.5 (env `HELIOS_V2_REPAIR_EDITOR_MODEL`).
- Code-built photo requests: `buildPhotoRequests(post, brief)` in image-step. Cover falls back to first person/org from TERMS that appears in THE NEWS; up to 3 story slides on photo-capable kinds, never two in a row, longer TERMS names win over shorter substrings. Writer's IMAGE subject is preferred when named. **(see Open #4 — this cover-subject heuristic needs a proper main-subject rewrite.)**
- "Unlike X, Y" framing added to `BANNED_ALWAYS`. Editor / Writer / Caption fix instructions now say "If a flag says a comparison or contrast isn't supported, cut it. Don't reword it."
- **Image step moved to run AFTER the fact-check + repair loop settles** (was before Caption). Photos now see the final, fully-repaired post; the fact-checker no longer sees "IMAGES CHOSEN:" (Wikidata P18/P180 is the identity authority, not the fact-check flag).
- **Post-PASS soft-repair loop** added: after fact-check passes, up to `MAX_SOFT_REPAIRS = 6` more Editor / Caption passes to clear any surviving `char_limit` / `highlight_substring` / `rhythm` errors. The 220-char body gate is not loosened.
- **`parseCaption` strips anything past the "Source:" line** (`stripAfterSourceLine`). Haiku sometimes emits internal deliberation past Source; that's now cut before code checks measure caption length.

Per-stage cost — Google re-run vs. California baseline:

| Stage | California (2026-09-29T02) | Google (2026-09-29T03-03, pre) | Google (2026-09-29T03-38, post) |
|---|---|---|---|
| Reporter | $0.226 | $0.161 | $0.161 (stubbed from cache) |
| Writer (initial) | $0.044 | $0.034 | $0.041 |
| Editor (initial) | $0.050 | $0.041 | $0.335 (2× max_tokens scratchpad) |
| Caption (initial) | $0.018 | $0.013 | $0.025 (Haiku, but 4.5K-char runaway) |
| Fact-checker | $0.000 | $0.077 (2 rounds) | $0.024 (1 round, PASS) |
| Repairs | $0.545 | $0.483 | $0.043 (Haiku CHECK ERRORS) |
| **Total** | **$0.882** | **$0.808** | **$0.627** |

Fact-check verdict flipped from FLAGGED-after-2-rounds → PASS-on-round-1. The "Unlike X, Y" ban prevented the Writer from re-inserting the fabrication that blocked the pre-fix run.

Cost cuts working: repair cost 87% lower ($0.043 vs $0.483), fact-check cost 68% lower (fewer rounds needed). Cost cuts NOT working on this run: Editor initial ballooned to $0.335 from the scratchpad blow-up; Caption on Haiku emitted 4.5K chars of internal deliberation past the SOURCE line (parseCaption doesn't strip it, so caption code-checks flagged it as too long). Need to firm up Haiku's caption output shape.

## Costs

About $0.70 per post now; target $0.25–0.35 after the cost cuts plus the Batch API. A daily top-10 at about $0.50 per post is about $110 a month. The $1.50 cap per post stays.

Soft-repair adds a small variable cost: each Editor / Caption pass in the post-PASS loop is Haiku (`REPAIR_EDITOR_MODEL`, `CAPTION_MODEL`), plus one targeted re-fact-check on Sonnet if any slide text changed. Track per run under `pipeline_v2_debug.softRepair.{runs, costUsd}` and `softRepair.reFactCheck.usage.approxCostUsd`; the summary writer should surface these so a run over the cap is easy to spot.

## Later

- The daily top-10 job: Jev ranks the stories, and the Batch API runs them at half price.
- Before merging to main: the guardrail, the poison-pill cron fix, the review-states migration, the spend cap.
- A manual photo picker in the review screen.
- The scraper prompt (rejecting thin stories).
