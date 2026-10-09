'use client';

import { useHubParams } from '@/components/social-hub/nav/HubNav';
import { TYPE_ICON, typeStyle } from '@/components/social-hub/ui/marks';
import { VERTICALS } from '@/lib/social-hub/verticals';
import type { Vertical } from '@/lib/social-hub/types';

/** Narrow the month to some content types (pills: choosing, not doing). Empty param = all. */
export function TypeToggles({ shown }: { shown: Vertical[] }) {
  const { set } = useHubParams();
  const all = shown.length === VERTICALS.length;
  const toggle = (v: Vertical) => {
    // From "All types", a click means "show me this one" (the filter-chip expectation); after that, clicks add and remove.
    const next = all ? [v] : shown.includes(v) ? shown.filter((x) => x !== v) : [...shown, v];
    set({ types: next.length === 0 || next.length === VERTICALS.length ? null : VERTICALS.filter((x) => next.includes(x.id)).map((x) => x.id).join(',') });
  };
  return (
    <div className="sh-pills" role="group" aria-label="Content types shown">
      <button type="button" className="sh-pill" aria-pressed={all} onClick={() => set({ types: null })}>All types</button>
      {VERTICALS.map((v) => {
        const Icon = TYPE_ICON[v.id];
        return (
          <button key={v.id} type="button" className="sh-pill" aria-pressed={!all && shown.includes(v.id)} onClick={() => toggle(v.id)} style={typeStyle(v.id)}>
            <span className="sh-type__dot" aria-hidden="true" />
            <Icon size={13} aria-hidden="true" />
            {v.label}
          </button>
        );
      })}
    </div>
  );
}
