# Smartlead S0 discovery findings

Read-only GET probe of the live Helios account, 2026-09-16.
Reproduce with `npx tsx scripts/smartlead/discover.ts`; fixtures land in
`tests/fixtures/smartlead/` and are asserted by `tests/smartlead-s0-shapes.test.ts`.

These answers freeze the schema. Where a finding contradicts the build plan, the
finding wins and the affected plan section is named.

## Answers to plan §8

| # | Question | Answer |
|---|---|---|
| 1 | `/email-accounts/` shape, paging | `offset`/`limit` query params, direct array response. Six OUTLOOK mailboxes present. `message_per_day` is the campaign cap (the PATCH body calls it `max_email_per_day`). `warmup_details` is `null` until warmup starts. |
| 1 | Does `POST /campaigns/{id}/leads` return per-lead ids? | **No.** It returns `{success, added_count, skipped_count, skipped_leads}`. Handoff must resolve ids afterwards via `GET /leads/?email=`. |
| 2 | Custom field limit | **200** key/value pairs per lead, not ~20. Ample room for `custom_subject` / `custom_body` / the four `hub_*` ids. |
| 3 | Webhook authentication | **Smartlead does not sign payloads.** The registration body has no secret field and the docs show only a generic HMAC snippet with no header name. → `org_settings.smartlead.webhook.mode = 'path_token'`. |
| 3 | Webhook scope | **Campaign-scoped only.** `GET /campaigns/{id}/webhooks` → 200 `[]`; `GET /webhooks` → **404**. |
| 4 | Rate limits | Response headers report `x-ratelimit-limit: 200` with a `x-ratelimit-reset` epoch. Docs quote 120/min and 3000/hour for Pro. `ORG_SMARTLEAD_CONCURRENCY` default 1 (max 3) is far under either. |
| 6 | Settings / schedule keys | `track_settings[]`, `stop_lead_settings`, `min_time_btwn_emails`, `max_leads_per_day`, `enable_ai_esp_matching`, `send_as_plain_text`, `unsubscribe_text`, `scheduler_cron_value {tz, days, startHour, endHour}`. |
| 11 | Microsoft OAuth fields | `type: "OUTLOOK"`, `password: null`, `expires_at` (token expiry, list only), `is_smtp_success` / `is_imap_success` as the connection-health signals. |

## Deviations from the build plan

1. **Webhook registration is per lane, not global.** §6 step 7 says "Register webhook
   (`POST /webhooks`)". That endpoint does not exist. Registration becomes a step of
   `ensureCampaignLane` (§5E), posting to `/campaigns/{smartlead_campaign_id}/webhooks`
   with the lane's own URL. Deleting a lane must delete its webhook.

2. **`smartlead_lead_id` is resolved after the fact.** §5C's "per-lead ids from the
   response or a lead-by-email lookup" resolves entirely to the lookup branch.
   `GET /leads/?email=` returns `{}` for an unknown address, so "not found" is an empty
   object rather than a 404.

3. **Counters are mixed strings and numbers.** `sent_count: "2"`, `total_leads: "0"`,
   and `warmup_reputation` is `100` on the detail endpoint but `"100%"` in the list.
   Everything reading Smartlead numbers goes through `toNumber` / `toReputationPercent`.

4. **The warmup sub-object has two spellings.** The list returns `warmup_created_at`,
   the detail returns `created_at` plus `id` and `is_warmup_blocked`.
   `normalizeWarmupDetails` reconciles them.

5. **No `event_id` on webhook payloads.** The documented body has no id field, so
   `eventId = sha1(type|campaign|lead|seq|eventAt)` is the normal path, not the fallback.

## Live account state at freeze

Six mailboxes, all OUTLOOK, all `is_smtp_success` / `is_imap_success` true:

| Smartlead id | Address | Warmup |
|---|---|---|
| 23268451 | lucas@heliosgroup.me | not started (`warmup_details: null`), cap 15 |
| 23395465 | lucasfigueroa@heliosgroup.me | ACTIVE, cap 30 |
| 23396728 | lucas@heliosgroup.store | ACTIVE, cap 30 |
| 23397974 | tommy@heliosgroup.me | ACTIVE, cap 30 |
| 23398154 | thomas@heliosgroup.me | ACTIVE, cap 30 |
| 23398188 | thomas@heliosgroup.store | ACTIVE, cap 30 |

One campaign exists (`3948549` "Boston Truckers", `DRAFTED`, no sequences, no leads, no
attached accounts). It is not a hub lane and is left alone.
