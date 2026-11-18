// The Explainers world kit, critter D's acting (hx-6): a performance is a pure function of time.
// Three classes of behaviour stack, in this order, on every frame:
//   1. the held feeling: beats of emotion that persist until the story turns, each change an eased
//      blend of every expression parameter (lids, pupils, eye shape, crescents, tilt, squash, arms);
//   2. one-shot accents (gestures, eye behaviours, body moves) that play once on their beat, under a
//      cooldown and a rate cap, and never repeat on their own;
//   3. the life layer: seeded blinks, glances, breathing and weight shifts, scaled by the feeling.
// Nothing here draws: cast.js turns the resolved face vector into D's eyes, arms and body. The
// catalogues (20 more moods, 20 more arm poses, 10 more states, the accents) live here and cast.js
// merges them into the D namespace. No randomness at run time: the same track and seed give the
// same frame.

// ── Catalogues ───────────────────────────────────────────────────────────────────────────
/**
 * D's twenty added moods, in D_MOODS' format plus the eye shape keys: `lidR` (the right eye's own
 * lids), `low` (lower lid 0..1), `curve` (upper-lid sag, + droops, − arches), `cr` (cheek crescent
 * 0..2; above 1 closes into happy arcs), `ey` (eye height), `pr` (pupil size), `sq` (squash).
 */
export const MOODS_X = {
  relieved: { p: [0, -1], lid: [0.35, 0.35], curve: 0.3, cr: 0.35, es: [1, 1], tilt: 2, sq: 0.04, arms: ['down', 'down'] }, // the weight lifts: soft lids, a settling sag
  embarrassed: { p: [-7, 5], lid: [0.3, 0.2], low: 0.15, cr: 0.6, es: [0.95, 0.95], pr: 0.85, tilt: -5, arms: ['tuck', 'tuck'] }, // eyes slide away and down, arms tucked in
  determined: { p: [0, 1], lid: [0.12, 0.4], low: 0.2, pr: 0.85, es: [1, 1], tilt: -3, sq: -0.02, arms: ['ready', 'ready'] }, // inner lids set low, fists up, leaning in
  skeptical: { p: [5, 1], lid: [0.5, 0.4], lidR: [0.08, 0.04], es: [0.92, 1.06], tilt: 5, arms: ['down', 'chin'] }, // one eye narrowed, the other open: not buying it
  bored: { p: [-4, 4], lid: [0.5, 0.5], curve: 0.2, pr: 0.85, es: [1, 1], tilt: 3, sq: 0.05, arms: ['droop', 'droop'] }, // heavy flat lids, a slump
  excited: { p: [0, -3], lid: [0, 0], cr: 0.4, es: [1.12, 1.12], ey: 1.05, pr: 1.15, tilt: 0, sq: -0.05, arms: ['pump', 'pump'] }, // wide bright eyes, big pupils, arms up
  confused: { p: [-4, -5], lid: [0.3, 0], lidR: [0, 0], es: [0.9, 1.12], pr: 0.9, tilt: -8, arms: ['down', 'scratch'] }, // mismatched eyes, a head tilt, a scratch
  shy: { p: [-6, 6], lid: [0.25, 0.3], low: 0.22, es: [1, 1], pr: 1.1, tilt: -4, sq: 0.05, arms: ['tuck', 'tuck'] }, // looks down and away, small and tucked
  smug: { p: [3, -1], lid: [0.48, 0.42], curve: -0.25, cr: 0.6, es: [1, 1], tilt: -4, arms: ['back', 'back'] }, // half lids over a crescent, hands behind
  disappointed: { p: [0, 7], lid: [0.5, 0.15], curve: 0.25, es: [1, 1], tilt: 3, sq: 0.06, arms: ['droop', 'droop'] }, // outer lids droop, eyes down, a sag
  nervous: { p: [-5, 2], lid: [0.2, 0], low: 0.12, es: [1.05, 1.05], pr: 0.75, tilt: -2, arms: ['wring', 'wring'] }, // small pupils, raised inner lids, hands wringing
  thoughtful: { p: [6, -7], lid: [0.25, 0.25], low: 0.1, es: [1, 1], tilt: -4, arms: ['down', 'chin'] }, // eyes up and aside, a hand at the chin
  impatient: { p: [6, 0], lid: [0.35, 0.35], low: 0.1, es: [1, 1], tilt: 4, arms: ['hips', 'wrist'] }, // flat lids, a look off, checking the wrist
  amazed: { p: [0, -4], lid: [0, 0], es: [1.18, 1.18], ey: 1.08, pr: 1.2, tilt: 0, sq: -0.06, arms: ['wide', 'wide'] }, // the widest eyes, big pupils, arms spread
  guilty: { p: [-6, 7], lid: [0.38, 0.12], curve: 0.2, low: 0.1, pr: 0.8, es: [1, 1], tilt: 4, sq: 0.04, arms: ['back', 'back'] }, // eyes down and away, hands hidden
  hopeful: { p: [2, -7], lid: [0, 0], cr: 0.3, es: [1.06, 1.06], pr: 1.12, tilt: -2, sq: -0.03, arms: ['clasp', 'clasp'] }, // eyes up and open, hands clasped
  panicked: { p: [-3, 0], lid: [0, 0], es: [1.18, 1.18], ey: 1.06, pr: 0.55, tilt: 0, sq: -0.06, arms: ['flail', 'flail'] }, // tiny pupils in huge eyes, arms up
  content: { p: [0, 0], lid: [0.28, 0.28], curve: -0.4, cr: 1.45, es: [1, 1], tilt: 1, sq: 0.02, arms: ['down', 'down'] }, // easy half lids over a crescent
  suspicious: { p: [-8, 0], lid: [0.55, 0.55], low: 0.3, es: [1, 1], tilt: -4, arms: ['tuck', 'tuck'] }, // a narrow slit, pupils hard to one side
};

/** D's twenty added arm poses, in D_ARM_POSES' format (the left arm [shoulder, control, hand] in
 *  tile units; the right mirrors it). All are stubs: the hand stays within D's arm length and off
 *  the eyes. */
export const ARMS_X = {
  tuck: [[34, 120], [40, 142], [52, 150]], // hands pulled in low against the body
  clap: [[34, 120], [50, 150], [70, 148]], // both mittens in front of the belly, together
  wring: [[34, 120], [44, 152], [62, 154]], // hands low in front, fidgeting
  clasp: [[34, 116], [52, 144], [72, 138]], // hands clasped at the chest, hoping
  wide: [[33, 112], [10, 112], [0, 100]], // arms spread wide, taking it in
  back: [[33, 118], [30, 140], [40, 160]], // hands hidden behind, innocent or smug
  ready: [[33, 114], [18, 124], [22, 98]], // fists up at the sides, braced
  pump: [[35, 104], [10, 96], [14, 66]], // a fist punched up
  scratch: [[35, 106], [18, 82], [40, 62]], // a mitten at the side of the head, puzzled
  shield: [[35, 106], [20, 92], [30, 70]], // a hand up at the side, looking far off
  pointup: [[35, 108], [20, 98], [16, 76]], // pointing up: an idea, a fact
  pointside: [[33, 114], [10, 112], [-4, 112]], // pointing straight out to the side
  pointdown: [[33, 116], [14, 134], [4, 150]], // pointing down at something below
  reach: [[33, 112], [8, 104], [-6, 92]], // reaching up and out
  present: [[33, 114], [10, 118], [2, 108]], // an open hand presenting to the side
  flail: [[34, 108], [4, 92], [6, 74]], // arms up and out in alarm
  offer: [[33, 116], [14, 128], [6, 128]], // a hand held out low, offering
  wrist: [[34, 118], [44, 138], [62, 142]], // a hand across the front, checking the time
  rest: [[33, 118], [12, 140], [14, 158]], // arms hanging loose and wide
  stop: [[34, 110], [12, 100], [8, 84]], // a hand up, palm out: wait
};

/** Ten added motion states (critterTile's class hooks, as STATES): mood, CSS look and bob hooks,
 *  arms, and `steps` for walking feet. */
export const STATES_X = {
  listen: { mood: 'thoughtful', look: 'look', bob: 'bob', arms: ['down', 'down'] }, // attentive, eyes on the speaker
  present: { mood: 'proud', look: '', bob: 'bob', arms: ['down', 'present'] }, // showing something off to the side
  celebrate: { mood: 'excited', look: '', bob: 'bounce', arms: ['pump', 'pump'], noBlink: true }, // a win
  react: { mood: 'surprised', look: 'waitlook', bob: 'hop', arms: ['wide', 'wide'] }, // taken aback
  search: { mood: 'curious', look: 'scan', bob: 'bob', arms: ['down', 'shield'], steps: true }, // looking for something
  explain: { mood: 'content', look: 'look', bob: 'bob', arms: ['down', 'pointup'] }, // making a point
  cheer: { mood: 'excited', look: '', bob: 'bounce', arms: ['up', 'up'], noBlink: true }, // rooting for someone
  doze: { mood: 'sleepy', look: '', bob: 'bob', arms: ['rest', 'rest'] }, // nodding off
  puzzle: { mood: 'confused', look: 'think', bob: 'bob', arms: ['down', 'scratch'] }, // working it out
  reveal: { mood: 'amazed', look: '', bob: 'hop', arms: ['wide', 'wide'], noBlink: true }, // the big moment
};

// keyframe helpers: [[seconds, value]…], eased between keys
const env = (v, a = 0.18, h = 0.6, r = 0.3) => [[0, 0], [a, v], [a + h, v], [a + h + r, 0]];
const pulse = (v, a = 0.12, r = 0.3) => [[0, 0], [a, v], [a + r, 0]];
const osc = (vals, step, a = 0) => [[0, 0], ...vals.map((v, i) => [a + step * (i + 1), v]), [a + step * (vals.length + 1), 0]];

/**
 * The accents: one-shot moves keyed by name, in three kinds. `k` holds channel keyframes added to
 * the pose (px, py pupils; lid, low, es, ey, pr, cr eye shape; tilt, sq, hop, dx, lift, legL, legR
 * body; lx, ly, rx, ry hand offsets), `arms` blends arms toward a pose by weight. Snaps are 0.14–0.2 s.
 */
const GESTURE_X = {
  nod: { k: { py: [[0, 0], [0.15, 4], [0.3, -1], [0.45, 3], [0.65, 0]], sq: [[0, 0], [0.15, 0.04], [0.3, -0.01], [0.45, 0.03], [0.65, 0]] } }, // yes: a double dip of the gaze and body
  shake: { k: { px: osc([-6, 6, -4], 0.18), tilt: osc([-3, 3, -2], 0.18) } }, // no: eyes and body swing side to side
  shrug: { arms: { l: 'shrug', r: 'shrug', w: env(1, 0.18, 0.6) }, k: { sq: env(-0.04, 0.18, 0.6), lid: env(0.15, 0.18, 0.6) } }, // who knows: arms and shoulders up
  hop: { k: { sq: [[0, 0], [0.12, 0.08], [0.2, -0.06], [0.42, -0.03], [0.52, 0.06], [0.66, 0]], hop: [[0, 0], [0.12, 0], [0.3, 14], [0.48, 0]] } }, // a small hop: crouch, lift, land
  flinch: { arms: { l: 'ready', r: 'ready', w: env(0.9, 0.1, 0.35, 0.4) }, k: { tilt: env(-6, 0.08, 0.35, 0.4), dx: env(-6, 0.08, 0.35, 0.4), sq: env(0.07, 0.08, 0.35, 0.4), lid: env(0.3, 0.08, 0.35, 0.4) } }, // recoils from something
  doubletake: { k: { px: [[0, 0], [0.15, 6], [0.35, 6], [0.45, -2], [0.55, 0]], es: [[0, 0], [0.42, 0], [0.54, 0.14], [0.9, 0.1], [1.3, 0]], hop: [[0, 0], [0.42, 0], [0.54, 6], [0.72, 0]] } }, // glance, away, then snap back wide
  clap: { arms: { l: 'clap', r: 'clap', w: env(1, 0.15, 0.7) }, k: { lx: osc([5, 0, 5, 0], 0.13, 0.15), rx: osc([-5, 0, -5, 0], 0.13, 0.15), hop: osc([2, 0, 2, 0], 0.13, 0.15) } }, // claps twice
  wave: { arms: { r: 'wave', w: env(1, 0.18, 1, 0.26) }, k: { rx: osc([-10, 4, -10, 4], 0.2, 0.18), tilt: env(2, 0.18, 1, 0.26) } }, // hello: the right arm up, two waves
  point: { arms: { r: 'pointside', w: [[0, 0], [0.16, 1.06], [0.24, 1], [1.2, 1], [1.45, 0]] }, k: { px: env(6, 0.12, 1.08, 0.25), tilt: env(2, 0.16, 1.04, 0.25) } }, // points and looks to the side
  fistpump: { arms: { r: 'pump', w: [[0, 0], [0.14, 1.05], [0.22, 1], [0.45, 1], [0.7, 0]] }, k: { ry: [[0, 0], [0.14, -6], [0.3, 4], [0.45, 0]], hop: pulse(5, 0.14, 0.2), cr: env(0.6, 0.14, 0.3) } }, // yes! one fist punched up
  bounce: { k: { hop: [[0, 0], [0.15, 8], [0.3, 0], [0.45, 5], [0.6, 0]], sq: [[0, 0], [0.08, 0.05], [0.15, -0.04], [0.3, 0.05], [0.45, -0.02], [0.6, 0]] } }, // two springy bounces
  bow: { k: { sq: env(0.1, 0.3, 0.5), py: env(6, 0.3, 0.5), lid: env(0.3, 0.3, 0.5) } }, // a little bow: sinks, eyes down
  leanin: { k: { tilt: env(6, 0.25, 0.8), dx: env(5, 0.25, 0.8), es: env(0.04, 0.25, 0.8) } }, // leans in, interested
  leanback: { k: { tilt: env(-6, 0.2, 0.8), dx: env(-4, 0.2, 0.8), es: env(0.06, 0.2, 0.8) } }, // leans back, taken aback
  gasp: { k: { es: [[0, 0], [0.12, 0.16], [0.7, 0.1], [1, 0]], hop: pulse(4, 0.12, 0.2), sq: [[0, 0], [0.12, -0.06], [0.7, -0.03], [1, 0]], pr: [[0, 0], [0.12, -0.25], [0.7, -0.15], [1, 0]] } }, // a sharp intake: eyes wide, pupils small
  sigh: { k: { sq: [[0, 0], [0.4, -0.03], [0.9, 0.07], [1.6, 0]], lid: [[0, 0], [0.4, 0], [0.9, 0.3], [1.6, 0]], py: [[0, 0], [0.4, 0], [0.9, 3], [1.6, 0]] } }, // swells, then sags with heavy lids
  slump: { arms: { l: 'droop', r: 'droop', w: env(1, 0.3, 0.8, 0.5) }, k: { sq: env(0.08, 0.3, 0.8, 0.5), lid: env(0.2, 0.3, 0.8, 0.5), py: env(4, 0.3, 0.8, 0.5) } }, // deflates
  cheer: { arms: { l: 'up', r: 'up', w: env(1, 0.16, 0.7) }, k: { hop: [[0, 0], [0.16, 10], [0.36, 0], [0.56, 6], [0.76, 0]], cr: env(1, 0.16, 0.7) } }, // both arms up, two hops
  beckon: { arms: { r: 'offer', w: env(1, 0.18, 0.9) }, k: { ry: osc([-8, 0, -8, 0], 0.18, 0.18), tilt: env(3, 0.18, 0.9) } }, // come here: a low hand curls in twice
  stretch: { arms: { l: 'up', r: 'up', w: env(1, 0.5, 0.6, 0.5) }, k: { sq: env(-0.07, 0.5, 0.6, 0.5), lid: env(0.5, 0.5, 0.6, 0.5), lift: env(0.6, 0.5, 0.6, 0.5) } }, // a long stretch on tiptoe
  yawn: { arms: { l: 'up', r: 'up', w: env(0.7, 0.6, 0.5, 0.6) }, k: { lid: env(0.7, 0.6, 0.5, 0.6), sq: env(-0.05, 0.6, 0.5, 0.6), tilt: env(-3, 0.6, 0.5, 0.6) } }, // eyes squeeze shut while the arms rise
  raise: { arms: { r: 'up', w: env(1, 0.18, 1) }, k: { lift: env(0.5, 0.18, 1), es: env(0.05, 0.18, 1) } }, // a hand up: me, a question
  present: { arms: { r: 'present', w: env(1, 0.2, 1.2, 0.35) }, k: { px: env(5, 0.15, 1.25, 0.35), tilt: env(3, 0.2, 1.2, 0.35) } }, // ta-da toward the side
  scratch: { arms: { r: 'scratch', w: env(1, 0.22, 0.9) }, k: { ry: osc([3, -1, 3, -1], 0.14, 0.22), tilt: env(-5, 0.22, 0.9), py: env(-3, 0.22, 0.9) } }, // scratches the head, puzzled
  stop: { arms: { r: 'stop', w: [[0, 0], [0.14, 1.06], [0.22, 1], [0.9, 1], [1.15, 0]] }, k: { tilt: env(-3, 0.14, 0.76), es: env(0.06, 0.14, 0.76) } }, // a hand up: wait
  wring: { arms: { l: 'wring', r: 'wring', w: env(1, 0.2, 1) }, k: { lx: osc([3, -2, 3, -2], 0.18, 0.2), rx: osc([-3, 2, -3, 2], 0.18, 0.2), pr: env(-0.2, 0.2, 1) } }, // fidgeting hands
  clasp: { arms: { l: 'clasp', r: 'clasp', w: env(1, 0.22, 0.9) }, k: { py: env(-4, 0.22, 0.9), es: env(0.05, 0.22, 0.9), lift: env(0.4, 0.22, 0.9) } }, // please: hands together, eyes up
  offer: { arms: { r: 'offer', w: env(1, 0.22, 1) }, k: { tilt: env(3, 0.22, 1), px: env(3, 0.22, 1) } }, // holds a hand out
  reach: { arms: { r: 'reach', w: env(1, 0.25, 0.8) }, k: { tilt: env(5, 0.25, 0.8), lift: env(0.6, 0.25, 0.8), px: env(5, 0.2, 0.85), py: env(-4, 0.2, 0.85) } }, // stretches up and out for something
  pointup: { arms: { r: 'pointup', w: [[0, 0], [0.15, 1.05], [0.22, 1], [1, 1], [1.25, 0]] }, k: { py: env(-5, 0.12, 0.88, 0.25), hop: pulse(3, 0.15, 0.2) } }, // aha: points up
  pointdown: { arms: { r: 'pointdown', w: env(1, 0.18, 1) }, k: { py: env(6, 0.15, 1), tilt: env(4, 0.18, 1) } }, // points down at something
  wrist: { arms: { r: 'wrist', w: env(1, 0.22, 0.8) }, k: { px: env(-4, 0.25, 0.75), py: env(5, 0.25, 0.75) } }, // checks the time
  tada: { arms: { l: 'wide', r: 'wide', w: [[0, 0], [0.16, 1.06], [0.24, 1], [0.9, 1], [1.2, 0]] }, k: { hop: pulse(8, 0.16, 0.24), sq: [[0, 0], [0.08, 0.06], [0.16, -0.06], [0.4, 0], [0.9, 0]], cr: env(0.8, 0.16, 0.74) } }, // a reveal: arms flung wide on a hop
  brace: { arms: { l: 'ready', r: 'ready', w: env(1, 0.16, 0.8) }, k: { sq: env(0.06, 0.16, 0.8), lid: env(0.2, 0.16, 0.8), legL: env(8, 0.16, 0.8), legR: env(-8, 0.16, 0.8) } }, // braces for impact
  giggle: { k: { hop: osc([2, 0, 2, 0, 1.5], 0.1), cr: env(1.7, 0.12, 0.45), curve: env(-0.5, 0.12, 0.45), lid: env(0.14, 0.12, 0.45), sq: osc([0.03, -0.01, 0.03, -0.01, 0.02], 0.1) } }, // eyes squeeze happy, little shakes
  startle: { arms: { l: 'flail', r: 'flail', w: env(1, 0.1, 0.3, 0.4) }, k: { hop: pulse(10, 0.1, 0.25), es: env(0.16, 0.1, 0.3, 0.4), pr: env(-0.35, 0.1, 0.3, 0.4), sq: [[0, 0], [0.1, -0.08], [0.35, 0.04], [0.8, 0]] } }, // jumps at a sudden thing
  wince: { k: { lid: env(0.55, 0.1, 0.35), low: env(0.25, 0.1, 0.35), tilt: env(-4, 0.1, 0.35), sq: env(0.05, 0.1, 0.35) } }, // squeezes the eyes at a bad one
  cower: { arms: { l: 'tuck', r: 'tuck', w: env(1, 0.18, 0.9) }, k: { sq: env(0.1, 0.18, 0.9), tilt: env(-5, 0.18, 0.9), dx: env(-6, 0.18, 0.9), py: env(4, 0.18, 0.9) } }, // shrinks away
};

const EYE_X = {
  blink: { k: { lid: [[0, 0], [0.06, 1], [0.1, 1], [0.21, 0]] } }, // one deliberate blink
  glance: { k: { px: env(6, 0.06, 0.5, 0.12) } }, // a quick look to the side and back
  saccade: { k: { px: [[0, 0], [0.05, -5], [0.3, -5], [0.35, 4], [0.6, 4], [0.66, 0]] } }, // jumps between two points
  sideeye: { k: { px: env(9, 0.14, 1), lid: env(0.35, 0.14, 1), low: env(0.12, 0.14, 1) } }, // a narrowed look to the side
  eyeroll: { k: { px: [[0, 0], [0.15, -6], [0.35, 0], [0.55, 6], [0.8, 0]], py: [[0, 0], [0.15, -3], [0.35, -8], [0.55, -3], [0.8, 0]], lid: env(0.2, 0.3, 0.3) } }, // the pupils roll up and over
  squint: { k: { lid: env(0.35, 0.16, 0.8), low: env(0.3, 0.16, 0.8) } }, // narrows the eyes to see
  widen: { k: { es: env(0.12, 0.14, 0.7), ey: env(0.06, 0.14, 0.7), lid: env(-0.3, 0.14, 0.7) } }, // the eyes open wide
  dart: { k: { px: [[0, 0], [0.04, -5], [0.2, -5], [0.24, 5], [0.4, 5], [0.44, -3], [0.6, -3], [0.66, 0]] } }, // nervous darting left, right, left
  scan: { k: { px: [[0, 0], [0.3, -7], [1, 7], [1.3, 0]], py: env(2, 0.3, 0.7) } }, // a slow sweep across
  lookup: { k: { py: env(-8, 0.14, 0.8), es: env(0.04, 0.14, 0.8) } }, // looks up
  lookdown: { k: { py: env(8, 0.14, 0.8), lid: env(0.2, 0.14, 0.8) } }, // looks down
  lookaway: { k: { px: env(-8, 0.16, 0.9), py: env(3, 0.16, 0.9), lid: env(0.15, 0.16, 0.9) } }, // breaks eye contact
  flutter: { k: { lid: osc([0.9, 0, 0.9, 0, 0.9], 0.07), cr: env(0.5, 0.1, 0.3) } }, // fluttering lids, charmed
  stare: { k: { es: env(0.06, 0.2, 1.2, 0.3), pr: env(-0.15, 0.2, 1.2, 0.3), lid: env(-0.2, 0.2, 1.2, 0.3) } }, // a fixed unblinking stare
  droop: { k: { lid: [[0, 0], [0.6, 0.6], [0.9, 0.55], [1.2, 0.7], [1.4, 0]], py: env(4, 0.6, 0.6, 0.2) } }, // lids sag, then catch
};

const BODY_X = {
  deepbreath: { k: { sq: [[0, 0], [0.7, -0.06], [1, -0.06], [1.8, 0.03], [2.1, 0]], lid: [[0, 0], [1, 0.25], [1.8, 0]] } }, // a big slow breath in and out
  sway: { k: { tilt: [[0, 0], [0.5, 3], [1.1, -3], [1.6, 0]], dx: [[0, 0], [0.5, 3], [1.1, -3], [1.6, 0]] } }, // sways once side to side
  shift: { k: { tilt: env(2.5, 0.4, 0.6, 0.5), dx: env(3, 0.4, 0.6, 0.5), legL: env(-4, 0.4, 0.6, 0.5) } }, // moves its weight to one foot
  tiptoe: { k: { lift: env(1, 0.2, 0.8), sq: env(-0.03, 0.2, 0.8) } }, // rises on its toes
  shuffle: { k: { legL: osc([8, -4, 8, -4], 0.15), legR: osc([-4, 8, -4, 8], 0.15), dx: [[0, 0], [0.3, 2], [0.75, 4]], hop: osc([1.5, 0, 1.5, 0], 0.15) } }, // a few awkward shuffled steps
  sink: { k: { sq: env(0.1, 0.35, 0.7, 0.4), py: env(3, 0.35, 0.7, 0.4) } }, // sinks down into itself
  rise: { k: { sq: env(-0.07, 0.25, 0.7, 0.35), lift: env(0.5, 0.25, 0.7, 0.35) } }, // draws itself up tall
  stomp: { k: { legR: [[0, 0], [0.15, -24], [0.25, 0], [0.4, 0]], sq: [[0, 0], [0.15, -0.03], [0.25, 0.08], [0.45, 0]], hop: [[0, 0], [0.15, 3], [0.25, 0]] } }, // one stomp of a foot
  tap: { k: { legR: osc([-14, 0, -14, 0, -14, 0], 0.13) } }, // taps a foot three times
  wiggle: { k: { tilt: osc([4, -4, 4, -4], 0.12), sq: osc([-0.02, 0.02, -0.02, 0.02], 0.12) } }, // a happy wiggle
  rock: { k: { tilt: [[0, 0], [0.4, 4], [0.9, -2], [1.3, 0]], legL: [[0, 0], [0.4, -6], [0.9, 3], [1.3, 0]] } }, // rocks back on its heels and forward
  dip: { k: { sq: pulse(0.07, 0.14, 0.3), hop: [[0, 0], [0.14, -2], [0.44, 0]] } }, // a quick knee dip, a beat
  perk: { k: { sq: [[0, 0], [0.12, -0.07], [0.2, -0.05], [0.7, 0]], es: env(0.08, 0.12, 0.3), hop: pulse(3, 0.12, 0.2) } }, // perks up: something caught its attention
  shiver: { k: { dx: osc([2, -2, 2, -2, 2, -2], 0.05), sq: env(0.04, 0.05, 0.25) } }, // a cold or scared shiver
  jump: { k: { sq: [[0, 0], [0.16, 0.1], [0.24, -0.08], [0.5, -0.03], [0.62, 0.08], [0.8, 0]], hop: [[0, 0], [0.16, 0], [0.38, 26], [0.6, 0]], lift: [[0, 0], [0.2, 1], [0.55, 1], [0.6, 0]] } }, // a full jump
  scoot: { k: { dx: [[0, 0], [0.18, 6], [0.3, 6], [0.48, 12]], hop: osc([2, 0], 0.12), legL: osc([10, 0], 0.12) } }, // scoots over a little
  settle: { k: { sq: [[0, 0], [0.2, 0.05], [0.45, -0.02], [0.7, 0.01], [0.9, 0]], tilt: [[0, 0], [0.2, -1.5], [0.45, 1], [0.9, 0]] } }, // settles in after a move
};

const tag = (o, kind) => Object.fromEntries(Object.entries(o).map(([n, a]) => [n, { kind, ...a }]));
/** Every accent by name: { kind: 'gesture' | 'eye' | 'body', k, arms? }. */
export const ACCENTS = { ...tag(GESTURE_X, 'gesture'), ...tag(EYE_X, 'eye'), ...tag(BODY_X, 'body') };
for (const a of Object.values(ACCENTS)) {
  const ends = [...Object.values(a.k ?? {}), ...(a.arms ? [a.arms.w] : [])].map((ks) => ks[ks.length - 1][0]);
  a.dur = Math.max(...ends);
  a.cool = Math.max(1.5, a.dur + 1);
}

/**
 * How the life layer behaves under a feeling: blinks per second and their slowness, glances per
 * second and their size (tile px), the breath period (s) and the weight-shift size (degrees).
 */
const LIFE_DEF = { blink: 0.135, slow: 1, glance: 0.35, gamp: 3, breath: 3.6, shift: 1 };
const LIFE_SET = [
  [['sleepy'], { blink: 0.09, slow: 2.4, glance: 0.06, gamp: 1.5, breath: 5.2, shift: 0.6 }],
  [['bored', 'content', 'relieved'], { blink: 0.108, slow: 1.5, glance: 0.15, gamp: 2, breath: 4.5, shift: 0.7 }],
  [['focused', 'determined', 'thoughtful'], { blink: 0.068, slow: 1, glance: 0.12, gamp: 1.5, breath: 3.8, shift: 0.4 }],
  [['suspicious', 'skeptical', 'sly'], { blink: 0.09, slow: 1, glance: 0.5, gamp: 3.5, breath: 3.6, shift: 0.6 }],
  [['nervous', 'worried'], { blink: 0.248, slow: 0.8, glance: 1.1, gamp: 4, breath: 2.2, shift: 1.3 }],
  [['panicked'], { blink: 0.27, slow: 0.7, glance: 1.4, gamp: 4.5, breath: 1.6, shift: 1.5 }],
  [['impatient', 'angry'], { blink: 0.18, slow: 0.9, glance: 0.8, gamp: 3.5, breath: 2.8, shift: 1.4 }],
  [['embarrassed', 'shy', 'guilty', 'disappointed'], { blink: 0.203, slow: 1.1, glance: 0.6, gamp: 3, breath: 3.4, shift: 0.9 }],
  [['excited', 'happy', 'hopeful'], { blink: 0.158, slow: 0.9, glance: 0.5, gamp: 3, breath: 2.6, shift: 1.2 }],
  [['surprised', 'amazed'], { blink: 0.045, slow: 1, glance: 0.2, gamp: 2, breath: 3, shift: 0.5 }],
];
/** The life profile of a mood (LIFE_DEF overridden by its class). */
export function lifeOf(mood) {
  const hit = LIFE_SET.find(([names]) => names.includes(mood));
  return { ...LIFE_DEF, ...(hit ? hit[1] : {}) };
}

/** Thresholds actingProblems and actingAt hold to: the least time a feeling must read (s), the
 *  most feeling changes in a window (count, s), the least gap between accents and the most per window. */
export const ACTING_LIMITS = { minRead: 0.9, changes: 2, changeWindow: 3, accentGap: 0.6, accents: 3, accentWindow: 5 };

// ── Maths ────────────────────────────────────────────────────────────────────────────────
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const mix = (a, b, u) => a + (b - a) * u;
const smooth = (u) => { u = clamp(u, 0, 1); return u * u * (3 - 2 * u); };
const inOut = (u) => { u = clamp(u, 0, 1); return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; };
/** cubic-bezier(x1, y1, x2, y2) on 0..1. */
function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let u = t;
    for (let i = 0; i < 8; i++) {
      const x = ((ax * u + bx) * u + cx) * u - t;
      const d = (3 * ax * u + 2 * bx) * u + cx;
      if (Math.abs(d) < 1e-6) break;
      u = clamp(u - x / d, 0, 1);
    }
    return ((ay * u + by) * u + cy) * u;
  };
}
const OVER = bezier(0.34, 1.32, 0.55, 1);
/** The approved overshoot at amplitude 0.82. */
const over = (u) => { const b = OVER(clamp(u, 0, 1)); return b > 1 ? 1 + (b - 1) * 0.82 : b; };
/** Keyframes [[t, v]…] at time t, eased between keys. */
function keyAt(ks, t) {
  if (t <= ks[0][0]) return ks[0][1];
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i][0]) {
      const [t0, v0] = ks[i - 1];
      const [t1, v1] = ks[i];
      return mix(v0, v1, smooth((t - t0) / (t1 - t0 || 1)));
    }
  }
  return ks[ks.length - 1][1];
}
function seedOf(s) {
  if (typeof s === 'number') return s >>> 0;
  let h = 2166136261;
  for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return h >>> 0;
}
/** A hash of (seed, slot, salt) to [0, 1). */
function hash(seed, k, salt) {
  let x = (seed ^ Math.imul(k + 0x9e37, 0x85ebca6b) ^ Math.imul(salt + 1, 0xc2b2ae35)) >>> 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d); x ^= x >>> 15; x = Math.imul(x, 0x846ca68b); x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

// ── The face vector ──────────────────────────────────────────────────────────────────────
/** The scalar expression keys: pupils, the four upper lids, the lower lid, lid curve, crescent,
 *  eye scales, eye height, pupil size, body tilt, squash, hop, tiptoe lift, leg swings, shift. */
export const FACE_VEC = ['px', 'py', 'lo', 'li', 'ro', 'ri', 'low', 'curve', 'cr', 'esl', 'esr', 'ey', 'pr', 'tilt', 'sq', 'hop', 'lift', 'legL', 'legR', 'dx'];
const ZERO = Object.fromEntries(FACE_VEC.map((k) => [k, 0]));

/**
 * The acting system over a mood table and an arm-pose table (cast.js binds D's). Returns
 * { moodVec, actingAt, actingProblems }.
 */
export function actingSystem({ moods, poses, states = {}, alias = (m) => m, known = (m) => !!moods[m] }) {
  const armPts = (name, side) => {
    const P = poses[name];
    if (!P) throw new Error(`HX: arm pose "${name}" must be one of ${Object.keys(poses).join(', ')}`);
    return side > 0 ? P.map(([x, y]) => [200 - x, y]) : P.map((p) => [...p]);
  };
  /** A mood as a vector: { ...FACE_VEC numbers, aL, aR (arm points, screen tile units) }. */
  function moodVec(name) {
    const m = moods[alias(name)] ?? moods.neutral;
    const lidR = m.lidR ?? m.lid;
    const low = m.low ?? 0;
    return {
      ...ZERO,
      px: m.p[0], py: m.p[1], lo: m.lid[0], li: m.lid[1], ro: lidR[0], ri: lidR[1], low,
      curve: m.curve ?? 0, cr: m.cr === true ? 1 : m.cr || 0, esl: m.es[0], esr: m.es[1], ey: m.ey ?? 1,
      pr: m.pr ?? (m.small ? 0.7 : 1), tilt: m.tilt, sq: m.sq ?? 0,
      aL: armPts(m.arms[0], -1), aR: armPts(m.arms[1], 1),
    };
  }
  const NEUTRAL = moodVec('neutral');
  const mixArms = (A, B, u) => A.map((p, i) => [mix(p[0], B[i][0], u), mix(p[1], B[i][1], u)]);
  /** v scaled from neutral by intensity k. */
  function scaled(v, k) {
    const o = {};
    for (const key of FACE_VEC) o[key] = mix(NEUTRAL[key], v[key], k);
    o.aL = mixArms(NEUTRAL.aL, v.aL, k);
    o.aR = mixArms(NEUTRAL.aR, v.aR, k);
    return o;
  }
  const norm = (track) => {
    const beats = Array.isArray(track) ? track : track?.beats ?? [];
    return [...beats].map((b, i) => ({ ...b, i })).sort((a, b) => a.at - b.at || a.i - b.i);
  };
  const emotionOf = (b) => b.emotion ?? (b.state ? states[b.state]?.mood : null) ?? 'neutral';
  /** A beat's target vector: its feeling at its intensity, its pose and look on top. */
  function target(b) {
    const v = scaled(moodVec(emotionOf(b)), clamp(b.intensity ?? 1, 0, 1));
    const pose = b.pose ?? (b.state ? states[b.state]?.arms : null);
    if (pose) {
      const [l, r] = Array.isArray(pose) ? pose : [pose, pose];
      if (l) v.aL = armPts(l, -1);
      if (r) v.aR = armPts(r, 1);
    }
    if (b.look) { v.px += b.look[0] * 7; v.py += b.look[1] * 6; }
    return v;
  }
  /** Mix two vectors: face channels in-out, the eyes leading by `lead`, arms and tilt with overshoot. */
  function blend(A, B, u, ul) {
    const o = {};
    const e = inOut(u);
    const eo = over(u);
    for (const k of FACE_VEC) o[k] = mix(A[k], B[k], k === 'px' || k === 'py' ? inOut(ul) : k === 'tilt' || k === 'dx' ? eo : e);
    o.aL = mixArms(A.aL, B.aL, eo);
    o.aR = mixArms(A.aR, B.aR, eo);
    return o;
  }
  const BLEND = 0.45;
  /** The eyes lead: they arrive in this share of the blend. */
  const LEAD = 0.7;
  /** The held feeling at t (no accents, no life). */
  function held(beats, t) {
    if (!beats.length) return { v: { ...NEUTRAL, aL: NEUTRAL.aL, aR: NEUTRAL.aR }, i: -1 };
    let start = target(beats[0]);
    let i = 0;
    for (let k = 1; k < beats.length && beats[k].at <= t; k++) {
      const from = start;
      const prevB = beats[k - 1];
      const dt = beats[k].at - prevB.at;
      // where the previous blend had got to when this beat began
      if (k - 1 > 0) {
        const pb = prevB.blend ?? BLEND;
        start = blend(from, target(prevB), dt / pb, dt / (pb * LEAD));
      } else start = target(prevB);
      i = k;
    }
    if (i === 0) return { v: target(beats[0]), i: 0 };
    const b = beats[i];
    const bl = b.blend ?? BLEND;
    const dt = t - b.at;
    return { v: blend(start, target(b), dt / bl, dt / (bl * LEAD)), i };
  }
  const accentsOf = (b) => [].concat(b.accent ?? []).filter(Boolean);
  /** The accents that play: in time order, each kept only if it clears its own cooldown, the gap
   *  and the per-window cap (the rest are dropped, never queued). */
  function admitted(beats) {
    const L = ACTING_LIMITS;
    const out = [];
    const dropped = [];
    for (const b of beats) {
      for (const name of accentsOf(b)) {
        const at = b.at + (b.accentAt ?? 0);
        const a = ACCENTS[name];
        if (!a) { dropped.push({ name, at, why: 'unknown' }); continue; }
        const last = out.at(-1);
        const same = [...out].reverse().find((x) => x.name === name);
        const inWin = out.filter((x) => x.at > at - L.accentWindow).length;
        if (same && at - same.at < a.cool) dropped.push({ name, at, why: 'cooldown' });
        else if (last && at - last.at < L.accentGap) dropped.push({ name, at, why: 'gap' });
        else if (inWin >= L.accents) dropped.push({ name, at, why: 'rate' });
        else out.push({ name, at, a });
      }
    }
    return { out, dropped };
  }
  /** Emotion at time t (the beat in force), for the life layer. */
  const moodAt = (beats, t) => {
    let m = beats.length ? emotionOf(beats[0]) : 'neutral';
    for (const b of beats) if (b.at <= t) m = emotionOf(b); else break;
    return alias(m);
  };
  /** The breath phase at t, integrated across the feelings' periods so it never jumps. */
  function breathPhase(beats, t) {
    let ph = 0;
    let t0 = 0;
    let m = beats.length ? moodAt(beats, 0) : 'neutral';
    for (const b of beats) {
      if (b.at >= t) break;
      if (b.at > t0) { ph += (b.at - t0) / lifeOf(m).breath; t0 = b.at; }
      m = alias(emotionOf(b));
    }
    ph += (t - t0) / lifeOf(m).breath;
    return ph;
  }
  /** The life layer at t: { blink 0..1, gx, gy, sq, tilt, dx }. */
  function life(beats, t, seed) {
    const S = 0.5;
    let blink = 0;
    const K = Math.floor(t / S);
    const occurs = (k) => hash(seed, k, 1) < lifeOf(moodAt(beats, k * S)).blink * S;
    for (let k = K - 3; k <= K; k++) {
      if (!occurs(k) || occurs(k - 1)) continue;
      const P = { ...lifeOf(moodAt(beats, k * S)) };
      P.slow = Math.min(1, P.slow); // natural blinks only: never a slow blink
      const t0 = k * S + hash(seed, k, 2) * 0.25;
      const shape = (tt) => {
        const c = 0.06 * P.slow;
        const h = 0.04 * P.slow;
        const o = 0.11 * P.slow;
        if (tt < 0 || tt > c + h + o) return 0;
        return tt < c ? smooth(tt / c) : tt < c + h ? 1 : 1 - smooth((tt - c - h) / o);
      };
      blink = Math.max(blink, shape(t - t0));
    }
    // glances: held a moment, a fast saccade out and back
    const G = 1.3;
    let gx = 0;
    let gy = 0;
    const KG = Math.floor(t / G);
    for (let k = KG - 1; k <= KG; k++) {
      const P = lifeOf(moodAt(beats, k * G));
      if (hash(seed, k, 5) >= Math.min(0.9, P.glance * G)) continue;
      const t0 = k * G + hash(seed, k, 6) * 0.3;
      const d = 0.35 + hash(seed, k, 7) * 0.55;
      const a = hash(seed, k, 8) * Math.PI * 2;
      const mag = P.gamp * (0.6 + 0.4 * hash(seed, k, 9));
      const w = smooth((t - t0) / 0.06) * (1 - smooth((t - t0 - d) / 0.1));
      gx += Math.cos(a) * mag * w;
      gy += Math.sin(a) * mag * 0.6 * w;
    }
    // micro-saccades: tiny steps
    const M = 0.45;
    const KM = Math.floor(t / M);
    const mv = (k) => [(hash(seed, k, 10) - 0.5) * 0.8, (hash(seed, k, 11) - 0.5) * 0.6];
    const um = smooth((t - KM * M) / 0.05);
    const [m0, m1] = [mv(KM - 1), mv(KM)];
    gx += mix(m0[0], m1[0], um);
    gy += mix(m0[1], m1[1], um);
    // weight shifts
    const W = 3.5;
    const KW = Math.floor(t / W);
    const sv = (k) => (hash(seed, k, 12) < 0.6 ? (hash(seed, k, 13) - 0.5) * 2.4 * lifeOf(moodAt(beats, k * W)).shift : 0);
    const shift = mix(sv(KW - 1), sv(KW), smooth((t - KW * W) / 0.9));
    const sq = 0.012 * Math.sin(2 * Math.PI * (breathPhase(beats, t) + hash(seed, 0, 14)));
    return { blink, gx, gy, sq, tilt: shift, dx: shift * 1.2 };
  }

  /**
   * The resolved pose at time t of a performance: `track` is beats [{ at, emotion, hold?,
   * intensity?, blend?, look?, pose?, accent?, state? }] (or { beats, seed }). A feeling persists
   * until the next beat. Returns { mood, intensity, face, armPts, life, accents } for D.tile and,
   * spread into critter(), its options (face, arms, rig, legs, sq).
   * @param {number} t
   * @param {Array<Record<string, any>> | { beats: Array<Record<string, any>>, seed?: string|number }} track
   * @param {{ seed?: string|number, life?: boolean }} [opts]
   */
  function actingAt(t, track, { seed = track?.seed ?? 'critter', life: alive = true } = {}) {
    const beats = norm(track);
    const { v, i } = held(beats, t);
    const f = { ...v, aL: v.aL.map((p) => [...p]), aR: v.aR.map((p) => [...p]) };
    const playing = [];
    for (const x of admitted(beats).out) {
      const u = t - x.at;
      if (u < 0 || u > x.a.dur) continue;
      playing.push(x.name);
      if (x.a.arms) {
        const w = keyAt(x.a.arms.w, u);
        if (x.a.arms.l) f.aL = mixArms(f.aL, armPts(x.a.arms.l, -1), w);
        if (x.a.arms.r) f.aR = mixArms(f.aR, armPts(x.a.arms.r, 1), w);
      }
      for (const [ch, ks] of Object.entries(x.a.k ?? {})) {
        const val = keyAt(ks, u);
        if (ch === 'lid') { f.lo += val; f.li += val; f.ro += val; f.ri += val; } else if (ch === 'es') { f.esl += val; f.esr += val; } else if (ch === 'lx' || ch === 'ly') f.aL[2][ch === 'lx' ? 0 : 1] += val;
        else if (ch === 'rx' || ch === 'ry') f.aR[2][ch === 'rx' ? 0 : 1] += val;
        else f[ch] += val;
      }
    }
    const L = alive ? life(beats, t, seedOf(seed)) : { blink: 0, gx: 0, gy: 0, sq: 0, tilt: 0, dx: 0 };
    f.px += L.gx; f.py += L.gy; f.sq += L.sq; f.tilt += L.tilt; f.dx += L.dx;
    for (const k of ['lo', 'li', 'ro', 'ri']) f[k] = mix(clamp(f[k], 0, 1), 1, L.blink);
    f.low = clamp(f.low + L.blink * 0.2, 0, 0.6);
    f.cr = clamp(f.cr, 0, 2);
    f.esl = clamp(f.esl, 0.8, 1.2); f.esr = clamp(f.esr, 0.8, 1.2);
    f.ey = clamp(f.ey, 0.85, 1.12); f.pr = clamp(f.pr, 0.5, 1.3);
    f.lift = clamp(f.lift, 0, 1); f.hop = Math.max(0, f.hop);
    f.curve = clamp(f.curve, -0.5, 0.5);
    const b = beats[Math.max(0, i)];
    return {
      mood: alias(b ? emotionOf(b) : 'neutral'),
      intensity: b?.intensity ?? 1,
      face: f,
      armPts: [f.aL, f.aR],
      life: L,
      accents: playing,
    };
  }

  /**
   * Emote spam in a track: [{ code, at, detail }]. Codes: unknown-emotion, unknown-accent,
   * unknown-pose, bad-intensity, short-hold (a feeling changed before it could read, or before its
   * own `hold`), emote-spam (too many feeling changes in a window), accent-gap, accent-rate,
   * accent-cooldown (the same accent again too soon).
   */
  function actingProblems(track) {
    const L = ACTING_LIMITS;
    const beats = norm(track);
    const out = [];
    for (const b of beats) {
      const e = emotionOf(b);
      if (!known(e)) out.push({ code: 'unknown-emotion', at: b.at, detail: `emotion "${e}" is not one of ${Object.keys(moods).join(', ')}` });
      if (b.intensity != null && !(b.intensity >= 0 && b.intensity <= 1)) out.push({ code: 'bad-intensity', at: b.at, detail: `intensity ${b.intensity} is outside 0..1` });
      for (const p of [].concat(b.pose ?? [])) if (p && !poses[p]) out.push({ code: 'unknown-pose', at: b.at, detail: `pose "${p}" is not a D arm pose` });
      for (const a of accentsOf(b)) if (!ACCENTS[a]) out.push({ code: 'unknown-accent', at: b.at, detail: `accent "${a}" is not one of the ACCENTS` });
    }
    // feeling changes
    const changes = [];
    let cur = null;
    for (const b of beats) {
      const e = alias(emotionOf(b));
      if (e !== cur) { changes.push({ at: b.at, e, hold: b.hold }); cur = e; }
    }
    for (let k = 0; k + 1 < changes.length; k++) {
      const held = changes[k + 1].at - changes[k].at;
      const need = Math.max(L.minRead, changes[k].hold ?? 0);
      if (k > 0 || changes[k].at > 0 || changes.length > 1) {
        if (held < need) out.push({ code: 'short-hold', at: changes[k].at, detail: `"${changes[k].e}" is held ${held.toFixed(2)} s before it changes (needs ${need} s to read)` });
      }
    }
    for (let k = 0; k < changes.length; k++) {
      const n = changes.filter((c, j) => j > 0 && c.at >= changes[k].at && c.at < changes[k].at + L.changeWindow).length;
      if (n > L.changes) { out.push({ code: 'emote-spam', at: changes[k].at, detail: `${n} feeling changes within ${L.changeWindow} s (max ${L.changes})` }); break; }
    }
    // accents
    const seen = [];
    for (const b of beats) {
      for (const name of accentsOf(b)) {
        const a = ACCENTS[name];
        if (!a) continue;
        const at = b.at + (b.accentAt ?? 0);
        const same = [...seen].reverse().find((x) => x.name === name);
        const last = seen.at(-1);
        if (same && at - same.at < a.cool) out.push({ code: 'accent-cooldown', at, detail: `"${name}" again ${(at - same.at).toFixed(2)} s after the last (cooldown ${a.cool.toFixed(2)} s)` });
        if (last && at - last.at < L.accentGap) out.push({ code: 'accent-gap', at, detail: `"${name}" ${(at - last.at).toFixed(2)} s after "${last.name}" (min ${L.accentGap} s)` });
        const inWin = seen.filter((x) => x.at > at - L.accentWindow).length;
        if (inWin >= L.accents) out.push({ code: 'accent-rate', at, detail: `"${name}" is accent ${inWin + 1} within ${L.accentWindow} s (max ${L.accents})` });
        seen.push({ name, at });
      }
    }
    return out;
  }

  return { moodVec, actingAt, actingProblems, admitted: (track) => admitted(norm(track)) };
}
