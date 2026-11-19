# Contract — Standard settings for every content type

Status: **draft v2 for Tommy's review** (2026-11-19). It replaces v1's four-switch model with D16's three states. Nothing is built until this is approved.
Decisions: D1, D3, D6, D7, D8–D12, D14–D16 in `PLAN.md`.

## 1. The model (D16)
Each type has **one state: Paused | Approval | Live**.

| State | Pool refills | Posts get made | Approving a post | Posts go to Instagram |
|---|---|---|---|---|
| Paused | yes | no | makes it ready in its slot | no |
| Approval | yes | yes, and they wait for review | makes it ready in its slot | no |
| Live | yes | yes, and they wait for review | makes it ready in its slot | yes, at its slot time, approved posts only |

- **Refill always runs.** It isn't a control. It runs every night (or on the type's weekly cadence), on its $ cap, whatever the state and even when the day's quota is full (D3).
- **Every post needs a person's approval.** There is no setting to turn that off.
- Retired types are removed from the code and have no state.

## 2. The Settings tab (D8, D9)
The pool menu becomes **Ideas | Made | Settings** on every type. The gear-button drawer (`SettingsButton` / `PostingSettings` in `components/content-type/TypeControls.tsx`) is removed.

```
State   ( Paused | Approval | Live )      one line saying what this state does
Pool    refills every night · last refill <time> · refill $ cap
Posts   posts per day, or days for weekly types · run $ cap · render cap (video types)
Posting windows (read-only) · days
─ This type only ─   AI Drama form · Stories series days · AI Events cities
Also affected by: calendar template mode · publisher   (links to Social Hub settings, D10)
```
- Moving to **Live** asks for confirmation: "Approved posts will go to Instagram at their slot times."
- Moving to **Paused** asks for confirmation and says what it cancels (see §7, question 1).

## 3. Storage (D7: no renames, no new state column)
The state is read from and written to the keys each type already has:

| State | Generate key (`auto_run` / `auto_render` / `auto` / `series[s].auto`) | `publishing_live` |
|---|---|---|
| Paused | false | false |
| Approval | true | false |
| Live | true | true |

- **Generate off with Live on isn't a valid state.** `posting.ts` reads it as **Paused** and logs `state_mismatch`. The migration finds none today: Carousels' Live was switched off on 2026-11-18.
- `require_approval` is written as `true` for every type and is no longer editable. The Auto-publish control is removed.
- **New keys:** `pool_refill_cap_usd` in each type's settings table. Stories types use `stories.settings.types[<type>].refill_cap_usd`. Defaults (D14): **$0.25** for Jev-only types (intake share for Carousels/LFD, AI Events, Stories types) and **$0.50** for types that call Claude (Explainers ideas, AI Drama development, Field Notes, Text on Screen scoring if it calls Claude).
- **A missing row means off (D6).** The migration writes explicit values for every type, so nothing relies on a default.
- **Day-one states** (today's values, nothing changes on deploy): Carousels = Paused. Every other type = Approval or Live, according to its current `publishing_live`.
- All reads and writes go through `lib/content-type/posting.ts`. It gets `state` (and `setState`), and the `generate`, `autoPublish` and `live` booleans are removed from its public shape.

## 4. Worker rules (all on `helios-social-worker`)
1. **Refill**: run on the type's cadence in every state, held to `pool_refill_cap_usd`. Hitting the cap ends the refill cleanly and logs `refill_capped`. The quota never stops a refill.
2. **Make posts**: only in Approval or Live, and only up to `quota − placed`. This is today's daily-fill rule.
3. **Approving a post** books or keeps its slot and marks it ready. This works in every state.
4. **Post**: only in Live, and only approved posts, at their slot time. Today's lateness rules still cancel a slot that's too late.

Each type's refill must be split out from its make step. Today they're one gate:

| Type | Refill to split out | Gated today at |
|---|---|---|
| Text on Screen | Song ingest and idea scoring | `scripts/reels_worker.ts:102`: whole run skips when `auto_run` is off |
| Explainers | Idea generation, scoring and dedupe into `explainers.topics` | `scripts/explainers_worker.ts:230` (`auto_render`) and the quota check inside `runIdeaCycle` |
| Carousels, LFD | The central intake's stories for them | `lib/intake/orders.ts` `carouselOpen` / `lfdOpen` (`auto_run`); the Carousels run's `quota-filled` skip |
| AI Events | Weekly ranking into `ai_events.pool` | The Sunday run (`auto_run`) |
| Field Notes | Tip sourcing into `field_notes.tips` | The Tue/Fri run (`auto_run`) |
| AI Drama | `tendPool` and the weekly development session | `scripts/reel_ai_drama_worker.ts:203` (`auto`) |
| Stories types | Pool refresh, `runTriviaDaily`, `runRoaDaily` | `scripts/stories_worker.ts`, per series |

The intake's open orders (`lib/intake/orders.ts`) are open for every type that hasn't been retired, because refill runs in every state.

## 5. Out of scope
Renaming stored keys (D7), global settings (D10), new content types, and any change to what a type makes or how it scores.

## 6. Build, test, ship
- **Builders, in parallel after approval:** (A) `posting.ts` state model + migration; (B) the Settings tab UI; (C) the worker refill split for Text on Screen / Explainers / AI Drama; (D) the same for social-worker types, intake and Stories. Then one review.
- **Tests are offline only** (CLAUDE.md Rule 1). They cover state ↔ key mapping including the mismatch case, refill in every state, refill on a quota-full day, refill caps, the post gate, and the migration's day-one states. No live model calls.
- **Deploy:** apply the migration, then redeploy with `./scripts/gcp/deploy-social-worker.sh` in the same session. Update `docs/social-overnight.md` (contract item 2, Daily fill, Approval sections).
- **Verify:** Tommy clicks the Settings tab on each type. The next night's logs should show every type's pool refilling, Carousels included, with no `quota-filled` refill skips.

## 7. Open questions for Tommy
1. **When a type is switched to Paused, do its approved posts keep their slots?** If they keep them, they'd post on their slots only after the type goes back to Live, otherwise they're cancelled. Proposed: they keep their slots and are marked ready but don't post while Paused. That matches "approving makes it ready in its slot".
2. **A ready post whose slot passes while the type isn't Live:** should it move to the next open slot or drop back to review? Proposed: next open slot.
