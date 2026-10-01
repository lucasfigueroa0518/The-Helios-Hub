'use client';

import { usePathname } from 'next/navigation';

import { SegmentedNav, type SegmentedTab } from '@/components/hub-shell/SegmentedNav';

const TABS = [
  { id: 'posts', label: 'Posts', href: '/reels' },
  { id: 'analytics', label: 'Analytics', href: '/reels/analytics' },
  { id: 'audio', label: 'Audio', href: '/reels/audio' },
  { id: 'health', label: 'Health', href: '/reels/health' },
] as const satisfies readonly SegmentedTab[];

function activeId(path: string): (typeof TABS)[number]['id'] {
  if (path.startsWith('/reels/analytics')) return 'analytics';
  if (path.startsWith('/reels/audio') || path.startsWith('/reels/songs') || path.startsWith('/reels/sfx')) return 'audio';
  if (path.startsWith('/reels/health')) return 'health';
  return 'posts';
}

/** Section bar shared by every Trial Reels page. Sits at the top of the main column. */
export function ReelsNav() {
  const path = usePathname() ?? '/reels';
  return (
    <nav className="rh-nav-row" aria-label="Trial Reels sections">
      <SegmentedNav tabs={TABS} activeId={activeId(path)} ariaLabel="Trial Reels sections" />
    </nav>
  );
}
