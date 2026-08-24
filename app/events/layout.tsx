import type { ReactNode } from 'react';

export default function EventsLayout({ children }: { children: ReactNode }) {
  return <div className="hub-shell">{children}</div>;
}
