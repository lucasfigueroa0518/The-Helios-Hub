// The close's timing and sound (Explainers 3.3, EX3-95), shared by the close itself (close.js,
// in the browser) and the Node tools that pace, write and check it. No imports.
//
// 2.5s, no voice: the Helios logo animates in at the centre of the screen, then "AI BRAIN BREAK"
// writes itself beneath it in the kit's print handwriting, then a still hold to read.

export const CLOSE = {
  /** The whole close, in seconds (pace.mjs makes the frame this long). */
  duration: 2.5,
  /** The logo scales in over these seconds, overshooting a little and settling. */
  logoIn: [0, 0.4],
  /** The handwriting starts and finishes. */
  write: [0.45, 1.85],
};

/** The close's sound events (frame seconds), written to its events file by mount.mjs. */
export const CLOSE_EVENTS = [
  { t: 0.28, kind: 'whoosh' },
  { t: 0.36, kind: 'sting' },
  { t: 0.45, kind: 'foley', what: 'pencil writing', dur: 1.4 },
  { t: 1.87, kind: 'foley', what: 'pen click' },
];
