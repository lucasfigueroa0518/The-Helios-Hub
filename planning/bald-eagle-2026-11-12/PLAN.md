# Bald-Eagle iteration — 2026-11-12

Living plan. Decisions land here with Tommy's words quoted; nothing is built until the build stage.

## Qualms (Tommy, verbatim)
1. "why did Guess the Number not work?"
2. "photo selection for the morning download is repetitive. It should be grabbing images from the photo bank."
   "How did the morning download not talk about the NVIDIA ceo controversy? That is clearly the biggest story out right now."
3. "I want to have generations and runs be a couple of days ahead."
   Fig: "If I were to approve this thing it goes out today. We need cushion. It either should've been generated yesterday (batched) or it should be scheduled for 2 days from now."

## Map (in the order the work flows)
| Part | Qualm | What the data shows |
|---|---|---|
| Night clock (every type) | 3 | Every night run fills *that same* New York day (`docs/social-overnight.md` §Daily fill). The approval window is the hours between the run and the posting slot. |
| Intake / pool | 2 (NVIDIA) | MD drops anything that ran in the last 3 days. NVIDIA led MD on Nov 9; Nov 10 failed (TypeSafe 402); Nov 11 had no NVIDIA item; Nov 12 only a side angle ("short seller flagged…") scored 0.699 → 7th, below the 5-story cut. |
| MD ranking | 2 (NVIDIA) | Absolute per-story score, no "biggest story today" comparison. Nov 12 = 2 Anthropic IPO + 2 OpenAI. |
| MD photos | 2 (photos) | Bank is on (`finder_source = compete`, 1,749 photos) but online Wikimedia still wins. Opener used the same "Newspaper Stack" photo on 6 of 8 days; Dario/Sundar repeat; ~40% of story frames have no photo. |
| GTN pick → read source → gates | 1 | 4 of the last 7 GTN days skipped (nothing broke). Causes: (a) the gate's `want_to_guess` floor 0.6 vs. scores 0.38–0.57; (b) "unreadable" pages — Google News wrapper links that resolve to paywalled/blocked pages; a model idea reused another candidate's link; (c) after 3 misses the day is skipped, no second try. |

## Findings, round 2
- **NVIDIA root cause:** the intake had it as the day's biggest story: one story with 77 articles before the 3 AM Nov 12 run, plus a dozen satellite stories (successor search, FBI probe, senators). The intake keeps adding new developments to the *same* story, so MD's "ran in the last 3 days" rule (it led on Nov 9) hid the whole developing story. Only a satellite angle got through, and it ranked 7th. Coverage volume is not a ranking input.
- **Readable sources:** Carousels' Reporter opens several starting sources plus independent coverage, retries a failed fetch once, then skips it. Text on Screen's ingest flags paywalled pages (`lib/reels/net/html.ts` PAYWALL_MARKERS). GTN reads only the one link the picker cited, and one failure kills the candidate, even though the intake holds many links per story.

## Decisions
- **D1 GTN bar:** `want_to_guess` floor 0.6 → **0.47**. Tommy: "lets ease that rule to .47."
- **D2 Developing stories:** a story already shown comes back when there is a major development. Tommy: "a major development (in this case, a second affair and his resignation) is absolutely a must-report."
- **D3 Photo repeats:** Tommy: "repeats, especially given the size of our bank and ability to find more, should never be used in the same week span." → no photo reused within 7 days, across every content type (Tommy: "Like 2"). Check lives in the shared photo finder.
- **D4 Lead time:** Tommy: "For evergreen content, we will have a 2-day cushion; for time-sensitive content like morning download, that will be generated the day of." Tommy: "Even LFD and ToS can have the cushion theoretically." Then: "LFD should be the day of." → 2-day cushion: AI Drama, Explainers, Field Notes, Free vs. Paid, Guess the Number, Text on Screen. Same-day: Morning Download, Last Few Days. AI Events is already a week ahead. (News Carousels: open question.)
- **D5 Developments compete, no guaranteed slot.** Tommy: "it should still compete, but I feel like, in this case, there would be no reason why NVIDIA's development wouldn't dominate the scoring. My overall fear is that we report on stories and completely miss the big scoop."
  - Coverage check before the Nov 12 run (articles / distinct outlets / new outlets in the last 24h): Anthropic IPO 146/69/15; NVIDIA main story 77/22/9 (plus about a dozen spin-off stories of 1–5 each); Gemini on CarPlay 18/18/18 (looks like counting noise). **Raw coverage would NOT have put NVIDIA first.** The collector's counts follow what it searches for, which leans toward Anthropic.
- **D6 Side-by-side final ranking.** Tommy: "Yes, 1". After the per-story scores, one call ranks the top ~10 against each other ("which would an informed reader be most annoyed to have missed today?").
- **D7 Approved, "Yes, move on":** the outlet signal and the GTN readable-source fix below. Alignment closed; next is inventory and the new process.
- **Outlet signal (approved):** no new searching. The collector already reads the big outlets' whole tech sections directly (Reuters, Bloomberg, WSJ, NYT, Guardian, NBC, …); those feeds don't depend on our search terms. Signal = how many of those outlets carry the story, with its spin-offs folded in. One ranking input. Look into the CarPlay 18-outlet noise during the build.
- **GTN readable sources (approved):** for a pool candidate, try its link, then the other links in the same intake story (publisher links first, Google News wrappers last, skipping pages flagged paywalled by the Text on Screen detector), and run the gate on the first page that contains the number. For the model's own ideas, the picker must cite a page it actually opened that isn't a Google News link, and no two candidates may share a link. The extra fetches cost nothing (no model calls).

## Findings, round 3 (code trace)
- **Lead time:** no lead-days setting exists. Every night run takes "today" (the run date) and uses it for the quota, the "already ran today" check, spend caps and booking. Booking helpers have only an end date (`throughDate`), never a start date. Approving books today first. The quota subtracts only what people placed. An unbooked item shows on the board under the day it was made. Text on Screen has the most same-day assumptions (slate per day, "windows still open today", Regenerate only today's video, carryover by slate date).
- **Photo repeats, real cause:** the shared photo log (`social.used_photos`, 20 days) records a photo only once its post is **published**. Stories hasn't published a live set yet, so nothing it picks is ever held, which is why the same "Newspaper Stack" keeps winning. Photos picked for built-but-unposted items are not held by any type (Field Notes' rest rule is the one exception). With a 2-day cushion this gets worse: two nights' items could share a photo.
- **MD repeat block:** `build/morning-download.ts` drops an intake story if *any* member article's key was shown in the last 3 days. Every new NVIDIA article joins the same intake story, so the whole story stays blocked.
- **MD ranking (intake mode):** uses the intake's stored per-story major/builder scores, a lead queue by margin, at most 2 builder stories. Stories are never compared with each other.

## Inventory
**Stays:** intake collector and its stored scores; the major-news score; same-event merge; the headline writer and grounding check; MD 2–5 stories; the 20-day published-photo log (it already meets "never within a week"); the GTN pick call and its gates (other than the floor); the photo finder and the bank; approval before posting; per-type spend caps (still counted by run day).

**Goes:**
- MD's "any member shown in 3 days → whole story blocked" rule.
- GTN's single-link reading (one failure kills the candidate).
- The assumption in the 6 cushion types that the day a post is made is the day it posts.

**New:**
1. **Lead days per type** (one shared setting/helper): 2 for AI Drama, Explainers, Field Notes, Free vs. Paid, Guess the Number, Text on Screen; 0 for Morning Download, Last Few Days, Carousels. Each night run fills *target day = run day + lead*. Booking gets a start date; approving books the item's own target day; the quota subtracts every booking already on the target day; the board shows an unbooked item on its target day.
2. **Photo hold covers unposted picks:** held = published in the last 20 days **plus** every photo chosen by a ready/approved/scheduled item of any type. One shared reader used by every finder.
3. **MD development test:** a story we already ran is blocked unless articles arrived after we posted it and a yes/no check says they report a new event. If they do, the writer is told what we already said and to lead with what's new. Spin-off intake stories tied to a story we ran go through the same test.
4. **MD outlet signal:** count of the big direct-feed outlets carrying the story, spin-offs folded in. One input to the ranking. Fix the outlet-count noise first.
5. **MD side-by-side final ranking:** one call orders the top ~10 by "which would an informed reader be most annoyed to have missed today?"; the 2–5 story cut is taken from that order.
6. **GTN:** floor 0.47; source fallback through the intake story's other links (publisher first, Google News last, paywalled skipped); the model's ideas must cite a page they opened, not a Google News link; no shared links.

## New process
### Night run for a cushion type (AI Drama, Explainers, Field Notes, FvP, GTN, Text on Screen)
| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Pick target day | run day, the type's lead days | target = run day + 2 (Field Notes: the next Field Notes day ≥ that) | target day |
| Quota | calendar slots on target day, every booking already there | how many to make (never over-make) | count |
| Make | the type's normal pipeline; freshness windows measured from the run day, not the target day | the posts | items stamped with target day |
| Book | open slots on target day only | publish time on the target day | scheduled item, waiting for approval |
| Approve (person) | item | yes/no; approval keeps its target-day slot | approved item |
| Publish | due slot, approved | post; log photos | published |
Spend caps stay counted by the run day.

### Morning Download (same day, 3 AM → 8:30 AM)
| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Pool | intake stories (fresh), the MD history (headline + time we posted) | candidates; a story we ran stays out unless step 2 lets it back | candidates |
| Development test | new articles since we posted + our old headline | let a story back in only for a new event | candidates, with "what we already said" attached |
| Merge | pairs sharing a name | one event = one story; spin-offs fold into their parent | merged candidates |
| Score | stored major/builder scores + outlet signal | per-story score | scored list |
| Final rank | top ~10 side by side | order by "most annoyed to miss" | ordered list → take 2–5 |
| Write + ground | chosen stories (+ what we already said) | headlines; returning stories lead with the new development | frames |
| Photos | bank + finder; hold = published in 20 days + unposted picks | no repeats | set ready for review |

### Guess the Number (now 2 days ahead)
| Step | Reads | Responsible for | Hands on |
|---|---|---|---|
| Pick | pool (links per intake story), recent GTN topics | 3 ranked candidates; the model's own ideas cite a page they opened, not Google News; no shared links | candidates |
| Read source | candidate link, then the intake story's other links (publisher first, paywalled skipped) | the first readable page that contains the number | page |
| Gates | page | verifiable ≥ 0.7, want-to-guess ≥ **0.47**, new-said-new, same-subject | winner or skip |
| Photos | same shared hold | no repeats | set |

## Decisions, round 4
- **D8 Cutover:** Tommy: "yes" → one catch-up night that makes both day+1 and day+2 for the six cushion types (one-time, about one extra night's spend).
- **D9 Photo bank first:** Tommy: "yes" → `media_library.settings.finder_source` = `first` (all types; web search only when the bank has nothing that fits).
- **GTN floor replay at 0.47** (the 4 skipped days): Oct 22 still skips (0.46, 0.44, plus one unreadable); Nov 2 passes (0.53, Terra error rate); Nov 9 passes on rank 3 (0.50, ActivTrak workday; Palantir/NHS 0.46 just misses); Nov 12 still skips (two unreadable, one failed "verifiable" at 0.01, so only the source fix can help). 0.47 saves 2 of 4 days; 0.44 would save 3 of 4.
- **D10 GTN bar + second try:** Tommy: "make it .45 with second try" → `want_to_guess` floor **0.45** (supersedes D1's 0.47). If all 3 candidates fail, one more pick round, told why each failed, before skipping (about $0.10–0.20, only on days that would otherwise skip).
- **D11 Unapproved Morning Download sets** (second review, 2026-11-14): a set that was built but never approved or posted is not "said" (followers never saw it), so its stories compete again the next day; the intake's 24-hour freshness keeps them from winning for days. A set that posted or was approved is "said" and its stories return only through the development test. Tommy: "I like the recommendation do it". A failed "what we said" read fails the set (it never treats everything as new).
