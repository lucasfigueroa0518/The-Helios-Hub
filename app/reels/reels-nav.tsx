'use client';

import { usePathname } from 'next/navigation';

import { SegmentedNav, type SegmentedTab } from '@/components/hub-shell/SegmentedNav';

const TABS = [
  { id: 'posts', label: 'Posts', href: '/reels' },
  { id: 'analytics', label: 'Analytics', href: '/reels/analytics' },
  { id: 'health', label: 'Health', href: '/reels/health' },
] as const satisfies readonly SegmentedTab[];

function activeId(path: string): (typeof TABS)[number]['id'] {
  if (path.startsWith('/reels/analytics')) return 'analytics';
  if (path.startsWith('/reels/health')) return 'health';
  return 'posts';
}

/**
 * Section bar for the hidden Text on Screen pages (Analytics, Health): the
 * pages stay in the code for later use but are linked from nowhere, so the
 * main page shows no bar.
 */
export function ReelsNav() {
  const path = usePathname() ?? '/reels';
  if (path === '/reels') return null;
  return (
    <nav className="rh-nav-row" aria-label="Text on Screen sections">
      <SegmentedNav tabs={TABS} activeId={activeId(path)} ariaLabel="Text on Screen sections" />
    </nav>
  );
}
