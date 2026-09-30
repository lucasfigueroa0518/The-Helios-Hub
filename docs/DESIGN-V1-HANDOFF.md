# Helios Social carousel design v1: handoff spec

> **Editorial rules moved (2026-09-29).** The priority ladder, context policy, story slide count (now 5–8), photo tiers and glossing rule live in `lib/social/editorial/v2/rules-block.ts` — the canonical source, imported by every stage prompt. Rules in this doc's **Prompt changes**, **Rhythm** and **Slide types** sections are the design-v1 intent but are no longer authoritative: where they disagree with the block, the block wins. When a rule changes, edit the block, not this doc.
>
> Layout, color, typography, cover template and CSS still live here — those are the design contract, not editorial rules.

## Read this first

This spec replaces the look of the v2 carousel slides. It was written from `docs/design-inventory.md` and a reviewed mockup (the "Helios Carousel Redesign" artifact, version 8). The inventory's file paths are real; treat everything else here as the intended behavior and map it onto the code as it is.

What is fixed and must not change:
- **The cover template.** `CoverSlide` renders exactly as it does today: uppercase Pragmatica headline anchored bottom-left, white and orange only, orange arrow bottom-right. Do not restyle it.
- The slide types, the type and color rules, and the Writer field mapping below.

What is up to you: component structure, CSS organization, and how the adapter maps fields to layouts.

## Why this change

The v2 writing pipeline now produces accurate posts, but the rendered slides look unfinished:
- Body text shrinks from 40px to 22px as it gets longer, so most slides show tiny text.
- Headline and body sit in the top third and the rest of the slide is empty.
- The dim brand green (#138510) colors every company name and date, and orange lands on random phrases.
- Every slide uses the same one or two layouts.
- The renderer carries 9 layout families and 21 variants, and v2 uses 6. The design skill installed at `~/.claude/skills/helios-social-skill/SKILL.md` is an old version that contradicts the code (masthead, slide index, corner marks, texture).

Goal: every slide reads like the cover does. Big type, one idea, a different layout on each swipe.

## Slide types

Seven types plus the follow slide. The Writer's fields decide the type; the adapter never guesses.

| Type | Writer fields | Layout |
|---|---|---|
| **Cover** | COVER, COVER HIGHLIGHT, COVER IMAGE | Unchanged template. With a brief image: the photo fills the whole slide, darkened under the headline (the template's existing bleed mode). Without one: dark canvas, as today. |
| **Text** | HEADLINE + BODY (+ optional IMAGE) | Top-anchored. Headline states the slide's point. Body under it. If IMAGE is a brief image, the photo occupies the bottom half of the slide, full width, fading upward into the canvas so the text area stays clean. |
| **Landing line** | HEADLINE only | One statement, vertically centered, very large. An optional short NOTE line under it in small muted text. |
| **Stat** | BIG NUMBER + NUMBER NOTE, HEADLINE, optional BODY | Headline at the top. Big number near the bottom with its note under it. Optional supporting photo between headline and number. |
| **Split stat** | BIG NUMBER + NUMBER NOTE, SECOND NUMBER + SECOND NOTE, HEADLINE | Headline at the top. Two numbers side by side near the bottom above a hairline, each with its note. The second number is orange. Optional supporting photo between. |
| **Quote** | QUOTE + QUOTE BY | Orange opening quote mark, the quote set large in Pragmatica, attribution in small mono caps. Optional round speaker photo above, only when a brief image shows that speaker. |
| **Image slide** | IMAGE: brief image N + HEADLINE only (no BODY) | Cover-style full-bleed treatment mid-carousel: photo fills the slide, headline anchored at the bottom. A slide with headline **and** body plus an IMAGE uses the Text slide's bottom-half fade layout instead. |
| **Follow** | FOLLOW | Unchanged. |

Rules:
- Never render a photo slot empty. If a slide type's optional photo is missing, render its type-only version.
- An image appears only when the IMAGE line names a brief image that passed image validation. No AI images, no drawn shapes, no stock photos.
- Every photo is credited in the caption, as today.
- Remove the 5×5 pictogram grid and the two-bar chart fallback. Numbers render as type only.

## Type

All sizes are at 1080 × 1350. Margins stay at 96px left and right.

| Role | Face | Size |
|---|---|---|
| Cover headline | unchanged | unchanged |
| Text headline | Pragmatica Extended Bold, uppercase | 100px, may step down to 84px and then 72px for long headlines |
| Landing line | Pragmatica Extended Bold, uppercase | 125px, may step down to 104px and then 88px |
| Big number (stat) | Pragmatica Extended Bold | 260px, shrinking only by character count as today |
| Numbers (split stat) | Pragmatica Extended Bold | 146px |
| Quote | Pragmatica Extended, semibold if available, sentence case | 69px, may step down to 56px |
| Body | Roboto Regular (400) | **44px, fixed. Never shrinks.** Line height 1.32 |
| Notes, number notes, attribution | Roboto Regular / Roboto Mono | 38px / 28px mono caps |

**Body text never shrinks and never clips.** The Writer's 220-character body limit fits at 44px in six lines or fewer. If a body still overflows, that is a failed render: log it and send the post to human review. Do not shrink or cut it.

Remove the `data-length` body buckets (40px → 22px) for body text.

## Color

- Canvas #0A0A0A, text #FFFFFF, muted text rgba(255,255,255,.66).
- **Orange #FF5E1A:** the HIGHLIGHT phrase only, at most one per slide. Also the quote mark, the cover arrow and the second split number.
- **Green: switch to #1BBF17.** Use it only on names of people and companies, detected from the brief's TERMS list. Dates, terms and numbers stay white. No green on the cover.
- Keep the top-right HELIOS wordmark on every slide except the cover and follow.

## Rhythm

- No two slides in a row share a type. The Writer is told this (see "Prompt changes"); the Editor enforces it in its flow check; code checks it.
- Most posts will be mostly Text slides with the other types as breaks. That's expected.

## What gets removed

- Layout families v2 never reaches: `source`, `proof`, `thesis`, `debate`.
- Variant codes that only exist for them or that nothing emits: B2, B3, B4, B6, B7, D2, D3, C4, P1, T1, T2, Q2. Keep the variant codes the new types need.
- Dead CSS listed in the inventory's section G, and the suppressed chrome (category chip, slide index, corner marks, bottom wordmark).
- The old design skill at `~/.claude/skills/helios-social-skill/SKILL.md`. Replace it with a short skill that restates this spec, so the spec and the code can't disagree again.

Confirm each removal against the code first. If anything outside the v2 carousel still uses a layout, keep it and tell me.

## Prompt changes

These are the only prompt edits in this handoff. Paste them as written.

**Writer, "## The slides" section.** Add after the bullet that begins "Posts have 5 to 10 story slides":

> Vary the slides. Each slide is one kind, set by the lines you fill in:
> - Text: HEADLINE and BODY. Most slides.
> - Landing line: HEADLINE only, for the one statement the story turns on. Add a NOTE line only if a reader needs one term explained.
> - Stat: BIG NUMBER with a NUMBER NOTE and a HEADLINE, when one number is the point. The big number is the number the headline is about.
> - Split stat: BIG NUMBER and SECOND NUMBER, each with a note, when two numbers only make sense side by side.
> - Quote: QUOTE copied word for word from the sources, with QUOTE BY.
> - Image slide: IMAGE set to a brief image of the slide's subject, with a HEADLINE.
>
> Don't use the same kind twice in a row. Headlines state the slide's point ("Training is paused"), never a label ("The response").

**Writer, "## The slides" section.** Replace the bullet that begins "For images, use a numbered image from the brief" with:

> - For images, use a numbered image from the brief when it shows the slide's subject, like "brief image 2." Otherwise write "type only." Never describe an image to be made.

**Writer, handoff format.** In the COVER IMAGE and IMAGE lines, replace `a numbered image from the brief ("brief image 2"), a description of what the image should show, or "type only"` with `a numbered image from the brief ("brief image 2") or "type only"`.

**Writer, handoff format.** Add these optional lines to each SLIDE block:

```
NOTE: <optional, landing line only>
NUMBER NOTE: <what the big number counts>
SECOND NUMBER: <optional>
SECOND NOTE: <what the second number counts>
QUOTE: <exact words from the sources>
QUOTE BY: <who said it, and where>
```

**Writer, "## Length limits".** Add:

> - Note, number note, second note: 60 characters (about 9 words)
> - Second number: 12 characters
> - Quote: 200 characters (about 32 words)
> - Quote by: 60 characters

**Editor, "Flow" check.** Add at the end of the paragraph:

> No two slides in a row should be the same kind. If they are, change one or merge them.

**Editor, "Images" check.** Replace the paragraph with:

> **Images.** Each IMAGE and COVER IMAGE is a numbered image from the brief that shows the slide's subject, or "type only."

**Editor, output step 2.** Replace `(HEADLINE, BODY, BIG NUMBER, HIGHLIGHT, IMAGE)` with `(HEADLINE, BODY, NOTE, BIG NUMBER, NUMBER NOTE, SECOND NUMBER, SECOND NOTE, QUOTE, QUOTE BY, HIGHLIGHT, IMAGE)`.

**Fact-checker, flag list.** Add:

> - a quote that isn't word for word what the sources say, or is credited to the wrong person

## Adapter and code checks

- Parse the new labels: NOTE, NUMBER NOTE, SECOND NUMBER, SECOND NOTE, QUOTE, QUOTE BY.
- Map fields to types exactly as in the table above. A slide with QUOTE is a Quote slide; with SECOND NUMBER, a Split stat; with BIG NUMBER, a Stat; with a brief-image IMAGE and HEADLINE only (no BODY, no numbers, no quote), an Image slide; HEADLINE only (no image), a Landing line; HEADLINE and BODY, a Text slide (the Text slide carries the optional bottom-half fade photo when IMAGE is a brief image).
- The HIGHLIGHT substring check also accepts phrases from QUOTE and NOTE.
- New code checks (soft, like the existing length checks): the limits above, "no two consecutive slides share a type", and "a post with 6 or more slides between the cover and the follow slide must use at least 3 different slide kinds" — otherwise the Editor gets it back with a note to mix in a Landing / Stat / Split stat / Quote / Image slide.
- The numbers-trace check covers NUMBER NOTE, SECOND NUMBER and SECOND NOTE.
- A QUOTE must appear word for word in a fetched source text (after normalizing curly quotes and whitespace). This is a hard check.

## Preview renders

- Hide the Next.js dev badge (the small "N" bottom-left) in `--render-preview` output.
- Keep the PREVIEW stamp.

## Acceptance

Free re-renders only, no new pipeline runs:
1. Re-render Run 6 (`runs/2026-09-28T22-05-25-336Z`) and Run 7 (`runs/2026-09-28T23-43-12-132Z`) previews. Those posts predate the new fields, so they will only use Text, Landing and Stat. That's expected.
2. The cover is pixel-identical to its current render, minus the dev badge.
3. No body text below 44px anywhere. No clipped text anywhere.
4. Green appears only on names, in #1BBF17. At most one orange phrase per slide.
5. No layout family or variant outside this spec is reachable from the v2 adapter.
6. Mocked tests cover the new field parsing, the type mapping, the rhythm check and the quote check.

Then one live run (about $0.60, ask first) on a new article, so the Writer uses the new slide kinds, with `--render-preview`.

## Target look — the reference post

The approved fixture at
`runs/design-v1-fixture-with-photos/preview/` is the canonical rendering
of design v1. Every post the pipeline ships should match its look, per
slide type. The Post JSON is at
`runs/design-v1-fixture-with-photos/post.json`; re-render with
`npx tsx scripts/social_v2_fixture.ts`.

Nine slides, one demo per photo layout:

| Slide | Type | Demonstrates |
|---|---|---|
| `slide-00.png` | Cover (photo-bleed) | Full-bleed photo + uppercase Pragmatica headline bottom-left + orange highlight + orange arrow bottom-right |
| `slide-01.png` | Text (with photo) | Headline + body top-anchored, photo fades in from the bottom half |
| `slide-02.png` | Landing | Centered giant Pragmatica headline + muted NOTE explainer |
| `slide-03.png` | Split stat (with photo) | 100/84/72 headline ladder, mid-slide photo, two numbers side-by-side above hairline, second orange |
| `slide-04.png` | Quote (with speaker photo) | 260px round speaker portrait, orange opening quote glyph, sentence-case Pragmatica quote, mono attribution |
| `slide-05.png` | Image slide | Full-bleed photo, headline only anchored bottom-left (no body — a Text slide with body + image takes the bottom-fade layout instead) |
| `slide-06.png` | Stat (with photo) | Headline top, supporting photo mid, 260px big number bottom + muted note |
| `slide-07.png` | Text (with photo) | Second text-with-photo example; green pivot on the proper name (`OpenAI`), orange highlight on the HIGHLIGHT phrase |
| `slide-08.png` | Follow | HELIOS lockup + @heliosgroup.ai 44px orange + story-specific line 38px full-white |

The type-only fixture at `runs/design-v1-fixture-no-photos/preview/`
covers the same eight slides (no image slide, no photos) as the reference
for posts that don't have brief images.

## Not in scope

- Any change to the cover template.
- Images beyond real, credited brief images.
- The daily top-10 job.
