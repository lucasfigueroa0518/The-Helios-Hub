import type { ReactNode } from 'react';

import { HubTabs } from '@/components/social-hub/HubTabs';

import '../../social-hub.css';
import './hub-sections.css';

/** Social Hub shell (spec §3). Route group, so `/social/render` stays outside it (SH-57). */
export default function SocialHubLayout({ children }: { children: ReactNode }) {
  return (
    <div className="sh">
      <HubTabs />
      <div className="sh__inner">{children}</div>
    </div>
  );
}
