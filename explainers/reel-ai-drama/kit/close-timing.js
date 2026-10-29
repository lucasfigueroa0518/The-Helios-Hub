// The brand close's timing and sounds (Reel AI Drama, MD-13, MD-18), shared by close.js in the browser
// and by the Node tools that pace, mount, mix and check it. No imports.
//
// The close is the last frame, about 2.5s, a fixed length: the comment question is spoken and
// captioned over it and never makes the reel longer (S-33). There is no opening sting (MD-13).

/** The close (the last frame). */
export const CLOSE = {
  duration: 2.5,
  /** The longest question that fits: its voice plus a short tail stays inside the close. */
  maxQuestion: 2.3,
  /** The orange rule wipes in. */
  ruleIn: [0.05, 0.3],
  /** The wordmark is revealed left to right. */
  wordIn: [0.18, 0.62],
  /** The Helios mark is set down beside "a Helios series" (never recolored; clear space kept). */
  markIn: [0.5, 0.78],
};

/** Sound events in frame seconds, in the events-file format sound.mjs reads: the mark lands. */
export const CLOSE_EVENTS = [{ t: CLOSE.markIn[1], kind: 'impact' }];
