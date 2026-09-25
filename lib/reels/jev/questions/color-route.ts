import { choice } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import type { ColorProfile } from '@/lib/reels/visual/color';

/**
 * P-12. Route a reel's on-screen copy to a color profile. The state is the
 * on-screen copy only. Every option is a valid look, so code takes the top
 * choice at any confidence.
 */

type Criterion = { means: string; use_for: string; not_for: string };

const criteria = {
  noir: {
    means: 'A dark room. Black fills the frame, with one small orange light.',
    use_for:
      'Something hidden, broken, watched, or heavy. A record, a permission, or a process that keeps going after the person looks away. Also the choice when the copy fits no other look.',
    not_for:
      'A clean fact that should read like a printed page (paper). A warning, a loss, or a price (orange), even when the thing keeps running.',
  },
  paper: {
    means: 'A white field. Black type will sit on it, like a page in daylight.',
    use_for: 'A plain fact, a correction, a document, a result stated cleanly, something exposed with nothing lurking.',
    not_for:
      'A threat, a secret, a failure, or something that keeps running out of sight (noir). Heat, urgency, a loss, or a price (orange).',
  },
  orange: {
    means: 'The whole frame flooded with orange, as a look rather than a real light.',
    use_for: 'A warning, a loss, a cost, a price, heat, or urgency. The number or the stake is the point.',
    not_for: 'A calm explanation with no stake (paper). Something concealed, or a process that simply keeps running (noir).',
  },
} satisfies Record<ColorProfile, Criterion>;

export const COLOR_ROUTE = defineQuestionSet({
  id: 'color-route',
  version: 'color-route-v2',
  questions: {
    color: choice(
      {
        question: 'Which color grade should a short vertical video use behind this on-screen text?',
        state: '`on_screen_copy` is the exact text the viewer reads over the picture.',
        judge:
          'Match the feeling of the first line. A price, a loss, or a warning is orange. A clean stated fact is paper. Anything hidden, broken, heavy, or still going after the person looks away is noir.',
      },
      criteria,
    ),
  },
});
