'use client';

import { usePathname } from 'next/navigation';

import { SegmentedNav, type SegmentedTab } from '@/components/hub-shell/SegmentedNav';

const TABS = [
  { id: 'topics', label: 'Topics', href: '/explainers' },
  { id: 'reels', label: 'Reels', href: '/explainers/reels' },
  { id: 'settings', label: 'Settings', href: '/explainers/settings' },
] as const satisfies readonly SegmentedTab[];

function activeId(path: string): (typeof TABS)[number]['id'] {
  if (path.startsWith('/explainers/reels')) return 'reels';
  if (path.startsWith('/explainers/settings')) return 'settings';
  return 'topics';
}

/** Section bar shared by every Explainers page. */
export function ExplainersNav() {
  const path = usePathname() ?? '/explainers';
  return (
    <nav className="rh-nav-row" aria-label="Explainers sections">
      <SegmentedNav tabs={TABS} activeId={activeId(path)} ariaLabel="Explainers sections" />
    </nav>
  );
}
