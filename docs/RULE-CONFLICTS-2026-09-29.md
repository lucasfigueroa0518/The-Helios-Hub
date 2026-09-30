# Rule conflicts: register and fix (2026-09-29)

Lucas's point: a system with rules that pull against each other keeps hitting errors, because the model can never satisfy both and every "fix" breaks the other rule. Tommy's example: "each slide is educational and adds a point" vs "leave space for images." An educational slide needs words; an image needs empty space. Both can't win on the same slide.

This register lists every conflict of that kind found in the current system (prompts at tag `prompts-2026-09-29-fact-first` and later, plus PROJECT-STATUS.md, DESIGN-V1-HANDOFF.md and the code checks), and how to resolve each one.

## The root cause

The rules live in **seven places**: five prompts (Reporter, Writer, Editor, Caption, Fact-checker), PROJECT-STATUS.md and DESIGN-V1-HANDOFF.md, plus the code checks. Each change has been made in one or two of them, so they drift apart. Some of the conflicts below are old rules that were replaced in one place and survived in another.

## The fix: one priority order, written once

Every prompt gets the same short ladder, and every conflict resolves by it:

1. **True.** Only what the sources say.
2. **Every slide teaches something new.**
3. **Clear to a reader who doesn't follow AI.**
4. **Fits the layout's hard limits** (lengths, 8 story slides max).
5. **Design preferences:** photos, slide-type variety, rhythm, white space. **Design adapts to the content, never the other way round.**

Put it in one shared rules block (like the existing shared voice block) that every prompt imports, and make PROJECT-STATUS.md and the design doc point to it instead of restating the rules.

## The conflicts

| # | Rule A | Rule B | What the model does | Resolution (by the ladder) |
|---|---|---|---|---|
| 1 | Every slide teaches something, with context; body up to 220 characters at a fixed 44px (Writer, PROJECT-STATUS) | Text slides carry a photo in the bottom half; fill empty space with images; "big type, one idea" (DESIGN handoff, Tommy's latest request) | Shortens explanations to make room, or leaves long text colliding with the photo zone | **Content first.** The Writer never shortens copy for an image. Code places a photo on a text slide only when the rendered text leaves the bottom half free; otherwise the slide stays text-only, or the image goes on a slide that has room. |
| 2 | Context policy: one sourced clause, plus at most one "why now" or "what stands in the way" slide (Writer, Editor, Reporter) | "Flag anything about a different event, date or company... BIG" (Fact-checker); "Never mention any other story" (Caption); "Main story only, not even a passing clause" (PROJECT-STATUS) | The Writer includes the allowed context slide, the fact-checker flags it BIG, the repair cuts it: guaranteed churn | **Update the Fact-checker, Caption and PROJECT-STATUS to the same context policy.** The Fact-checker flags only context *beyond* the allowance. |
| 3 | Max 8 story slides (Instagram's 10-item carousel limit, decided today) | "5 to 10 story slides... if 10, ship 10" (Writer, Editor, PROJECT-STATUS, code limit) | A 9–10 slide post passes every check, then can't be published | **5–8 everywhere,** including `LIMITS.storySlidesMax`. |
| 4 | Rhythm and variety are soft preferences (decided today) | "Never the same kind twice, at least 3 kinds" (PROJECT-STATUS, DESIGN handoff); Writer: "Vary the kinds... fix by adding content"; Writer: "After the OUTLINE is approved, no stage may change a slide's kind" | The Writer pads a slide to justify a different kind; the Editor can't change a wrong kind | **Kinds follow content.** Delete "fix by adding content" and the kind-lock sentence from the Writer. Update PROJECT-STATUS and the design doc to say variety is a preference that design provides (images, layouts). |
| 5 | Glossing is advisory: only when the slide doesn't make sense without it (Writer, Editor) | "Terms explained on the slide where they appear or the next one" (PROJECT-STATUS, listed under rules not to relax) | Depends which the reader of the docs follows; Claude Code may re-tighten it | **Update PROJECT-STATUS** to the advisory wording. |
| 6 | Concept slides may use stock or AI illustrations (Tommy, today) | "No AI images, no drawn shapes, no stock photos" (DESIGN handoff); Writer/Editor: "IMAGE names a real subject from TERMS... cut any request for a scene" | The pipeline has no way to ask for the images you approved, and an editor following the design doc would remove them | **Update the design doc and both prompts** with the two-tier photo rule. Concept images are chosen by the image step, not described by the Writer. |
| 7 | "The cover summarizes the change the whole post is about" (Writer) | "Draft three covers, each leading with a DIFFERENT reader question" (Writer) | Covers that lead with one slide's question, then that slide repeats the cover | **One cover rule:** who did what, and what changes. The three drafts differ in wording and angle, not in which question they answer. |
| 8 | "No teasing, nothing click-baity; the cover says who did what"; "no invented framing" (Writer) | Hook frameworks: "Provocative question", "Frame shift", "Insider reveal" (Writer) | Covers that tease or frame, which the fact-checker then trims | **Keep only the frameworks that state facts:** shock number, authority vs. hype (sourced), rivalry (sourced), personal payoff (sourced). Drop provocative question, frame shift and insider reveal, or restate them as fact-based. |
| 9 | Glosses from the TERMS list are allowed (Fact-checker, decided earlier) | "Nothing the sources don't say" (PROJECT-STATUS) | A reader of PROJECT-STATUS would treat a TERMS gloss as a violation | **Add the exception to PROJECT-STATUS:** "TERMS explanations count as sourced." |
| 10 | Editor: "Be strict... you can rewrite freely" | Editor on rerun: "Fix exactly what you were given, change nothing else" | Mostly fine, but the Editor sometimes applies first-pass freedom during repairs | **Separate the two modes** under their own headings in the Editor prompt, so each run sees only its own instructions. |

## How to keep it from drifting again

1. **One rules block, imported everywhere.** The priority ladder, context policy, slide count, photo tiers and gloss rule are written once and imported by all five prompts (the way the voice block already is).
2. **The docs point to it.** PROJECT-STATUS.md and DESIGN-V1-HANDOFF.md link to the rules block instead of restating rules.
3. **A consistency test.** A unit test fails if any prompt contains a phrase that's been retired ("main story only", "5 to 10", "not even a passing clause", "no stock photos", "never the same kind twice", "no stage may change a slide's kind"). Cheap, and it catches a stale copy the moment one sneaks back in.
4. **Every rule change goes through the checkpoint habit:** commit and tag before, then update the rules block, then run the consistency test.
