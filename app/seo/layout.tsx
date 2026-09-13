import type { ReactNode } from 'react';

import './seo-hub.css';

export const metadata = {
  title: 'SEO Hub',
  robots: { index: false, follow: false },
};

export default function SeoLayout({ children }: { children: ReactNode }) {
  return children;
}
