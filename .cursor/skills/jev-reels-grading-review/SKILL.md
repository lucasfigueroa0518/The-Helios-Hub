---
name: jev-reels-grading-review
description: >-
  Report Trial Reel copy-gate results from Jev: each idea considered, its
  scores, whether it passed, and whether the day had 3 passing reels. Use when
  the user asks for Jev scoring results, copy-gate pass rates, or how reels
  graded on a date or range.
---

# Jev reels grading review

The date range comes from the user. Do not assume last night.

## What to show

For each New York date in the range, then for each idea that received a copy judgment:

- Headline and the winning on-screen copy
- Bucket and framework
- Scores on the winning line, from 0 to 1: plain, stake, payoff when the bucket is Ball Knowledge, loop, care, reward, same story
- Word count, and whether it sits inside the bucket range
- Whether a rewrite ran
- Eligible lines out of lines judged
- Passed or missed, and which part of the gate failed
- Whether that date had 3 passing reels

A reel passes when its winning line clears the gate. The day has 3 passing reels only when 3 ideas passed. Shipping a nearest miss still produces a reel, and it does not count as a pass. Report how many were produced that way, apart from the pass count.

## The gate

Ball Knowledge: payoff at least 0.75, stake at least 0.75, words in range, same story at least 0.50. Plain is stored. It does not decide the pass.

Every other bucket: plain at least 0.75, stake at least 0.75, words in range, same story at least 0.50.

Loop, care, and reward rank lines that already passed. They do not decide a pass.

Word ranges: ball knowledge 8–14, the number 1–14, the saga 20–32, personal profile 10–18, the warning 15–25, the callout 12–22.

## Where the numbers are

Read Postgres with `DIRECT_DATABASE_URL` from `.env.local`, `ssl: false`. Do not print the URL or any other secret. Do not call Claude or Jev.

`reels.score_slates.ny_date` is the New York date. If a date has more than one slate, use the latest `scored_at` unless the user asks for an earlier one, and say which slate.

`reels.idea_copy` is one current row per idea on that slate. Report `variants.lines` where `winner` is true. `variants.winnerEligible` is the pass. `variants.rewrote` is the rewrite. `prompt_version` is the writer. `variants.questionSetVersion` and `variants.payoffQuestionSetVersion` are the Jev sets.

`reels.idea_copy_history` keeps every attempt. A failed row whose error is `No on-screen copy cleared the bar`, followed by an ok row for the same idea, is one reel. Do not count it twice.

`reels.idea_scores.rank` is the order the night tried them. `selected` on the current row means the idea was one of the reels filled for that day, including a nearest miss.

`reels.copy_day_penalties` are ideas demoted that day. A shipped nearest miss has its penalty cleared.

`reels.video_jobs` and `reels.posting_schedule` show what was produced. Production is not a pass.

## Report

Lead with the date, how many ideas were considered, how many passed, and whether the day had 3 passing reels. Then one row per idea, in rank order. Round each score to 3 decimals. Name the gate that failed.
