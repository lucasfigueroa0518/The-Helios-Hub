import type { ReactNode } from 'react';

import './traffic-hub.css';

export const metadata = {
  title: 'Traffic',
  robots: { index: false, follow: false },
};

export default function TrafficLayout({ children }: { children: ReactNode }) {
  return children;
}
