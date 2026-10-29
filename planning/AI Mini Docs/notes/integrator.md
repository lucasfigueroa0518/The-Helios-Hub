# Integrator notes

## To settle in Phase 2
- [done] jev_logs.question_set_version is text (QuestionSet.version is a string) — schema changed.
- B5 live.ts: newsTouching must read the shared stories DB, not the explainers DB.
- B1 pickCells: reserve one slot per session for a news-reopened cell (Lucas wants news to reopen cells; the strict order starves it).
- Weekly cap: B1 rolling 7 days vs B5 Monday-NY week — pick one (Monday-NY week, matching the schedule).
- Near-miss calibration fixtures are thin (one-liners) — flesh out to producer quality before live calibration so the test is fair.
- B5: a kill on a click-triggered job should not auto-queue the next pitch; a capped/failed pitch returns to the pool once, then needs a click.
- B5 questions for B4: rewriting project files after voice (timing), caption transcript location; for B3: fix-findings file, deps shape.
- B2: `visuals-look` split → B1 keeps `visuals-look` (submit_look), B2 renames its call to `harvest-look` (submit_looks); B3 told to write both. B2 must rename its loadPrompt call at integration.
- Ask Lucas: install yt-dlp (video frames), an upscaler (Real-ESRGAN, MD-16) and poppler (pdftoppm for PDFs)? Downloads need his OK.
- Not built in harvest: Flickr, GDELT, Wayback, satellite, SEC/court filings — fine for v1; list for Lucas.
- [done] types.ts founding_moment label no longer echoes calibration stories (B3 Q2).
- B5 live.ts: pass jobDir to checkIntegrity (B3 Q1).
- B3 Q3 (refusal fallbacks): not needed for v1.
