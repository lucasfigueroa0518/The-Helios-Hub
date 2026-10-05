# Helios Social v2: shared blocks for review (VOICE_BLOCK, RULES_BLOCK)

**Status:** PROPOSED (2026-10-04). Nothing imports these yet. They become `lib/social/prompts/voice-block.ts` and `lib/social/prompts/rules-block.ts` only after Tommy approves this file.

**Sources:**

- Old voice block: `lib/social/editorial/v2/voice-block.ts` at tag `helios-social-v2/2026-10-02-root-cause-fixes` (reference only).
- Old rules block: `lib/social/editorial/v2/rules-block.ts`, same tag (reference only).
- Tested Writer rules: `docs/superpowers/specs/2026-10-04-helios-social-prompts.md` §2.

**Instructions this follows (Tommy, 2026-10-04):** carry the voice block over word for word. Build the rules block from the tested Writer rules plus the glossing rule and the context policy.

---

## 1. VOICE_BLOCK: carried over word for word

**Old:** the `VOICE_BLOCK` string in `voice-block.ts`.
**New:** identical, byte for byte. No differences.

```
Direct, dry, confident. A sharp editor, not a press release.

Write the way a person talks:
- Use real names. "Norland Labs says," not "the company says" when you can name it.
- Say who did what. "Norland Labs tested the software," not "the software was tested."
- Read every line aloud in your head. If nobody would say it in a normal voice, rewrite it.
- Vary sentence length. Three short sentences in a row is too many.
- Don't open two slides the same way.

Never use:
- Em dashes, double hyphens (--), emoji or exclamation marks.
- "Not X, it's Y" or "not X but Y" constructions.
- Filler that sounds deep: "at its core," "the real question is," "it's worth noting," "moving forward."
- Announcing instead of saying: "let's dive in," "here's what you need to know," "here's the kicker," "here's why."
- Endings that tack on fake depth: "..., highlighting the growing tension."
- "Serves as," "boasts" or "features" where "is" or "has" works.
- Unnamed authority, like "experts say."
- Glue words: "Meanwhile," "Additionally," "Furthermore," "That said."
- These words: landscape, ecosystem, space (as in "AI space"), game-changer, paradigm, revolutionary, seismic, watershed, pivotal, robust, groundbreaking, unprecedented, delve, testament, reshape, unlock, leverage, empower, elevate, transform, redefine, reimagine.
```

**Not carried over now:** the old file also exported `BANNED_ALWAYS` and `BANNED_JUDGMENT`, the code-check lists derived from this text. Those are checks, so they belong to M5 (mechanical guarantees) and get reviewed there.

---

## 2. RULES_BLOCK: proposed new text

Three sections, each copied word for word from its source. Where they overlap, the overlap is listed under §3 for your call. I haven't resolved any of them myself.

| Section | Source | Changes |
|---|---|---|
| Rules | Tested Writer prompt, `RULES` | None |
| Context policy | Old `rules-block.ts`, `## Context policy` | None |
| Glossing | Old `rules-block.ts`, `## Glossing (advisory, not required)` | None |

**Left out of the old block:** Priority ladder, Story slide count, Slide kinds, Photos. Each one is replaced by a tested Writer rule or contradicts the spec:

- **Photos** keeps the coverage floor and `type only` on stat slides, which spec §5.1 and §5.3a reversed.
- **Story slide count** and **Slide kinds** are covered by the tested lines "5–8 story slides…" and "Slide kinds: …".
- **Priority ladder** isn't part of the tested rules.

**Proposed text:**

```
## Rules

- Every fact from the brief. Describe people/roles only with the brief's words.
- Keep hedges. Claims marked [CLAIM: X says] must keep that attribution on the slide ("X says…").
- Quotation marks only for QUOTES entries, by ID or exact excerpt with "…" (max 140 chars on quote slides). Avoid ⚠ single-source quotes on quote slides unless nothing else works; never use a quote marked as cut off.
- Stat numbers by ID (N1…). Don't compute new numbers.
- Where sources disagree, don't pick a side silently: either show the disagreement or leave it out.
- COVER (≤90 chars): must say who did what on its own. If the main person isn't widely known, lead with role/country, not their name.
- Headlines may be punchy, but never false. Body states the precise version.
- 5–8 story slides. Stop when the story is told; never pad to 8. Headline ≤60, body ≤220 chars.
- Slide kinds: text, stat / split stat (by ID), quote, landing, image. Variety where material supports it.
- Max 2 background slides.
- EVERY slide has an IMAGE line: `subject: <name>`, `article: <photo>` (from ARTICLE PHOTOS), or `stock: <plain 2–3 word scene>`. Stat slides get a symbolic stock scene.
- Write 3 cover options; choose one.

## Context policy

Stay on this one event. Earlier events, other companies or other people appear in TWO shapes:

1. **One sourced clause**, embedded in a slide that is otherwise about the main event (e.g. "the bill would make a voluntary process mandatory").
2. **Up to TWO background slides per post** on "why now" (an earlier event that triggered this news), "what stands in the way" (an earlier action by another party that constrains this one), or a relevant earlier event that a reader needs to grasp the significance of the main event. Each background slide must tell the reader something new and relevant (not restatement, not filler), must name the outside event, and must cite a source. Two is the ceiling — the post is still about the main event, not a history lesson.

Not allowed: repeating a competitor's prior announcement as coverage of this story; recycling the same subject's earlier statements as if they're new; more than two background slides; a market-context paragraph. The Fact-checker and Caption follow the same policy — a slide or caption clause that fits (1) or (2) is not a flag; anything beyond that is.

## Glossing (advisory, not required)

A term needs a gloss only if the slide doesn't make sense without it. If a gloss would eat more than about a fifth of a slide's body, move the definition to the caption or a dedicated slide instead of shrinking the fact. Glosses always come from the TERMS list in the brief; never invent a definition. TERMS explanations count as sourced by the Fact-checker.
```

---

## 3. Overlaps and conflicts for Tommy to decide

The prompts file says: "Where a tested rule repeats one in RULES_BLOCK, keep one copy and use the tested wording." These are the places that rule touches, plus the ones it doesn't settle.

| # | Where | What | Options |
|---|---|---|---|
| 1 | Rules "Max 2 background slides." vs Context policy item 2 "Up to TWO background slides per post…" and "more than two background slides" | Same limit stated twice. Context policy item 2 also defines what a background slide may be ("why now", "what stands in the way", …), which the tested line doesn't. | (a) Keep both as is: same number, no conflict, only repetition. (b) Keep the tested line and cut the count from Context policy, keeping its definition of a background slide. This is a small rewording, so it needs your OK. |
| 2 | Context policy, last sentence | "The Fact-checker and Caption follow the same policy." There's no separate Caption stage now; the Writer writes the caption (spec §4.3). | (a) Keep as is: "Caption" still reads as "the caption". (b) Change "and Caption" to "and the caption". |
| 3 | Context policy, "—" (two em dashes) | The voice block bans em dashes in output. The rules text has them, and so does the old block. Prompts don't render to readers, but models copy the style of their instructions. | (a) Keep word for word. (b) Swap for commas or periods. |
| 4 | Glossing, "TERMS explanations count as sourced by the Fact-checker" | Fits spec §4.2: the Fact-checker never flags a gloss taken from TERMS. Jev claim-checking (M4) has to treat TERMS as a source too. | Note only; no change. |
| 5 | Rules, "Slide kinds: text, stat / split stat (by ID), quote, landing, image" | No `spread`. The prompts file adds the spread rule to the Writer as its own line (spec §5.4). | Note only: the spread line goes in the Writer prompt, not this block, unless you want it shared. |
| 6 | `${renderRulesFor('caption')}` in the carried-over caption section | The old registry rendered code-checked rules for the caption: banned voice list, numbers verbatim, caption under 2,200 chars, no hashtags. It isn't covered by your instruction. | (a) Rebuild it in M5 from the new mechanical checks, so it only lists checks that exist. (b) Drop the placeholder from the caption section and rely on RULES_BLOCK plus VOICE_BLOCK. |

**Prompt caching:** both blocks are static strings, so every prompt that embeds them keeps a stable prefix. The cache breakpoint goes after them, never on the per-story brief.
