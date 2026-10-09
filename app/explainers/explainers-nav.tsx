'use client';

import Link from 'next/link';

/** The review page's way back to the Explainers page. */
export function ExplainersNav() {
  return (
    <nav className="rh-nav-row" aria-label="Explainers">
      <Link href="/explainers" className="rh-link">← Explainers</Link>
    </nav>
  );
}
