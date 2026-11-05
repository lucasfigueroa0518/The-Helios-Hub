'use client';

import Link from 'next/link';
import { useState } from 'react';

import { money, perUnit } from '@/components/social-hub/cost/format';
import type { WorthModel } from '@/lib/social-hub/cost-page/model';
import type { HubMetrics, MetricKey, Vertical } from '@/lib/social-hub/types';
import { verticalInfo } from '@/lib/social-hub/verticals';

export type WorthPost = { id: string; vertical: Vertical; name: string; costMicros: number; metrics: HubMetrics };

const RANKED = 8;

/** Cost per interaction by type (left); the selected type's kinds (right), and its posts ranked by cost per kind. */
export function WorthDrill({ byType, posts, base }: { byType: WorthModel['byType']; posts: WorthPost[]; base: string }) {
  const [vertical, setVertical] = useState<Vertical | null>(byType[0]?.vertical ?? null);
  const type = byType.find((t) => t.vertical === vertical) ?? null;
  const [kind, setKind] = useState<MetricKey | null>(null);
  const [open, setOpen] = useState(false);
  const activeKind = type?.kinds.find((k) => k.key === kind) ?? type?.kinds[type.kinds.length - 1] ?? null;
  const ranked = activeKind && type
    ? posts
      .filter((p) => p.vertical === type.vertical)
      .map((p) => {
        const n = p.metrics[activeKind.key] ?? 0;
        return { post: p, per: n > 0 ? Math.round(p.costMicros / n) : null };
      })
      .sort((a, b) => (a.per ?? Infinity) - (b.per ?? Infinity))
      .slice(0, RANKED)
    : [];

  return (
    <div className="sh-cost-worth">
      <div className="sh-cost-panel sh-cost-list">
        <p className="sh-ops-eyebrow">Cost per interaction</p>
        {byType.map((t) => (
          <button
            key={t.vertical}
            type="button"
            className="sh-cost-list__r"
            aria-pressed={t.vertical === vertical}
            onClick={() => { setVertical(t.vertical); setKind(null); setOpen(false); }}
          >
            <span className="sh-cost-list__name">
              <i className="sh-ops-mark" style={{ background: `var(${verticalInfo(t.vertical).colorVar})` }} aria-hidden />
              {t.label} <span className="sh-ops-meta">· {t.interactions.toLocaleString('en-US')} {t.vertical === 'stories' ? 'replies, shares, follows, profile visits' : 'interactions'}</span>
            </span>
            <span className="sh-ops-num">{perUnit(t.cpiMicros)}</span>
          </button>
        ))}
      </div>
      <div className="sh-cost-panel sh-cost-list">
        <p className="sh-ops-eyebrow">{type ? `${type.label} · by kind` : 'By kind'}</p>
        {!type || type.kinds.length === 0 ? (
          <p className="sh-ops-none">No published posts with interactions in this range.</p>
        ) : (
          <>
            {type.kinds.map((k) => (
              <button key={k.key} type="button" className="sh-cost-list__r" aria-pressed={activeKind?.key === k.key} onClick={() => setKind(k.key)}>
                <span>{k.label}</span>
                <span className="sh-ops-num">{perUnit(k.cpiMicros)}</span>
              </button>
            ))}
            {activeKind && (
              <p className="sh-cost-list__more">
                <button type="button" className="sh-ops-link" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                  See posts ranked by cost per {activeKind.label.toLowerCase()}
                </button>
              </p>
            )}
            {open && (
              <ol className="sh-cost-ranked">
                {ranked.map(({ post, per }) => (
                  <li key={post.id}>
                    <Link href={`${base}/post/${encodeURIComponent(post.id)}`} prefetch={false} className="sh-cost-ranked__name">{post.name}</Link>
                    <span className="sh-ops-meta sh-ops-num">{money(post.costMicros, 1)}</span>
                    <span className="sh-ops-num">{perUnit(per)}</span>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </div>
    </div>
  );
}
