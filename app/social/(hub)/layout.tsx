import { Suspense, type ReactNode } from 'react';

import { HubNavProvider } from '@/components/social-hub/nav/HubNav';
import { HubTabs } from '@/components/social-hub/nav/HubTabs';

import '../../social-hub.css';
import './hub-content.css';
import './hub-analytics.css';
import './hub-post.css';
import './hub-calendar.css';
import './hub-ops.css';

/** Social Hub shell: four places (Content · Calendar · Analytics · Health), pending-aware navigation. Route group, so `/social/render` stays outside it (SH-57). */
export default function SocialHubLayout({ children, drawer }: { children: ReactNode; drawer: ReactNode }) {
  return (
    <div className="sh">
      <Suspense fallback={<div className="sh-hubbar" />}>
        <HubTabs />
      </Suspense>
      <Suspense>
        <HubNavProvider>{children}</HubNavProvider>
      </Suspense>
      {drawer}
    </div>
  );
}
