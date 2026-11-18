# Standardize settings for all content types — living plan

Trello card: "Standardize settings for all content types"
Stage: **Align** (planning only; no code or prompt edits until the contract is approved)

## The card's questions
- (a) Where do we control whether a content type is "live"?
- (b) What does "live" mean?
- (c) Why aren't idea pools refreshing for some content types?

## Decisions (user's words quoted)
_None yet._

## Grounding (read-only pass, 2026-11-18)
- There is already a shared settings model with three switches per type: **Generate**, **Auto-publish**, **Live**.
  `lib/content-type/posting.ts` maps them onto each type's own stored keys. `lib/content-type/config.ts` holds per-type data.
- The stored keys differ by type:

  | Shared switch | Carousels / Text on Screen / LFD / AI Events / Field Notes | Explainers | AI Drama | Stories series |
  |---|---|---|---|---|
  | Generate | `auto_run` | `auto_render` | `auto` | per-series `auto` |
  | Auto-publish | `require_approval` = off | same | same | same |
  | Live | `publishing_live` | same | same | same |

- Defaults differ too. Text on Screen's Generate counts as **on** when the row is missing (`run !== false`), and every other type counts it as off.
- "Live" means at least four different things today: `publishing_live` (posting), Generate (the night run makes things), the "Status: live" column in `docs/social-overnight.md`, and `publisher_mode` (AI Drama).
- Pool refill cadences are listed in `lib/social-hub/views/pools.ts` (`REFILL_CADENCE`, stale thresholds).
- **Hypothesis for (c), not verified:** for several types, the pool only refills during the run that Generate gates. Examples: the Explainers idea cycle runs "only with `auto_render` on", AI Drama develops "while Generate is on", and Stories makes sets "for series with `auto` on". If that holds, switching Generate off also stops pool refill. Not yet checked against the DB or the worker logs.

## Draft MECE tree (for discussion)
Scope × stage. Each knob lives in exactly one cell.

```
Settings
├── Global (all types)          — slot_source (template/legacy), publisher on/off, spend caps
├── Per content type
│   ├── 1 Source / pool refill  — refill on/off, cadence, pool size, seeding
│   ├── 2 Generate              — make posts on/off, per-day quota, render cap, run $ cap
│   ├── 3 Review                — require approval
│   └── 4 Publish               — live on/off, posting windows, days
└── Per series / city (only where the type has groups) — overrides of the above
```

## Open questions
See the latest chat turn.
