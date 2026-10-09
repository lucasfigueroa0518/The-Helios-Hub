import Link from 'next/link';
import { ChevronRight } from 'lucide-react';

import type { Crumb } from '@/lib/social-hub/views/nav';

/** Where you are (REVISIONS G7, G10): replaces the eyebrow kicker. */
export function Breadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  if (crumbs.length < 2) return null;
  return (
    <nav aria-label="Breadcrumb">
      <ol className="sh-crumbs">
        {crumbs.map((c, i) => (
          <li key={`${i}-${c.label}`}>
            {i > 0 ? <ChevronRight size={14} aria-hidden="true" /> : null}
            {c.href ? <Link href={c.href} scroll={false}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}
