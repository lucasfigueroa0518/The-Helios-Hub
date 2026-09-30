# Jev grading pass: design

Status: design, not built. Decisions from Tommy (2026-09-29): Jev judges only what a reader sees; a pass requires all four qualities; strict bar (it may reject a good post rather than pass a weak one); Jev is tuned to Tommy's and Lucas's hand grades before it controls anything.

## 1. What Jev is, and why that shapes everything

Jev (TypeSafe `systemOne`) doesn't write critiques. It reads a short **state** and answers yes/no questions (**Nouls**), returning a calibrated probability for each. Input is cheap, output is free, and the context window is small. So the design is:

- **Small, exact state:** the post as a reader sees it, and nothing else.
- **Few, concrete questions:** one per quality, plus one per slide. Vague questions ("is this good?") give noisy probabilities. Concrete ones ("does slide 4 tell the reader anything the cover didn't?") give sharp ones.
- **Code does the rest:** thresholds, the pass rule, ranking the 6 drafts, and turning failed questions into feedback for the rewrite.

## 2. State (what Jev reads)

The cover and story slides exactly as rendered, numbered, with nothing else: no brief, no sources, no caption, no follow slide.

```
COVER: <text>
SLIDE 2 (text): <headline> | <body>
SLIDE 3 (quote): "<quote>" | <quote by>
SLIDE 4 (stat): <headline> | <big number> | <number note>
...
```

About 1,500–2,500 characters. It's the same view a reader has, so Jev can't be swayed by what the research *could* have said. Whether the best facts were used is checked separately by code (the Writer's unused-facts list).

## 3. The questions

Every instruction starts with the same reader line:
> The reader is smart and busy, curious about AI, but doesn't follow AI news.

| ID | Instruction | TRUE | FALSE |
|---|---|---|---|
| `cover_says_what` | Read only the COVER. | The cover alone tells the reader who did what. | The cover teases, is vague, or needs another slide to make sense. |
| `pulls_through` | The reader has seen the cover and SLIDE 2 in their feed. | They want to keep swiping: what they've read raises something the next slides answer. | They already have the gist; the rest feels optional. |
| `clear_to_outsider` | Read every slide. | Every slide makes sense without prior AI knowledge; any unfamiliar term or name is explained where it appears. | At least one slide relies on a term, name or idea the reader wouldn't know and isn't explained. |
| `why_it_matters` | Read to the last slide. | The reader could say in one sentence what changes because of this news. | The reader knows what was announced, but not what it changes or why it matters. |
| `worth_sharing` | Read the whole post. | A reader would save it or send it to someone, because it tells them something specific they didn't know. | It's accurate but forgettable; nothing in it is worth passing on. |
| `slide_N_earns_place` (one per story slide) | Compare SLIDE N with the COVER and every slide before it. | SLIDE N gives the reader a fact, number, reason, quote or consequence they haven't already been told. | SLIDE N mostly repeats what the cover or an earlier slide said, even in different words, or is filler (logistics, a label, a restated headline). |

Mapping to Tommy's four qualities:
- *Every slide earns its place* → all `slide_N_earns_place`.
- *Pulls you to the next slide* → `cover_says_what` + `pulls_through`.
- *Clear to a non-AI reader* → `clear_to_outsider` + `why_it_matters`.
- *Worth sharing* → `worth_sharing`.

All of these go in **one `systemOne` call** per draft (5 post questions + up to 8 slide questions), so the cost is essentially zero.

## 4. Pass rule and ranking (code)

- **Pass** = every question at or above its threshold. A single filler slide fails the post; that's what "every slide earns its place" means.
- **Thresholds** start strict (0.75) and are then set per question from calibration (§6), chosen so that Jev **never passes a post both graders failed**.
- **Ranking the 6 drafts** when none pass: most questions passed wins; ties go to the higher sum of probabilities. The final pick also weighs story rank, per the flow in the handoff.

## 5. Feedback for Story A's rewrite (code, not Jev)

Each failed question maps to one fixed instruction for the Writer:

| Failed | Instruction to the Writer |
|---|---|
| `slide_N_earns_place` | "SLIDE N repeats what the reader already knows. Replace it with a fact from UNUSED FACTS, or cut it." (with the unused-facts list attached) |
| `cover_says_what` | "The cover must say who did what on its own." |
| `pulls_through` | "Slide 2 gives away the rest. Lead with the first new fact and leave the reader a reason to swipe." |
| `clear_to_outsider` | "A slide relies on something the reader wouldn't know. Explain it where it appears or cut it." |
| `why_it_matters` | "The post never says what changes. Use the fact that answers 'why does this matter?'" |
| `worth_sharing` | "Nothing here is specific enough to pass on. Lead with the most concrete fact: a number, a named consequence, a direct quote." |

## 6. Calibration (before Jev controls anything)

**Grading sheet.** 12–15 posts we already have, as rendered slides:
- old Google CC (Lucas: good) and old Gottheimer (Lucas: headline dragged out);
- the three finals in `Claude outputs/final/`;
- the four `copy-ab` drafts and the two `copy-ab-2` drafts;
- old Suleyman and old Newsom.

For each post, Tommy and Lucas separately mark: pass/fail on each of the four qualities, and each slide as **new** or **repeat/filler**. About 15 minutes each. Where they disagree, they settle it together: that conversation *is* the rubric.

**Targets:**
- Zero posts that both graders failed get a Jev pass (strictness).
- At least 85% agreement on per-slide new vs repeat.
- At least 80% agreement on each quality.

`worth_sharing` is the most subjective; if it can't hit 80%, it becomes a ranking signal only, not part of the pass rule.

**Sanity tests** (free, run on every change to the questions):
1. Take a passing post and add a slide that restates the cover in new words → that slide must fail.
2. Remove the slide that says what changes → `why_it_matters` must drop.
3. Replace a gloss with bare jargon → `clear_to_outsider` must drop.
4. Run the same post twice → same verdict.

## 7. What Jev deliberately doesn't do

- **Accuracy.** That's the fact-checker's job; Jev never sees sources.
- **Layout, lengths, rhythm.** Code and the renderer handle those.
- **Story selection.** That's Jev's existing ranking step, kept separate so a great draft of a minor story doesn't automatically win.

## 8. Versioning

The question texts and thresholds live in one file and are tagged like the prompts (`jev-grader-YYYY-MM-DD`). Every run records the grader version it used. Any change to a question text re-runs calibration and the sanity tests before shipping.
