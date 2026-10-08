import Link from 'next/link';
import type { ReactNode } from 'react';

import { StatusBadge, VerticalTag, colorStyle } from '@/components/social-hub/marks';
import { metricLine, postTime } from '@/lib/social-hub/calendar';
import { formatUsd } from '@/lib/social-hub/cost';
import { postHref } from '@/lib/social-hub/ids';
import { dateTimeLabel } from '@/lib/social-hub/time';
import type { HubPost } from '@/lib/social-hub/types';

/** One post in a Content House list: same identity and link as everywhere (spec §3). */
export function PostRow({ post, base, extra, children }: { post: HubPost; base: string; extra?: ReactNode; children?: ReactNode }) {
  const line = metricLine(post);
  return (
    <li className="sh-row" style={colorStyle(post.vertical)}>
      <div className="sh-row__main">
        <span className="sh-row__meta">
          <VerticalTag vertical={post.vertical} />
          <StatusBadge post={post} />
          <span className="sh-subtle">{postTime(post) ? `${dateTimeLabel(postTime(post))} ET` : post.generatedAt ? `generated ${dateTimeLabel(post.generatedAt)}` : ''}</span>
          {extra}
        </span>
        <Link href={postHref(base, post.id)} className="sh-link sh-row__name">{post.name}</Link>
        {post.description ? <span className="sh-muted sh-row__desc">{post.description}</span> : null}
        <span className="sh-subtle">
          {line ? `${line} · ` : ''}cost {formatUsd(post.costMicros)}{post.costNote ? ` · reusing content ${post.costNote}` : ''}
        </span>
      </div>
      {children ? <div className="sh-row__side">{children}</div> : null}
    </li>
  );
}
