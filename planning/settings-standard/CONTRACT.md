# Contract — Standard settings for every content type

Status: **draft for Tommy's review** (2026-11-19). Nothing is built until this is approved.
Decisions it implements: D1–D13 in `PLAN.md`.

## 1. Words
- **Refill**: keep this type's idea pool topped up. **Generate**: turn pool ideas into finished posts. **Approval**: a person approves each post. **Live**: approved posts actually go to Instagram (D1).
- A type is **Active** or **Paused** (D13). Retired types are removed from the code and have no state.

## 2. The Settings tab (D8, D9)
The pool menu becomes **Ideas | Made | Settings** on every type. The gear-button drawer (`SettingsButton` / `PostingSettings` in `components/content-type/TypeControls.tsx`) is removed. Every per-type setting shows in this tab and nowhere else.

```
Settings
① Refill    [on/off]  how often (read-only) · refill $ cap
② Generate  [on/off]  posts per day, or days for weekly types · run $ cap · render cap (video types)
③ Approval  [on/off]  "A person approves every post before it can post"
④ Live      [on/off]  posting windows (read-only) · days
─ This type only ─   AI Drama form · Stories series days · AI Events cities
Also affected by: calendar template mode · publisher   (one line, links to Social Hub settings — D10)
[Pause this type]
```
- Each setting sits under its switch. Settings under a switch that's off are greyed out but can still be edited.
- **Paused**: the tab shows only "Paused — nothing refills, generates or posts" and a **Bring back** button. The type shows as one row in the hub. Bring back restores the four switches exactly as they were.
- Live can't be switched on while Approval is off without a confirmation that says "posts will go out with no one checking". Existing confirmations about cost stay.

## 3. Storage (D7: keep the existing names, add only what's missing)
| Switch | Text on Screen | Explainers | Carousels | LFD | AI Events | Field Notes | AI Drama | Stories types |
|---|---|---|---|---|---|---|---|---|
| Refill (new) | `reels.settings.pool_refill` | `explainers.settings.pool_refill` | `social.settings.pool_refill` | `lfd.settings.pool_refill` | `ai_events.settings.pool_refill` | `field_notes.settings.pool_refill` | `reel_ai_drama.settings.pool_refill` | `stories.settings.types[<type>].refill` |
| Refill $ cap (new) | `pool_refill_cap_usd` in the same table | ” | ” | ” | ” | ” | ” | `types[<type>].refill_cap_usd` |
| Generate | `auto_run` | `auto_render` | `auto_run` | `auto_run` | `auto_run` | `auto_run` | `auto` | `series[<s>].auto` |
| Approval | `require_approval` (all types; stored inverted as "Auto-publish" today, shown as Approval) |||||||
| Live | `publishing_live` (all types) |||||||
| Paused (new) | `social_hub.settings.paused_types`: a JSON array of type ids, plus the four switch values saved at pause time ||||||||

- All reads and writes go through `lib/content-type/posting.ts`, which gets `refill` and `paused` added. `Posting.autoPublish` is renamed to `approval`, so the UI no longer flips its meaning.
- **A missing row means off for every type (D6).** The migration writes an explicit `true` wherever a type relies on today's missing-means-on default (Text on Screen `auto_run`, `require_approval`), so behavior doesn't change.
- **Day-one values:** `pool_refill` = that type's Generate value today, so nothing starts or stops on deploy. The one exception is Carousels, which is added to `paused_types`.

## 4. Worker rules (D2, D3), all on `helios-social-worker`
1. **Refill runs only on its own switch.** Generate being off and the day's quota being full never stop a refill.
2. **Generate runs only when Refill's pool has something to make, Generate is on, and the quota isn't filled.** These are today's rules.
3. **Paused stops everything:** refill, generate, scheduling and posting. Slots that are already scheduled get cancelled with the reason `paused`.
4. **Each refill is held to its `pool_refill_cap_usd`.** When the cap is reached, the run stops cleanly and logs `refill_capped`.

| Type | What counts as refill (split it out from the make step) | Where it's gated today |
|---|---|---|
| Text on Screen | Song ingest and idea scoring | `scripts/reels_worker.ts:102`: the whole run skips when `auto_run` is off |
| Explainers | Idea generation, scoring and dedupe into `explainers.topics` | `scripts/explainers_worker.ts:230` (`auto_render`) and the quota check in `runIdeaCycle` |
| Carousels, LFD | The central intake's stories for them | `lib/intake/orders.ts` `carouselOpen` / `lfdOpen` (`auto_run`); the Carousels run skips with `quota-filled` |
| AI Events | Weekly ranking into `ai_events.pool` | The Sunday run (`auto_run`) |
| Field Notes | Tip sourcing into `field_notes.tips` | The Tue/Fri run (`auto_run`) |
| AI Drama | `tendPool` and the weekly development session | `scripts/reel_ai_drama_worker.ts:203` (`auto`) |
| Stories types | The pool refresh, `runTriviaDaily` and `runRoaDaily` | `scripts/stories_worker.ts`, per series |

The intake's open orders (`lib/intake/orders.ts`) read **Refill**, not Generate.

## 5. Out of scope
Renaming stored keys (D7), global settings (D10), new content types, and any change to what Generate makes.

## 6. Build, test, ship
- **Builders, in parallel after approval:** (A) storage + `posting.ts` + migration; (B) the Settings tab UI; (C) worker refill split for reels/explainers/drama; (D) the same for social-worker types, intake and Stories. Then a review.
- **Tests are offline only** (CLAUDE.md Rule 1). They cover the gate logic for every type × switch × quota-full case, the `posting.ts` mapping, the migration's day-one values, and the Paused round trip. No live model calls.
- **Deploy:** apply the migration, then redeploy with `./scripts/gcp/deploy-social-worker.sh` in the same session. Update `docs/social-overnight.md` (contract item 2, Daily fill table) to match.
- **Verify:** Tommy clicks through the Settings tab on each type. The next night's logs should show every type with Refill on adding to its pool, including on days whose quota was already filled.

## 7. Open questions for Tommy
1. **Refill $ caps:** what default per refill? Proposed: $0.25 for Jev-only types (intake, AI Events, Stories); $0.50 for types that call Claude (Explainers ideas, AI Drama development, Field Notes).
2. **Pausing:** should it cancel posts that are already scheduled for that type? Proposed: yes, with the reason `paused`.
3. **Approval off + Live on:** is the extra confirmation enough, or should that combination be blocked?
