# Helios Social: project status

Last updated 2026-09-29 (evening). Read this first in any new session.

## What this is

Helios Social turns one AI news story into an Instagram carousel for smart, busy readers who don't follow AI closely. Owner: Tommy (Helios Group). Repo: The-Helios-Hub, branch `feature/helios-social-pipeline-v2` (unpushed). Production DB: Supabase project okslkogkokdwylmcsygz. Test runs use `--no-persist` — no prod DB writes, no Storage uploads, no `article_queue` mutations.

## Source-of-truth docs (in docs/)

- `HELIOS-PIPELINE-V2-HANDOFF.md`: writing pipeline, handoff formats, fact-check loop, all five prompts.
- `DESIGN-V1-HANDOFF.md`: slide types, type and color rules, the reference "target look" fixture.
- `IMAGES-V1-HANDOFF.md`: photo sourcing, including the accuracy rules.
- `design-inventory.md`: what the renderer contained before the redesign.

## Pipeline

Reporter (web search) → brief-integrity gate → Writer → Editor → Caption → code checks → Fact-checker (flags only, 2 rounds max) → soft-repair loop → image step → render. Anything unresolved goes to human review with the flags attached. Nothing posts without Tommy's review.

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

Working: the Reporter, when it returns a substantive brief, keeps to the main story; the Fact-checker catches unsupported claims and paraphrase attributions; the code checks (rhythm, char limits, quote verbatim, number trace, term explained, past-statement, sequence-integrity) all fire on the FINAL post; the design with its rotating slide types; the sun-logo follow slide; the test runner (`npm run social:v2:test`, with `--from-brief`, `--render-preview`, `--articles`, `--no-persist`); source trimming (each source's paragraphs scored by keyword overlap with THE NEWS / THE STORY / TERMS, kept in original order up to the per-source cap — so a mid-essay quote survives).

**Photos: UNPROVEN.** No run has actually placed a photo on a shipped slide yet. The Wikidata P18 / Commons P180 lookup + license filter + KIND-only vision check are all coded; the Suleyman `--from-brief` re-run failed photo verification on the one photo request it made ("Anthropic" on a quote slide, rejected because QUOTE BY didn't name Anthropic). Whether the accuracy rules and credit rendering actually work end-to-end will not be known until a run gets past hard code checks and a cover-slide photo lands.

## Open

1. **Writer keeps inventing numbers.** Run 2026-09-29T16-40-07 (Suleyman `--from-brief`) shipped "200" as a BIG NUMBER and "16" in a body — neither appears in any fetched source. `number_trace` caught them both, but the Writer produced them from thin air on the first pass; the Editor didn't cut them; two repair rounds didn't fix them. Root cause is upstream of the checker. Options: forbid the Writer from writing any digit not already present in the brief; add a Writer-side number-source guard; or feed number_trace hits back into the Editor's CHECK ERRORS with the specific number named. Pick one.
2. **Rhythm still fails on the FINAL post.** Same run: SLIDE 4+5, 5+6, 10+11 all text, three separate rhythm hard errors surviving to the final gate. The Editor was told to fix rhythm and couldn't within the retry budget. Either the Editor prompt needs a rhythm-specific repair recipe ("convert the middle text slide to a landing line or a quote from an existing source line"), or the Writer needs to draft with rhythm awareness so the Editor isn't fixing structural gaps after the fact.
3. **Live Reporter bails on "thin brief".** The fresh Reporter run for Suleyman (run 2026-09-29T16-36-21) returned a brief the integrity gate cut 3 quotes from, leaving the Writer with too little substance and no slides. This means live runs on some stories will now fail before the Writer even tries. Either loosen the integrity gate (risky), have the Reporter re-fetch when its brief is thin, or add a Reporter-side check that its brief has enough sourced quotes before it hands off.
4. **Photos unproven** (see above). Need one run that reaches render with a valid cover-slide photo request, verified against Wikidata P18 and rendered with the correct credit line, before we can claim the images pipeline works.
5. **The site run — dev DB vs one story on prod.** Tommy's call: do we point the site at a local/dev DB seeded with a hand-picked run, or push a single passing story to prod `article_queue` behind `compose_status = 'needs_human_review'` and view it in the real review UI? Blocker for the review-screen UX work.
6. **Cover subject must be the main subject of THE NEWS, not the longest TERMS match.** `buildPhotoRequests` still sorts eligible TERMS longest-first and picks whichever appears in `brief.news`. Rewrite to identify the main subject directly and drop the "related entity" fallback — a story with no photographable main subject stays type-only.
7. **Broad test — 5+ different stories** with `--no-persist --render-preview` to see which failures are systemic (Writer number-invention, thin-brief bail, rhythm-on-final) vs Suleyman-specific.
8. **Editor scratchpad blow-up (max_tokens).** Google re-run's initial Editor pass emitted 45KB of chain-of-thought before writing `COVER:`. Fix: "write COVER: on the first line, reason after", or a stop-sequence after EDIT NOTES.
9. **Audit Haiku boundary.** Confirm Haiku 4.5 runs only for the caption + length-only editor repairs, not for Writer / Editor first passes, fact-check reruns, or BIG-flag reruns.

## Pre-merge (before this branch touches main)

- The guardrail (the outer safety check that stops a run from writing to prod when `--no-persist` isn't set).
- The poison-pill cron fix (a single bad article shouldn't take down the whole daily job).
- The review-states migration (schema change to `article_queue` for the new review UI states).
- The per-day and per-post spend cap enforced at the DB level, not just in code.

## Recent shipped

- **Preview renders the FINAL post, not the initial editor pass** (2026-09-29 pm). `reconstructPost` in `render-preview.ts` was reading `debug.edited.post` when the pipeline bailed to human review, so previews rendered a stale post that disagreed with the FINAL summary — the root cause of "cover lost its orange highlight" and "three text slides in a row before follow" on the Suleyman preview. Added `debug.finalPost` + `debug.finalCaption` as the single canonical snapshot, written at both bail and ship. Reconstruction prefers `finalPost` → `rounds[last].post` → `edited.post`. Summary formatter now prints QUOTE / NOTE / NUMBER NOTE / SECOND NUMBER / SECOND NOTE / QUOTE BY and each slide's classified kind, so this class of bug can't hide again.
- **`past_statement_reference` HARD code check.** Catches "earlier writing/wrote/said/argued/warned", "has long argued", "previously said", "in an earlier essay/post/statement", "long-standing position/stance". Confirmed removed the Suleyman "earlier writing on model welfare" clause on the re-run.
- **`sequence_incomplete` HARD code check.** Scans slides for `<ordinal> <noun>` patterns (first / second / third + noun). Flags missing beats and out-of-order sequences. Deny-list on common non-sequence nouns (time, place, half, quarter, party, floor, grade, class) prevents "for the first time in a decade" false-firing.
- **Relevance-based source trimming.** Each source's paragraphs scored by keyword overlap with THE NEWS + THE STORY + TERMS; kept in original order up to the per-source cap (default 12K chars, env `HELIOS_V2_MAX_SOURCE_CHARS`). A quoted phrase in paragraph 40 of a 50-paragraph essay now survives.
- **Cost cuts.** Shared cached prefixes on Writer / Editor / Caption / Fact-checker. Caption + Editor length-only repairs on Haiku 4.5 (env `HELIOS_V2_CAPTION_MODEL`, `HELIOS_V2_REPAIR_EDITOR_MODEL`).
- **Image step moved to run AFTER the fact-check + repair loop settles.** Photos see the final, fully-repaired post; the fact-checker no longer sees `IMAGES CHOSEN:`.
- **Post-PASS soft-repair loop** (up to 6 Editor / Caption passes to clear surviving `char_limit` / `highlight_substring` / `rhythm` errors after fact-check PASS). 220-char body gate not loosened.
- **`parseCaption` strips anything past "Source:"** so Haiku post-Source deliberation stops inflating caption code-checks.
- **`"Unlike X, Y"` and `"not X, it's Y"` invented-contrast framings added to `BANNED_ALWAYS`.**
- **Editor / Writer / Caption fix instructions**: "If a flag says a comparison or contrast isn't supported, cut it. Don't reword it."

## Costs

Roughly $0.60–$0.65 per run right now — Suleyman `--from-brief` on 2026-09-29T16-40-07 cost $0.6481, fresh Reporter Suleyman on 2026-09-29T16-36-21 cost $0.5883. Target still $0.25–0.35 after the cost cuts plus the Batch API. `$1.50` cap per post stays. Soft-repair adds a small variable cost tracked in `pipeline_v2_debug.softRepair.{runs, costUsd}` and `softRepair.reFactCheck.usage.approxCostUsd`.

## Later

- The daily top-10 job: Jev ranks the stories, and the Batch API runs them at half price.
- A manual photo picker in the review screen.
- The scraper prompt (rejecting thin stories at ingestion, before they reach the pipeline).

## Next step

Fix the Writer's number invention (Open #1). It's the most concrete failure blocking a shipped run: Suleyman `--from-brief` failed on "200" and "16" that no source contains, and `number_trace` catching them at the gate isn't enough because two repair rounds still didn't remove them. Trace where the Writer got those digits (prompt? memory? source paraphrase?) and either (a) forbid the Writer from emitting any digit not present in the brief's source texts, or (b) feed each `number_trace` hit back into the Editor's CHECK ERRORS with the specific missing digit named so the Editor knows exactly what to cut. Then re-run Suleyman `--from-brief --render-preview --no-persist` and confirm number_trace stays empty on the FINAL post.
