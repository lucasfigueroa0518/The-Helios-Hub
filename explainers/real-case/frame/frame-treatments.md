## Frame Treatments

> A Real Case Reel always has eight frames in this order (planning/Real Case Reels/DECISIONS.md RC-12),
> usually 50–65s; length is never chased by cutting words. Each frame is its voice plus a 0.15s `hold`.
> Each treatment names its ground, focal, shots, the move that carries the beat, and its sounds. Every
> number, label and outcome on screen is one of the event's facts (the storyboard's `claims:`).

### 1 · The incident (about 5s · `hook` · cut in)

**The opener is the bank's** (EX3-102). Every reel draws one animated intro at random from the opener
bank (`assets/kit/openers/`), never one of the last 8 reels' openers; `assets/opener.json` names it. The
key item is an object, so the opener is one of the seven that never touch a critter hero (Paper Rip,
Typewriter, Big Bang, Balloon Pop, Block Drop, Unboxing, Paper Plane). It shows "AI BRAIN BREAK" first,
then the title card with the term. Code writes `assets/frames/01-opener.js` (`pace.mjs`, `mount.mjs`);
never edit it. Its sound is its own stem (`opener-sfx.mjs`).

**The frame worker writes the hook only: `assets/frames/01-hook.js`**, to this contract:

```js
export const shots = [ /* one shot, as any scene frame; two if the frame runs past 6s */ ];
export default {
  ground: 'paper',
  shots,
  draw(t, { hideHero = false, heroPose = {} } = {}) {
    // the event's key moment in motion under shotFrame(); the key item in it, in its orange
  },
};
```

The hook exports no `hero` (an object-led reel), and `hideHero` and `heroPose` are never passed. No
title card and no text in the hook (the opener draws them), no events file (the opener's stem is the
frame's sound).

**Hook shot:** the storyboard's picked hook, **already moving at frame 0**, its first visible change by
0.3s, and **clear on its own**: a viewer with no context knows what they are looking at within 1 second
(a familiar product or moment, the key item in it, something visibly going wrong or impossibly right).
It raises a question; it is never a slow pan over a still scene. **Ground** the story world's. **Move**
the moment builds (`ramp-up`); the camera may push in with it. **Title card** the opener's. Captions are
quiet for the frame.

### The 1→2 cut: the attention reset (mandatory)

A hit lands exactly on the cut (placed by `opener-sfx.mjs`). Frame 2 opens with the reset its storyboard
`reset:` names: a camera **punch-in**, a **color change** (the ground flips paper → night or forest), an
**in-frame zoom-through** out of the hook (`seams.js` `zoomThroughIn`), or a **visual effect on the cut**
(the kit's `shock()` marks, or a one-frame palette flash). The reset lands in the first 0.3s.

### 2 · The puzzle (about 9s · `pain_point`)

**Shows** the story world, closer than the hook: the rest of what happened, each piece arriving as the
voice names it, then **the strange detail** isolated on a clear ground (circled, lifted, or traced back
to where it came from), and the question landing on a held shot of it. **Focal** the strange detail,
usually the key item. **Move** anticipatory: something surprising has just been seen and the viewer
wants to know how. Never the term on screen.

### 3 · Name it: the dictionary card (about 5s · `product_intro`)

**Top half** `dictionaryCard(t, { headword, pos, words })` from `cards.js`: the headword is the term
(the storyboard `term:`), `pos` is `part_of_speech:`, `words` are frame 3's word times from
`assets/timing/03-define.json` (the definition equals the voiceover); each word appears on its time and
stays. Never lay the text out by hand. **Below the card** (from its returned `bottom` + 40px to y 1600) a
drawn visual of what the definition says, simple, in open space; the key item may appear in its orange.
**Focal** the thing the definition names, in the visual. Captions are quiet. **Sounds:** `paper slide`
as the card lands; a `typewriter key` or soft `pen writing` with `dur` under the fill-in; a sound on each
arrival in the visual.

### 4 · Walk it (about 13s · `feature_showcase`)

**Establishing shot first:** the reel's one `wide` shot of the story world, the concept's machinery laid
out on the event's own things. **The step tracker** (the `step-tracker` component) runs along one edge
of the safe area, its stops the anchor steps' names (world.js `STEPS`, `technical`), numbered, each
lighting (green) on the word that names it, done stops ink, upcoming ones 25%. **Then** closer shots
(`medium`, `close`, `insert`), one step at a time: each step plays on the event's own thing as a visible
state change on its voice cue (`STEPS`, `in_story`), the key item moving through them. The frame ends on
the last step, never on a stated cause. **Focal** the step happening now. This is the reel's richest
picture: the eye moves through it and is rewarded, and it stays clean. **Sounds:** a `tick` as each
stop lights, every arrival, every state change.

### 5 · The click (about 8s · `feature_showcase`)

**Shows** the step that produced the outcome, replayed on the key item in `close` or `insert` shots (not
frame 4's framing): the key item glows or is traced as it passes through that step, and a drawn line
(dotted ink, drawing itself) leads from the cause to the outcome as the voice says why. The outcome
lands on the word that names it. **Focal** the key item at the causal step, then the outcome. **Never** a
list, a node grid, or a slideshow. **Sounds:** the action's own sound on each move, a `pop` as the line
lands.

### 6 · The other side (about 8s · `social_proof`)

**Shows** the same story world at the step the fix or the limit touches, in its own shots: for a failure,
the fix applied at that step, as the facts describe it, and the step running again cleanly; for a success, the limit made visible (a state the step cannot hold, a cost, a miss); for a
mystery, what is known lit and what is still open left faint. **Focal** the step being changed or tested.
**Sounds:** the change's own sound, a `tick` or `pop` for any label.

### 7 · The takeaway (about 6s · `benefit_highlight`)

**Shows** the answer landing, on a ground different from frame 6's: the key item, small and settled, and
one drawn thing for the rule the viewer keeps, named as a stranger names it, built from objects drawn
for it, and critters when someone acts. At most one
callback shot of the story world. **Shots** two or more when it runs past 6s. **Focal** the rule's
object. **Sounds:** a soft landing for the answer, one for the rule.

### 8 · The close (2.5s · `branding`) · built by code

The kit's `close.js` (EX3-95); no worker writes it. **Ground** `white`. The Helios logo, about 40% of the
width, animates in; then "AI BRAIN BREAK" writes itself beneath it in Hershey Sans, in ink; then it
holds, the two centred on the screen. No voiceover, no captions. **Sounds** (fixed, `close-timing.js`).
The music fades out across it.

