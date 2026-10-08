'use client';

import { usePathname } from 'next/navigation';

import { SegmentedNav, type SegmentedTab } from '@/components/hub-shell/SegmentedNav';

const TABS = [
  { id: 'queue', label: 'Queue', href: '/stories' },
  { id: 'history', label: 'History', href: '/stories/history' },
  { id: 'settings', label: 'Settings', href: '/stories/settings' },
] as const satisfies readonly SegmentedTab[];

/** Section bar shared by every Stories page (plan §8). */
export function StoriesNav() {
  const path = usePathname() ?? '/stories';
  const active = path.startsWith('/stories/history') ? 'history' : path.startsWith('/stories/settings') ? 'settings' : 'queue';
  return (
    <nav className="sh-nav-row" aria-label="Stories sections">
      <SegmentedNav tabs={TABS} activeId={active} ariaLabel="Stories sections" />
    </nav>
  );
}
