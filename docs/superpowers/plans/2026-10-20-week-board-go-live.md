# Week board go-live checklist (2026-10-20)

Run these in order; Tommy runs every step. You can stop after any step: until step 6 everything stays in `legacy` mode, so the hub and the overnight run behave exactly as they do today.

## 0. Before you start
- [ ] **Read-only check that the slot tables are empty.** The schema reshape empties them once.
  ```
  psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SELECT (SELECT count(*) FROM social_hub.slot_template) AS template_rows, (SELECT count(*) FROM social_hub.slot_override) AS override_rows; SELECT value FROM social_hub.settings WHERE key = 'slot_source'; ROLLBACK;"
  ```
  - Expect 0 and 0, and `"legacy"`.
  - If either count isn't 0, stop and tell Claude before applying anything.

## 1. Get the code to GitHub (your call)
- [ ] Push `unify-social-hub`. The local branch is 35 commits ahead of GitHub, and the push also adds other sessions' work on this branch to PR #13.
- [ ] Merge PR #13 when ready. That merge is what deploys the hub on Vercel (step 3).

## 2. Apply both schema files
- [ ] `node scripts/apply_social_hub_schema.js --apply`
- [ ] `node scripts/apply_stories_schema.js`. This one has no `--apply` flag; running it applies.
- [ ] Read-only check:
  ```
  psql "$DATABASE_URL" -X -c "BEGIN READ ONLY; SELECT indexname FROM pg_indexes WHERE schemaname = 'stories' AND indexname LIKE 'uq_stories_sets_live_%'; SELECT key, value FROM social_hub.settings WHERE key IN ('slot_source','daily_caps'); ROLLBACK;"
  ```
  - Expect two indexes, `uq_stories_sets_live_day` and `uq_stories_sets_live_slot`.
  - Expect `slot_source` = `"legacy"`.
  - Expect `daily_caps` = `{"reels":5,"explainers":3,"carousels":3,"last_few_days":1,"stories":2}`.
- This step is safe with the code that's live now. The old Stories index is kept on purpose.

## 3. Deploy the new code
- [ ] **Social worker:** `./scripts/gcp/deploy-social-worker.sh`.
- [ ] **Hub:** the Vercel deploy from the merge in step 1. It serves the Calendar and `/api/stories/*`.
- The orchestration VM (`deploy-worker-code.sh`) doesn't need a redeploy for this: no outreach worker code changed.

## 4. Let Stories post twice a day
- [ ] Only after step 3 is live: run `node scripts/apply_stories_multi_slot.js` first. It prints what it would do.
- [ ] Then run `node scripts/apply_stories_multi_slot.js --apply`. It drops only `uq_stories_sets_live_day`.
- [ ] Re-run the step 2 check. Expect only `uq_stories_sets_live_slot`.
- If you skip this step, everything works except a second Stories set of the same series on one day, which is refused.

## 5. Look before switching on
- [ ] Open `/social/calendar` → Week. It should look like today, read-only, with the switch notice.

## 6. Switch on
- [ ] Click the switch on the Calendar (sets `slot_source = 'template'`). The board fills with the default week:
  - Text on Screen: 8:45 AM, 11:15 AM, 6 PM.
  - Explainers: 1 PM, 3:30 PM.
  - Carousels: 9 AM, 2:30 PM.
  - Last Few Days: 9 AM on Tue and Fri.
  - Stories: 8:30 AM.

## 7. Live checks right after switch-on (about 5 minutes)
- [ ] Drag an Explainer onto a day at 12:00 PM. Expect the toast, then "Make it every…" and Undo.
- [ ] Flip a Trial/Main tag, then Undo it.
- [ ] **A booked post:** try Remove. It should ask "Move it back to ready" / "Keep it"; choose Keep.
- [ ] **A booked Story:** try moving it. It should say it can't move here.
- [ ] Make a second edit while "Saving…" shows. It should say "Still saving the last change."
- [ ] **Type page:** the "Daily limit" row shows. Change one limit and change it back.
- [ ] **Next morning:** posts went out at their slot times (within 15 minutes, later if the 30-minute feed gap pushed them).

## To undo
- **Switch back:** "Switch back to type settings" on the Calendar returns to `legacy` right away. Booked posts keep their times.
- **Schema:** the schema changes are additive. Leaving them in place in `legacy` mode is fine.
