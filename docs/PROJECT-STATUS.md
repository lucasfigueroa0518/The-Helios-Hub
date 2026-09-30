# Helios Social: project status

Last updated 2026-09-29 (late evening, second pass). Read this first in any new session.

## What this is

Helios Social turns one AI news story into an Instagram carousel for smart, busy readers who don't follow AI closely. Owner: Tommy (Helios Group). Repo: The-Helios-Hub, branch `feature/helios-social-pipeline-v2` (unpushed). Production DB: Supabase project okslkogkokdwylmcsygz. Test runs use `--no-persist` — no prod DB writes, no Storage uploads, no `article_queue` mutations.

## Testing budget (2026-09-29 late)

- **Offline-only fixes.** Iterations that don't need a live model must run offline (unit tests, replay, image-step-only using cached photos). Assume every fix stays offline unless we're specifically proving a live model behavior.
- **$5 live cap until launch.** Agent-driven live spend accumulates against a $5 ceiling until Tommy calls launch. Any live run over that ceiling requires explicit in-the-moment approval from Tommy — the ~$1.50 per-post cap and Rule 1 in `CLAUDE.md` still apply.
- **Running spend tally** lives in `## Costs` below and is updated after any live run. Ingest bails (article body too thin) and cache-hit image steps count $0.

## Source-of-truth docs (in docs/)

- `HELIOS-PIPELINE-V2-HANDOFF.md`: writing pipeline, handoff formats, fact-check loop, all five prompts.
- `DESIGN-V1-HANDOFF.md`: slide types, type and color rules, the reference "target look" fixture.
- `IMAGES-V1-HANDOFF.md`: photo sourcing, including the accuracy rules.
- `design-inventory.md`: what the renderer contained before the redesign.

## Pipeline

Reporter (web search) → SINGLE STORY: yes gate → Reporter narrow-to-one retry if "no" → brief-integrity gate → Writer emits OUTLINE first → code validates OUTLINE (retry Writer once if bad) → Writer writes prose → enforceStructure → Editor → Caption → code checks → Fact-checker on FULL sources (rounds 1–2) → soft-repair loop → image step → render (via `debug.finalPost` + rebuilt `selectedImages` map). Anything unresolved goes to human review with the flags attached. Nothing posts without Tommy's review.

## Rules Tommy has set

The **canonical rules block** is `lib/social/editorial/v2/rules-block.ts`. All five stage prompts import it; a consistency test fails if any of them drifts. This section points to that block instead of restating it — when the rule changes, edit the block, not this doc.

The block covers:

- **Priority ladder** (five levels — resolves any conflict between the rules below).
- **Context policy** — one sourced clause anywhere, plus at most ONE "why now" or "what stands in the way" slide per post. Not the old "not even a passing clause" — the Fact-checker and Caption follow this same policy. TERMS explanations count as sourced.
- **Story slide count: 5 to 8** between cover and follow (was "5 to 10"; lowered so cover + story + follow fits inside Instagram's 10-item carousel cap).
- **Slide kinds** are a preference, not a quota. Kinds follow content — no padding to justify a different kind, no kind-lock after outline approval.
- **Photos (two tiers).** Real people/places/orgs go through Wikidata P18/P180. Concept slides may use licensed stock (Unsplash / Pexels) first, AI illustration as last resort (labelled). Photos are placed by the image step and only where the rendered text leaves room — the Writer never shortens copy to make room for an image.
- **Glossing is advisory,** not required. A term needs a gloss only when the slide doesn't make sense without it; long glosses move to the caption.

Other rules that stay outside the block (still Tommy's, but narrower):

- **Nothing the sources don't say.** No invented comparisons, framings, descriptors or quotes. "Unlike X, Y" and "not X, it's Y" are banned (voice-block.ts). TERMS gloss is the exception.
- **Quotes word for word** from a fetched source (trailing punctuation is ignored).
- **Body text is 220 characters,** fixed at 44px, never shrinks.
- **Cover template is untouched.** Follow slide uses the Helios sun-mark logo.
- **Quality over targets.** Limits exist only where the layout needs them.
- **Test broadly, not by re-running one story.** Every fix must be a general rule.

## Where things stand

Working: outline-before-prose (Writer emits an OUTLINE block first, code validates rhythm / kind / count on the OUTLINE alone, one Writer retry with outline errors if invalid); Reporter narrow-to-one retry on SINGLE STORY: No (bails only if second pass still can't isolate one event); fact-check verification uses FULL fetched text (prompt-input trimming is separate); brief-integrity comma / hyphen / trailing-punctuation normalization; `number_trace` matches dates as verifiable tokens ("September 16" checked against sources, not skipped); `checkQuotes` requires exact source punctuation (comma / dash equivalence lives in brief-integrity only, not on slide QUOTE lines); `past_statement_reference` limited to explicit-temporal cues (fact-checker handles reworded prior-work references); cover-subject picker prefers a named PERSON over an ORG regardless of position (companies won't produce logos / HQ / lobby photos on covers); ship-path + render-path photo guards; `debug.finalPost` + `debug.approvedOutline` snapshots; cover text never breaks mid-word.

**Photos: PROVEN via image-step-only run.** `runs/2026-09-29T16-40-07-763Z/image-step-only/slide-00.png` — Mustafa Suleyman cover photo (Q16847797, CC BY 2.0, ~$0.01 for one Haiku vision call), stored at the Supabase CDN, credit "Joi Ito from Cambridge, MA, USA, CC BY 2.0. Via Wikimedia Commons." generated correctly. End-to-end path is exercised; still pending a full live pipeline run that reaches the ship path with a placed cover photo.

## Open

1. **Live run.** Every fix in this branch is verified offline or by narrow live tests; no full live pipeline run yet has (a) reached the render step with the new checks passing, (b) shipped with a rendered cover photo. Next live run must clear both.
2. **Cover text overflow (not mid-word).** Word-break is fixed (whole-word wrap). But 108-char covers still overflow the arrow's fixed position and stretch to the bottom edge of the slide. Options: promote cover char_limit to HARD (currently soft), or add an `xxl` step below xl. Tommy's call.
3. **Broad test.** `--articles` on 5+ different stories with `--no-persist --render-preview`. Report per story: cost, fact-check flags, HARD checks that fired, whether a photo landed.
4. **Cover subject when only an ORG is in the first sentence.** Post-fix (2026-09-29 late) an org can still be picked when no person appears — Google Labs will win on "Google Labs announced CC". Wikidata may return a logo or HQ; those are visually bland. If Tommy wants stricter, we'd have to type-only when no person is available, which cuts photo coverage.
5. **The site run — dev DB vs one story on prod.** Tommy's call: local/dev DB seeded with a hand-picked run, or push a single passing story to prod `article_queue` behind `compose_status = 'needs_human_review'`.
6. **Writer main-story pruning inside a yes-verdict brief.** Even when SINGLE STORY: yes, the Writer sometimes still pulls context from other events in THE STORY. Consider flagging any month-day mention on a slide that doesn't match the news date.
7. **Audit Haiku boundary.** Confirm Haiku 4.5 runs only for the caption + length-only editor repairs.
8. **Cover face-clear check missed a headline overlap (2026-09-29 finalizer).** Gottheimer's cover shipped with the headline crossing his eyes and mouth — the pre-render face-zone check didn't flag it, so `object-fit: cover; object-position: center top` left the face inside the bottom-anchored headline's rectangle. Root cause is likely that the face-zone measurement doesn't intersect against the headline's actual laid-out bounding box (or trusts a face detector that missed a face in a busy background). Fix scope: measure the headline rect at render time and require the detected face to sit fully above it; if it can't, either shift `object-position` deterministically (finalizer used `center 78%`) or drop the cover photo.
9. **No-mid-word-break / overflow checks missed 2 Suleyman headlines (2026-09-29 finalizer).** S6's "ANTHROPOMORPHISING" broke mid-word and S7's "CONSCIOUSNESS" ran past the safe right edge, neither of which the pre-render checks caught. Likely the per-word-fits-at-current-size logic runs against the wrong font size bucket (headline sizes are picked from char count, but a single long word bigger than the current bucket width isn't demoted to a smaller bucket). Fix scope: after size bucket is chosen for a headline, remeasure every word at the picked font size; if any word alone exceeds the safe inner width, drop one bucket and re-check.

## Pre-merge (before this branch touches main)

- The guardrail (outer safety check that stops any run from writing to prod when `--no-persist` isn't set).
- The poison-pill cron fix (a single bad article shouldn't take down the daily job).
- The review-states migration (schema change to `article_queue` for the new review UI states).
- The per-day and per-post spend cap enforced at the DB level, not just in code.

## Recent shipped

- **Content-aware OUTLINE + kind lock (2026-09-29 late second pass).** OUTLINE lines now carry the actual short content for non-text kinds (landing HEADLINE + NOTE, verbatim quote + speaker, stat number + note). `validateOutline` rejects any kind whose content already busts a limit (a 97-char landing NOTE fails at OUTLINE time, not later after the Editor demotes to text and breaks rhythm — the Gottheimer regression). After OUTLINE approval, `outline_kind_mismatch` is HARD both in-round (Editor sees it as a CHECK ERROR and restores the kind) and at the final gate. Length errors on prose are fixed by cutting words, never by demoting the kind.
- **Cover subject scans ALL of THE NEWS.** Prior first-sentence-only cut broke on "U.S. Rep. Josh Gottheimer …" (the "U.S." period truncated the extracted first sentence and Gottheimer never entered the picker). No abbreviation list needed — THE NEWS is a one-line summary. Also strips parenthetical suffix ("Josh Gottheimer (D-NJ-5)" → "Josh Gottheimer") so the Wikidata resolver matches.
- **Story-slide photos: PEOPLE ONLY.** No orgs, no bills, no products. Prior code requested Wikidata pictures for "China FIREWALL Act". `buildPhotoRequests` filters story slides to TERMS persons; Writer's IMAGE line only wins when it also names a TERMS person.
- **`isPersonTerm` accepts country/agency-prefixed roles.** "U.S. Congressman", "British Prime Minister", "California Governor" — role appears within first 30 chars of description, and rejects "signed by/from/of a governor" so "Executive order" stays classified as a document.
- **Fact-checker prompt: TERMS gloss allowed.** A slide's gloss that matches its TERMS entry passes fact-check — TERMS is the reporter's plain-language explanation for readers. Flag only when the gloss exceeds TERMS or contradicts the sources. Reverts the Gottheimer BIG flag on the open-weight gloss.
- **Cover arrow position locked from design-v1 fixture** (`runs/design-v1-fixture-{no,with}-photos/preview/slide-00.png`). `.helios-cover__chevron` at `right: 96px; bottom: 60px; font-size: 60px`. `tests/social-v2-cover-arrow-lock.test.ts` fails if any of those coordinates or the position/color rules move. Cover template otherwise untouched.
- **Cover-fit unreachable-server FAILS loudly on live runs.** Only `opts.skip = true` (unit tests) is a silent bypass. Summary now says plainly "Cover-fit check: ran, ok" / "ran, FAILED — <reason>" / "skipped (env not set or pipeline bailed early)".
- **Cover char_limit HARD.** Covers over 90 chars block the run at the code-check gate — the Editor can't ship a cover that doesn't fit, no matter how many soft-repair passes the pipeline still has. `countCoverChars` is the canonical counter, used everywhere.
- **Outline-before-prose (2026-09-29 latest).** Writer prompt now opens with `OUTLINE:` (one line per story slide: `SLIDE N: <kind> — <beat>`, then blank, then COVER OPTIONS + slides + FOLLOW). Parser extracts the OUTLINE. `validateOutline` checks slide count, rhythm, variety, and valid kinds. On failure the Writer is re-called once with the OUTLINE errors as CHECK ERRORS — the prose is discarded until the OUTLINE clears. Once valid, `debug.approvedOutline = writerPost.outline`. `checkOutlineMatch` at the final gate compares final prose kinds against the approved OUTLINE.
- **Reporter narrow-to-one retry.** On SINGLE STORY: No, the Reporter is re-called with `narrow.previousBriefRaw` + `narrow.reason` and instructed to isolate one main event. Only if the second pass still can't narrow does the pipeline bail to human review. Removed `HELIOS_V2_ALLOW_MULTI_STORY`.
- **Dates matched, not skipped in `number_trace`.** "September 16" is now extracted as its own token and verified against sources — the Suleyman run's Writer-invented date would now fail. Comma-grouped thousands ("1,200") still preserved as one token.
- **`checkQuotes` exact-punctuation.** Dash equivalence removed from slide QUOTE matching. Comma / hyphen equivalence still lives in brief-integrity (STORY-time), not on slide-time QUOTE lines. If the essay writes "believes X - that Y" (spaced hyphens), the slide must too.
- **`past_statement_reference` reverted to the original 6 patterns.** The 3 experimental additions ("its public position is X", "public position is …", "its constitution says Y") false-positive on legitimate current-news content ("its public position on climate is X"). Semantic prior-work detection is the fact-checker's job.
- **Cover subject prefers named PERSON over ORG.** No writer-override, no longest-TERMS heuristic, no proper-noun fallback outside TERMS. If a person is named in the first sentence of THE NEWS, they win regardless of position. An org wins only when no person appears. Fixes the "Google Labs logo on the cover" risk.
- **`isPersonTerm` requires the description to LEAD with the role.** Fixed Newsom-run FALSE where TERM "Executive order" ("A directive signed by a governor or president…") was classified as a person.
- **`highlight_substring` check now scans BIG NUMBER + NUMBER NOTE + SECOND NUMBER + SECOND NOTE** as well as HEADLINE / BODY / QUOTE / NOTE. Fixes Suleyman-run FALSE on SLIDE 9 HIGHLIGHT="~1,200".
- **Cover text never breaks mid-word.** CSS `word-break: normal; overflow-wrap: normal; hyphens: none;` on `.helios-cover__headline`. Fixes "UNCONTROLLABL/E" split. Cover template otherwise untouched.
- **Ship-path photo guard.** Every placed image's storageUrl must appear on some `slide.photoUrl` after the adapter. If any placed image is lost, the run bails.
- **Verification checks use FULL fetched text.** Fact-checker LLM prompt, `bailToHumanReview` defensive re-check, `checkNumberTrace`, `checkQuotes`, `checkBriefIntegrity` — all see full sources. Trimming is only for stage-input prompts.
- **brief-integrity normalizeForMatch** strips trailing punctuation and treats comma-space as equivalent to spaced-hyphen. Fixes Suleyman "hall of mirrors." vs essay "hall of mirrors ".
- **Preview renders the FINAL post + attaches placed photos.** `debug.finalPost` + `debug.finalCaption`; `debug.imageStep.selected` persists `storageUrl` + `credit` + `isPortrait`; `reconstructPost` rebuilds the `Map<SlideKey, SelectedImage>`. Guards fail loud if photos disappear.
- **Editor + Writer scratchpad control.** Both prompts open with "Begin your response with COVER: / OUTLINE: on the first line — reasoning goes AFTER FOLLOW: in EDIT NOTES."
- **Editor rhythm-repair rule.** Editor prompt forbids reordering slides for rhythm — must change kind or merge.
- **Writer + Editor copy-quality tightening.** Argument sentences must stay attributed; no invented editorial adjectives; truncated quotes use `...` not a period; glosses only from TERMS.
- **From-brief cost display split.** Summary + CLI show "$X live + $Y stubbed = $total".

## Costs

**Monthly target: ~$20–40** (Tommy, 2026-09-29 late). Daily job produces 1–2 finished posts, not a top-10 batch, so per-day spend runs $0.60–$1.50 and the monthly total lands well under $50 at 30 posts/month. The $1.50 per-post cap and the ~$1.50 autonomous-work ceiling (CLAUDE.md Rule 1) stay unchanged. Per-run expected cost is $0.60–$0.85 today (Writer + Editor + fact-checker + optional field repairs); tighter prompts and cache hits should pull that to $0.40–$0.60 without a Batch API.

**Batch API is optional, not planned.** At 1–2 posts/day the batch discount (~50%) doesn't matter and the extra latency (up to 24h) hurts editorial control. Revisit only if the daily volume grows beyond ~5 posts/day.

**Live spend tally (2026-09-29):** $8.18 today across all runs. Agent-driven since $5 cap reset: **$0.65 / $5.00** (Gottheimer live run 18-49-26 = $0.6509; image-step-only reruns = $0.00 cache hits). Remaining under cap: **$4.35**.

## Later

- **Story selection (moved up 2026-09-29 late — priority above the Batch API):** Jev ranks candidate stories daily; thin-story rejection at ingest so the pipeline never spends a Writer call on a story it can't support. The 1–2/day cadence makes selection quality the biggest lever on both cost and copy quality.
- **Grading pass:** generate 3–4 candidate stories / drafts per day, auto-grade them, surface the top 1–2 for review. Observe a few days, then tune. Complements story selection: catches drafts that came out weak even when the story was viable.
- **The daily top-10 job (deferred):** was "Jev ranks the stories, and the Batch API runs them at half price." Not planned now; kept as an option for higher-volume days.
- Keep the one-off 5-story test batch for regression checks after prompt / rule changes.
- A manual photo picker in the review screen.
- The scraper prompt (rejecting thin stories at ingestion).

## Next step

Live single-story run to prove the branch, using article `43a705f5` (Google Gemini Live Avatar) or another product release with an official announcement page. Confirm end-to-end: OUTLINE clears validation, SINGLE STORY: yes, fact-checker sees full sources, a cover photo lands, the FINAL preview renders with the photo + credit line. Wait for Tommy's cost-estimate go-ahead before running.
