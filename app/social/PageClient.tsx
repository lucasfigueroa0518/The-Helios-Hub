'use client';

import { useState } from 'react';
import { ArrowUpRight, Building2, Loader2, Newspaper, RefreshCw, Sparkles, User } from 'lucide-react';

import type { Article } from '@/lib/social/types';

import './social.css';

type Props = { articles: Article[] };

type GenerateResponse = {
  slug?: string;
  preview_url?: string;
  cost_usd?: number;
  stages_run?: string[];
  error?: string;
  detail?: string;
};

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

      <GeneratePanel article={a} />
    </div>
  );
}

/**
 * Generation controls — runs the full editorial + render pipeline for one
 * article. Resume by default (skips cached stages), force=true for
 * regenerate-from-scratch. Redirects to the preview route when done.
 */
const CRITIQUE_SUGGESTIONS = [
  'Tighter cover — fewer words on slide 1',
  'Different photo on the GROUND slide',
  'Kill the debate slide',
  'Less formal, more conversational',
  'Simpler language — assume no domain expertise',
];

function GeneratePanel({ article }: { article: Article }) {
  const [status, setStatus] = useState<'idle' | 'generating' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [critiqueOpen, setCritiqueOpen] = useState(false);
  const [critique, setCritique] = useState('');

  async function trigger(payload: { force?: boolean; critique?: string }) {
    setStatus('generating');
    setError(null);
    try {
      const res = await fetch(`/api/social/generate/${article.id}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = (await res.json()) as GenerateResponse;
      if (!res.ok) {
        setStatus('error');
        setError(data.detail ? `${data.error}: ${data.detail}` : (data.error ?? `HTTP ${res.status}`));
        return;
      }
      setResult(data);
      setStatus('done');
      setCritiqueOpen(false);
      setCritique('');
    } catch (e) {
      setStatus('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function submitCritique() {
    const trimmed = critique.trim();
    if (!trimmed) return;
    trigger({ critique: trimmed });
  }

  return (
    <section className="social-detail-section">
      <h3 className="social-section-label">Generated post</h3>
      {status === 'idle' && (
        <div className="social-generate">
          <p className="social-generate-lead">
            Runs the full editorial + render pipeline. Skips any stages that
            are already cached — first run for this article costs about
            $0.25, follow-up runs are cheaper.
          </p>
          <div className="social-actions">
            <button
              type="button"
              className="social-btn social-btn--primary"
              onClick={() => trigger({})}
            >
              <Sparkles size={14} strokeWidth={2.2} />
              Generate slides
            </button>
          </div>
        </div>
      )}
      {status === 'generating' && (
        <div className="social-generate">
          <p className="social-generate-lead">
            <Loader2 size={14} className="social-spin" strokeWidth={2.2} />
            {' '}Running pipeline (fact-sheet → hook → strategy → plan → copy → humanize → polish → QA → render). Takes ~2–3 minutes.
          </p>
        </div>
      )}
      {status === 'done' && result?.preview_url && (
        <div className="social-generate">
          <p className="social-generate-lead">
            <span className="social-generate-ok">Done.</span>{' '}
            Stages run: {(result.stages_run ?? []).join(' → ')}. Cost: ${result.cost_usd?.toFixed(4)}.
          </p>
          <div className="social-actions">
            <a
              className="social-btn social-btn--primary"
              href={result.preview_url}
              target="_blank"
              rel="noreferrer"
            >
              View slides <ArrowUpRight size={14} strokeWidth={2.2} />
            </a>
            {!critiqueOpen && (
              <button
                type="button"
                className="social-btn social-btn--secondary"
                onClick={() => setCritiqueOpen(true)}
              >
                <RefreshCw size={14} strokeWidth={2.2} />
                Regenerate
              </button>
            )}
          </div>
          {critiqueOpen && (
            <div className="social-critique">
              <label className="social-critique-label" htmlFor="social-critique-input">
                What would you like changed?
              </label>
              <textarea
                id="social-critique-input"
                className="social-critique-input"
                value={critique}
                onChange={(e) => setCritique(e.target.value)}
                placeholder="e.g. Make the cover shorter. The debate slide feels forced. Use less formal language."
                rows={3}
              />
              <div className="social-critique-suggestions">
                {CRITIQUE_SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="social-critique-chip"
                    onClick={() => setCritique((prev) => (prev ? `${prev}\n${s}` : s))}
                  >
                    {s}
                  </button>
                ))}
              </div>
              <div className="social-actions">
                <button
                  type="button"
                  className="social-btn social-btn--primary"
                  onClick={submitCritique}
                  disabled={critique.trim().length === 0}
                >
                  <Sparkles size={14} strokeWidth={2.2} />
                  Adjust based on this
                </button>
                <button
                  type="button"
                  className="social-btn social-btn--secondary"
                  onClick={() => { setCritiqueOpen(false); setCritique(''); }}
                >
                  Cancel
                </button>
              </div>
              <p className="social-critique-hint">
                Reads the existing copy + your feedback and reshapes what you asked for.
                Facts stay verified. ~$0.08 per adjust vs $0.25 for a full regenerate.
              </p>
            </div>
          )}
        </div>
      )}
      {status === 'error' && (
        <div className="social-generate">
          <p className="social-generate-lead social-generate-error">Failed: {error}</p>
          <div className="social-actions">
            <button
              type="button"
              className="social-btn social-btn--primary"
              onClick={() => trigger({})}
            >
              Retry
            </button>
          </div>
        </div>
      )}
    </section>
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
