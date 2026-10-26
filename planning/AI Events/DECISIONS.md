# AI Events This Week: decisions

The register for the weekly AI networking events carousel, its ranked idea pool, the networking ingest v2 behind it, and the public calendar on heliosgroup.ai. The plan is `/Users/lucasfigueroa/.claude/plans/curried-sauteeing-truffle.md` (approved 2026-10-21). Every row was Lucas's call unless marked otherwise.

| ID | Decision | Date |
|---|---|---|
| AE-01 | The series is called **AI Events This Week**. Vertical id `ai_events`, schema `ai_events`, hub page `/ai-events`. `/events` stays the internal networking calendar. | 2026-10-21 |
| AE-02 | Cities, in this order everywhere: **Miami, Boston, NYC (30 mi), SF Bay Area (45 mi, San Jose included)**. NYC and SF are public only: the internal `/events` view stays Boston and Miami (`INTERNAL_METROS`). *Posts: superseded by AE-29 (Miami and Boston only; all four stay on the site and are ranked).* | 2026-10-21 |
| AE-03 | Each city slide shows the top **3** events. A city with nothing above the bar is skipped, and the cover lists only the cities that have picks. *Superseded by AE-28 and AE-29.* | 2026-10-21 |
| AE-04 | A ranked weekly pool with **pin / exclude** on every event. If no one touches it, Jev's picks go. "Rebuild post" re-renders after a change. | 2026-10-21 |
| AE-05 | **Rule 2 carve-out.** Each week's newly ingested events are scored once per question-set version and never re-swept. The ranking runs on its schedule without a click. | 2026-10-21 |
| AE-06 | Detail fetches (Luma `event/get`, Meetup event pages) cover kept events in the next ~10 days. They run once a week, at most 3 at a time. | 2026-10-21 |
| AE-07 | **Eventbrite is dropped** from the ingest for now, because the VM's IP is blocked. Bevy is fixed with a `latitude`/`longitude` search, and the conferences source is fixed. | 2026-10-21 |
| AE-08 | Timing, all ET: the ingest refreshes **Sunday 9:00 AM**, ranking and render run at **12:00 PM**, a person approves in the afternoon, and the post goes out **6:00–7:00 PM**. *Post time: AE-29 (Miami 6:00–7:00 PM, Boston 7:00–8:00 PM).* | 2026-10-21 |
| AE-09 | Carousel eligibility is wide open. Sold-out events with a waitlist, paid events at any price, and multi-day conferences can all be picked. A sold-out event is labelled "Waitlist". | 2026-10-21 |
| AE-10 | The website calendar shows **all** events in the tech and both buckets. Vertical-only events stay internal. Jev's picks are badged "Helios pick" and shown first. *Badges and order: superseded by AE-32.* | 2026-10-21 |
| AE-11 | Invite or application events show with an **"Apply to attend"** label and can be picked. | 2026-10-21 |
| AE-12 | The calendar opens on all cities. A visitor's city choice is remembered on their device and kept in the URL. | 2026-10-21 |
| AE-13 | **Hook bank:** the 7 approved lines, drawn at random, never one used by the last 4 posts. **Look bank:** Spotlight, Obsidian glass, Daylight, The orb, never one used by the last 2 posts. Both draws are stored on the post and kept on a rebuild. *Hook bank retired by AE-29; the look bank stays.* | 2026-10-20/21 |
| AE-14 | **Daylight stays white.** This is a logged exception to the design system's "social posts use the stage" rule, for this series only. The other looks use the light Premium stage. Covers may use full Premium. | 2026-10-21 |
| AE-15 | Design-system rules, non-negotiable: the whole Helios mark, never cropped or covered (a halo is fine); the lit line in solid `#FF6A2A` with a glow, never gradient text; Lucide icons only; no emoji; no exclamation marks; no textures. | 2026-10-21 (DS) |
| AE-16 | **The pitch exception extends S-09 to this series.** The cover, every city slide and the final slide point to the site ("link in bio"). D-211 still governs every other type. | 2026-10-19/21 |
| AE-17 | The website's phone nav becomes a **hamburger menu** below 768px. Lucas's approval covers editing `Header.tsx` under the SEO charter. | 2026-10-21 |
| AE-18 | The `event-pick@1` wording and formula (below) are approved with the plan (R6). | 2026-10-21 |
| AE-19 | Ship scope: feature branches in both repos, additive schemas applied to Supabase, and a public `public-feeds` bucket, all testable locally. No VM deploys, no website deploy, and no commits until Lucas says. | 2026-10-21 |
| AE-20 | PR #16 (LFD Premium) and PR #15 (week board) were merged before branching. The hub branch is `feat/ai-events-weekly`; the website branch is `feat/free-tools-events`, in the worktree `FIGMAHELIOSWEBSITE-free-tools`. | 2026-10-21 |
| AE-21 | Defaults set by Claude and flagged in the plan:<br>- A hidden attendee count is neutral.<br>- Luma `featured_guests` are never stored or sent.<br>- The popup shows on every visit to `/social-landing`.<br>- A prerender feed failure ships the empty state and never fails the build.<br>- Design-system tokens and Roboto are scoped to the new website pages (`.hds`). | 2026-10-21 |
| AE-22 | **The cover is the hook and the calendar CTA, nothing more.** Every look's cover is the same layout on the plain stage (Daylight: white), with no light, no mark, no city pills and no subline. The hook is large and centred, with "Free AI Events Calendar · **Link in bio**" under it. A quiet week date sits above, a quiet city line below, and the swipe tile bottom right. This supersedes the cover parts of AE-13 to AE-16. *Cover copy: superseded by AE-29; the layout stays.* | 2026-10-21 |
| AE-23 | **Hook bank, 8th line:** "Best AI networking events this week." with "this week." lit (key `best_this_week`). It is drawn like the other 7. | 2026-10-21 |
| AE-24 | **One slide per city, built around its top pick.** The city is the big lit headline. The ranking's first pick (pins first, then score) sits in the look's card under a "TOP PICK" eyebrow, with day and time, title, "Hosted by …" and venue. There is no price or Waitlist/Apply badge on the slide. The week eyebrow is gone from city slides. *Superseded by AE-29 (one rank slide per event).* | 2026-10-21 |
| AE-25 | **Two honorable mentions** under the top pick, labelled "ALSO THIS WEEK", each one line of day + title (titles cut at 46 characters). Then "+N more {City} events on our free calendar · Link in bio". The footer text ("Helios Group · heliosgroup.ai") stays. *Superseded by AE-29.* | 2026-10-21 |
| AE-26 | **The Helios mark appears only on the closing slide**, because a logo makes a post read as an ad. It is gone from the cover and city slides: the orb, the glass chip and the Daylight lockup. The closing slides are unchanged. | 2026-10-21 |
| AE-27 | **Partner boost (Miami).** Events by eMerge Americas, Miami AI Hub, South Miami Tech Tuesdays (Purple Horizons), Burhan Sebin, Melissa Medina and Tony Jimenez always go to the top of Miami's ranking, after pins. They skip the gates and the bar; several partners order among themselves by score. Matched on organizer, host and calendar names (whole words) and the Tech Tuesdays title (`lib/networking/pick/partners.ts`). | 2026-10-21 |
| AE-28 | **The bar is the city's own history.** Every score is kept in `ai_events.pool` (the log, with `score_version`). An event must be in the **top 30%** of its city's past v2 scores (gated-in only). When fewer than 4 clear it, the bar steps down to the top 40%, then 50%, then anything past the gates. Until a city has 20 past scores, this week's scores join the history. The tier cleared is stored on the post (`bar_tier`). Replaces the fixed 3.0 bar. | 2026-10-21 |
| AE-29 | **Two ranked posts a week, Miami and Boston**, both on Sunday: Miami 6:00–7:00 PM, Boston 7:00–8:00 PM (the `night` window; AI Events' daily cap is 2). Each takes the city's top 4 (pins, partners, then score). Slides: the cover "N AI Networking Events in {City} this week. **Ranked.**", where N counts the city's events on the site that week; then #2, #3 and #4, each with a large rank number; then a tease, "Want to see the full list? →", over a blurred, locked #1; then the closing slide pointing to the site. #1 is never named in the post or caption. The hook bank is retired (hook reads `ranked`); the look bank still rotates. A city with fewer than 2 picks gets no post that week. | 2026-10-21 |
| AE-30 | **Score v2: code 6 points, Jev 4.** Attendance 2, track record 1.5, demand 1.5, roster .5, satellite .5; Jev: speakers or moment 1, would want to go 1, host .75, crowd .75, program .5, minus up to .5 for vendor pitch. Track record takes the larger of the source's past-event count and our own (never the sum). Past pool weeks are rescored from cached answers (`scripts/ai_events_rescore_history.ts`), with no Jev call. | 2026-10-21 |
| AE-31 | **Missing data is neutral.** Attendance, demand or track record with no data takes the city's median for that week over the events where it is known (0 when none is). The score breakdown says "imputed (city median)". | 2026-10-21 |
| AE-32 | **Website: date order, medals for the top 3.** The calendar lists events by date; the "Helios pick" section is gone. During the week, each city's ranks 1, 2 and 3 get gold, silver and bronze badges ("#1 in Miami this week"), and only those three. NYC and SF are ranked and badged too. | 2026-10-21 |
| AE-33 | **Spotlights span the gated list.** The post's ranked list is the 4 picks, then every later event that passed the gates (one per organizer), not only those over the history bar. 3–4 spotlights always lead with #2 and end on the last event on that list (even steps in between). Two ranked: #2; three: #2 and #3; four or five: three ranks; six or more: four ranks. Rank slides are card-free: the rank, the organizer's poster whole, then the event, with outlined rank numerals straddling the slide seams. | 2026-10-22 |
| AE-34 | **Instagram geotag is the city's Facebook Place.** The CAROUSEL parent is created with Meta's `location_id`: Miami `110148382341970`, Boston `106003956105810` (Wikidata P1997). Other carousels stay untagged. | 2026-10-21 |

## Question-set registry

| Set | Status | Questions | Use |
|---|---|---|---|
| `event-pick@1` | **Approved 2026-10-21** (AE-18) | **Gates:** `in_person_networking` (≥ .5), `vendor_pitch` (< .6), `get_rich` (< .4), `ai_relevant` (≥ .5).<br>**Value questions:** `notable_speakers`, `quality_crowd`, `established_host`, `ecosystem_moment`, `substantive_program`, `would_want_to_go`.<br>Merged with `planted-v1` (bar .7). | Weekly event ranking (plan M2). Wording is verbatim in `lib/networking/pick/questions.ts`. |

**Score v2 (AE-30), 0 to 10, calibrated later on Lucas's grades by the memes AUC method:**

```
max(notable_speakers, ecosystem_moment) + .75·established_host + .75·quality_crowd
+ .5·substantive_program + would_want_to_go                               (Jev, 4)
+ 2·attendance + 1.5·demand + 1.5·track_record + .5·roster + .5·satellite  (code, 6)
− .5·vendor_pitch
```

Attendance is log2 of going to 250 (capacity minus spots left when the count is hidden). Demand: sold out or waitlist 1, near capacity .6, approval required .4. Track record is log2 of past events to 50, or a 4.5+ rating over 50+ ratings. Missing attendance, demand or track record takes the city median (AE-31).

**Picks (AE-27, AE-28):**
- Pinned events go first, then partner events, each by score, whatever their score or gate; excluded events are dropped.
- Then events past the gates that reach the city's history bar, by score, up to 4.
- At most one event per organizer in a city.
- Picks are spread across days: the last pick is swapped for the best event on a different day if that event scores within 15%.
- Ties break on attendance, then start time.

*Score v1 (superseded):* `2·max(speakers, moment) + 1.5·host + 1.5·crowd + program + 1.5·would go + attendance + demand + roster + satellite + track record − vendor pitch`, with a fixed 3.0 bar and 3 picks.
