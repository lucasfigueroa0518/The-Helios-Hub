import Link from 'next/link';
import { Hand } from 'lucide-react';

import type { ApprovalDue } from '@/lib/social-hub/health/approvals';
import { verticalInfo } from '@/lib/social-hub/verticals';

const clock = (d: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(d);

/**
 * One line under Today (reliability plan #3, Tommy 2026-10-14: in the hub, not
 * sent anywhere): how many posts wait on an approval and the first deadline.
 * Opens to each post with its deadline and what is lost if it's missed.
 * Nothing waiting: no line.
 */
export function ApprovalDeadlines({ due, base }: { due: readonly ApprovalDue[]; base: string }) {
  if (!due.length) return null;
  const next = due.find((d) => !d.overdue);
  const missed = due.length - due.filter((d) => !d.overdue).length;
  return (
    <details className="sh-note sh-note--needs sh-deadlines">
      <summary>
        <Hand size={14} aria-hidden="true" />
        <span>
          <strong>{due.length} waiting for approval</strong>
          {next ? <> · first deadline {clock(next.deadline)} ({verticalInfo(next.post.vertical).label}: {next.post.name.slice(0, 60)})</> : null}
          {missed ? <> · {missed} missed</> : null}
        </span>
      </summary>
      <ul>
        {due.map((d) => (
          <li key={d.post.id}>
            <span className="sh-nowrap">{d.overdue ? `Missed ${clock(d.deadline)}` : `By ${clock(d.deadline)}`}</span>
            {' · '}
            {verticalInfo(d.post.vertical).label}
            {' · '}
            <Link className="sh-link" href={`${base}/post/${encodeURIComponent(d.post.id)}`}>{d.post.name}</Link>
            {` (otherwise ${d.consequence})`}
          </li>
        ))}
      </ul>
    </details>
  );
}
