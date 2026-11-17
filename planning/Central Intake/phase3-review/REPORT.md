# Phase 3 (shared photo finder): morning report, 2026-11-10

## 0. Urgent, not Phase 3: Jev (TypeSafe) is out of credits
Tonight's intake main run (05:00 UTC, midnight NY) failed after 9 seconds with
`402 Your organization has no available TypeSafe API credits`. It fetched sources but couldn't score or group them.

- **Who it affects:** every Jev call, on intake paths and legacy paths alike. That covers the Reels screen and
  scores, carousel story-scoring, major-news, builder, Field Notes scoring, and the photo-fit checks.
- **Why types won't error out:** the last good intake run (00:38–00:52 UTC) is inside the 26-hour freshness window,
  so tonight's types read that pool instead of failing. They get no new scoring.
- **What you need to do:** add credits or set up auto-reload at console.typesafe.ai. I can't do billing.

Then check `intake.runs` and each type's run this morning.

## 1. What was built (local only: branch `feat/photo-finder-phase3`, not pushed, nothing deployed or migrated)
- **`lib/photos/`**, one finder for every news type, built on AI Drama's harvest engine:
  - `types.ts`, `profiles.ts` (per-type floors and logo rules), `switch.ts`, `needs.ts` (each type's request as one
    shape), `find.ts`, `live.ts`.
  - The engine stays in `lib/reel-ai-drama/harvest/` (CI-31).
- **Adopters,** each behind its own switch with today's finder as the default: LFD (every slide), MD, GTN, FvP,
  Carousels, and their revisions.
  - In shared mode a frame tries the shared finder first. If it finds nothing usable, runs out of cap, or errors, the
    frame goes to today's finder unchanged.
  - LFD keeps its rendered-slide vision check. Field Notes is out (team photos). Text-on-Screen is out: it has no
    photo finder (CI-31).
- **Switch:** `intake.settings` key `photo_finders`, for example `{"md":"shared"}`. A missing key means today's
  finder. No migration is needed.
- **Caps:**
  - $0.30 per post, split across frames as left ÷ frames left. Serper is held to 40% of each frame's share.
  - A frame with under $0.02 left goes straight to today's finder.
  - Revisions spend at most their approved fix cap.
- **Comparison tool:** `scripts/photos/compare.ts`. It reads prod read-only and makes no calls without `--go`.

## 2. Checks
- **Tests:**
  - The full offline suite before the review fixes: 5,572 of 5,577 pass. The 3 failures were already there before
    Phase 3 (HEIC, text engine, workspace).
  - After the fixes, the touched areas (social, revisions, stories, lfd, photos and the harvest tests): 1,678 of
    1,678 pass.
  - After the place-photo rule, the Phase 3 files: 50 of 50 pass.
  - tsc is clean.
- **Fresh review:**
  - 1 must-fix: revisions could spend $0.30 against a $0.15 cap. Fixed.
  - 4 should-fixes, all fixed: the soft cap and Serper, GTN/FvP per-frame splitting, carousel rules moved into the
    find, and a cost-vendor label.
  - Nits are listed at the end of this report.

## 3. Live side-by-side ($2.64 of your $3; nothing published, nothing written to prod)
"Old" = the photo the post actually shipped with. "New" = the shared finder.

| Run | Types | Spend | Page |
|---|---|---|---|
| 1 | LFD ×2, MD ×2, GTN, FvP, Carousel ×2 (43 frames) | $1.77 | `run1-all-types.html` |
| 2 | MD ×2, GTN, after the review fixes | $0.52 | `run2-md-gtn-after-fix.html` |
| 3 | MD ×2, after the place-photo rule (final rules) | $0.35 | `run3-md-final-rules.html` (= `index.html`) |

- **Fill and cost:** the shared finder filled 42 of 43 frames in run 1. Cost per post was $0.07–0.30.
- **One defect, fixed in code:** run 1 showed a single banked building or lobby photo per company filling every
  frame about that company, even frames asking for a product, a dashboard or a moment. The same DSIT lobby photo
  appeared on about 8 frames across 5 posts.
  - The rule now: a building or place photo fills a frame only when the writer asked for a place (CI-31).
  - Run 3 shows the effect on MD. For example, the Anthropic frame now carries The Verge's own screenshot of the
    feature.
- **Not rerun under the final rules:** LFD, Carousels and FvP. The budget ran out. Eight of their run-1 frames (LFD
  3, Carousels 5) used building photos and would now go to today's finder.
- **Judging the photos is yours.** The pages show old and new side by side with each frame's copy and trace.
  Objectively odd picks to look at:
  - MD 11-09 "Goldman Sachs" → an 1800s halftone of Samuel Sachs.
  - GTN "GPT-3" → a Hebrew-captioned tool screenshot.

## 4. Your calls
1. **Which switch to flip first?** My recommendation: MD. Its shipped photos are often generic stand-ins (a stack of
   newspapers or a datacenter for an Anthropic story), and run 3 is the cleanest result. Flipping one is a single
   UPDATE on `intake.settings` after the deploy.
2. **Carousels' C6 credit check vs "editorial, credited":** carousels still reject agency and outlet-credited photos
   (C6, and the harvest's own `AGENCY_CREDIT` filter). Shared picks that fail it fall back to today's finder.
   - Keep C6 as it is? (my recommendation, it's Tommy's legal guard)
   - Or let credited editorial photos through on carousels?
3. **The 7-day no-repeat photo log has been empty since Oct 26.** `social.used_photos` has had no writes from
   LFD, Stories or Carousels. So nothing stops the same photo from repeating across days today, with either finder.
   This is a separate prod fix.

## 5. Shipping, after your review
Merge → Vercel → social VM deploy (hash the VM first). Then set `photo_finders` per type. No schema change.

## Nits left (from the review)
- Fallback dedupe is by URL only: today's finder could pick a CDN size variant of a shared pick.
- LFD's shared hits are recorded as `photoSource: 'harvest'`; the trace prefix `shared:` tells them apart.
- Stories needs carry the frame copy, not the story text, into the pitch.
- A shared carousel slide has no runner-ups: if its image fails to load at render, the slide gets its icon.
