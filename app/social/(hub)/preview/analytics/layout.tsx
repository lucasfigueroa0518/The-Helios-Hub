import type { ReactNode } from 'react';

import { CompareProvider } from '@/components/social-hub/analytics/CompareTray';
import { AnalyticsSubnav } from '@/components/social-hub/cost/AnalyticsSubnav';

/** Analytics keeps one compare tray across the overview, type pages and compare; Performance | Cost sits above them. */
export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <CompareProvider>
      <AnalyticsSubnav />
      {children}
    </CompareProvider>
  );
}
