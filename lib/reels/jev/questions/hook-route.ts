import { choice } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import type { Hook } from '@/lib/reels/visual/hook';

/**
 * P-11. Route a reel's on-screen copy to one of the ffmpeg hooks. The state is
 * the on-screen copy and nothing else: the hook answers what the viewer reads
 * first, not the source or the scene.
 *
 * Every option is a whole-screen disruption, so a split distribution between
 * two of them is harmless. Code takes the top choice at any confidence.
 */

type Criterion = { means: string; use_for: string; not_for: string };

const criteria = {
  glitch: {
    means: 'Digital corruption: the picture tears and splits like broken software.',
    use_for: 'Something malfunctioning. A model or product misbehaving, a bug, an error, a hallucination, a hack or breach, an automation going wrong. A breach stays here even when someone was not told about it: the malfunction is the point.',
    not_for: 'Something that stopped entirely (blue_screen). A story whose point is a false public picture rather than a breakdown (invert).',
  },
  color_bars: {
    means: 'Broadcast test pattern, as if programming is being interrupted for an announcement.',
    use_for: 'Something going public. A launch, release, announcement, open-sourcing, a first-ever, a result just made available.',
    not_for: 'A launch whose real point is a flaw (glitch) or that the public claim is the opposite of the truth (invert).',
  },
  invert: {
    means: 'The picture flips to its photographic negative: dark becomes light. What was shown is the reverse of what is there.',
    use_for: 'A reversal or a concealment. The opposite of what people assume, a contrarian claim, a myth corrected, roles swapped. Also an undisclosed fact, deception, people not being told, a hidden human or hidden cost, censorship: the picture the public was given is the negative of the truth.',
    not_for: 'A plain breakdown with no false picture (glitch). A plain ending (blue_screen). History told as history (vhs). A benchmark, checker, or measurement, even one that overturns what people believed (thermal).',
  },
  vhs: {
    means: 'A worn videotape: washed-out picture, scanlines, a tracking band rolling through.',
    use_for: 'The past. History, an origin story, decades-old technology, how something used to work, a comeback, an old idea returning. An old secret belongs here when the age is the point.',
    not_for: 'A recent event told without looking back.',
  },
  thermal: {
    means: 'Heat-camera vision: the scene seen through a sensor.',
    use_for: 'Scrutiny. Tracking, monitoring, surveillance, data collected about people, a benchmark or test exposing how something really performs, something scanned or measured.',
    not_for: 'A fact withheld, with no one watching or measuring it (invert).',
  },
  blue_screen: {
    means: 'The solid blue field of a dead video signal.',
    use_for: 'Something ending. A shutdown, a ban, a product killed, an outage, layoffs, a company folding, access cut off.',
    not_for: 'Something still running but broken (glitch).',
  },
} satisfies Record<Hook, Criterion>;

export const HOOK_ROUTE = defineQuestionSet({
  id: 'hook-route',
  version: 'hook-route-v2',
  questions: {
    hook: choice(
      {
        question: 'Which full-screen visual disruption should open a short vertical video that carries this on-screen text?',
        state: '`on_screen_copy` is the exact text the viewer reads over the video.',
        judge: 'Match the core of what the text is about, the one thing a viewer takes away in the first second. Go by meaning, not by surface words. A launch that is itself the news is color_bars. A launch mentioned only to show the public claim is false is invert. A system misbehaving is glitch even when people were not told. A measurement that exposes real performance is thermal.',
      },
      criteria,
    ),
  },
});

export const HOOK_ROUTE_OPTIONS = Object.keys(criteria) as Hook[];
