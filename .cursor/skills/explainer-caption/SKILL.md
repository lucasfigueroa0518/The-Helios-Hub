---
name: explainer-caption
description: >-
  Write the Instagram post caption for a Helios Explainer Reel. Use when the user
  asks for a caption, post copy, or the words under an explainer reel. The reel
  already teaches the concept; this skill writes the caption beside it. Not the
  burned-in video captions, and not a Trial Reel news caption.
---

# Explainer caption

The caption is the Instagram text under a 45-second Explainer Reel. The video already teaches one concept. The caption does not retell it.

This follows the Trial Reels caption skill (`lib/reels/copy/skill.ts`, copy-caption-v27) where the two products share a rule, and changes the job of the caption because the lesson is already in the video.

## Read first

The reel's title, one-sentence scope, `STORYBOARD.md`, and `SCRIPT.md`. If a source was attached, read that too. Those are the only facts you may use.

Then read `.cursor/skills/humanizer/SKILL.md` and apply it to the draft before you show it.

## What carries over from Trial Reels

- Instagram shows about the first 125 characters, then "more". The first line has to stand alone inside that limit. Do not spend it on a greeting, a hashtag, or "In this video".
- Short paragraphs with a blank line between them. One block is a failed caption.
- No emoji. No URLs. Instagram does not make them clickable.
- Helios never speaks as "we", "our", "us", or "I". Address the viewer as "you", or write in the third person.
- Plain words. A reader at about a sixth-grade level gets every line on one read. Never talk down.
- Every number, name, and claim comes from the reel's script, storyboard, or attached source. Do not add one from memory. "About 1,000" stays "about 1,000".
- One call to action, specific to this concept. No "what do you think?", no "double tap", no "comment YES", no offer of Helios services.
- 3 to 5 hashtags. One or two broad, the rest specific to this concept. Each tag needs a reason in the post.
- The caption, the call to action, and the hashtags together stay within 2,200 characters.
- The video already ends on the Helios logo. The caption does not sign off by saying Helios.

## What is different

A Trial Reel caption often carries the story the screen only opened. An Explainer Reel has already taught the thought: hook, analogy, mapping, example, catch, and where you meet it. The caption's job is to make a scroller stop and save the idea, not to teach it a second time.

- The first line is a second way into the same idea. It is not the spoken thesis copied out, and it is not a description of the frames.
- The body adds at most one thing the 45 seconds left thin: the catch in one more sentence, or the place the viewer will meet it. Then stop. Do not walk the seven beats.
- The call to action asks them to save it for the next time they hit this exact situation. Name that situation from the reel.

## How to write it

1. Name the one idea in a sentence, from the scope. If the script and the scope disagree, the script is what the video said.
2. Draft the first line. It has to make sense with no video playing, inside 125 characters.
3. Draft two or three short paragraphs. Blank line between them.
4. Add one save line, then the hashtags on their own lines after a blank line.
5. Run the humanizer pass. Cut anything that restates the video beat by beat.
6. Show one caption. Above it, note the first-line character count.

## Shape

```
First line, under 125 characters.

One short paragraph. The idea, in the viewer's world.

One more sentence only if the reel left a catch or a place worth keeping.

Save this for the next time <the situation this reel is about>.

#specific #specific #broad
```

## Example

Reel: "What is a context window?" The spoken thesis is "A context window is the text a model can see at once." The example in the reel is a 1,000-token window and a 1,200-token chat, so the oldest 200 drop.

```
Your AI didn't forget the start of the chat. It fell off the desk.

A context window is only the text a model can see at once. Fill a 1,000-token window with 1,200 tokens of chat, and the oldest 200 drop out. They are not hidden. The model never sees them.

Save this for the next time a long chat loses the beginning.

#contextwindow #ai
```

The first line is 62 characters. It does not repeat the thesis, and it does not say Helios.
