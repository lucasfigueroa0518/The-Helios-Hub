# Helios Social carousel — design inventory

Read-only snapshot of every layout, variant, token, and chrome element the v2 pipeline can currently produce on the Instagram-format renderer (1080×1350). Written to hand off to the design-audit work — none of this describes what the design *should* be, only what it *is* today.

Source of truth is the code, not the design skill spec. Where the two diverge, both readings are noted below.

**Key files:**
- Renderer component: `lib/social/render/SlideTemplate.tsx`
- Types: `lib/social/render/types.ts`
- Stylesheet: `app/social/render/preview/preview.css`
- v2 pipeline adapter (what feeds the renderer): `lib/social/editorial/v2/adapter.ts`
- Design skill spec: `~/.claude/skills/helios-social-skill/SKILL.md`

## A. Layout families — what actually renders

Each `layoutVariant` value has a dedicated React sub-component in `SlideTemplate.tsx`. `layoutVariant` decides which component fires; `variant` is a CSS modifier passed through as `data-variant="…"`.

| layoutVariant | Component (SlideTemplate.tsx line) | Fields consumed | Key JS branches |
|---|---|---|---|
| `cover` | `CoverSlide` (115–152) | `headline`, `photoUrl`, `photoCredit`, `lightCanvas` | `photoBleed` when `photoUrl && !isPlaceholderPhoto`; double-scrim overlay; auto-scaled headline via `data-length` (5 buckets) |
| `story_beat` | `StoryBeatSlide` (156–227) | `headline`, `title`, `body`, `bodyBottom`, `photoUrl`, `photoCaption`, `photoCredit`, `photoTreatment` | `isB5` (variant === 'B5') promotes `headline` to giant landing, suppresses `body`/`title`/photo; `isBottomFade` anchors photo to bottom with mask gradient |
| `data_block` | `DataBlockSlide` (284–388) | `title` (BIG NUMBER), `headline` (label), `body` (context), `bodyBottom`, `photoUrl`, `photoCaption`, `variant` | `isD3` (variant === 'D3') routes `title` to small green eyebrow; `parseScaleChart` extracts percentage → 5×5 grid OR time/currency → two-bar chart |
| `quote` | `QuoteSlide` (519–536) | `body` (quote text), `headline` (attribution) | none |
| `source` | `SourceSlide` (540–560) | `body` (teaser), `photoUrl` | none |
| `follow` | `FollowSlide` (571–582) | `storySpecificLine` | none — always dark canvas |
| `proof` | `ProofSlide` (590–617) | `body` (article headline), `photoUrl`, `photoCredit` | reads outlet from `post.source`, filters via `cleanOutletName` |
| `thesis` | Routes to `StoryBeatSlide` (line 90 dispatcher) | Same as story_beat; CSS makes it look different | CSS-only differentiation |
| `debate` | `DebateSlide` (621–658) | `headline` (question), `sides[]`, `body` (fallback), `photoUrl`, `photoCredit` | falls back to `body` when `sides` is empty |

## B. Variant codes — the CSS modifier grid

The `variant` union in `types.ts` has 21 values (C1–C4, B1–B7, D1–D3, Q1–Q2, P1, T1–T2, F1). Only these ones actually change something at render time:

| Variant | Applies to | What it does | Route |
|---|---|---|---|
| `C4` | cover | Hides `.helios-cover__headline` — the number IS the cover | CSS-only, `[data-variant="C4"]` selector (preview.css line 1334) |
| `B1` | story_beat | Default chapter-mark stack | Implicit — no CSS scope, just the default StoryBeatSlide path |
| `B2` | story_beat | Hides `.helios-beat__title` — photo carries the beat | CSS-only, `[data-variant="B2"]` (line 1371) |
| `B5` | story_beat | Landing mode: giant Pragmatica headline, no body/photo | JS + CSS: `isB5` branch in SlideTemplate + `[data-variant="B5"]` block (lines 1341–1366) |
| `D3` | data_block | Small green eyebrow instead of giant number treatment | JS + CSS (lines 291, 305–308) |
| `T1` | thesis (routed to StoryBeatSlide) | Landing sentence via CSS class scope | CSS-only, `.helios-slide--thesis` (lines 1380–1387) |

**Every other variant code (C1, C2, C3, B3, B4, B6, B7, D1, D2, P1, Q1, Q2, T2, F1) is either:**
- The *default* rendering of its family (no CSS scope needed), or
- Type-defined but has no CSS scope and no JS branch — effectively a passthrough.

## C. What v2 actually emits vs. what exists

The v2 adapter (`lib/social/editorial/v2/adapter.ts`) has one mapping table for turning plain-text pipeline output into SlideCopy. **v2 currently produces exactly six combinations:**

| v2 slide shape | Emitted as | Adapter line |
|---|---|---|
| Cover + brief image describing a named subject | `cover / C1` | pickCoverVariant (72–94) |
| Cover + non-portrait brief image | `cover / C2` | same |
| Cover + type-only or free-text image | `cover / C3` | same |
| Beat with `BIG NUMBER` | `data_block / D1` | 118–135 |
| Beat with `HEADLINE` only | `story_beat / B5` | 139–146 |
| Beat with `BODY` only | `story_beat / B1` | 150–163 |
| Beat with `HEADLINE + BODY` | `story_beat / B1` | 167–180 |
| Follow slide | `follow / F1` | 185–193 |

**Everything the renderer can draw that v2 never produces (dead code from v2's perspective):**

- `layoutVariant`: `source`, `proof`, `quote`, `thesis`, `debate` — no path from the parser to these
- `variant`: `C4`, `B2`, `B3`, `B4`, `B6`, `B7`, `D2`, `D3`, `P1`, `Q1`, `Q2`, `T1`, `T2`
- Special renderer features unused by v2:
  - `photoTreatment: 'bottom-fade'` (StoryBeatSlide alt mode)
  - `sides[]` (debate two-side layout)
  - `artifact` (proof-clipping metadata)
  - `chartData` (D3 SVG chart — not the parseScaleChart fallback)
  - `lightCanvas` (mid-carousel Helios White interstitial)
  - `panoramaSide` (B6 two-slide panorama)
  - `storySpecificLine` — actually IS used by v2 (follow slide only)

## D. Design tokens in use

**Colors (CSS custom properties on `.helios-slide`):**

| Token | Dark canvas | Light canvas | Use |
|---|---|---|---|
| `--brand-orange` | `#FF5E1A` | same | hook spans, chapter marks, big numbers, follow handle |
| `--brand-orange-soft` | `rgba(255,94,26,.10)` | same | subtle tints (unused in current render) |
| `--brand-green` | `#138510` | same | attribution, labels, pivot spans |
| `--brand-canvas` | `#0A0A0A` | `#FAFAFA` | slide background |
| `--brand-narrative` | `#FFFFFF` | `#171717` | body copy default |
| `--brand-narrative-muted` | `rgba(255,255,255,.72)` | `rgba(23,23,23,.72)` | de-emphasized copy |
| `--brand-narrative-quiet` | `rgba(255,255,255,.55)` | `rgba(23,23,23,.55)` | chrome, mono attribution |

**Fonts (declared as CSS custom properties on `.helios-slide`, resolved from `next/font`):**

| Token | Stack | Where used |
|---|---|---|
| `--font-heading` | `Pragmatica Extended → Helvetica Neue → sans-serif` | cover headline, story-beat title/landing, data big number, debate question, quote glyph |
| `--font-body` | `Roboto → Helvetica Neue → sans-serif` | beat body, data context, source teaser, follow wordmark hero, debate side text |
| `--font-mono` | `Roboto Mono → ui-monospace → Menlo` | attribution, labels, eyebrows, category tag, follow handle |

**Font-size scales (character-count driven via `data-length` bucket):**

| Element | xs (shortest) → xl (longest) |
|---|---|
| `.helios-cover__headline` | 132px → 60px (5 buckets, lines 443–447) |
| `.helios-beat__body` | 40px → 22px (5 buckets, lines 576–580) |
| `.helios-beat__landing` (B5) | 148px → 56px (lines 1362–1366) |
| `.helios-slide--thesis .helios-beat__body` | 104px → 44px (lines 1392–1396) |
| `.helios-data__number` | 260px base, shrinks 5–8 char buckets (lines 691–718) |
| `.helios-data__label` | 96px → 42px (lines 806–810) |

**Fixed sizes:**

| Element | Size |
|---|---|
| Quote text | 72px |
| Category label (design skill spec, unused chrome) | 18px |
| Masthead top-right wordmark | 26px |
| Cover chevron ("→") | 44px |
| Photo caption (in-figure) | ~18–22px Roboto Mono |
| Photo credit (below figure) | 13px green Roboto Mono, 0.10em spacing |

## E. Chrome elements — active vs dead

**Active on every render:**

- **Top-right HELIOS wordmark** on all non-cover, non-follow slides. `showTopWordmark = !isCover && !isFollow` (SlideTemplate line 59). 26px Roboto Bold, 0.40em letter-spacing.
- **Cover chevron "→"** bottom-right of every cover. 44px orange (line 148).

**Suppressed by explicit flag (code + CSS present, JSX doesn't render):**

- **`.helios-chrome__category`** — the green "▸ CATEGORY" chip. `showCategory = false` (line 49). CSS lines 167–182.
- **`.helios-chrome__mark`** — bottom-right HELIOS chrome wordmark. `showWordmark = false` (line 54). CSS lines 184–195, plus a `:has(.helios-cover--bleed)` suppression rule at line 258.
- Comment at line 48: *"Cover has its own byline chrome (outlet · date) + SWIPE → text; the universal HELIOS wordmark would collide with them at bottom-right."*
- Comment at line 55: *"Killed the volume/issue ticker, category label, and slide index — all read as editorial-magazine LARP on a 6" phone screen."*

**Type-defined but no JSX and no CSS calls:**

- **Slide index** (`03 / 10`) — `.helios-chrome__index` CSS at lines 239–254, no JSX writes it.
- **Corner registration marks** — `.helios-cover__corner` CSS at lines 502–533, no JSX writes them.
- **Micro-texture** (rotated "HELIOS · HELIOS · …" down the right edge) — spec calls for it, no evidence in code.

## F. Photo handling

**`photoUrl` renders differently per layout:**

| Layout | Composition |
|---|---|
| Cover (`photoBleed` mode) | Full 1080×1350 background with top + bottom scrims |
| Story-beat (card mode) | 16:10 figure between body-top and body-bottom |
| Story-beat (bottom-fade mode) | Bottom half, `-webkit-mask-image` linear gradient dissolving upward |
| Data-block | 21:9 wide hero band at slide bottom |
| Source | Absolute-positioned portrait on right side |
| Proof | Optional figure at slide bottom |
| Debate | Optional figure at slide bottom |

**`photoCredit`:**

- Story-beat / proof / debate: 13px green Roboto Mono caption below the figure. Filtered by `isPlaceholderCredit()` which drops null, empty, `"PHOTO"`, `"PHOTO ·"`, and anything containing `"ARTICLE HERO"` (lines 252–259).
- Data-block: no on-slide credit rendered.
- Cover: on-slide credit killed by design; moved to caption's attribution block.

**`photoCaption`** (subject/role overlay baked onto the photo, e.g. `"Sam Altman · CEO OpenAI"`):

- Story-beat + data-block: overlay bottom-left with dark scrim (lines 203–206, 378–381).
- Other layouts: not rendered.

**`isPlaceholderPhoto`** (lines 267–270): returns true only for null/undefined URLs — every real URL, including stock/atmosphere shots, renders.

## G. Known dead code + comments

**CSS rules targeting selectors nothing produces:**

| CSS selector | Line | Never rendered by |
|---|---|---|
| `.helios-quote__arrow` | 992–1003 | `QuoteSlide` |
| `.helios-source__cta` | 1051–1059 | `SourceSlide` |
| `.helios-data__source-tag` | 919–930 | `DataBlockSlide` |
| `.helios-debate__prompt` | 1318–1324 | `DebateSlide` |

**TypeScript variants defined but never emitted by v2 adapter:**

- Cover: `C4`
- Story-beat: `B2`, `B3`, `B4`, `B6`, `B7`
- Data-block: `D2`, `D3`
- Quote: `Q1`, `Q2` (whole layout family unused)
- Proof: `P1` (whole layout family unused)
- Thesis: `T1` (whole layout family unused)
- Debate: `T2` (whole layout family unused)

**Comments marking intentional dead work:**

- `SlideTemplate.tsx:48` — cover chrome category tag redundant
- `SlideTemplate.tsx:55` — volume/issue ticker, category label, slide index all "killed"
- `SlideTemplate.tsx:224, 383` — on-slide photo credit killed; attribution moves to caption

## H. Cross-cutting observations

**The v2 pipeline uses roughly a third of the design system's surface.** Every layout family beyond cover / story_beat / data_block / follow (i.e., quote, source, proof, thesis, debate) is reachable from the renderer but has no path from v2's parser output. Same story for over half the variant codes.

**Design system says one thing, code does another** in a few places:

- Design skill §Universal chrome says every non-follow slide gets a masthead strip with wordmark, ticker, and green mono metadata. Code renders only the wordmark and killed the ticker / metadata explicitly.
- Design skill §Cover lists C4 (big-number cover) as a first-class variant. v2 never emits it — if a story's cover phrase happens to be a single number, adapter still routes it to C3 (type-only) unless COVER IMAGE is a brief-image reference.
- Design skill §Slide index says "03 / 10" bottom-right on every slide except cover/follow. Killed in code.
- Design skill §Corner registration marks lists brackets on covers, data, chart, and proof slides. No JSX writes them despite CSS being present.

**Recent renderer fix (2026-09-28, commit `d26399f`):** D1 pictogram grid now honors two guardrails:
- Values under 2% no longer inflate to "1 in 25" filled (would misrepresent).
- Body copy > 120 chars drops the grid so the body doesn't clip off the bottom.

**Photo handling has meaningful surface unused by v2:**
- `photoTreatment: 'bottom-fade'` renders differently from `'card'` — never selected.
- `photoCaption` (subject-name overlay) is renderer-supported but v2 never populates it.
- `lightCanvas` (Helios White interstitial for 1 mid-carousel slide) is renderer-supported, never used.

## I. Open questions for the design audit

Frames only — not decisions:

1. **Layout coverage:** are the missing quote / source / proof / thesis / debate layouts intentional pruning, or should the v2 pipeline learn to emit them?
2. **Variant granularity:** do B2, B3, B4, B6, B7 add real rhythm variety worth reviving, or is the current B1/B5-only palette enough?
3. **Chrome:** are the killed elements (category label, slide index, corner marks, micro-texture) permanently gone or paused?
4. **Cover C4:** the "big number IS the cover" layout is one of the design skill's four cover options. Worth reviving via a Writer prompt tweak (treat single-number covers as C4-worthy) plus an adapter branch?
5. **Photo caption + bottom-fade:** worth wiring into the adapter when the brief has a portrait, or defer to a later pass?
6. **Data-block chart types:** D3 (real SVG chart from structured `chartData`) is renderer-supported but v2 has no path to it. Same for time/currency `parseScaleChart` fallback.
7. **Light canvas break:** the design skill wants one Helios White slide per carousel besides Follow. Never used.

Everything above is descriptive. None of it is a proposal.
