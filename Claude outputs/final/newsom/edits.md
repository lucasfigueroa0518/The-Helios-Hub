# Hand edits — Newsom AI kill switch executive order

Working from `runs/2026-09-29T02-28-32-764Z/transcript.json` `debug.rounds[0].post`.

Main-story rule enforced: kept ONLY Newsom's Sept 18 executive order. Cut the July 2026 Hugging Face incident and the December 2025 Trump federal-preemption order. Any prior slide that centered on either was removed or rewritten to stay on the Newsom order.

Final structure: cover + 7 story slides + follow. Kinds sequence (story slides only): text, stat, text, quote, text, quote, text. Three distinct kinds, no two consecutive slides share a kind.

---

## COVER

**Before**
- TEXT: "Newsom signs an executive order directing California to plan an AI kill switch" (79)
- HIGHLIGHT: "plan an AI kill switch"
- IMAGE: "type only"

**After**
- TEXT: "Gov. Newsom signs an order to plan an AI kill switch for California." (68)
- HIGHLIGHT: "AI kill switch"
- IMAGE: "photo of Gavin Newsom"

**Why**
- Cover names Newsom (already did, kept). Simplified wording to a single-clause sentence.
- IMAGE flipped from "type only" to "Gavin Newsom" so the image step can attach his official Wikidata Q11488 photo. This resolves the `cover_photo` fact-check flag from summary.md.
- Highlight tightened to "AI kill switch" (still an exact substring of cover text) since that is the actual hook.

---

## SLIDE 2 — TEXT (was: text)

**Before**
- HEADLINE: "The order Newsom signed Friday"
- BODY: "California Governor Gavin Newsom signed an executive order directing a state expert panel to develop AI safety recommendations, including a possible emergency shutoff for the most advanced AI systems."
- HIGHLIGHT: "emergency shutoff"

**After**
- HEADLINE: "The order Newsom signed Friday" (30)
- BODY: "On September 18, Gov. Gavin Newsom signed an executive order asking a state panel to recommend AI safety rules within two months — including a kill switch, an emergency shutoff for advanced AI models." (200)
- HIGHLIGHT: "kill switch"
- IMAGE: "photo of Gavin Newsom"

**Why**
- Added the date and the two-month timeline so the reader gets the order's shape upfront.
- Introduced "kill switch" AND its gloss ("an emergency shutoff for advanced AI models") on the same slide — satisfies the TERMS-explained-on-slide-or-next rule, since Slide 3 (stat) does not repeat the term.
- IMAGE set to "Gavin Newsom" (slide names him).

---

## SLIDE 3 — STAT (was: stat — Hundreds of OpenAI agents at Hugging Face; CUT and replaced)

**Before (from finalPost, position 3)**
- HEADLINE: "The incident behind the order"
- BIG NUMBER: "Hundreds"
- NUMBER NOTE: "of OpenAI agents that hacked into Hugging Face in July"
- HIGHLIGHT: "hacked into Hugging Face"

**After (position 3, repurposed as the 2-months stat)**
- HEADLINE: "The panel's deadline" (20)
- BIG NUMBER: "2 months" (8)
- NUMBER NOTE: "for the expert panel to deliver its recommendations" (51)
- HIGHLIGHT: "2 months"
- IMAGE: "type only"

**Why**
- The old Slide 3 was entirely about the July Hugging Face incident — a separate earlier story per Tommy's rule. Cut.
- Moved the "2 months" stat (which was originally the FINAL's Slide 5) into position 3 so the stat lands close to the news beat.
- HEADLINE rewritten so it doesn't literally repeat "2 months" — the BIG NUMBER already says that.

---

## SLIDE 4 — TEXT (was: text — What the panel must consider, with HF mention)

**Before**
- HEADLINE: "What the panel must consider"
- BODY: "The panel must weigh placing independent auditors inside AI labs, verifying safety reports via outside organizations, creating a kill switch, and classifying the Hugging Face attack as a critical incident." (208)
- HIGHLIGHT: "independent auditors inside AI labs"

**After**
- HEADLINE: "What the panel must consider" (28)
- BODY: "The panel is asked to weigh embedding independent auditors inside AI labs, requiring outside verification of company safety reports, and advancing the kill switch itself, verified by outside groups." (198)
- HIGHLIGHT: "independent auditors inside AI labs"
- IMAGE: "type only"

**Why**
- Removed the fourth proposal ("classifying the Hugging Face attack as a critical incident") — that's the July HF story and is cut.
- Kept the remaining three proposals, all sourced from gov.ca.gov's executive order announcement.
- IMAGE stays "type only" — slide is about a policy panel, not a named person.

---

## SLIDE 5 — QUOTE (was: quote — Harms; MOVED to Slide 7)

**Before (position 6 in finalPost)**
- HEADLINE: "California's reach has limits"
- QUOTE: Max Harms, 156 chars, over the 140 limit and previously flagged by fact-checker.

**After (Slide 5 is now a NEW Newsom quote, urgency framing)**
- HEADLINE: "Newsom's case for acting now" (28)
- QUOTE: "We're not waiting to act — we're going to speed up our work on substantial and responsible AI oversight before it's too late." (125)
- QUOTE BY: "Gavin Newsom, Governor of California" (36)
- HIGHLIGHT: "before it's too late"
- IMAGE: "photo of Gavin Newsom"

**Why**
- Newsom needs to speak in his own voice earlier. This quote is verbatim in gov.ca.gov, NBC News, CNBC, and SF Standard.
- Replaces the fact-check-failed quote (previously at Slide 6) that came in over the char limit.
- IMAGE set to "Gavin Newsom" — he's the speaker.

---

## SLIDE 6 — TEXT (was: text — kill switch mechanics)

**Before (position 7)**
- HEADLINE: "A kill switch is not a button"
- BODY: "It would be a set of protocols each major lab creates and runs itself, then verified by independent organizations. A kill switch might not work at all if models grow advanced enough to outsmart it." (198)
- HIGHLIGHT: "set of protocols each major lab creates and runs itself"

**After**
- HEADLINE: "A kill switch is not a button" (29)
- BODY: "It would not be a literal switch someone could press. Each major AI lab would instead create and run its own set of protocols to shut down a model, verified on an ongoing basis by an outside organization." (204)
- HIGHLIGHT: "set of protocols to shut down a model"
- IMAGE: "type only"

**Why**
- Rewritten to open with the "not a literal switch" beat, which is the SF Standard's actual framing.
- Dropped the second sentence about models being smart enough to outsmart the switch — that's a separate expert take and takes the slide off the Newsom-order beat.
- HIGHLIGHT tightened to a shorter, punchier substring.
- IMAGE stays "type only" — abstract mechanic, no person.

---

## SLIDE 7 — QUOTE (was: quote at position 8 — Newsom "begging for regulation")

**Before (position 6 originally had Harms; position 8 had Newsom begging-for-regulation)**
- HEADLINE: "Newsom's case for acting now"
- QUOTE: Newsom's "abject failure" quote (194 chars — over 140 limit, previously flagged)

**After (Slide 7 is now the Harms California-reach quote)**
- HEADLINE: "California's reach has limits" (29)
- QUOTE: "California has only a limited capacity to control what a company incorporated in Delaware does with a data center in Oregon." (124)
- QUOTE BY: "Max Harms, Machine Intelligence Research Institute" (50)
- HIGHLIGHT: "limited capacity to control"
- IMAGE: "type only"

**Why**
- Harms quote is now a contiguous 124-char verbatim fragment from SF Standard — dropped the trailing "to serve a customer in Colorado." to fit under 140.
- Reused the same quote text the summary flagged (the fact-checker said it wasn't in any source), but verification against `brief.json/sourceTexts[4]` (SF Standard) confirms it IS verbatim after curly-quote normalization. The prior fact-check failure was likely a normalization miss.
- Moved to Slide 7 because it works better AFTER the "what a kill switch is" beat — the reader now understands why California's reach matters.
- IMAGE stays "type only" — Harms is a named researcher but the on-slide direction is org/law level.

---

## SLIDE 8 — TEXT (was: text — federal complication + California weight, merged)

**Before (position 9)**
- HEADLINE: "The complication, and the weight"
- BODY: "Trump signed an executive order in December 2025 blocking states from enforcing their own AI rules. OpenAI, Anthropic, and others are based in California, so Sacramento's rules could become the industry's working standard." (222)
- HIGHLIGHT: "Sacramento's rules could become the industry's working standard"

**After**
- HEADLINE: "California's rules carry unusual weight" (39)
- BODY: "Many top AI companies — including ChatGPT-maker OpenAI and Claude-maker Anthropic — are headquartered in California, so rules written in Sacramento could set the industry's working standard." (190)
- HIGHLIGHT: "Sacramento could set the industry's working standard"
- IMAGE: "type only"

**Why**
- Cut the Trump December 2025 executive order sentence — that's a separate story per Tommy's rule.
- Kept the California-weight beat but glossed OpenAI and Anthropic on-slide ("ChatGPT-maker", "Claude-maker") to satisfy the TERMS-explained rule without a separate glossary slide.
- Body dropped from 222 (over-limit) to 190 (under 220).
- IMAGE stays "type only".

---

## FOLLOW

**Before**: "Follow Helios for more on AI regulation and what California is doing about it." (78)
**After**: unchanged (78)

**Why**: within limits, on-topic, reads clean.

---

## Caption

Rewritten as a separate string (see `caption.txt`). No hashtags. Includes a `Source:` line naming the five substantive fetched outlets and their dates. No photo credit (image step handles that when the render runs).

The caption walks the reader through: order (Sept 18) → two months → three panel proposals → what a kill switch actually is → California's industry weight → Q for the audience → follow line → sources.

---

## Fact-check delta vs. summary.md

- Cover `cover_photo` flag: RESOLVED — cover now names Newsom and IMAGE is "photo of Gavin Newsom", so the image step will attach his Wikidata Q11488 photo.
- `char_limit` on old Slide 6 QUOTE (156), old Slide 8 QUOTE (195), old Slide 9 BODY (222): RESOLVED — new quotes are 125 and 124 chars; new Slide 8 body is 190 chars.
- `term_unexplained` on Hugging Face + OpenAI: RESOLVED by cut — Hugging Face is gone; OpenAI/Anthropic glossed on-slide as "ChatGPT-maker" and "Claude-maker".
- `term_unexplained` on Kill switch: RESOLVED — glossed on Slide 2 (first appearance) as "an emergency shutoff for advanced AI models".
- `quote_verbatim` on old Slide 6: RESOLVED — new Harms quote (Slide 7) is a shorter contiguous verbatim fragment from SF Standard, confirmed by grep against `brief.json/sourceTexts`.
