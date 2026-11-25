# Caption Voice — living plan

Started 2026-11-24. Method: Bald-Eagle-Iteration. Nothing is built yet: the decisions below collect here and get built in one pass.

## Goal
Lucas: one central **voice** shared by all captions and the comment bot. It is a few simple guidelines on tone and writing style, so all copy feels cohesive. Each content type's caption prompt sets only that caption's **structure**.

## The system today
| Part | Where it lives | What it does now |
|---|---|---|
| Comment bot voice | `lib/personality/helios.soul.md` | Six traits (professional, warm, unpretentious, confident, curious, knowledgeable) plus a Restraint section |
| Comment bot rules | `lib/personality/prompts.ts` REPLY_RULES | Routes, length budgets and facts. These win over the voice. |
| Caption voice and structure, mixed | `lib/social/captions/helios-context.ts` | HELIOS_CONTEXT (who we build for, the industry list) plus CAPTION_SHARED_RULES (hook, order, the Helios line, emoji, banned phrases) |
| Last Few Days | `lib/lfd/caption-lines.ts`, `lib/lfd/post.ts` | Opener, body, question, industry-specific Helios line |
| Field Notes | `lib/field-notes/caption.ts`, `write/prompts.ts` | The Writer's caption, then "How to try", a follow line and hashtags |
| AI Drama | `explainers/reel-ai-drama/prompts/post-text.md`, `publish/publish.ts` | Caption, then hashtags, the question and the credits, in that order |
| Explainers | `lib/explainers/caption.ts` | "AI 101 Episode N:", the second half of the reel, a save/question ask and hashtags |
| AI Events | `lib/ai-events/caption.ts` | Code-built ranked line, a link line and tags |

## Decisions (Lucas's words)
1. **Voice is central, structure is per type.** "a few simple guidelines on the tone / writing style … so that they all feel cohesive. And then the captions prompts for each post will set the structure." The comment bot's soul is the starting point.
2. **What captions are for.** "Captions are where people go to learn more. To answer their next or their unanswered questions."
3. **Word economy.** "Each word in a caption should be purposeful. Avoid word vomit." "Not all captions need to be long."
4. **Helios plug is generic.** "Whenever there's a Helios CTA or plug, it should just state our positioning and the positioning of the page generically. Something like 'We built this page to help you stay ahead of AI. Follow for more [value that a post provides].'" The industry-specific LFD Helios line goes, because "it makes assumptions about how Helios relates to specific stories."
5. **Field Notes.** "How to try" comes first. The Writer's caption is removed.
6. **AI Drama.** The credits sit below many empty lines. The question never sits under the hashtags. The post-text prompt gets rewritten.
7. **Explainers.** "AI 101 Episode N:" is dropped. The caption fills the viewer's gaps and "try[s] its hardest to simply make the reader understand." If the concept is easy, it can add more context or harder use cases instead. The options are being brainstormed (see the questions below).
8. **AI Events.** It stays as it is: "AI Networking one is good."

## Carried over from the caption review (same session)
- The LFD meme step overwrites the model's caption (`lib/memes/lfd-post.ts:221`). This gets fixed in the same build.

9. **Helios line: code-written, rotated.** Every caption on LFD, Field Notes, AI Drama and Explainers gets one line, written by code and not by the model. This brings a generic line back to Explainers. Lucas picks several drafts. The pick is seeded per post, so a re-render keeps the same line, and it rotates through that group. AI Events keeps its link line.
10. **Voice.** The draft of 7 points is kept, with "Emphasis on warmth. We want the voice to be TRUSTWORTHY." Trustworthy is the umbrella. The voice file is shared by the captions and the comment bot. Comment-only rules stay in REPLY_RULES. HELIOS_CONTEXT comes out of the caption prompts.
11. **Explainers.** The caption answers the viewer's most likely next question. If the idea is still slippery, it re-explains from a new angle and gives one sentence worth saving. The opener is that *kind* of line ("Still confused?"), "not fixed … fresh each time". If the concept is easy, the writer picks one of these, whichever is most surprising: where it gets serious (a high-stakes use), where it breaks (a misconception or a limit), or what it unlocks (the next idea it builds toward). Dropped: "you already use it" and "try it in 30 s".
12. **AI Drama order.** Hook, then 2–3 lines answering the open questions, then the question, the Helios line, the hashtags, a gap of empty lines, and the credits. Check how Instagram renders empty lines.

13. **Rotation set.** All 8 base sentences (A–H) and both value phrases for each type. "Practical ways to use AI at work" gets swapped for something else; the pick is open.

## Helios line set
Bases (`{value}` is filled per type):
- A. We built this page to help you stay ahead of AI. Follow for more {value}.
- B. AI moves fast. We built this page to help you keep up. Follow for more {value}.
- C. We're Helios, a team of AI engineers. This page is where we share {value}.
- D. We build AI systems for a living, and this page is where we share what we learn. Follow for more {value}.
- E. Glad you're here. We're Helios, and we post {value} to help you stay ahead of AI.
- F. This page is run by Helios, a team that builds AI for businesses. Follow for more {value}.
- G. We work with AI every day, so you don't have to keep up alone. Follow for more {value}.
- H. Staying ahead of AI is our job. Sharing it with you is why this page exists. Follow for more {value}.

Values:
- Last Few Days: AI news worth knowing / quick catch-ups on what changed in AI
- Field Notes: AI tips you can try today / AI workflows worth stealing
- AI Drama: real stories from inside AI / stories about the people and fights shaping AI ("the people…" broke after "Follow for more"; fixed in the build)
- Explainers: AI explained in plain words / AI ideas made simple

Pick: a deterministic hash of (type, post id) chooses one of the 16 combos, so a re-render keeps the same line. It does not look back at recent posts. That keeps the pick free of DB reads; with 16 combos per type, repeats are rare.

## Build plan (built 2026-11-24, uncommitted)
One owner, this session. The work is sequential and mostly prompts, so parallel agents would cost more than they save.

1. **Shared voice.** `lib/personality/helios.soul.md` moves to `lib/social/voice/helios-voice.md` and is rewritten around "trustworthy", with warmth first. The comment bot (`lib/personality/lab.ts`) reads the new path. The four caption writers load it into their cached system prefix. Comment-only rules stay in REPLY_RULES.
2. **Helios line.** New `lib/social/captions/helios-line.ts`: BASES, VALUES by type, and `heliosLine(type, postId)`. Code appends it; the model never writes it.
3. **Retire the old shared rules for these four types.** LFD, Field Notes, AI Drama and Explainers stop importing HELIOS_CONTEXT, CAPTION_SHARED_RULES and build-line. The legacy users (`lib/reels/copy`, `lib/social/captioner`, factcheck) are left untouched.
4. **Last Few Days.** Drop `helios_line` from the prompt and schema, and add the voice. Compose: opener, body, question, Helios line, credits. Fix the meme step that overwrites the model caption: keep the stored model lines and rebuild only the credits, the way `recaption` does. Sources show the outlet name, not the feed name.
5. **Field Notes.** Remove the Writer's caption field and its fact-check claim. Compose: "How to try" first, then the Helios line (replacing FIELD_NOTES_FOLLOW_LINE), then hashtags. Strip backticks. A bare source link gets a label.
6. **AI Drama.** Rewrite `post-text.md` around "answer what the reel leaves open". Compose: caption, question, Helios line, hashtags, a gap of empty lines, credits. Credits: flatten nested "drawn from: … traced from: …" to the original source, and write "Photo supplied by Lucas" as "Photo: Helios". The gap uses lines that hold an invisible character, because Instagram can collapse plain empty lines; confirm on the first real post.
7. **Explainers.** Caption v14: answer the next question (gap-fill, or serious use / breaks / unlocks). Drop the "AI 101 Episode N:" stamp in `caption-format.ts`. Compose: body, Helios line, hashtags.
8. **Tests.** Offline only: update the LFD, Field Notes, Drama-publish and Explainers caption tests, plus a helios-line unit test. Run tsc. No live API calls.
9. **Deploy.** These four run on `helios-social-worker`. Hash the VM first, then Lucas runs `GCP_SSH_IAP=1 ./scripts/gcp/deploy-social-worker.sh`. Only new posts change; nothing is backfilled.
10. **Check.** Optional caption-only preview: rewrite the captions of the four example posts from the review page, without publishing. That is 4 model calls, about $0.15, and needs Lucas's go-ahead.

14. **Field Notes value 2** = "AI workflows worth stealing".
15. **LFD body is a plain recap.** "this caption shouldn't try to be different. Here the caption can just give each slide 1 line and recap it." The LFD body is one line per story, recapping it. This overrides the "answer the next question" principle for LFD only.
16. **Explainers save ask is dropped.** Lucas: "drop the save this". The Helios line is the call to action.
