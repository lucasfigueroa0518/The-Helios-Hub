# Frame worker — the shared contract (Helios AI News Explained, news-v1)

> The packet builder puts this file and the format delta below it into `_role.md`. Every rule here is
> mandatory.

You build **one frame** of a Helios AI News Explained reel: its scene module and its sound events.
Other workers build the other frames at the same time; you never touch their files.

## What you read

1. `_role.md` (this file and the delta) and your **frame packet**: your frame's storyboard block, with
   its `ground`, `scene`, `voiceover`, `claims`, `artifacts`, `shots`, and its Scene lines.
2. `frame.md` in full: the three scenes, the components and their options, the art you may use, one
   item per shot, the camera, the frame treatment for your act, the forbidden list, and the motion and
   sound rules.
3. `assets/timing/<frame id>.json`: your frame's `duration`, `voice_end`, `hold`, and every word's
   `start` and `end` in frame seconds. Time every cue from it.
4. `STORYBOARD.md`'s `## Case file` (the key detail, players, artifacts, numbers, objects, mechanism)
   and `BRIEF.md`'s `## Artifacts` (artifact words, verbatim).
5. `assets/objects/credits.json` and `assets/bank/credits.json`: the objects, cutouts and logos that
   exist for this reel. Nothing else exists.
6. Only if you need an option `frame.md` does not list: the doc comment of that function in
   `assets/kit/components/`. Never read the kit's internals or the kit's tests.

## What you write

Exactly two files, where the frame id is the basename of your storyboard `src`
(`compositions/frames/03-moment.html` → `03-moment`):

1. `assets/frames/<frame id>.js`, the scene module;
2. `assets/frames/<frame id>.events.json`, its sound events.

### The scene module

```js
let S, rig /* , and each item and mark you animate */;

export default {
  ground: 'board', // your storyboard ground:
  build(root, ctx) {
    const nk = ctx.nk;
    const doc = root.ownerDocument;
    S = nk.board(doc);
    root.append(S.el);
    // create every item and mark once, append items to S.stage, set up the camera
  },
  render(t) {
    // set every item's and mark's state for frame time t; then rig.apply(t)
  },
};
```

- An ES module with **no imports**: everything comes from `ctx.nk`. `ctx` also holds `timing` (your
  timing file), `duration`, `assets` (the path prefix for art) and `objects` (drawings' strokes).
- `build(root, ctx)` runs once: create every element you will ever show, hidden until its moment (marks
  start undrawn; items get their arrival in `render`). `render(t)` is a **pure function of t**: it
  sets each element's state from `t` alone, with no randomness, clocks, timers, state carried between
  calls, or elements created or removed. The renderer seeks to any `t` in any order.
- Word times come from `ctx.timing.words` in `build` (find a cue word by its text, with a fallback time),
  stored in module variables that `render` reads.
- Show an element by clearing `visibility` (`''`), never by setting it to `'visible'`; never use a CSS
  `filter: url(#…)`.

Never write `compositions/`, never edit `STORYBOARD.md`, `frame.md`, the kit, or another frame's files,
never run commands, never ask questions.

## Sound events

`assets/frames/<frame id>.events.json` is a JSON array, one entry per visible action, at its contact
frame in frame seconds:

```json
[
  { "t": 0.31, "kind": "foley", "what": "paper drop" },
  { "t": 0.38, "kind": "foley", "what": "pushpin" },
  { "t": 1.9, "kind": "foley", "what": "felt marker writing paper", "dur": 0.55 }
]
```

- `kind` is `foley`, `impact`, `tick` or `click`. A `foley` needs `what`, in `frame.md`'s words for its
  action. A continuous action (a stroke, a wipe) is **one** `foley` with `dur` (0.2–8s) for exactly as
  long as it moves.
- Every visible action has its event and every event has its visible action, except the marker's uncap
  and cap (`frame.md` § Motion rules 5). At least 4 events.
- `t` runs from 0 to your frame's `duration`.

## Timing

Your frame's `duration` is fixed by the real voice plus a short `hold`. The voice is tight, so the
picture keeps pace: each item arrives as the voice names it, each mark finishes on its word, and the
frame has landed by `voice_end`.

## Self-check before you stop

`ground` equals the storyboard's · each shot gives one item the attention, and it is what the voice
names then · the key detail marked in its color on its word, when your act shows it · every fact,
number, date and name on screen is in your frame's `claims:` or its artifacts, word for word · only
art the credits files list · nothing from `frame.md`'s forbidden list · no readable text in the caption
band or outside the safe area · `render(t)` is pure and works at t = 0, mid-frame and the end · every
action has its event and every event its action (the marker's uncap and cap aside).

Your last message names the two files you wrote.
