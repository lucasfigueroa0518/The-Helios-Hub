'use client';

import { usePathname, useSearchParams } from 'next/navigation';

import { WarmLink } from '@/components/hub-shell/warm-link';
import { hubBaseOf } from '@/lib/social-hub/links';
import { activeHubTab, HUB_TABS, safeFrom } from '@/lib/social-hub/views/nav';

/** The four places (REVISIONS G17): real links, so cmd-click opens a tab; the active one follows where a post came from. */
export function HubTabs() {
  const path = usePathname() ?? '/social';
  const search = useSearchParams();
  const base = hubBaseOf(path);
  const active = activeHubTab(base, path, safeFrom(base, search?.get('from')));
  return (
    <div className="sh-hubbar">
      <nav className="sh-hubtabs" aria-label="Social Hub">
        {/* On screen, prefetch stays partial. Hover loads the full route, and the click uses that response. */}
        {HUB_TABS.map((t) => (
          <WarmLink key={t.id} href={`${base}${t.path}`} aria-current={active === t.id ? 'page' : undefined}>
            {t.label}
          </WarmLink>
        ))}
      </nav>
    </div>
  );
}
