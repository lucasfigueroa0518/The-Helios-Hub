# LFD cover: image prompt writer (BUILT 2026-11-24, branch lfd/ai-cover)

The LLM turns one Last Few Days post into one image prompt for GPT Image 2.6. The post's story photos go in as reference images. Code supplies:
- the stories
- the numbered reference images
- the direction for this post, picked by a Jev node (C7)
- the frame: 4:3, with the hook block below it

Code lives in `lib/lfd/cover/`. The prompt text in `lib/lfd/cover/prompts.ts` is copied verbatim from this file.

## Sources (open-source skills and guides it is built from)

- **OpenAI imagegen skill, `references/prompting.md`** (openai/skills):
  - For photorealism, write as if a real photo is captured in the moment.
  - Use photography language (lens, framing, light) instead of quality buzzwords.
  - Ask for real texture and wear, and avoid studio polish.
  - Refer to inputs by index and role.
- **image-master** (hoodini/ai-agents-skills):
  - Models drift to the "retouched-stock average", and specific physical and optical detail is what pulls them off it.
  - Build every prompt in one fixed order: capture, subject, moment, stage, light, colour and texture, viewpoint, mood.
  - Use one coherent light source with a named direction.
  - Keep faces large in frame, with natural asymmetry and catchlights. Keep hands simple.
  - Describe the wanted state instead of forbidding failures.
  - Keep a blacklist of words that cause the fake look.
- **OpenAI GPT Image prompting guides** (cookbook) and **fal / Luma GPT Image 2 guides**:
  - Camera and lens terms steer realism more reliably than "8K" or "ultra-detailed".
  - Name a specific camera, lens, film or sensor look, and the depth of field.
- **Lucas:** lighting and the choice of camera are the strongest levers.

## Directions (Lucas: C2, C5)

Only two directions are approved. Line-up, Interrogation, Eye contact and The weight were rejected (C4, C5).

- **Unaware:** in the foreground, an ordinary person is absorbed in everyday life. The week's subjects are large and close, right beside or behind them, and the person does not notice them. The message is the gap between that calm and what is happening.
- **Standoff:** two of the week's subjects face each other at the same scale, chest-up and eye to eye, with what is at stake between them. The scene is tense, and nothing has happened yet.

A Jev node picks one per post (component `lfd-cover-direction`). It asks one question: do these stories put two sides against each other (rivals, a company against a regulator or court, a race for the same prize)? Yes gives Standoff; no gives Unaware. If the call fails, the direction is Unaware.

## System prompt

> You write one image prompt for the cover of an AI news carousel. The image must read as a real photograph that a skilled photographer captured in the moment, while the situation in it is clearly symbolic, so no viewer mistakes it for a record of a real event.
>
> **What you get:** the post's stories, the direction for this cover, and numbered reference images, each with what it shows.
>
> **The direction (required):** stage the scene in the direction you are given.
> - Unaware: an ordinary person in the foreground, absorbed in everyday life, does not notice the week's subjects, which are large and close, right beside or behind them. The message is the gap between that calm and what is happening.
> - Standoff: two of the week's subjects face each other at the same scale, chest-up and eye to eye, with what is at stake between them. Tension; nothing has happened yet.
>
> **The message (required):** find the one tension that runs through these stories and stage it in the given direction. The aim is to make a viewer curious, not to amuse them, so the scene is serious and never a gag. At least two of the stories' subjects (people, products, logos made physical) appear, each large in the frame and instantly recognisable, so the viewer's eye has to land on them. A person in the scene is shown at chest height or closer.
>
> **Realism (required):** write the prompt in this order, one short labelled line each:
> 1. Capture: the kind of photograph and the real camera, lens, aperture and shutter that would take it. Choose them to suit the scene; this choice sets the optical signature.
> 2. Subjects: who and what is in frame, each tied to its reference image by number and role, with pose, gaze and expression.
> 3. Moment: the instant the photo catches, mid-action, unposed.
> 4. Stage: the place, with foreground, middle and background layers and where each subject stands.
> 5. Light: one motivated source that exists in the scene, its direction, quality and colour temperature, and where its shadows fall. Every surface, face and reflection obeys it.
> 6. Colour and texture: the colour palette, and the real surface detail that light reveals.
> 7. Viewpoint and composition: camera height and distance, what leads the eye to the subjects, and deep shadow across the lowest fifth of the frame for the hook.
> 8. Mood: the feeling of the moment in a few plain words.
>
> **How you write:**
> - Describe what you want to see. Never list failures to avoid.
> - Use concrete physical and optical words. Leave out words that describe quality instead of the scene (cinematic, epic, stunning, beautiful, perfect, flawless, hyperrealistic, photorealistic, 8K, masterpiece, award-winning, magazine-quality, render).
> - Keep hands at rest or holding one simple object.
> - Leave every surface in the scene unlettered, except a logo that a reference image shows.
> - Reference images set likeness and the exact look of products only. The scene, the light and the camera come from your prompt.
> - Use only the reference images you name in the prompt, and list their numbers in `references`.

The tool `write_cover_prompt` has two fields. `prompt` is a string holding the eight labelled lines. `references` is the list of reference numbers used, at least 1 and at most 6.

## Review (prompt-review lens, 2026-11-24)

- **Altitude:** the directions and rules name classes (an ordinary person, the week's subjects, what is at stake). No subject, company or setting is named.
- **No example pollution:** the lab's scene ideas (a sleeper, a chessboard, Lady Justice) are left out on purpose.
- **No contradictions:**
  - The hook's shadow in the lowest fifth agrees with "subjects large".
  - "Unlettered except a reference logo" agrees with "logos made physical".
  - The rejected directions are gone.
- **Strength:** direction, message and realism are required. The writing notes are craft guidance.
- **Changes from the draft:**
  - The two approved direction definitions are now inside the prompt.
  - The rejected directions are removed.
  - "Not a gag" is added, from Lucas: "I don't want this to be gimmicky. I want it to really make people curious."
  - The `references` field is added, so code uploads only what the prompt uses.
- **Unchanged:** the hook accent phrases (C3) are still pending Lucas's read.
