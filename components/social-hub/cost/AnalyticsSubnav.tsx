'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { hubBaseOf } from '@/lib/social-hub/links';

/** Analytics has two views: Performance (the overview, type pages, compare) and Cost. */
export function AnalyticsSubnav() {
  const path = usePathname() ?? '/social/analytics';
  const base = hubBaseOf(path);
  const cost = /\/analytics\/cost\/?$/.test(path);
  return (
    <nav className="sh-subnav" aria-label="Analytics">
      <Link href={`${base}/analytics`} aria-current={cost ? undefined : 'page'} prefetch>Performance</Link>
      {/* No prefetch: Cost is force-dynamic and reads the whole uncached ledger. */}
      <Link href={`${base}/analytics/cost`} aria-current={cost ? 'page' : undefined} prefetch={false}>Cost</Link>
    </nav>
  );
}
