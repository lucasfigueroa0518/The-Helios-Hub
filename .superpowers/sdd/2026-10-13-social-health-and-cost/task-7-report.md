# Task 7 report
Status: DONE. Commit 6270b01.
RED: initial run failed with "Cannot find module '@/lib/social-hub/health/brief'".
GREEN: tests/social-health-view.test.ts 6/6; health + hub suites 231/231; tsc clean for health files.
Code and fixture copied verbatim from the brief; no fixture or code changes were needed (clean-night chip test passed as written).
dayLabel returns long form ("Thursday, October 8, 2026"), so the eyebrow and card titles use that; tests match only stable text.

## Fix report (review findings)
Changes in lib/social-hub/health/view.ts: dropped dayLabel; local eyebrowDay ("Thursday, October 8") and cardDay ("Thu Oct 8", also Publisher card); publisher-only failure gives emphasis "The publisher stopped." and lede "Posts can't go out until the publisher is running again."; exported ordinal() now yields 21st/22nd/12th (words through seventh).
Tests added: date formats (eyebrow, Carousels and Publisher titles), publisher-only failure, ordinals (21, 12, 22, 3).
Command: npx tsx --test tests/social-health-view.test.ts -> tests 9, pass 9, fail 0. tsc: no health errors.
