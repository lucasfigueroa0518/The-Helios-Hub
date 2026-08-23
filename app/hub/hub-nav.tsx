'use client';

import { usePathname, useRouter } from 'next/navigation';

import { HUB_TAB_PREFETCH, prefetchHubJson } from '@/app/hub/hub-data';
import { SegmentedNav, type SegmentedTab } from '@/components/hub-shell/SegmentedNav';

const TABS = [
  { id: 'campaigns', label: 'Campaigns', href: '/hub' },
  { id: 'queue', label: 'Queue', href: '/hub/queue' },
  { id: 'analytics', label: 'Analytics', href: '/hub/analytics' },
  { id: 'conversations', label: 'Conversations', href: '/hub/conversations' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function tabIdFromPath(pathname: string): TabId {
  if (pathname.startsWith('/hub/queue')) return 'queue';
  if (pathname.startsWith('/hub/analytics')) return 'analytics';
  if (pathname.startsWith('/hub/conversations')) return 'conversations';
  return 'campaigns';
}

export function HubNav() {
  const pathname = usePathname() || '/hub';
  const router = useRouter();

  function prefetchTab(tab: SegmentedTab) {
    const match = TABS.find((item) => item.id === tab.id);
    if (!match) return;
    router.prefetch(match.href);
    for (const url of HUB_TAB_PREFETCH[match.id] ?? []) {
      prefetchHubJson(url);
    }
  }

  return (
    <nav className="hub-nav-row" aria-label="Outreach Hub sections">
      <SegmentedNav
        tabs={TABS}
        activeId={tabIdFromPath(pathname)}
        ariaLabel="Outreach Hub sections"
        onPrefetch={prefetchTab}
      />
    </nav>
  );
}
