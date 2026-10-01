import type { ReactNode } from 'react';

import { AnalyticsTitle } from '@/app/reels/analytics/analytics-title';

export function AnalyticsShell({
  current,
  children,
}: {
  current: 'cost' | 'performance';
  children: ReactNode;
}) {
  return (
    <div className="rh">
      <div className="rh__inner">
        <header className="rh__head">
          <div>
            <p className="rh__kicker">Trial Reels</p>
            <AnalyticsTitle current={current} />
          </div>
        </header>
        {children}
      </div>
    </div>
  );
}
