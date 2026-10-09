import type { CSSProperties } from 'react';
import {
  ClockAlert,
  Ban,
  Check,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Clapperboard,
  Clock,
  GalleryHorizontal,
  Hand,
  Loader,
  Presentation,
  SkipForward,
  Sparkles,
  TriangleAlert,
  Upload,
  type LucideIcon,
} from 'lucide-react';

import { verticalInfo } from '@/lib/social-hub/verticals';
import type { PostState, StateIcon } from '@/lib/social-hub/views/state';
import type { Vertical } from '@/lib/social-hub/types';

/** Lucide icons for each content type (DESIGN.md, Content Type Mark). */
export const TYPE_ICON: Record<Vertical, LucideIcon> = {
  reels: Clapperboard,
  explainers: Presentation,
  carousels: GalleryHorizontal,
  stories: Sparkles,
};

const STATE_ICON: Record<StateIcon, LucideIcon> = {
  loader: Loader,
  'circle-dashed': CircleDashed,
  hand: Hand,
  clock: Clock,
  'clock-alert': ClockAlert,
  check: Check,
  upload: Upload,
  'circle-check': CircleCheck,
  'triangle-alert': TriangleAlert,
  ban: Ban,
  'circle-slash': CircleSlash,
  'skip-forward': SkipForward,
};

export function typeStyle(vertical: Vertical): CSSProperties {
  return { '--sh-color': `var(--sh-v-${vertical})` } as CSSProperties;
}

/** Dot + icon + name. In dense rows the name may drop; the dot and icon never do. */
export function TypeMark({ vertical, name = true, short = false }: { vertical: Vertical; name?: boolean; short?: boolean }) {
  const info = verticalInfo(vertical);
  const Icon = TYPE_ICON[vertical];
  const label = short ? info.short : info.label;
  return (
    <span className="sh-type" style={typeStyle(vertical)} title={name ? undefined : info.label}>
      <span className="sh-type__dot" aria-hidden="true" />
      <Icon size={14} aria-hidden="true" />
      {name ? label : <span className="sh-sr">{info.label}</span>}
    </span>
  );
}

/** Icon + word. Only Needs you and Failed carry color (MATRICES.md §1). */
export function StateBadge({ state }: { state: Pick<PostState, 'id' | 'label' | 'tone' | 'icon'> }) {
  const Icon = STATE_ICON[state.icon];
  const tone = state.tone === 'quiet' ? '' : ` sh-state--${state.tone}`;
  return (
    <span className={`sh-state${tone} sh-state--${state.id}`}>
      <Icon size={13} aria-hidden="true" />
      {state.label}
    </span>
  );
}
