---
name: explainer-caption
description: >-
  Write the Instagram post caption for a Helios Explainer Reel. Use when the user
  asks for a caption, post copy, or the words under an explainer reel. The reel
  already teaches the concept; this skill writes the caption beside it. Not the
  burned-in video captions, and not a Trial Reel news caption.
---

# Explainer caption

The caption is the Instagram text under a 45-second Explainer Reel (AI Brain
Break). Write it the way the best AI tips pages do: a hook that names a problem
the viewer already has, a short why in the viewer's world, one clear ask (save
it, or say which option they would use first), and then the Helios line, which
shows where the concept turns up in a real business. The Helios line is always
the last paragraph before the hashtags. The video taught the concept. The
caption does not walk the eight beats (Explainers 3.0), and it does not pad.

Code version: `explainer-caption-v5` in `lib/explainers/caption.ts`. The live
prompt also carries the shared Helios context and caption rules
(`lib/social/captions/helios-context.ts`), the same block every Helios caption
type uses.

Code adds the opening line when the reel publishes. Do not write an episode
number. `lib/explainers/publish/publish.ts` counts how many explainers have
`published` and stamps `AI Brain Break Episode N:` on the way to Instagram.

This follows the Trial Reels caption skill (`lib/reels/copy/skill.ts`,
copy-caption-v29) where the two products share a rule, and changes the job of
the caption because the lesson is already in the video.

## Read first

The reel's title, one-sentence scope, `STORYBOARD.md`, and `SCRIPT.md`. If a
source was attached, read that too. Those are the only facts you may use about
the concept. Facts about Helios come only from the Helios context in
`lib/social/captions/helios-context.ts`.

Then read `.cursor/skills/humanizer/SKILL.md` and apply it to the draft before
you show it.

## What carries over from Trial Reels

- Instagram shows about the first 125 characters, then "more". Code will put
  `AI Brain Break Episode N:` and a blank line in front of your hook. The hook
  has to stay short enough that the episode line, the blank line, and the hook
  still fit in that count (keep the hook under 96 characters). The hook has to
  make sense if someone never taps "more". Do not spend it on a greeting, a
  hashtag, or "In this video".
- Short paragraphs with a blank line between them. One block is a failed caption.
- At most two emoji, and none is required: one may lead the hook (code puts
  the episode line above it, so the emoji follows the stamp), and one may follow
  the save prompt or question. None in the Helios line or the hashtags. Code
  rejects a third, or one in either place. No URLs; Instagram does not make
  them clickable.
- "We" and opinion belong only in the Helios line. Everywhere else, address
  the viewer as "you" or write in the third person. Never "I".
- Plain words. A reader at about a sixth-grade level gets every line on one
  read. Never talk down.
- Every number, name, and claim comes from the reel's script, storyboard, or
  attached source. Do not add one from memory. "About 1,000" stays "about 1,000".
- One ask, specific to this concept, right before the Helios line. No "what do
  you think?", no "double tap", no "comment YES", no "DM us", no list of services.
- 3 to 5 hashtags. One or two broad, the rest specific to this concept. Each
  tag needs a reason in the post.
- The whole caption, the Helios line and the hashtags included, stays within 2,200
  characters.
- Helios is named once, lightly, in the Helios line, in words that differ from
  the recent closings. No client results, no invented Helios anecdotes.

## What is different

A Trial Reel caption often carries the story the screen only opened. An
Explainer Reel has already taught the thought. The caption's job is still a
full post: make a scroller stop, keep the idea, and give them a reason to save
or send it.

- Do not write the episode line. Code fills `AI Brain Break Episode N:` at
  publish time from the number of explainers already published.
- The hook, your first paragraph, names a problem or situation the viewer has
  that this concept explains: a chat that forgets how it started, an answer
  that sounds sure and is wrong. It is a second way into the same idea, not the
  spoken thesis copied out, and not a description of the frames.
- Then two or three short paragraphs on why. Use the reel's curiosity gap, its
  analogy, its concrete example, and the place the viewer will meet this. The
  body before the hashtags, the Helios line included, must be at least 200
  characters, and three paragraphs (hook, ask, Helios line) is enough. Say the
  idea once and well; do not pad to reach a length.
- The ask asks them to save it for the next time they hit this exact situation,
  or asks which of the reel's options they would use first, or both in two
  short sentences. Name that situation from the reel.
- The Helios line is the last paragraph before the hashtags, one or two
  sentences. Prefer naming a specific industry from the Helios context (a real
  estate team, a law firm, a med spa, an HVAC company, a consumer brand)
  whenever one is a reasonable match, and show where this episode's concept
  turns up in its marketing, sales or operations: the moment it helps, or the
  moment it gets in the way. Fall back to marketing or sales work in general
  only when none fits, stay inside what Helios builds, and pick an industry the
  recent closings did not use. Name Helios once. It may
  end by inviting the viewer to follow for the next episode. It adds no new
  fact about the concept. Code rejects a caption whose paragraph before the
  hashtags does not name Helios.
- Code decides whether the Helios line also says what Helios builds that this
  concept touches (`include_build_line`: a Jev fit score plus a ceiling of about
  1 in 3 recent explainer captions). Follow it; never add that sentence on your
  own.

## How to write it

1. Name the one idea in a sentence, from the scope. If the script and the scope
   disagree, the script is what the video said.
2. Draft the hook: the viewer's problem, in their words. It has to make sense
   with no video playing, and stay under 96 characters.
3. Draft two or three short paragraphs on why. Blank line between them. Pay
   out the idea in the viewer's world.
4. Add the ask: a save line, a "which would you use first" question, or both.
5. Draft the Helios line: one business type from the Helios context, where the
   concept shows up there, Helios named once. Then the hashtags after a blank
   line.
6. Run the humanizer pass. Cut anything that restates the video beat by beat,
   and cut a caption that is only a restatement of the thesis.
7. Show one caption. Above it, note the character count of
   `AI Brain Break Episode 1:`, the blank line, and the hook together. Do not
   put that episode line in the caption itself.

## Shape

```
Hook that names the viewer's problem. After the episode line is added, this opening stays under 125 characters.

Why it happens, in the viewer's world, with the reel's concrete example.

One more short paragraph on why, when the idea needs it.

Save this for the next time <the situation this reel is about>. Or ask which of the reel's options they would try first.

The Helios line: where this concept shows up in one kind of business, with Helios named once.

#specific #specific #broad
```

## Example

Reel: "What is a context window?" The spoken thesis is "A context window is the
text a model can see at once." The example in the reel is a 1,000-token window
and a 1,200-token chat, so the oldest 200 drop.

```
Your long chat with AI forgot how it started. It fell off the desk.

A context window is the text a language model can see at once, measured in tokens. Think of a desk that only holds so much paper. Once the pile is taller than the desk, the oldest pages slide off the edge.

The reel's example is a 1,000-token window and a 1,200-token chat. The first 200 tokens of that chat are no longer in view. That is why a long thread starts answering as if the opening never happened.

Save this for the next time a long chat loses the beginning.

A law firm pasting a long contract into a chat feels this first. At Helios we'd split the file and hand the model one section at a time.

#contextwindow #tokens #ai
```

When this posts, code puts `AI Brain Break Episode 1:` above the hook. That
line, the blank line, and the hook are 94 characters. The hook names the
viewer's problem and does not repeat the thesis. Helios appears once, in the
Helios line just before the hashtags, which picks a business type from the
context and adds no new fact about context windows.
