# Copy-quality wave, 2026-10-05: proposed prompt rewrites

Status: approved by Lucas and built on 2026-10-05 as `copy-caption-v17`, with the teaser, escaping, and dedupe changes (D-245 to D-247). Edit 1 is the bucket-rule version (D-249). Offline tests: `tests/reels-copy-quality-wave.test.ts`.

When approved, the writer becomes `copy-caption-v17`. `copy-caption-v16` is retired. Every new string goes through the same tells test as the old ones (`tests/reels-copy.test.ts`: no dashes, no bold, no "not just", no stock words).

Ground rules for these edits:

- No phrase from a winning reel goes into prompt text. Each edit is a test, a scope, or an order, not a template.
- Each edit says how it keeps the output range open.
- Line numbers refer to `lib/reels/copy/skill.ts` at the checkpoint.

---

## Edit 1. The tests go into the bucket rules and framework logic (D-249, replaces the precedence change in D-243)

Lucas, 2026-10-05: bucket rules and framework logic are the core of the system and keep precedence. These edits improve them; they don't outrank them.

So "Which instruction wins" (`skill.ts` lines 59 to 69) does not change. The tests are written into the layer that owns each one, which leaves no conflict to rank:

| Test | Lives in | Edit |
|---|---|---|
| Saga copy lands on an outcome that already happened, when the sources report one | The Saga bucket rule | 1a below |
| A figure needs an implication for someone, and a second figure is not one | The Number bucket rule | 1b below |
| Caption parts are content, not an order | The Number bucket rule | 1c below |
| The Number's example copy | The Number bucket rule | Edit 13 |
| Arousal cost and viewer address | Arousal framework logic | Edit 9 |
| Arousal close, call to action, Helios fallback | Arousal framework logic | Edit 10 |

The hook questions (Edit 5) and the caption rule (Edit 7) stay in the skill as the working checks. They now agree with the bucket and framework text instead of competing with it. The stake edits (3 and 4) never conflicted with bucket or framework text, so they need no new home.

Only the copy writer reads this spec text. The Jev scoring prompts have their own wording, so these spec edits change writing, not idea scores. Run `npm run reels:sync-copy-text` after editing.

### 1a. The Saga, Copy line

`planning/Trial Reels/PRODUCT_SPEC.md` line 111.

Before:

```
- Copy: Cold open at peak tension, then chronology. 20–32 words on one screen, longer than the other buckets.
```

After:

```
- Copy: Cold open at peak tension, then chronology. Where the sources report an outcome that already happened, the copy builds to it. Where they report none, the copy lands on the strongest true beat, and no outcome is invented. 20–32 words on one screen, longer than the other buckets.
```

### 1b. The Number, Copy line

Line 100.

Before:

```
- Copy: One statistic, one implication. Under 15 words. No preamble.
```

After:

```
- Copy: One statistic, one implication. The implication says what the figure does to someone or lets them do. A second figure, a ranking, or a comparison is more of the statistic, not an implication. Under 15 words. No preamble.
```

### 1c. The Number, Caption line

Line 101.

Before:

```
- Caption: Source, methodology caveat, then what it means for the viewer's work or life. Can be told like a story with a plot.
```

After:

```
- Caption: Source, methodology caveat, and what it means for the viewer's work or life, each placed where the story needs it. Can be told like a story with a plot.
```

Range: each edit says when the rule applies and leaves the shape, the opener, and the order to the writer. 1a protects stories with no landed outcome, 1b still allows two figures as long as one beat carries the implication, and 1c removes an order.

---

## Edit 2. How the hook formulas are used (D-243)

`skill.ts` line 107, the end of the paragraph before the hook questions.

Before:

```
A line that restates the one before it weakens the hook. Apply the framework's hook formulas and the bucket's live hook formulas to the copy as a whole. Test the whole copy with these questions before you keep it:
```

After:

```
A line that restates the one before it weakens the hook. The framework's hook formulas and the bucket's live hook formulas are directions the copy as a whole can take. Use the one that fits this story's strongest true beat, or none of them. Test the whole copy with these questions before you keep it:
```

Changed after approval: "They outrank any formula" is dropped. With the precedence order unchanged (Edit 1), it would claim a rank the skill doesn't give it. Formulas are now optional, so nothing needs ranking.

Why: "Apply" made the formulas required, and the Counter-Intuitive Truth and Hidden Mechanism shapes produced the "one tweak fixes it" and mechanism-first leads. Range: widens. Formulas stay available; using none is now allowed.

---

## Edit 3. The stake belongs to this story (D-244)

`skill.ts` line 105, after the entertainment sentence.

Before:

```
For a story told as entertainment, it is what is on the line for the people in it, in terms anyone feels: a record that stood for 80 years, a life's work, a fortune. What stays open for the caption is how it happened, what to do about it, or what comes next.
```

After:

```
For a story told as entertainment, it is what is on the line for the people in it, in terms anyone feels: a record that stood for 80 years, a life's work, a fortune. A stake has to belong to this story. If the same sentence would fit most posts about AI, it is not the stake yet, so find what this story's facts put on the line. What stays open for the caption is how it happened, what to do about it, or what comes next.
```

Why: stakes like "and you may use AI like it" and "which bears on the safety of the AI you use" fit any AI story, and the copy inherits them. Range: the stake vocabulary (money, time, safety, work, the AI they use) stays; only the fits-anything version is sent back.

---

## Edit 4. The viewer stake is tested first (D-244)

`skill.ts` line 115.

Before:

```
Before you draft, write the viewer stake: one plain sentence, 20 words at most, saying why this viewer should care. Report it in the viewer_stake field. Both on-screen copies carry that stake in their own words, and the caption's first paragraph pays it out.
```

After:

```
Before you draft, write the viewer stake: one plain sentence, 20 words at most, saying why this viewer should care. Put it through hook question 1 and, in The Saga, hook question 4 before you write anything else. The stake picks the beat that both copies and the caption's opening reach for, so a stake that fails a question fails everything built on it. Report it in the viewer_stake field. Both on-screen copies carry that stake in their own words, and the caption's first paragraph pays it out.
```

Why: the stake is written first, and the same-story check holds the copy to the caption opening. A check that runs only at the end comes too late. Range: same test, applied earlier.

---

## Edit 5. The hook questions (D-238, D-239)

`skill.ts` lines 109 to 111. Questions 2 and 3 do not change.

Before:

```
1. Could a viewer say, in their own words, what happened and why it matters? If not, rewrite it. Where the bucket's resolution puts the payload on screen, land the payload in full.
2. Could someone scroll past it? If the first words do not ask for attention, or a later line lets the pull drop, rewrite it.
3. Is the payoff implied? By the last line, the viewer should sense what the caption gives them for opening it, even while the specifics are held back.
```

After:

```
1. Could a viewer say, in their own words, what happened and why it matters? If not, rewrite it. Where the bucket's resolution puts the payload on screen, land the payload in full. When the copy rests on a figure, why it matters is what that figure does to someone or lets them do. A second figure, a before and after, a ranking, or a contest between two systems tells more of what happened. It does not say why it matters, so the copy still needs that beat.
2. Could someone scroll past it? If the first words do not ask for attention, or a later line lets the pull drop, rewrite it.
3. Is the payoff implied? By the last line, the viewer should sense what the caption gives them for opening it, even while the specifics are held back.
4. In The Saga, where does the copy land? Read its last beat. If that beat is something that could happen, an estimate of what was possible, or what someone wants, plans, or demands, look in the sources for an outcome that already happened to someone or something in the story. When the sources report one, the copy reaches it. When they report none, keep the strongest true beat and say so in outcome_note. This question reinforces a pattern that works. It does not rank stories. A Saga with no landed outcome can still be the strongest post of the night, and an outcome is never invented or stretched from a possibility.
```

Why: same-story pairs show the landed beat and the human-unit implication score far higher on stake. Range: question 1 does not name a unit, an order, or which figure leads, and two figures stay allowed. Question 4 applies only to The Saga, accepts outcomes that happened to "something" as well as someone, and says outright that stories without one are fine (your note on risk 5).

---

## Edit 6. How to work, steps 1 and 6 (D-244)

`skill.ts` line 139, and one clause in line 144.

Before (step 1):

```
1. Read all the source material and find the one element the post turns on. If the sources hold two stories, pick one. Write the viewer stake for it.
```

After (step 1):

```
1. Read all the source material and find the one element the post turns on. If the sources hold two stories, pick one. Note what the sources report as already done and what they report as possible, estimated, or wanted. Write the viewer stake for it, and test it against hook question 1 and, in The Saga, hook question 4 before you go on.
```

Before (in step 6):

```
that each copy carries the viewer stake, that each copy works as a hook from its first word to its last,
```

After (in step 6):

```
that each copy carries the viewer stake, that the stake and each copy pass every hook question, that each copy works as a hook from its first word to its last,
```

Range: ordering only.

---

## Edit 7. Caption parts name content, not order (D-240)

`skill.ts` line 127.

Before:

```
Follow the bucket's caption rules for structure and content. The caption ends when that structure ends. Leave the call to action and the hashtags out of the caption.
```

After:

```
Follow the bucket's caption rules for what the caption contains. A bucket's list of caption parts names what has to be in the caption. It does not set their order and does not ask for a labelled paragraph per part, unless the bucket says its order is fixed. Place each part where the story needs it. A source can be named in the sentence that uses its fact, and a caveat can sit beside the claim it limits. The caption ends when every part the bucket asks for is in and the close has landed. Leave the call to action and the hashtags out of the caption.
```

Why: The Number's "Source, methodology caveat, then what it means" was being written as three labelled sections, often with the caveat before any content. Personal Profile says "Six parts in fixed order", so it keeps its order. Range: removes a constraint. A labelled structure is still allowed; it is just no longer implied.

---

## Edit 8. When Helios can be named (D-241)

`skill.ts` line 81, in Voice.

Before:

```
Where the bucket asks the caption to establish Helios, name Helios in the third person, in one line, with no pitch.
```

After:

```
Where the bucket asks the caption to establish Helios, or the framework's writing logic sends the close to Helios, name Helios in the third person, in one line, with no pitch.
```

"There is no pitch and no offer of Helios services" in The account's job stays word for word. A test pins that sentence.

---

## Edit 9. Arousal on-screen logic (D-243)

`FRAMEWORK_WRITING_LOGIC.arousal.onScreen`, `skill.ts` line 172.

Before:

```
Lead with the fact in the source that raises anger, awe, anxiety, or amusement, and state it flatly. The fact does the work, so leave out adjectives that try to add heat. For anxiety, address the viewer and name what they stand to lose, using a cost the source states. For awe, give the scale in the source's own figure. Drop any calm, sad, or content framing, because low-arousal emotion lowers the urge to act. Never raise the stakes past what the source supports.
```

After:

```
Lead with the fact in the source that raises anger, awe, anxiety, or amusement, and state it flatly. The fact does the work, so leave out adjectives that try to add heat. For anxiety, use a cost the source states. Where the source reports that cost landing on someone, show it landing. Where it does not, name what the viewer stands to lose. Address the viewer only when the line still reads as this story with them in it. For awe, give the scale in the source's own figure. Drop any calm, sad, or content framing, because low-arousal emotion lowers the urge to act. Never raise the stakes past what the source supports.
```

Why: "address the viewer and name what they stand to lose" asked for a possible loss in the second person on every anxiety story, even when the source had a real one. Range: both routes stay. The landed cost comes first only when the source has it, and addressing the viewer stays allowed.

---

## Edit 10. Arousal caption logic: the close, the call to action, and the Helios fallback (D-241)

`FRAMEWORK_WRITING_LOGIC.arousal.caption`, `skill.ts` line 174.

Before:

```
Keep the charge the copy raised and give it somewhere to go. Explain the mechanism behind the fact in plain terms, then what the viewer should make of it or change. Fear with no way out reads as fear farming, so name the way out wherever the source supports one. Call to action: ask the viewer to send the post to one specific person who should see it, such as the friend or coworker who does the thing at risk, because high arousal is what drives sharing.
```

After:

```
Keep the charge the copy raised and give it somewhere to go. Explain the mechanism behind the fact in plain terms, then what the viewer should make of it or change. Fear with no way out reads as fear farming, so name the way out wherever the source supports one. The close belongs to this story. If the last paragraph could end a caption about a different story, rewrite it from this story's facts or cut it. Call to action: ask the viewer to send the post to one specific person who should see it, such as the friend or coworker who does the thing at risk, because high arousal is what drives sharing. Name that person by something they do or believe that this story is about. If the description would fit a post about a different story, it is too broad. When the source offers neither a way out nor a person who does the thing at risk, do not invent either. End the caption on one line that names Helios in the third person as the account that follows stories like this, with no pitch, and make the call to action an ask to follow Helios for the next story like this one.
```

Lucas picked Option A, follow Helios, for the fallback call to action.

Why: 13 of 44 captions ended on a "check your AI" moral that didn't come from the story, and generic calls to action ("uses ChatGPT every day") showed up exactly where the story had no one at risk. Range: both rules are rejection tests, so any close or person built from the story passes. The Helios line applies only when there is nothing real to say, which replaces filler rather than options.

---

## Edit 11. report_copy tool descriptions (D-238, D-241, D-244)

`lib/reels/copy/report.ts`.

`viewer_stake`, before:

```
One plain sentence, 20 words at most, saying why this viewer should care. Both on-screen copies carry it in their own words, and the caption's first paragraph pays it out.
```

After:

```
One plain sentence, 20 words at most, saying why this viewer should care. Tested against the hook questions before either copy is drafted. It belongs to this story: a sentence that would fit most posts about AI is not a stake yet. Both on-screen copies carry it in their own words, and the caption's first paragraph pays it out.
```

`call_to_action`, before:

```
The one call to action, as a single line.
```

After:

```
The one call to action, as a single line. A person it names is described by something this story is about.
```

New optional field `outcome_note`, stored with the working fields:

```
For The Saga: whether the sources report an outcome that already happened, and which beat the copy lands on. One sentence. Leave empty for other buckets.
```

This field is what makes "say so in outcome_note" in Edit 5 work. Over time it also shows how often the pool offers no landed outcome, which feeds topic selection.

---

## Edit 12. Ideas that return on a later night (D-242)

`lib/reels/copy/assemble.ts`, `draftTask`. The draft task is unchanged when the idea is new. When the idea has copy from an earlier New York date and never shipped, this block goes after the first paragraph, in the uncached task block (`user[1]`), so the cached prefix does not change.

Before: no such block.

After:

```
This post idea was written on an earlier night, and no copy cleared the bar. These on-screen copies were tried then. Each one is shown with how a first-time viewer scored its plain read and stake, from 0 to 1.

Copy 1, from {date}: "{copy}" Plain {0.00}. Stake {0.00}.
...

They are here so tonight's copies take a different way in. Do not edit them or reuse their first lines. Open on a different beat, figure, or person from the sources where the sources have one, and keep the facts that matter. Every rule in this prompt still applies.
```

The block lists at most 8 copies, most recent first, with duplicates collapsed. Range: this widens the range by construction. It rules out shapes already tried and leaves everything else open, and when the sources have only one fact worth using, it says to keep it.

---

## Edit 13. The Number's example copy (approved, D-249)

`planning/Trial Reels/PRODUCT_SPEC.md` line 103, then `npm run reels:sync-copy-text`.

Before:

```
- Example copy: "95% of company AI projects stall in testing. The AI is rarely why."
```

After:

```
- Example copy, three different shapes: "95% of company AI projects stall in testing. Most of that budget is gone." "Nurses spend 2 hours a shift fixing AI notes, time taken from patients." "Your AI assistant gets 1 in 8 dates wrong. The invites still go out."
```

Why: the old example's second sentence is a tease where the implication should be, and unshipped lines copied that shape almost word for word ("Accuracy wasn't why.", "Thinking longer wasn't why.").

Lucas asked for more examples. Three examples showing three shapes give the writer a range instead of a single template to copy:

| Example | Words | Opens on | Implication lands on |
|---|---|---|---|
| 95% of company AI projects… | 14 | the figure | the money spent |
| Nurses spend 2 hours a shift… | 13 | a group of people | the people they serve |
| Your AI assistant gets 1 in 8… | 14 | the viewer | what happens next |

All three are invented, like the original, and none comes from a reel. All are under the 15-word limit.

Left unchanged on purpose: the codified hook formulas in the framework spec (Hidden Mechanism, Counter-Intuitive Truth, and the rest). They're the research grounding, and the curiosity framework uses them legitimately. Edits 1 and 2 make them options that rank below the tests, which is enough to resolve the conflict.

---

## Not prompt text: built after approval

These are code changes with no model wording. They're listed so one approval covers the wave.

- D-245, teasers: teaser markers are detected in feed bodies and fetched pages. An item that fails gets the full article fetched through the existing follow-the-link path, and if it still fails it's dropped at ingestion with drop reason `teaser`. `FULL_TEXT_MIN_CHARS` goes from 600 to 800. Hugging Face paper abstracts are whole items, not teasers, and they clear 800 (median 1,463), so they stay.
- D-246, escaping: one normalizer for every model-written field (on-screen copies, caption, call to action, viewer stake). It repairs `\n`, `\r\n`, `\t`, `\"`, `\\`, and `\uXXXX`. Then a check fails the report and retries on anything left over: backslash escapes, tool JSON keys such as `"call_to_action":`, or a call to action or hashtags inside the caption body. A last gate in the posting path runs the same normalizer and check on the assembled caption, so stored rows are covered too. Tests use the real artifacts from Sep 30 and Oct 3 as fixtures.
- D-247, dedupe: an idea whose canonical or cited URLs match a reel published in the last 30 days is held out of the slots for good and logged. The web search's do-not-cover list adds the headlines of reels published in the last 30 days. P-01's wording does not change.
- Worker sync: these touch the orchestration worker, so the same session redeploys the GCP VM (`./scripts/gcp/deploy-worker-code.sh`).
