// The brand close's timing and sounds (Reel AI Drama, MD-143), shared by close.js in the browser and by
// the Node tools that pace, mount, mix and check it. No imports. The look is AI Brain Break's close
// (explainers/world-kit/close.js, read and ported, never imported).
//
// The close is the last frame, 2.5s: white, the Helios logo scales in at the centre, "Reel AI Drama" writes
// itself beneath it in the print handwriting, then a still hold. The comment question is spoken and
// captioned over it. A question voiced past maxQuestion stretches the close to its voice plus a short tail
// (pace.mjs closeLength), so it is never cut off. The last story frame crossfades into it (CLOSE_FADE).

/** The close (the last frame). */
export const CLOSE = {
  duration: 2.5,
  /** The longest question that fits unstretched: its voice plus a short tail stays inside `duration`. */
  maxQuestion: 2.3,
  /** The story crossfades to the white ground over these seconds (the storyboard's transition_in). */
  fade: [0, 0.4],
  /** The logo scales in, overshooting a little and settling; it starts as the white forms. */
  logoIn: [0.28, 0.68],
  /** The handwriting starts and finishes. */
  write: [0.72, 1.95],
};

/** The close's `- transition_in:` (transitions.mjs): the outgoing frame holds and the white fades in over it. */
export const CLOSE_FADE = `crossfade ${CLOSE.fade[1] - CLOSE.fade[0]}s`;

/** Sound events in frame seconds, in the events-file format sound.mjs reads. */
export const CLOSE_EVENTS = [
  { t: 0.2, kind: 'whoosh' },
  { t: 0.62, kind: 'sting' },
  { t: 0.72, kind: 'foley', what: 'pencil writing', dur: 1.23 },
  { t: 1.97, kind: 'foley', what: 'pen click' },
];
