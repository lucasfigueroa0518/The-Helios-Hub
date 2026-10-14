'use client';

import type { SlideCopy } from '@/lib/social/render/types';

import { coverModeOf, type EyePath } from './blocks';
import { CoverBleedPremium, EYE_PATH as BLEED_PATH } from './cover-bleed';
import { CoverIconPremium, EYE_PATH as ICON_PATH } from './cover-icon';
import { CoverLogoPremium, EYE_PATH as LOGO_PATH } from './cover-logo';
import { CoverSplitPremium, EYE_PATH as SPLIT_PATH } from './cover-split';

export function CoverSlidePremium({ slide }: { slide: SlideCopy }) {
  const mode = coverModeOf(slide);
  if (mode === 'split') return <CoverSplitPremium slide={slide} />;
  if (mode === 'logo') return <CoverLogoPremium slide={slide} />;
  if (mode === 'icon') return <CoverIconPremium slide={slide} />;
  return <CoverBleedPremium slide={slide} />;
}

export function eyePathForCover(slide: SlideCopy): EyePath {
  const mode = coverModeOf(slide);
  if (mode === 'split') return SPLIT_PATH;
  if (mode === 'logo') return LOGO_PATH;
  if (mode === 'icon') return ICON_PATH;
  return BLEED_PATH;
}
