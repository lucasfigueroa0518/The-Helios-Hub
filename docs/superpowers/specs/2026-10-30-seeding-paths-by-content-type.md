# Seeding paths by content type (2026-10-30)

Why: Lucas's point after the Text on Screen build. Each content type has its own path from "a person types something in" to "it is in the queue", and the rules (duplicates, unreadable links, cost, what the night does) differ. This maps what the code does today, read from the files named, before any shared toolset is considered. **Nothing was run; this is from reading the code.** Rows marked (?) I did not confirm.

## 1. The paths

| Type | Nature | The person gives | Where the body text comes from | Model use at seed time | Scored | Cap / expiry | Seed code |
|---|---|---|---|---|---|---|---|
| **Text on Screen** | News and tools (reels from RSS, HN, GitHub, papers, web search) | Headline, optional link, optional own text; or headline only | Own text, else the linked page (plain reader), else (new) a substitute story found by search | Jev scoring, about 1¢; headline-only adds up to 8 Jev calls; opt-in paid web search up to 15¢ | At seed, same two Jev passes as the night | No cap, 7 days | `lib/reels/seeds.ts`, `seed-search.ts` |
| **Carousels** | News | A link (headline optional) | The linked page (plain reader, article extractor) | One Jev call (story scoring) | At seed | 10 open, 7 days | `lib/social/overnight/seeds.ts` |
| **Last Few Days** | News (a round-up of recent stories) | A link (headline optional) | The linked page (plain reader) | None | In the next run, one call per seed inside the run cap | 10 open, 7 days | `lib/lfd/seeds.ts` |
| **Stories: Morning Download** | News | Headline, link or notes | Notes, else the headline itself; the link is never read | None | At seed, by a fixed news-scale formula (no model) | 10 per series, no expiry seen | `lib/stories/seed.ts` |
| **Stories: Guess the Number** | Educational / trivia | The number, what it counts, optional story headline and link | Typed by the person; nothing read | None | None: fixed mid-pool rank 0.5 | 10 per series | `lib/stories/seed.ts` |
| **Stories: Free vs. Paid** | Tools | Tool name, link, short description | Typed; the link is never read; the model pairs it with a counterpart at build time | None at seed | None: fixed mid-pool rank 0.5 | 10 per series | `lib/stories/seed.ts` |
| **Explainers** | Educational | A topic title (optional source URL or text), or a pasted list of up to 25 | A model writes the scope from the title; whether the source URL/text is read (?) | One Sonnet call for all scopes, then Jev score and dedupe per topic | At seed (`evaluateSeed`) | 10 typed topics in the pool; never trimmed | `app/api/explainers/topics/route.ts`, `lib/explainers/ideas/` |

## 2. What the night does with a seed

| Type | Does the night make it unprompted? |
|---|---|
| Text on Screen | **No** (changed 2026-10-29). Pin or Run now only. |
| Carousels | Believed no: the night finds seeds through pinned/Run-now selection (`lib/social/overnight/pinned.ts`) (?) |
| Last Few Days | **Yes, by design**: the next run takes seeds before the lanes, inside the run cap (`lib/lfd/run.ts`). |
| Stories | **Yes, can**: a seed is an ordinary pool row. Morning Download competes on score; the other two sit mid-pool, "never bumped". |
| Explainers | **Can**: a typed topic is evaluated like any pool topic; one below the gate is manual-only for the night unless pinned (`evaluate.ts`), otherwise it can be promoted and auto-rendered. |

## 3. Which of Text on Screen's rules each type has

✔ has it · ✘ does not · – does not apply

| Rule | Text on Screen | Carousels | Last Few Days | Stories | Explainers |
|---|---|---|---|---|---|
| Duplicate of something in the queue stops and shows it | ✔ (new) | ✔ refuses ("already in the queue"), no existing idea shown | ✔ refuses (open seed, archived, already in latest post) | ✘ none (random key) | Jev dedupe at evaluation |
| Headline-only finds the story | ✔ (new) | – needs a link | – needs a link | – no read at all | – a topic is the unit |
| Unreadable link | Searches for a substitute, else adds nothing | Refuses (422) | Refuses (422) | – never read | (?) |
| Pasted Google News wrapper link unwound | ✔ (new) | Probably, inside the article extractor (?) | Probably (?) | – | – |
| Private address and redirect guard on the page read | ✔ (new, every hop) | ✔ every hop (fixed 2026-10-30, in the shared article extractor) | ✔ same | – | (?) |
| Cost ceiling and cost quote before spending | ✔ 15¢, quoted | Under a cent, no quote | None needed | None needed | Sonnet + Jev, not quoted; 25-topic cap |
| Night skips seeds | ✔ (new) | Believed ✔ | ✘ by design | ✘ | Partly |
| Same-day rerun does not rescore a seed | ✔ (new) | (?) | (?) | (?) | (?) |
| Expiry | 7 days | 7 days | 7 days | none seen | none (never trimmed) |

## 4. What this says about a shared toolset

- **Can be shared** (the same need everywhere a page is read): a page reader that refuses private addresses at every hop; unwinding Google News wrapper links; a headline-overlap and queue-duplicate check; the seed list plumbing (7-day expiry, archive, "Yours" flag).
- **Cannot be shared**: where the body comes from (link read, typed notes, model-written scope), how the idea is scored (Jev passes, a fixed formula, a mid-pool constant, Sonnet scope + Jev), and what the night does with it. These are per-type decisions.
- **Gaps this exposes, not fixed here:**
  1. ~~Carousels and Last Few Days checked only the first host.~~ Fixed 2026-10-30: the shared article extractor now checks every redirect hop and resolved address (`tests/extract-article-body-private.test.ts`).
  2. Stories seeds have no duplicate check and no expiry.
  3. Last Few Days and Stories seeds can reach the night unprompted. Whether that is wanted is a per-type decision, not yet made.
  4. Explainers' typed topics cost real money (Sonnet + Jev, and a render if promoted) without a quote.
- **To confirm before relying on this:** the (?) cells above; whether Explainers reads the source URL; whether Carousels' night really skips seeds.

## 5. One shared seed button (2026-11-02, approved by Tommy)

Every idea pool shows the same "Seed an idea" button (`components/content-type/SeedButton.tsx`): same label, drawer title, placement and result note. Only the form inside the drawer is per type, because the inputs and costs differ (section 1). It is on the new Social Hub pool pages (`PoolScreen.tsx`, page header actions) and on the old per-type pages, which now use the same component.

- **Pools with a seed:** Text on Screen, Carousels, Last Few Days, Stories, Explainers. The list is `lib/content-type/seed-verticals.ts`; the button map is exhaustive over it, so adding a pool there without a form will not compile.
- **AI Events: no seed, on purpose.** Decided 2026-11-02 not to build one tonight. It has no seed path today (its pool only has Pin and Exclude), the button renders nothing there, and a test pins that it is the only pool without one. A seed there would mean adding an event by link or text; it needs its own design (scoring, whether it costs a model call) and Tommy's approval before any live call.
- **Still out of scope:** Stories duplicate check and expiry; an Explainers cost quote. The paid Text on Screen search stays gated off.
