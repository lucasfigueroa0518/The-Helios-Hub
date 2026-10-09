'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { hubBaseOf } from '@/lib/social-hub/links';
import { activeHubTab, HUB_TABS, safeFrom } from '@/lib/social-hub/views/nav';

/** The three places (REVISIONS G17): real links, so cmd-click opens a tab; the active one follows where a post came from. */
export function HubTabs() {
  const path = usePathname() ?? '/social';
  const search = useSearchParams();
  const base = hubBaseOf(path);
  const active = activeHubTab(base, path, safeFrom(base, search?.get('from')));
  return (
    <div className="sh-hubbar">
      <nav className="sh-hubtabs" aria-label="Social Hub">
        {HUB_TABS.map((t) => (
          <Link key={t.id} href={`${base}${t.path}`} aria-current={active === t.id ? 'page' : undefined} prefetch>
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
