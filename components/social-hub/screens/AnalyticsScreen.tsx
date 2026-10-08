import Link from 'next/link';
import type { ReactNode } from 'react';

import { Controls } from '@/components/social-hub/analytics/Controls';
import { CompareTab } from '@/components/social-hub/analytics/CompareTab';
import { ContentTab } from '@/components/social-hub/analytics/ContentTab';
import { ProfileTab } from '@/components/social-hub/analytics/ProfileTab';
import { AccountSection } from '@/components/social-hub/analytics/AccountSection';
import { DataNotes } from '@/components/social-hub/DataNotes';
import { PageHead } from '@/components/social-hub/PageHead';
import { summarizeAccount } from '@/lib/social-hub/account';
import { hrefWith, parseAnalyticsQuery, postsInView } from '@/lib/social-hub/analytics';
import type { HubDataset } from '@/lib/social-hub/dataset';
import type { HubParams } from '@/lib/social-hub/links';
import { rangeLabel } from '@/lib/social-hub/time';
import { verticalInfo } from '@/lib/social-hub/verticals';

const TABS = [
  { id: 'profile', label: 'Profile' },
  { id: 'content', label: 'Content' },
  { id: 'compare', label: 'Compare' },
] as const;

/** Analytics (spec §5): Profile · Content · Compare, with the global controls. */
export function AnalyticsScreen({ dataset, base, params, compare, now }: {
  dataset: HubDataset;
  base: string;
  params: HubParams;
  compare: string[];
  now: Date;
}) {
  const q = parseAnalyticsQuery(params, compare, now);
  const action = `${base}/analytics`;
  const inView = postsInView(dataset.posts, q);
  const summary = q.tab === 'profile' ? summarizeAccount(dataset.account, q.range) : null;
  const account: ReactNode = summary ? <AccountSection summary={summary} /> : undefined;
  const accountState = dataset.account.present ? 'empty' : dataset.account.error ? 'error' : 'absent';
  return (
    <>
      <PageHead
        kicker="Social Hub · Analytics"
        title={q.vertical ? verticalInfo(q.vertical).label : 'Every pipeline'}
        sub={`${rangeLabel(q.range)} · ${inView.length} published posts · descriptive numbers, latest totals`}
        actions={
          <nav className="sh-seg" aria-label="Analytics tabs">
            {TABS.map((t) => (
              <Link key={t.id} href={hrefWith(action, q, { tab: t.id === 'content' ? null : t.id })} aria-current={q.tab === t.id ? 'page' : undefined}>{t.label}</Link>
            ))}
          </nav>
        }
      />
      <Controls q={q} posts={dataset.posts} action={action} />
      <DataNotes dataset={dataset} cost />
      {q.tab === 'profile' ? <ProfileTab q={q} posts={inView} base={base} account={account} accountState={accountState} /> : null}
      {q.tab === 'content' ? <ContentTab q={q} posts={inView} base={base} action={action} /> : null}
      {q.tab === 'compare' ? <CompareTab q={q} all={dataset.posts} inView={inView} base={base} action={action} /> : null}
    </>
  );
}
