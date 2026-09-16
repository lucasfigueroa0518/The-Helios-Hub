'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowUpRight, Inbox, Plus, User } from 'lucide-react';

import type { Article } from '@/lib/social/types';

import { addToQueue } from './actions/addToQueue';
import './social.css';

type Props = { initial: Article[] };

export function PageClient({ initial }: Props) {
  const router = useRouter();
  const [form, setForm] = useState({ sourceUrl: '', source: '', headline: '', body: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = () => {
    setError(null);
    const snapshot = { ...form };
    startTransition(async () => {
      try {
        await addToQueue(snapshot);
        setForm({ sourceUrl: '', source: '', headline: '', body: '' });
        // Server action already called revalidatePath('/social'); router.refresh()
        // re-runs the parent server component so the queue includes the new row.
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to add article');
      }
    });
  };

  const items = initial;

  return (
    <div className="social-shell">
      <header className="social-hero">
        <div className="social-eyebrow">HELIOS SOCIAL</div>
        <h1 className="social-title">News to Instagram.</h1>
        <p className="social-subtitle">
          The team queue for articles worth turning into on-brand posts. Add
          what you find; approve, draft, and ship together.
        </p>
      </header>

      <section className="social-add">
        <h2 className="social-section-title">Add to queue</h2>
        <div className="social-form">
          <label>
            <span>Source URL</span>
            <input
              type="url"
              placeholder="https://…"
              value={form.sourceUrl}
              onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
            />
          </label>
          <label>
            <span>Outlet</span>
            <input
              type="text"
              placeholder="The New York Times"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            />
          </label>
          <label>
            <span>Headline</span>
            <input
              type="text"
              placeholder="Meta pauses political ads across the EU"
              value={form.headline}
              onChange={(e) => setForm({ ...form, headline: e.target.value })}
            />
          </label>
          <label>
            <span>Article body</span>
            <textarea
              rows={8}
              placeholder="Paste the article body here."
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
            />
          </label>
          {error && <div className="social-error" role="alert">{error}</div>}
          <button
            type="button"
            className="social-cta"
            onClick={submit}
            disabled={pending}
          >
            <Plus size={16} strokeWidth={2.4} />
            {pending ? 'Adding…' : 'Add to queue'}
          </button>
        </div>
      </section>

      <section className="social-queue">
        <h2 className="social-section-title">
          {items.length === 0 ? 'Queue is empty' : `In queue (${items.length})`}
        </h2>
        {items.length === 0 ? (
          <div className="social-empty">
            <Inbox size={40} strokeWidth={1.5} />
            <p>No articles in the queue yet. Paste one above.</p>
          </div>
        ) : (
          <ul className="social-list">
            {items.map((a, i) => (
              <li
                key={a.id}
                className="social-card"
                style={{ animationDelay: `${i * 100}ms` }}
              >
                <div className="social-card-meta">
                  <span className="social-card-source">{a.source}</span>
                  <a
                    href={a.sourceUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="social-card-link"
                    aria-label="Open source article in new tab"
                  >
                    <ArrowUpRight size={14} strokeWidth={2} />
                  </a>
                </div>
                <h3 className="social-card-headline">{a.headline}</h3>
                <p className="social-card-body">
                  {a.body.slice(0, 200)}
                  {a.body.length > 200 ? '…' : ''}
                </p>
                <div className="social-card-footer">
                  <User size={12} strokeWidth={2} />
                  <span>{a.addedByName ?? 'Unknown'}</span>
                  <span className="social-card-time">{formatRelativeTime(a.addedAt)}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
