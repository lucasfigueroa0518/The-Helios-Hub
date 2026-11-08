# Overnight reliability plan (2026-10-13)

**Goal:** the 1 to 4 AM run makes every slot, or says clearly at about 5 AM what it could not, so a bad night is caught before the posting windows. Not "zero failures": every failure is retried, caught or reported.

**Where it stands (from the Oct 12 audits).** Every type is "ready with risks", with no blocker. Reliable now: the schedules fire, reels built 2 videos on all 5 recent nights, explainers have succeeded 8 times running, Morning Download builds, and cost caps hold. Luck today: a failed step usually ends the day with no retry; Free vs. Paid has made 0 sets in 17 tries; posting depends on a human Approve before 10 AM; nobody is told when a night goes wrong; one 2-CPU VM runs everything; and model behavior can't be tested without spending.

Effort is rough working time. "Run cost" is extra spend per night. "Test spend" is a one-off live test, which needs the owner's go-ahead under Rule 1.

## Phase 1: see it (about 1.5 days, $0)
| # | Item | Effort | Run cost | Test spend |
|---|---|---|---|---|
| 1 | **Scoreboard.** Made, scheduled, posted and failed per type per night, with reason and cost. A CLI first (`scripts/overnight_scoreboard.ts`), read-only over existing tables. A hub panel later (part of the hub-wide project). | 3 h CLI, 1 day panel | $0 | $0 |
| 2 | **Automatic checks that reach you.** Run `overnight_check.ts` at 11 PM (are the switches right, is anything stuck?) and about 5:30 AM (what was made, what failed, what needs approval). Delivered by a channel you pick. | 3 h script, 1 to 3 h delivery | $0 | $0 |
| 3 | **Approval deadline alert.** At about 8 AM, list anything made but unapproved and say it must be approved before its window closes (Stories: 10 AM, after which a set is never scheduled). | 2 to 3 h | $0 | $0 |
| 4 | **Keep skipped Stories candidates.** Skipped sets store no candidates today, so a Free vs. Paid skip can't be diagnosed afterwards. | 1 to 2 h | $0 | $0 |

## Phase 2: fewer dead ends (about 2 days, small spend)
| # | Item | Effort | Run cost | Test spend |
|---|---|---|---|---|
| 5 | **Explainer 2 AM cycle: retry once.** Today a failed cycle blocks the day. Needs an attempts column and a bounded retry. | 3 h with tests | at most one extra idea call (cents) | $0 |
| 6 | **Free vs. Paid.** With #4 in place, find why the pair search returns nothing (the "accessible" answer is about 0.1, 14 of 17 searches found no scorable pair, the 90-day dedupe). Then adjust the bar, the question or the pool. | 0.5 to 1 day | about $0.15 to $0.20 per attempt, once a day | **about $1 to $2** (5 to 10 searches, daytime) |
| 7 | **Carousel funnel.** Photo fallback and a 4th Reporter attempt are done. Next: stop candidates likely to hit the $0.45 Reporter cap early, and the rare "words changed after the visual failed" draft failure (relaxes a rule: owner's decision). | 0.5 to 1 day | each extra attempt about $0.40, up to $0.40 to $0.80 a night | $0 |
| 8 | **Disk housekeeping.** Explainer job folders (2.6 GB now) and temp folders on a 29 GB disk. | 1 h | $0 | $0 |

## Phase 3: decisions first
| # | Item | Effort | Notes |
|---|---|---|---|
| 9 | **Approval policy.** Option A: keep approvals and rely on #3. Option B: auto-approve sets that pass the review checks (flagged ones still need you). Option C: per type. | setting flip to 1 day | posts without review: the owner decides |
| 10 | **Reels publish retry.** A failed post becomes a failed slot with no retry or backfill. | 0.5 to 1 day | touches the publish path: test in daytime, not overnight |
| 11 | **Hub banner on a main page.** The same readout as #2, live, for the whole hub. | 1 day | web deploy (merge to `main`) |

## Order and rule of thumb
1. Do #1 to #4 first: they cost nothing and tell us what is really failing.
2. Then #5, #6 and #8, with the Free vs. Paid test in daytime.
3. After about 10 nights of scoreboard, decide #7, #9 and #10 from data, not guesses.
4. Never deploy between 12:30 and 5 AM ET (a restart kills a run). Prefer daytime deploys.

## Decisions needed from the owner
- **Where alerts should go:** email, Slack, a push notification, or the hub banner only.
- **Approval policy** (#9).
- **Budget for the Free vs. Paid daytime test** (about $1 to $2) and for extra carousel attempts (up to $0.80 a night).

## What this cannot fix
Model steps will always vary a little. Live model behavior (Reporter, Writer, Free vs. Paid pairing) only proves itself with real spend, so each change gets a small, approved daytime test.
