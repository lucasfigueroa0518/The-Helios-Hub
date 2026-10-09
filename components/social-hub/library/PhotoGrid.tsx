import type { LibraryItem } from '@/lib/media-library/read';

const LANE_LABEL: Record<string, string> = {
  headshot: 'Headshot',
  second: 'Second photo',
  hq: 'Headquarters',
  logo: 'Logo',
  ceo: 'CEO',
  openverse: 'Stock',
  stocksnap: 'Stock',
  stock: 'Stock',
  article: 'Article',
  official: 'Official',
  commons: 'Commons',
};

export function laneLabel(lane: string): string {
  return LANE_LABEL[lane] ?? lane.replace(/[-_]/g, ' ');
}

/**
 * The photo bank (DECISIONS_LOG D49) as a grid of what we own: each image
 * comes through the thumbnail route (session-checked, short signed URL; the
 * bucket stays private). Library-only images (company or article photos)
 * are marked; they're never offered back to the finder.
 */
export function PhotoGrid({ items }: { items: LibraryItem[] }) {
  return (
    <ul className="sh-photos">
      {items.map((item) => {
        const subject = item.subjects[0] ?? item.scenes[0] ?? null;
        return (
          <li key={item.id} className="sh-photo">
            <div className="sh-photo__frame">
              {/* eslint-disable-next-line @next/next/no-img-element -- a signed redirect to a private bucket */}
              <img src={item.thumbUrl} alt={subject ?? 'Photo from the bank'} loading="lazy" decoding="async" width={item.width} height={item.height} />
              {!item.reuseOk ? <span className="sh-photo__flag">Library only</span> : null}
            </div>
            <div className="sh-photo__meta">
              {subject ? <span className="sh-photo__subject">{subject}</span> : null}
              <span className="sh-photo__credit" title={item.credit}>{item.credit}</span>
              <span className="sh-photo__line">
                {[...new Set(item.lanes.map(laneLabel))].slice(0, 2).join(' · ') || 'Photo'}
                {' · '}
                {item.useCount ? `used ${item.useCount}×` : 'not used yet'}
              </span>
              {item.tags.length ? (
                <span className="sh-chips">{item.tags.slice(0, 4).map((t) => <span key={t} className="sh-chip">{t}</span>)}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
