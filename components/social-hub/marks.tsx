import type { CSSProperties } from 'react';

import { statusLabel } from '@/lib/social-hub/calendar';
import { VERTICALS, verticalInfo } from '@/lib/social-hub/verticals';
import type { HubPost, Vertical } from '@/lib/social-hub/types';

export function colorStyle(vertical: Vertical): CSSProperties {
  return { '--sh-color': `var(${verticalInfo(vertical).colorVar})` } as CSSProperties;
}

export function VerticalDot({ vertical }: { vertical: Vertical }) {
  return <span className="sh-vdot" style={colorStyle(vertical)} aria-hidden="true" />;
}

export function VerticalTag({ vertical }: { vertical: Vertical }) {
  return (
    <span className="sh-vtag" style={colorStyle(vertical)}>
      <VerticalDot vertical={vertical} />
      {verticalInfo(vertical).label}
    </span>
  );
}

export function StatusBadge({ post }: { post: HubPost }) {
  return <span className={`sh-status sh-status--${post.status}`}>{statusLabel(post)}</span>;
}

/** Color key for the calendar (SH-12: color = vertical). */
export function VerticalLegend() {
  return (
    <ul className="sh-legend" aria-label="Colors by content type">
      {VERTICALS.map((v) => (
        <li key={v.id}>
          <VerticalDot vertical={v.id} />
          {v.label}
        </li>
      ))}
    </ul>
  );
}
