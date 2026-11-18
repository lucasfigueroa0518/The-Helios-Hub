# Standardize settings for all content types — living plan

Trello card: "Standardize settings for all content types"
Stage: **Align** (planning only; no code or prompt edits until the contract is approved)

## The card's questions
- (a) Where do we control whether a content type is "live"?
- (b) What does "live" mean?
- (c) Why aren't idea pools refreshing for some content types?

## Decisions (user's words quoted)
- **D1 (2026-11-18): "Live" means only "posts actually go to Instagram"** (`publishing_live`). Generating gets its own name, for example "making posts". User: "1 yes".
- **D2 (2026-11-18): Pool refill is its own switch, separate from Generate**, with a small spend cap for each type. User: "2 yes".

## Pool check (read-only DB, 2026-11-18, Supabase `lucas-outreach-hub`)
| Type | Generate now | Newest pool refill | Verdict |
|---|---|---|---|
| Text on Screen | no row (counts as on) | today 06:02, 7 slates in 7 days | healthy |
| Explainers | `auto_render` on since **today 16:24** | idea cycle today 16:24, only 2 in 7 days | **stalled until Generate was switched on**: refill depends on Generate |
| Carousels | `auto_run` off (set today 16:28) | last finished run **Oct 28** | **stale 3 weeks**: since Nov 2 every run ends `skipped / quota-filled` (7 of them) before any story work |
| Last Few Days | on | Nov 17 | healthy (twice a week) |
| AI Events | on | Nov 15 (Sunday) | healthy (weekly) |
| Field Notes | on | tips Nov 13 | check: Tue Nov 17 added nothing |
| Stories: Morning Download, Trivia, Real or AI? | per series | today | healthy |
| Stories: Free vs Paid, Guess the Number (retired) | `auto` still true | Nov 17 | still refilling after retirement (wasted work) |
| AI Drama | `auto` on | not checked (pool may be on another DB handle) | open |

**Cause of (c):** the pool refills only inside the "make posts" run, so it stops whenever that run doesn't do work. There are two ways it gets switched off:
1. **Generate is off.** Explainers' idea cycle, AI Drama development, Stories series with `auto`, and the intake's "open orders" (`lib/intake/orders.ts`: no Generate means no fetch for that type) all wait on Generate.
2. **The day's quota is already filled.** Carousels and Explainers skip the whole run, refill included, when people have placed enough posts (`docs/social-overnight.md` §Daily fill). Carousels have hit this every night since Nov 2.

D2 fixes both, as long as the refill switch is independent of Generate **and of the quota**.

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
