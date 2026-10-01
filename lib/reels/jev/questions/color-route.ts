import { choice } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import type { ColorProfile } from '@/lib/reels/visual/color';

/**
 * P-12. Route a reel's on-screen copy to a color profile. The state is the
 * on-screen copy only. Every option is a valid look, so code takes the top
 * choice at any confidence. v5 (D-219): copy that states a cost or a risk to
 * the viewer is orange ahead of noir, even when something is also hidden.
 * v6 (D-221): green is the grade when the copy fits no other look. Noir stays
 * for something hidden, broken, or still running, with no stated stake.
 */

type Criterion = { means: string; use_for: string; not_for: string };

const criteria = {
  noir: {
    means: 'A dark room. Black fills the frame, with one small orange light.',
    use_for:
      'Something hidden, broken, watched, or heavy, with no stated stake for the viewer. A record, a permission, or a process that keeps going after the person looks away.',
    not_for:
      'A clean fact that should read like a printed page (paper). A warning, a loss, or a price (orange), even when the thing keeps running. Copy that states a cost or a risk to the viewer (orange). A release, a fix, or something that came into the open on purpose (green).',
  },
  paper: {
    means: 'A white field. Black type will sit on it, like a page in daylight.',
    use_for:
      'A plain fact, a correction, a document, a result stated cleanly, something exposed with nothing lurking and nothing newly arrived.',
    not_for:
      'A threat, a secret, a failure, or something that keeps running out of sight (noir). Heat, urgency, a loss, or a price (orange). A release, a launch, or a fix, where the arrival is the point (green).',
  },
  orange: {
    means: 'The whole frame flooded with orange, as a look rather than a real light.',
    use_for: 'A warning, a loss, a cost, a price, heat, or urgency. The number or the stake is the point.',
    not_for:
      'A calm explanation with no stake (paper). Something concealed, or a process that simply keeps running (noir). A gain, a release, or a fix with no loss (green).',
  },
  green: {
    means: 'The whole frame flooded with green, as a look rather than a real light.',
    use_for:
      'A release, a launch, a fix, or a capability that arrived and works. The point is that something new is here, or something got better. Also the choice when the copy fits no other look.',
    not_for:
      'A price, a loss, or a warning (orange). A plain fact with no arrival and no stake (paper). Something hidden, broken, or still running out of sight (noir).',
  },
} satisfies Record<ColorProfile, Criterion>;

export const COLOR_ROUTE = defineQuestionSet({
  id: 'color-route',
  version: 'color-route-v6',
  questions: {
    color: choice(
      {
        question: 'Which color grade should a short vertical video use behind this on-screen text?',
        state: '`on_screen_copy` is the exact text the viewer reads over the picture.',
        judge:
          'Match the feeling of the copy as a whole. A price, a loss, or a warning is orange, and so is any cost or risk the copy states for the viewer, even when something is also hidden. A release, a fix, or something that arrived and works is green. A clean stated fact, with no arrival and no stake, is paper. Anything hidden, broken, heavy, or still going after the person looks away is noir. When the copy fits no other look, the grade is green.',
      },
      criteria,
    ),
  },
});
