---
name: explainer-caption
description: >-
  Write the Instagram post caption for a Helios Explainer Reel. Use when the user
  asks for a caption, post copy, or the words under an explainer reel. The reel
  already teaches the concept; this skill writes the caption beside it. Not the
  burned-in video captions, and not a Trial Reel news caption.
---

# Explainer caption

The caption is the Instagram text under a 45-second Explainer Reel. Write a real
social caption: a hook that stops the scroll, a body that makes the idea stick,
and one clear ask. The video taught the concept. The caption does not walk the
seven beats, and it does not stop after one sentence.

Code adds the opening line when the reel publishes. Do not write an episode
number. `lib/explainers/publish/publish.ts` counts how many explainers have
`published` and stamps `AI Brain Break Episode N:` on the way to Instagram.

This follows the Trial Reels caption skill (`lib/reels/copy/skill.ts`,
copy-caption-v27) where the two products share a rule, and changes the job of
the caption because the lesson is already in the video.

## Read first

The reel's title, one-sentence scope, `STORYBOARD.md`, and `SCRIPT.md`. If a
source was attached, read that too. Those are the only facts you may use.

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
- No emoji. No URLs. Instagram does not make them clickable.
- Helios never speaks as "we", "our", "us", or "I". Address the viewer as "you",
  or write in the third person.
- Plain words. A reader at about a sixth-grade level gets every line on one
  read. Never talk down.
- Every number, name, and claim comes from the reel's script, storyboard, or
  attached source. Do not add one from memory. "About 1,000" stays "about 1,000".
- One call to action, specific to this concept. No "what do you think?", no
  "double tap", no "comment YES", no offer of Helios services.
- 3 to 5 hashtags. One or two broad, the rest specific to this concept. Each
  tag needs a reason in the post.
- The caption, the call to action, and the hashtags together stay within 2,200
  characters.
- The video already ends on the Helios logo. The caption does not sign off by
  saying Helios.

## What is different

A Trial Reel caption often carries the story the screen only opened. An
Explainer Reel has already taught the thought. The caption's job is still a
full post: make a scroller stop, keep the idea, and give them a reason to save
or send it.

- Do not write the episode line. Code fills `AI Brain Break Episode N:` at
  publish time from the number of explainers already published.
- The hook, your first paragraph, is a second way into the same idea. It is not
  the spoken thesis copied out, and it is not a description of the frames.
- Then write at least two body paragraphs. Use the reel's analogy, its concrete
  example, the catch, and the place the viewer will meet this. The body before
  hashtags must be at least 400 characters. A one-sentence caption is a failed
  caption.
- The call to action asks them to save it for the next time they hit this exact
  situation, or to send it to the person who does. Name that situation from the
  reel.

## How to write it

1. Name the one idea in a sentence, from the scope. If the script and the scope
   disagree, the script is what the video said.
2. Draft the hook. It has to make sense with no video playing, and stay under
   96 characters.
3. Draft two or three short body paragraphs. Blank line between them. Pay out
   the idea in the viewer's world.
4. Add one save or send line, then the hashtags on their own lines after a
   blank line.
5. Run the humanizer pass. Cut anything that restates the video beat by beat,
   and cut a caption that is only a restatement of the thesis.
6. Show one caption. Above it, note the character count of
   `AI Brain Break Episode 1:`, the blank line, and the hook together. Do not
   put that episode line in the caption itself.

## Shape

```
Hook. After the episode line is added, this opening stays under 125 characters.

What this is, in the viewer's world, with the reel's concrete example.

The catch, or the place they will meet it. Enough that the idea sticks.

Save this for the next time <the situation this reel is about>.

#specific #specific #broad
```

## Example

Reel: "What is a context window?" The spoken thesis is "A context window is the
text a model can see at once." The example in the reel is a 1,000-token window
and a 1,200-token chat, so the oldest 200 drop.

```
Your AI didn't forget the start of the chat. It fell off the desk.

A context window is the text a language model can see at once, measured in tokens. Think of a desk that only holds so much paper. Once the pile is taller than the desk, the oldest pages slide off the edge. Those pages are gone from what the model can use.

The reel's example is a 1,000-token window and a 1,200-token chat. The first 200 tokens of that chat are no longer in view. That is why a long thread starts answering as if the opening never happened.

This shows up any time a chat runs long, a PDF gets pasted in, or a project file is too big to fit. The model is not being careless. The window filled up.

Save this for the next time a long chat loses the beginning.

#contextwindow #tokens #ai
```

When this posts, code puts `AI Brain Break Episode 1:` above the hook. That
line, the blank line, and the hook are 95 characters. The hook does not repeat
the thesis, and it does not say Helios.
