import type { ReactNode } from 'react';

import { CompareProvider } from '@/components/social-hub/analytics/CompareTray';

/** Analytics keeps one compare tray across the overview, type pages and compare. */
export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return <CompareProvider>{children}</CompareProvider>;
}
