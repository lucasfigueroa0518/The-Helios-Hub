// The sting's and the close's timing and sounds (AI News Explained), shared by sting.js / close.js in
// the browser and by the Node tools that pace, mount, mix and check them. No imports.
//
// Every sound is the action's own, on its contact frame (SCENES.md): the folder lands, the stamp hits.

/** The sting: in frame 1's hold, a rubber stamp hits a manila case folder (reference: 03-sting.png). */
export const STING = {
  /** Frame 1's hold after its voice: the whole sting. pace.mjs gives frame 1 exactly this hold. */
  duration: 1.2,
  /** The folder slides in over the board and lands. */
  folderIn: [0, 0.22],
  /** The stamp comes down and hits (the contact frame is the window's end). */
  stampDown: [0.3, 0.42],
  /** The stamp lifts away, leaving the impression. */
  stampUp: [0.5, 0.66],
};

/** The close: frame 8, no voice (reference: 13-close.png). */
export const CLOSE = {
  duration: 2.5,
  folderIn: [0, 0.22],
  /** The Helios mark is set down on the folder (never recolored; its clear space kept). */
  markIn: [0.35, 0.6],
  stampDown: [0.85, 0.97],
  stampUp: [1.05, 1.2],
};

/** Sound events in frame seconds, in the events-file format sound.mjs reads. */
export const STING_EVENTS = (at) => [
  { t: at + STING.folderIn[1], kind: 'foley', what: 'paper drop folder' },
  { t: at + STING.stampDown[1], kind: 'foley', what: 'stamp press thump' },
];

export const CLOSE_EVENTS = [
  { t: CLOSE.folderIn[1], kind: 'foley', what: 'paper drop folder' },
  { t: CLOSE.markIn[1], kind: 'foley', what: 'paper drop' },
  { t: CLOSE.stampDown[1], kind: 'foley', what: 'stamp press thump' },
];
