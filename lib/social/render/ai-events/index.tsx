'use client';

/**
 * AI Events This Week slides (plan M5; planning/AI Events/DECISIONS.md AE-13 to AE-16): four looks,
 * each with a cover, a city slide and a closing CTA slide (layoutVariant `ae_{look}_{role}`). Each
 * slide is one `div.ae-frame` filling the slide well; SlideTemplate draws no masthead, icon
 * background or photo credit around it. Copy comes from lib/ai-events/post.ts; CSS is
 * drafts/ai-events.css on top of the design system's premium.css.
 */
import type { ReactElement } from 'react';

import type { AeLook, SlideCopy } from '@/lib/social/render/types';

import { DaylightCity, DaylightCover, DaylightCta } from './daylight';
import { GlassCity, GlassCover, GlassCta } from './glass';
import { OrbCity, OrbCover, OrbCta } from './orb';
import { Rank } from './rank';
import { Tease, type AeCity, type AeCover, type AeCta } from './shared';
import { SpotlightCity, SpotlightCover, SpotlightCta } from './spotlight';

type Looks = { cover: (p: { s: AeCover }) => ReactElement; city: (p: { s: AeCity }) => ReactElement; cta: (p: { s: AeCta }) => ReactElement };

const LOOKS: Record<AeLook, Looks> = {
  spotlight: { cover: SpotlightCover, city: SpotlightCity, cta: SpotlightCta },
  glass: { cover: GlassCover, city: GlassCity, cta: GlassCta },
  daylight: { cover: DaylightCover, city: DaylightCity, cta: DaylightCta },
  orb: { cover: OrbCover, city: OrbCity, cta: OrbCta },
};

export const isAiEventsKind = (kind: string) => kind.startsWith('ae_');

export function AiEventsSlide({ slide }: { slide: SlideCopy }) {
  const s = slide.aiEvents;
  if (!s) return null;
  const look = LOOKS[s.look] ?? LOOKS.spotlight;
  switch (s.role) {
    case 'cover':
      return <look.cover s={s} />;
    case 'city':
      return <look.city s={s} />;
    case 'rank':
      return <Rank s={s} />;
    case 'tease':
      return <Tease s={s} />;
    case 'cta':
      return <look.cta s={s} />;
    default:
      return null;
  }
}
