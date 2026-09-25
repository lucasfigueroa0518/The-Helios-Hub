# Helios Reels — Video Motion Research Report

**Purpose:** Research to inform an upgrade of the Helios reel video generation prompt (the image-to-video step).
**Goal of the upgrade:** The motion in Helios reels should not look like standard AI animation. Qualities such as polarity, rhythm and glows should be pushed deliberately in a particular direction instead of being left to the model's defaults.
**Compiled:** September 24, 2026

This report is research, not a spec. It collects what the sources say, explains the frameworks in enough depth to apply them, and notes where each finding is relevant to Helios. Decisions about how to apply it belong to whoever upgrades the prompt, within the scope they were given.

---

## Contents

1. Helios context the motion has to respect
2. The problem: why AI motion reads as AI
3. Rhythm and timing frameworks
   - 3.1 Karen Pearlman, *Cutting Rhythms*
   - 3.2 Disney's 12 principles of animation
   - 3.3 IBM Carbon motion system
4. Techniques for controlling motion in video models
5. Research: Motion Prompting (Google, CVPR 2025)
6. Evaluating motion
7. Open-source repos and skills
8. Open questions
9. Sources

---

## 1. Helios context the motion has to respect

These are existing, approved decisions about the Helios visual system. The video prompt operates on top of them.

- **Input:** The video step is image-to-video. The input is a finished 9:16 background still with no text on it.
- **Text comes after video.** On-screen text is composited onto the video after it is generated. The text sits in the center of the frame.
- **Dark center band.** The central horizontal band of the frame (roughly 30% to 62% of frame height, full width) is reserved for that text and must be predominantly deep black: no light sources, no bright highlights, no orange elements, no high-contrast detail. Because the text is laid over the finished video, this has to hold for the entire clip, not just the first frame. Motion that brings light, glow or the subject into the center band would clash with the text.
- **Subject placement.** The subject and the single orange focal point sit in the upper zone (about 12–30% of height) or the lower zone (about 62–78%), never centered.
- **Look.** Low-key, matte black, high-end 3D render (Octane/Redshift quality). About 85% of the frame in shadow. Minimalist industrial design in the spirit of Dieter Rams, restrained neo-noir atmosphere with light volumetric haze.
- **Color roles.** Helios orange (#FF5E1A) is the single focal point and marks the story's turning point, one per frame. Helios green (#138510) is rim light, faint background glow and small details, always subordinate to orange. No other hues.
- **People.** Only silhouettes or partial figures (hands, shoulders, profiles, backs), faces always in shadow.
- **Content.** Each reel is about a specific story; scenes are inspired by that story. Two categories: education and storytelling.

---

## 2. The problem: why AI motion reads as AI

Before deciding what the motion *should* be, it helps to name what makes AI motion recognizable. The sources converge on six causes.

**2.1 Camera motion without motivation.** A real camera is a physical object with weight, inertia and intention. It doesn't teleport or jitter randomly, and every move has a reason. AI video often ignores this, so camera motion feels floaty and disconnected from the scene. The recommended fix is conceptual: before generating, decide how the camera behaves emotionally (observing quietly, approaching cautiously, revealing something). A single, simple movement repeated consistently across scenes reads as far more cinematic than a series of unrelated movements. *(BudgetPixel)*

**2.2 Aimless drift when camera language is missing.** Video models were trained on real footage and understand cinematography terms (dolly, pan, crane, orbit). When the prompt skips them, the model guesses, and the result is the floaty, aimless drift that immediately reads as AI-generated. *(Atlabs)*

**2.3 Interpolated smoothness.** Many video tools generate internally at a low frame rate (often around 8–16 fps) and interpolate up to 24 or 30 fps for export. Part of the "too smooth, too even" feel of AI motion comes from this interpolation. The same source notes models handle static or slow pans much better than fast motion. *(Lilach Bullock)*

**2.4 Smooth is not the same as believable.** Neighboring frames can look consistent with each other while the motion still has no realistic weight, contact or trajectory. Temporal consistency doesn't equal believable movement: a smooth but physically impossible path still reads as fake. The same source recommends naming the dominant failure mode before rewriting anything: floaty glide, rubbery stretch, overly fast action, an impossible path, or a disconnect between subject and camera. *(Creatide)*

**2.5 Overload.** Many motion failures come from asking one short generation to carry too much at once: several actions, a camera change and physical contact. The model resolves the overload as floaty weight, rubbery deformation or physics errors. The fix is to reduce the motion load per clip. *(Creatide)* A related rule from production guides: one subject, one action, one camera move per shot. *(Atlabs)*

**2.6 Physics is the weakest axis, and viewers look exactly there.** A 2025 benchmark (PhyWorldBench) found physical realism (gravity, momentum, friction, collisions) remained the weakest dimension across leading text-to-video models. An eye-tracking study found viewers' gaze concentrates on motion boundaries and interacting objects, which is exactly where temporal and physics errors appear. *(The Rank Masters, citing both studies)*

**Relevance to Helios:** The Helios look (dark void, one subject, one orange focal point, minimal hardware) already avoids many high-risk categories (crowds, fast human action, hands in close-up, text in frame). The remaining risks are mainly 2.1–2.5: unmotivated camera drift, generic interpolated smoothness, and overloaded clips.

---

## 3. Rhythm and timing frameworks

AI video prompts usually describe *what* moves. These three frameworks describe *how* movement should be shaped over time: when it starts, how fast, how it accelerates and settles, and how it creates tension and release. They come from film editing, character animation and interface motion design respectively.

### 3.1 Karen Pearlman, *Cutting Rhythms*

Karen Pearlman is a film editor and former dancer, now Associate Professor of Screen Production at Macquarie University. *Cutting Rhythms* (1st ed. 2009; 2nd ed. 2016; 3rd ed. *Cutting Rhythms: Creative Film Editing*, Routledge, 2025) is a widely used text on how rhythm works in film. It's written about editing, but its concepts apply to movement within a single shot, because she treats editing as choreography: shaping movement and energy over time.

**What rhythm is for.** Pearlman defines rhythm's function as creating cycles of tension and release, and synchronizing the viewer's physical, emotional and cognitive fluctuations with the rhythms of the film. In other words, rhythm is how a film makes the viewer's body and attention move along with it.

**The three tools of rhythm.** Pearlman names three tools an editor uses to shape rhythm:

1. **Timing.** Decisions about *when* and *for how long*: which exact frame a movement or shot begins and ends on, and how long a moment is held. Timing is a local, moment-level choice. A beat held a little longer builds anticipation; one cut short creates surprise or urgency.
2. **Pacing.** The *rate* of movement and change over a stretch of time: how much is happening, how fast, and how that rate changes. Pacing is the overall sense of speed or stillness across a passage. A steady pace calms; an accelerating pace builds tension.
3. **Trajectory phrasing.** A term Pearlman coined for an area neither timing nor pacing covers: shaping the *energy of movement* by how trajectories are linked or collided. A trajectory is the path and direction of movement in the frame (of the subject, the camera, light, particles). Phrasing is how those paths are grouped into "phrases," the way a choreographer shapes a dance phrase. Continuing a trajectory (motion flowing in the same direction) carries energy forward; colliding trajectories (motion reversing or opposing) creates impact or tension.

**Tension, release and synchronization.** Rhythm alternates between building tension and releasing it. Synchronization is the degree to which the film's rhythm locks onto the viewer's own physical and emotional rhythms.

**Three kinds of rhythm.** She distinguishes:
- **Physical rhythm:** the rhythm of visible movement (bodies, objects, camera, light).
- **Emotional rhythm:** the rhythm of feeling (the build and release of emotional intensity).
- **Event rhythm:** the rhythm of story information (when new events and revelations land).

A well-shaped piece aligns all three.

**Relevance to Helios:** Each Helios clip is short and has one subject, but it still has physical rhythm (how the camera, glow and haze move), emotional rhythm (building to the story's turn) and event rhythm (the moment the orange focal point matters). Pearlman's vocabulary offers a way to specify motion by its *shape over time*: where the motion starts, whether it builds or settles, whether its trajectory continues or reverses. Trajectory phrasing is also a candidate lens for the user's "polarity" (see Section 8), since it deals with direction and whether movements flow together or collide.

### 3.2 Disney's 12 principles of animation

The 12 principles were set out by Disney animators Frank Thomas and Ollie Johnston in *The Illusion of Life: Disney Animation* (1981), codifying practice developed at Disney from the 1930s. They are still the foundation of character and motion animation in 2D, 3D and motion graphics. The core idea: motion reads as alive and intentional when it respects weight, momentum and preparation.

Each principle below has a short explanation, then a note on how it might relate to an image-to-video clip. The notes are interpretation, not findings from a source.

**1. Squash and stretch.** Objects deform to show weight and flexibility: a ball flattens on impact and elongates as it falls, while keeping the same volume.
*Relevance:* Mostly *not* relevant to Helios. Hardware and architecture are rigid, matte, precise forms. Unintended squash and stretch on rigid objects is a known AI failure (rubbery deformation, see 2.4). If anything, the Helios world is defined by the *absence* of squash and stretch.

**2. Anticipation.** A small preparatory movement before a main action tells the audience something is about to happen: a pitcher winds up before throwing, a character glances before turning. It builds tension and makes the action believable.
*Relevance:* In a short clip this could be a small preparatory change before the key moment, such as a glow dimming slightly before it swells, or a pause in motion before a reveal. Anticipation is one of the most direct ways to give motion intention rather than uniform drift.

**3. Staging.** Presenting an idea so it is unmistakably clear: using composition, camera placement, lighting and silhouette to direct attention to what matters and removing distraction.
*Relevance:* Already central to the Helios still (one subject, one orange focal point, dark void). In motion, staging means the movement should direct attention to the focal point, not scatter it.

**4. Straight-ahead action and pose-to-pose.** Two ways of animating. *Straight ahead* draws frame after frame from start to finish, giving spontaneous, fluid motion. *Pose to pose* defines key poses first and fills in between them, giving planned, controlled motion.
*Relevance:* Image-to-video with only a start frame resembles straight-ahead: the model improvises from the first frame. Start-and-end-frame control (Section 4.3) resembles pose-to-pose: the start and end are fixed and the model fills the path. This maps directly onto a control choice available in current video models.

**5. Follow-through and overlapping action.** Parts of a body or object don't all stop at once. After the main mass stops, looser parts keep moving and settle (a coat keeps swinging after a character halts). Different parts move at different rates.
*Relevance:* Ambient elements (haze, particles, a glow's falloff) can continue and settle after the main motion. This is also what distinguishes layered, real motion from the uniform, everything-moves-together feel of generic AI motion.

**6. Slow in and slow out (ease in / ease out).** Real objects accelerate from rest and decelerate to a stop; they don't start or stop at full speed. Animators put more frames near the start and end of a movement, fewer in the middle.
*Relevance:* One of the most important principles for Helios. Uniform-speed motion (a push-in that moves at constant velocity from first frame to last) is a strong machine tell. Movement that accelerates and then settles reads as intentional. See also Carbon easing (3.3).

**7. Arcs.** Natural movement follows curved paths rather than straight lines: a swinging arm, a turning head, a thrown object.
*Relevance:* Camera moves and light movement along gentle arcs can read as more physical than perfectly straight, mechanical paths. For rigid hardware, a precise straight path may be deliberate, which is a style choice.

**8. Secondary action.** Smaller actions that support the main action and add dimension, without competing with it (a character gestures while speaking).
*Relevance:* Ambient motion (haze drifting, dust in light, faint green status lights) is secondary action. It should support the main motion, not compete with it. This connects to the measured finding in 4.2 that giving the model ambient detail to move stops it from over-animating the subject.

**9. Timing.** The number of frames an action takes determines its speed, and speed conveys weight, mood and meaning. Few frames: fast, light, urgent. Many frames: slow, heavy, deliberate.
*Relevance:* Timing sets the emotional character of the clip. A heavy, slow, deliberate motion reads very differently from a quick one. Choosing timing deliberately per clip is a lever against the default AI pace.

**10. Exaggeration.** Pushing a movement beyond literal realism to make it read more clearly and with more feeling.
*Relevance:* Low. The Helios style is restrained and precise. Exaggeration would work against it except, possibly, in the single moment the focal point matters.

**11. Solid drawing.** Drawing forms with three-dimensional volume, weight and balance, so they stay solid as they move.
*Relevance:* In AI video, this is form consistency: rigid objects keeping their shape and volume throughout the clip rather than warping or morphing.

**12. Appeal.** The quality that makes a character or design engaging to watch: clarity, charisma, pleasing design.
*Relevance:* General. Motion that is clear, restrained and purposeful supports the Helios brand's appeal.

**Most relevant principles for Helios:** slow in/slow out, timing, anticipation, secondary action, follow-through, staging, and straight-ahead vs. pose-to-pose (as a lens on start/end frame control). Least relevant: squash and stretch and exaggeration.

### 3.3 IBM Carbon motion system

Carbon is IBM's open-source design system. Its motion guidelines are the clearest public example of a brand defining a *house motion personality*: a small set of rules that makes all of the brand's motion feel alike. It was designed for interfaces, not film, but it shows how to force motion in a consistent direction.

**Two styles of motion.** Carbon defines two styles, framed as reflecting the duality of man and machine:
- **Productive motion** is efficient and responsive while staying subtle and out of the way. It's for moments when the user needs to focus on a task.
- **Expressive motion** is enthusiastic, vibrant and highly visible. It's for significant moments, or when the movement itself carries meaning.

Carbon reserves expressive motion for occasional, important moments, so that it captures attention and gives a rhythmic break from the productive baseline. Productive motion is significantly faster than expressive motion.

**Easing philosophy.** Carbon states that strictly linear movement looks unnatural. Elements should speed up quickly and slow down smoothly, like a light-weight physical material. It explicitly rules out easing curves that suggest bounce, stretch or sudden stops, and anything purely decorative.

**Three easing types, each with a meaning:**
- **Standard easing:** for an element visible from start to end of a motion.
- **Entrance easing:** the element appears quickly and decelerates to a stop. Used when something enters the view.
- **Exit easing:** the element accelerates as it leaves, implying the departure is permanent. Exception: if an element leaves but stays nearby, ready to return, it uses standard easing and slows as it exits, implying it rests just outside the view.

**Curve values (cubic-bezier):**

| Easing | Productive | Expressive |
|---|---|---|
| Standard | `cubic-bezier(0.2, 0, 0.38, 0.9)` | `cubic-bezier(0.4, 0.14, 0.3, 1)` |
| Entrance | `cubic-bezier(0, 0, 0.38, 0.9)` | `cubic-bezier(0, 0, 0.3, 1)` |
| Exit | `cubic-bezier(0.2, 0, 1, 0.9)` | `cubic-bezier(0.4, 0.14, 1, 1)` |

**Duration.** Duration depends on the style and on the size of the change: the farther something travels or the more it scales, the longer the motion takes. Carbon uses a non-linear duration scale so motion feels consistent across distances. Static duration tokens:

| Token | Typical use | Value |
|---|---|---|
| `duration-fast-01` | Micro-interactions (button, toggle) | 70ms |
| `duration-fast-02` | Micro-interactions (fade) | 110ms |
| `duration-moderate-01` | Small expansion, short movement | 150ms |
| `duration-moderate-02` | Expansion, toast | 240ms |
| `duration-slow-01` | Large expansion, important notification | 400ms |
| `duration-slow-02` | Background dimming | 700ms |

**Evaluation checklist (paraphrased).** Is the motion purposeful (what problem does it solve)? Is it meticulous (right easing, each motion considered, related movements unified)? Is it unobtrusive (if average users constantly notice it, reduce it)?

**Relevance to Helios:**
- Video models don't accept bezier curves or millisecond tokens. What transfers is the *structure* and the *vocabulary*: a baseline motion mode plus a rarer, reserved "expressive" mode for the key moment; a consistent easing character described in words (for example, "accelerates quickly, then settles slowly to rest"); and meaningful directions of motion (entering vs. leaving, leaving for good vs. resting nearby).
- The productive/expressive split is a model for "forcing motion in a particular direction" at a brand level, which is the user's stated goal.
- The entrance/exit semantics (how something arrives or departs implies permanence or return) is another candidate lens for "polarity."
- Carbon's durations are for UI micro-interactions and are far shorter than a video clip, so the numbers don't transfer; the principle that larger changes take longer does.
- The curves are available as an npm package (`@carbon/motion`, Apache 2.0).

---

## 4. Techniques for controlling motion in video models

### 4.1 Prompt structure for motion

- **Use real cinematography vocabulary.** Models respond to standard camera terms (dolly in/out, push in, pull out, pan, tilt, crane, tracking, orbit, static/locked-off). Vague phrases like "cinematic camera movement" leave the model guessing. *(Atlabs)*
- **Put the movement first.** Models weight early tokens more heavily, so leading with the camera movement makes it more likely to happen. *(Atlabs)*
- **Motion description structure.** One guide structures each motion as: the movement and its speed ("slow dolly in"), the subject, and what the movement reveals. *(Atlabs)*
- **One subject, one action, one camera move per shot.** *(Atlabs)*
- **Physical detail convinces the eye.** When animating a still, give the model one clear camera move plus one physical detail it can render (dust, steam, fabric), because visible physics is what makes the motion believable. *(Atlabs)*
- **Dolly vs. zoom.** A dolly physically moves the camera; a zoom changes focal length from a fixed position. A dolly reads as natural because humans approach things to see them closer; a zoom reads as artificial (which can be used deliberately as a style). *(Leonardo.Ai, Kling guide)*
- **Narrative intent for every camera move.** Connect each camera movement to a narrative goal rather than using it as an effect. Example: a low angle with a slow tilt up makes a subject feel heroic. *(Leonardo.Ai)*

### 4.2 Image-to-video specifics

- **The input image is an anchor.** In image-to-video, the model preserves identity and layout from the starting image while introducing motion; the prompt should focus on motion and camera work rather than re-describing the scene. *(Atlabs, fal.ai Kling 3.0 guide)*
- **Measured findings** (kanno321-create, from A/B tests on about $18,000 of generation spend; self-reported):
  - Static and ambient shots should be image-to-video, not text-to-video. Text-to-video added a +6.95% push-in regardless of the wording; image-to-video drifted about ±0.02%.
  - Dropping the camera sentence and spending the words on ambient detail increased liveliness by 53%, while camera phrasing alone scored 11–23% lower.
  - The explanation given: when a prompt gives the model no ambient detail to spend motion on, the model spends it on the subject, which is how static shots fall apart.
  - Orbit and POV moves could not be prompted reliably from a still, because the far side of the subject isn't in the image.
  - Leaving sound generation off avoided a +42.9% billing increase and hallucinated sound effects.
- **Relevance to Helios:** Helios is already image-to-video. The haze, particles, glows and faint green status lights in the Helios world are exactly the kind of ambient detail the model can spend motion on, instead of distorting the subject or drifting the camera.

### 4.3 Start and end frames

- **What it does.** Kling 3.0 lets you attach a start frame, an end frame, or both. Both frames lock the full trajectory; an end frame alone lets the model choose how to arrive. *(Higgsfield, Kling 3.0 guide)*
- **The drift rule.** When the prompt describes motion that can't plausibly arrive at the attached end frame, the result drifts. The prompt must agree with where the end frame says the scene finishes. *(Higgsfield)*
- **Veo 3.1** supports a "first and last frame" workflow for controlled camera moves and transformations between two points of view. *(Google Cloud, Veo 3.1 guide)*
- **Loops.** Matching the first and last frame produces a seamless loop (example: a mercury sphere deforms and returns exactly to its original shape by the final frame). *(0xadvait/ai-video-skill)*
- **Relevance:** This is the pose-to-pose option from Disney principle 4. It is the strongest available tool for making motion deliberate rather than improvised, at the cost of needing a second frame.

### 4.4 Parameters (Kling v3.0 image-to-video API, as documented by a third-party host)

- `cfg_scale` (0–1): higher values follow the prompt more closely; lower values produce more natural motion. This is a direct trade-off between control and naturalness.
- `negative_prompt`: up to 2,500 characters, covering things to avoid in video and audio.
- `end_image`: ending frame for guided transitions. Cannot be combined with `multi_prompt`.
- `multi_prompt`: multi-shot composition, each segment with its own prompt and duration (3–15 seconds).
- Duration: 3–15 seconds (some tiers only 5 or 10).

Check parameters against the documentation of the specific model and host actually used in the codebase.

### 4.5 Negative prompts: use with caution

- Kling documents negative prompts such as blur, distortion, flicker, morphing and unnatural physics. *(0xadvait/ai-video-skill style library)*
- But negatives are unreliable across Sora 2, Veo and Seedance. On Sora 2, naming an unwanted thing in a negative ("no fingers") tended to *increase* it, because it primes the model on the noun. The recommendation is to default to positive description: describe what should happen, not what shouldn't. *(0xadvait/ai-video-skill)*

### 4.6 Speed, warping and continuity

From the 0xadvait failure-mode catalog (compiled for Seedance 2.0 from several sources):
- **Fast motion warps.** Fast actions cause stretching; fixes are slowing to medium speed, one clear motion, or counted actions (describing a precise number of movements).
- **Unrequested cuts.** On ambiguous shots the model may switch angles on its own. Fix: state continuity explicitly (single continuous take, no cuts).
- **Over-stabilization.** Even "handheld" can render too smooth; getting real camera shake requires emphatic wording. (The inverse lesson: the model's default is over-smooth.)
- **Drift over longer shots.** Structure and palette drift across 10+ second single shots. Breaking the clip into time-coded blocks with explicit camera changes re-anchors the model.
- **Quality anchors go last.** Terms like "8K" or camera-body names work as fallback weight at the end of a prompt; concrete cinematography earns more than adjectives.

### 4.7 Light as motion (glows)

- I found no dedicated research on animating glows in AI video. The closest material:
  - A Veo 3.1 example that uses light as the motion: the camera holds steady to build anticipation, then a slow side-light sweep reveals form and material as the camera gently pushes in, ending on a clean close-up. *(Invideo)* This combines anticipation (3.2), timing and a reveal, with light as the moving element.
  - kanno321-create's `vp-lighting-and-look` and `vp-ambient-vocabulary` skills cover lighting vocabulary for Kling, Seedance and Veo (docs in Korean; prompt payloads in English).
- A known failure mode: AI can get scene depth wrong, so illumination shifts slightly between frames and shadows don't follow moving objects, which viewers sense even if they can't name it. *(Digital Synopsis)* This matters for Helios, where light is the main visual element.
- **Relevance:** In the Helios world, the glows (orange focal glow, green rim and background glow) are the most natural place to put deliberate motion. Pearlman's tension and release and Disney's anticipation and slow in/slow out all translate naturally into how a glow could build, peak and settle. How it should move is an open design question. Any glow motion must stay out of the dark center band (Section 1).

### 4.8 Model-specific guides

- **Veo 3.1 (Google Cloud "Ultimate prompting guide").** Camera movement terms (dolly, tracking, crane, aerial, slow pan, POV), composition and lens/focus terms, first-and-last-frame workflow. Community guides also describe timestamp prompting (describing the clip in timed segments) to control pacing within a single generation.
- **Kling 3.0.** Start/end frames; custom multi-shot mode with up to 5 shots in a 15-second total; each shot needs enough duration for a readable action. Draft at 720p and run finals at higher resolution (4K costs about three times as much). *(Higgsfield)* Kling Motion Control 3.0 is a separate product for copying motion from a reference video.
- **Seedance 2.0 / 2.5.** See LearnPrompt/awesome-seedance (Section 7), which has retested cases and templates.

---

## 5. Research: Motion Prompting (Google, CVPR 2025)

**Paper:** Daniel Geng et al., *Motion Prompting: Controlling Video Generation with Motion Trajectories*, CVPR 2025. arXiv:2412.02700. Project page: motion-prompting.github.io.

**The problem it addresses.** Text prompts struggle to express the nuances of motion: exact trajectories, acceleration and precise timing. This is the same gap the Helios upgrade is trying to close.

**The approach.** The authors train a video model (a ControlNet adapter on a video diffusion model) conditioned on *motion trajectories*: point tracks that describe how points in the image move over time. The tracks can be sparse (a few points) or dense (thousands), cover one object or the whole scene, and cover only part of the clip's duration. They call these "motion prompts."

**Motion prompt expansion.** The paper shows how to turn a simple, high-level request (like a mouse drag) into a detailed, semi-dense motion prompt the model can follow. The analogy to text prompting: a short intent is expanded into a precise specification.

**Capabilities demonstrated.** Object control, camera control, combined object and camera motion (by adding tracks together), motion transfer from one video to a different image, and drag-based image editing. The authors report emergent realistic physics.

**Relevance to Helios.** This model isn't available through the commercial video APIs, so it can't be used directly. Its value is conceptual: it frames motion as something to *specify* (path, acceleration, timing) rather than leave to the model, and "motion prompt expansion" is a precedent for turning a short motion intent into a detailed description.

---

## 6. Evaluating motion

**VBench** (CVPR 2024, open source, github.com/Vchitect/VBench) splits video generation quality into 16 dimensions. Several can score your own clips without prompts or labels by running with `mode=custom_input`:
- `subject_consistency`: the subject keeps its identity, shape and appearance.
- `background_consistency`: the background stays stable without flicker or unintended shifts.
- `motion_smoothness`: motion is continuous and free of jitter or abrupt jumps.
- `dynamic_degree`: how much motion there is (it measures amount, not correctness).
- `aesthetic_quality` and `imaging_quality`.
- (`temporal_flickering` is another dimension in the suite.)

**Caveat (DynamicEval, 2025).** The motion smoothness metric aligns reasonably well with human judgment but fails in two cases: occlusions and disocclusions caused by camera and object movement.

**Caveat for Helios.** High "motion smoothness" is not the goal in itself: overly even smoothness is part of the AI look (Section 2.3). These metrics are more useful for catching breakage (flicker, morphing, subject drift) than for judging whether motion has the intended character.

**QC loop (0xadvait/ai-video-skill).** After each generation, Claude extracts a contact sheet of frames, scores the clip on prompt fidelity, consistency, motion and audio, and appends a one-line cause→effect lesson to `LESSONS.md`, which is loaded before the next prompt is written.

---

## 7. Open-source repos and skills

Most of these are small, recent projects; their numbers are self-reported. Treat them as sources of vocabulary and patterns to test, not as established fact.

| Repo | License | What it contains | What's useful for Helios |
|---|---|---|---|
| [kanno321-create/ai-video-prompt-skills](https://github.com/kanno321-create/ai-video-prompt-skills) | MIT | 19 Claude Code skills for Kling, Seedance and Veo, grouped as Matter, World, Subjects, Frame and Register. Includes `vp-lighting-and-look`, `vp-ambient-vocabulary`, `vp-director-techniques`, `vp-vfx-and-transitions`, `vp-composition-blocking`, `vp-materials-textures`, `vp-product-hero`. Docs in Korean, prompt payloads in English. | The measured i2v vs. t2v and ambient-detail findings (4.2). Lighting and ambient vocabulary for glows and haze. Material vocabulary for matte hardware. |
| [0xadvait/ai-video-skill](https://github.com/0xadvait/ai-video-skill) | MIT | End-to-end Claude Code video skill across six models. `reference/style-library.md` (camera, lens, lighting, director vocabulary), `reference/failure-modes.md` (15 failure modes and fixes), `reference/prompt-logic.md`, `examples/prompts.json` (30 prompts), `LESSONS.md` QC loop. | The failure-mode catalog (4.6), the negative-prompt caution (4.5), the loop example (4.3), the QC loop pattern (6). |
| [kdowswell/veo-tools](https://github.com/kdowswell/veo-tools) | — | Claude Code plugin for Veo 3.1. `skills/veo/references/cinematography-lexicon.md`, `skills/veo/validation/prompt-checklist.md`, `skills/veo/examples/hero-prompts.md`, and a seamless-loop skill using FFmpeg. | Cinematography lexicon and a prompt validation checklist. |
| [LearnPrompt/awesome-seedance](https://github.com/LearnPrompt/awesome-seedance) | — | Seedance 2.5/2.0 prompt library: 463 cases traced to original posts, 264 cross-model retest runs with published verdicts, 25 templates, 60 installable AI-video skills. | Evidence-backed prompt patterns if the pipeline uses Seedance. |
| [maciejdzierzek/kling-ai-prompt-generator](https://github.com/maciejdzierzek/kling-ai-prompt-generator) | — | Claude skill for Kling 3.0 prompts: image-to-video, text-to-video, Motion Control, multi-shot storyboards. | Kling-specific prompt conventions if the pipeline uses Kling. |
| [geekjourneyx/awesome-ai-video-prompts](https://github.com/geekjourneyx/awesome-ai-video-prompts) | — | Curated list of official guides, templates and cinematic techniques for Veo, Sora, Runway, Pika, Kling. | Index of official model guides. |
| [snubroot/Veo-3-Prompting-Guide](https://github.com/snubroot/Veo-3-Prompting-Guide) | — | Community Veo 3 prompting guide. | Veo prompt examples. |
| [Vchitect/VBench](https://github.com/Vchitect/VBench) | — | Video generation evaluation suite (Section 6). | Scoring clips for breakage. |
| [carbon-design-system/carbon: packages/motion](https://github.com/carbon-design-system/carbon/tree/main/packages/motion) | Apache 2.0 | IBM Carbon easing curves and durations (Section 3.3). | Reference for a two-mode house motion system. |

---

## 8. Open questions

1. **What "polarity" means.** The user's brief names polarity as one of the qualities to force in a particular direction. The research turned up no named framework for it. Possible readings include the direction of light change (dark to bright, or bright to dark), the direction of motion (toward or away from camera, expanding or contracting, entering or exiting), or whether movements continue or collide (Pearlman's trajectory phrasing). The user should define it before it's built into the prompt.
2. **Which video model and host.** Several findings are model-specific (parameters, negative prompts, start/end frames, multi-shot). Apply the ones that match the model the codebase actually calls.

---

## 9. Sources

**Frameworks**
- Karen Pearlman, *Cutting Rhythms: Creative Film Editing*, 3rd ed., Routledge, 2025 — https://www.routledge.com/Cutting-Rhythms-Creative-Film-Editing/Pearlman/p/book/9781041024088
- "On Rhythm in Film Editing" (discussion of Pearlman's definitions) — https://www.academia.edu/41235278/On_Rhythm_in_Film_Editing
- Review of *Cutting Rhythms* (trajectory phrasing) — https://www.researchgate.net/publication/324855293
- Senses of Cinema review of the 3rd edition — https://www.sensesofcinema.com/2026/book-reviews/feeling-the-screen-storys-pulse-karen-peralmans-cutting-rhythms-creative-film-editing/
- Frank Thomas and Ollie Johnston, *The Illusion of Life: Disney Animation* (1981); summaries: Adobe (https://www.adobe.com/creativecloud/animation/discover/principles-of-animation.html), Animation Mentor (https://www.animationmentor.com/blog/tutorial-12-principles-of-animation/), Pluralsight (https://www.pluralsight.com/resources/blog/software-development/understanding-12-principles-animation)
- IBM Carbon Design System, Motion — https://carbondesignsystem.com/elements/motion/overview/

**Research**
- Geng et al., *Motion Prompting* (CVPR 2025) — https://arxiv.org/abs/2412.02700 · https://motion-prompting.github.io/
- VBench — https://github.com/Vchitect/VBench · https://vchitect.github.io/VBench-project/
- DynamicEval — https://arxiv.org/html/2510.07441v1

**AI motion problems and techniques**
- BudgetPixel, "Why AI Videos Feel Fake" — https://medium.com/budgetpixel-ai/why-ai-videos-feel-fake-and-how-consistency-fixes-everything-7c9dc9aa5720
- Lilach Bullock, "Why Do AI Generated Videos Still Look a Bit Weird?" — https://www.lilachbullock.com/why-ai-generated-videos-still-look-weird/
- Creatide, "Why AI Video Motion Looks Unnatural" — https://creatide.ai/blog/why-ai-video-motion-looks-unnatural-and-how-to-fix-it
- The Rank Masters, "How to Create Realistic AI Videos" — https://www.therankmasters.com/insights/ai-video/how-to-create-realistic-ai-videos-that-dont-look-fake
- Digital Synopsis, "Why AI Videos Often Look Fake" — https://digitalsynopsis.com/tools/ai-videos-look-fake-how-to-fix/
- Atlabs, camera movement prompt guide — https://www.atlabs.ai/blog/ultimate-prompt-guide-best-camera-movement-prompts-for-ai-videos-2026
- Atlabs, "Why Your AI Videos Look Fake" — https://www.atlabs.ai/blog/why-your-ai-videos-look-fake-(and-how-to-fix-them-step-by-step)
- Atlabs, Kling 3.0 prompting guide — https://www.atlabs.ai/blog/kling-3-0-prompting-guide-master-ai-video-generation
- Leonardo.Ai, Kling prompt guide — https://leonardo.ai/news/kling-ai-prompts
- fal.ai, Kling 3.0 prompting guide — https://blog.fal.ai/kling-3-0-prompting-guide/
- Higgsfield, Kling 3.0 guide — https://higgsfield.ai/blog/Kling-3.0-is-on-Higgsfield-User-Guide-AI-Video-Generation
- Kling v3.0 i2v API docs (Novita) — https://novita.ai/docs/api-reference/model-apis-kling-v3.0-4k-i2v
- Google Cloud, Veo 3.1 prompting guide — https://cloud.google.com/blog/products/ai-machine-learning/ultimate-prompting-guide-for-veo-3-1
- Invideo, Veo 3.1 guide — https://invideo.io/blog/google-veo-prompt-guide/
