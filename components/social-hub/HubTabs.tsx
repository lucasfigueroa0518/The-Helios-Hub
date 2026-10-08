'use client';

import { usePathname } from 'next/navigation';

import { SegmentedNav, type SegmentedTab } from '@/components/hub-shell/SegmentedNav';
import { hubBaseOf } from '@/lib/social-hub/links';

/** Section bar for every Social Hub page (spec §3). Same pattern as Trial Reels' nav. */
export function HubTabs() {
  const path = usePathname() ?? '/social';
  const base = hubBaseOf(path);
  const tabs: SegmentedTab[] = [
    { id: 'calendar', label: 'Calendar', href: base },
    { id: 'analytics', label: 'Analytics', href: `${base}/analytics` },
    { id: 'house', label: 'Content House', href: `${base}/house` },
  ];
  const rest = path.slice(base.length);
  const active = rest.startsWith('/analytics') ? 'analytics' : rest.startsWith('/house') ? 'house' : 'calendar';
  return (
    <div className="sh-nav-row">
      <SegmentedNav tabs={tabs} activeId={active} ariaLabel="Social Hub sections" />
    </div>
  );
}
