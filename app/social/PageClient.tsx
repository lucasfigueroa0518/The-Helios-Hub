'use client';

import { useState } from 'react';
import { ArrowUpRight, Building2, Newspaper, User } from 'lucide-react';

import type { Article } from '@/lib/social/types';

import './social.css';

type Props = { articles: Article[] };

export function PageClient({ articles }: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(articles[0]?.id ?? null);
  const selected = articles.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="social-shell">
      <header className="social-hero">
        <div>
          <div className="social-eyebrow">HELIOS SOCIAL</div>
          <h1 className="social-title">Today&rsquo;s batch.</h1>
        </div>
        <div className="social-hero-meta">
          <span className="social-hero-count">{articles.length}</span>
          <span className="social-hero-label">
            {articles.length === 1 ? 'article surfaced' : 'articles surfaced'}
          </span>
        </div>
      </header>

      {articles.length === 0 ? (
        <div className="social-empty">
          <Newspaper size={40} strokeWidth={1.5} />
          <p>Nothing has cleared the relevance filter yet.</p>
          <p className="social-empty-sub">
            Run <code>npm run helios-social:ingest</code> to pull the latest cycle.
          </p>
        </div>
      ) : (
        <div className="social-workspace">
          <aside className="social-list" aria-label="Article list">
            {articles.map((a) => (
              <ArticleRow
                key={a.id}
                article={a}
                selected={a.id === selectedId}
                onSelect={() => setSelectedId(a.id)}
              />
            ))}
          </aside>
          <section className="social-detail" aria-live="polite">
            {selected ? <ArticleDetail article={selected} /> : null}
          </section>
        </div>
      )}
    </div>
  );
}

function ArticleRow({
  article: a,
  selected,
  onSelect,
}: {
  article: Article;
  selected: boolean;
  onSelect: () => void;
}) {
  const primaryEntities = [
    ...a.companies.slice(0, 2),
    ...a.people.slice(0, 1),
  ].filter(Boolean);

  return (
    <button
      type="button"
      className={`social-row${selected ? ' is-selected' : ''}`}
      onClick={onSelect}
    >
      <div className="social-row-meta">
        <span className="social-row-source">{a.source}</span>
        {a.relevanceScore !== null && (
          <span className="social-row-score" title={a.relevanceReason ?? undefined}>
            {Math.round(a.relevanceScore * 100)}
          </span>
        )}
      </div>
      <div className="social-row-headline">{a.headline}</div>
      {primaryEntities.length > 0 && (
        <div className="social-row-entities">{primaryEntities.join(' · ')}</div>
      )}
    </button>
  );
}

function ArticleDetail({ article: a }: { article: Article }) {
  const relativeTime = a.publishedAt ? formatRelativeTime(a.publishedAt) : null;

  return (
    <div className="social-detail-inner">
      <div className="social-detail-topmeta">
        <span className="social-detail-source">{a.source}</span>
        {a.byline && <span>· {a.byline}</span>}
        {relativeTime && <span>· {relativeTime}</span>}
        <a
          className="social-detail-link"
          href={a.sourceUrl}
          target="_blank"
          rel="noreferrer noopener"
        >
          Read source <ArrowUpRight size={12} strokeWidth={2.2} />
        </a>
      </div>

      {a.notableNumber && (
        <div className="social-detail-hook">{a.notableNumber}</div>
      )}

      <h2 className="social-detail-headline">{a.headline}</h2>

      {a.relevanceReason && (
        <p className="social-detail-take">{a.relevanceReason}</p>
      )}

      {a.bullets.length > 0 && (
        <section className="social-detail-section">
          <h3 className="social-section-label">Key points</h3>
          <ul className="social-bullets">
            {a.bullets.map((b, i) => (
              <li key={i}>{b}</li>
            ))}
          </ul>
        </section>
      )}

      {(a.companies.length > 0 || a.people.length > 0 || a.products.length > 0) && (
        <section className="social-detail-section">
          <h3 className="social-section-label">Entities</h3>
          <div className="social-chips">
            {a.companies.map((c) => (
              <span key={`c-${c}`} className="social-chip social-chip--company">
                <Building2 size={11} strokeWidth={2.2} />
                {c}
              </span>
            ))}
            {a.people.map((p) => (
              <span key={`p-${p}`} className="social-chip social-chip--person">
                <User size={11} strokeWidth={2.2} />
                {p}
              </span>
            ))}
            {a.products.map((p) => (
              <span key={`prod-${p}`} className="social-chip social-chip--product">
                {p}
              </span>
            ))}
          </div>
        </section>
      )}

      <section className="social-detail-section">
        <h3 className="social-section-label">Generated post</h3>
        <div className="social-stub">
          <p className="social-stub-title">Slides render here</p>
          <p className="social-stub-sub">
            4–7 carousel slides from the packet above. Coming in Phase 3.
          </p>
        </div>
      </section>

      <section className="social-detail-section">
        <h3 className="social-section-label">Caption</h3>
        <div className="social-stub">
          <p className="social-stub-title">Caption text renders here</p>
          <p className="social-stub-sub">Under 2200 chars, first line under 125.</p>
        </div>
      </section>

      <div className="social-actions">
        <button type="button" className="social-btn social-btn--secondary" disabled>
          Regenerate
        </button>
        <button type="button" className="social-btn social-btn--primary" disabled>
          Submit post
        </button>
      </div>
    </div>
  );
}

function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}
