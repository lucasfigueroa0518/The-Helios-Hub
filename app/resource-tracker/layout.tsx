import type { ReactNode } from 'react';

import './resource-tracker.css';

export const metadata = {
  title: 'Resource Tracker',
  robots: { index: false, follow: false },
};

export default function ResourceTrackerLayout({ children }: { children: ReactNode }) {
  return children;
}
