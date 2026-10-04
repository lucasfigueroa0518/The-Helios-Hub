'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { FIXTURES } from '@/fixtures/social/example-post';
import { SlideTemplate } from '@/lib/social/render/SlideTemplate';
import type { Post } from '@/lib/social/render/types';

import './preview.css';

/**
 * Slide preview route. Used by developers to eyeball a slide layout, and
 * (in Phase 3a.2) by Playwright to screenshot at pixel-exact canvas size.
 *
 * Query params:
 *   ?fixture=example-post   (defaults to 'example-post')
 *   ?slide=0                (defaults to 0)
 *   ?scale=0.55             (preview only — Playwright ignores this and
 *                             screenshots the un-scaled 1080x canvas)
 *   ?humanized=1            (runs the fixture through humanize.ts before
 *                             rendering — user-triggered API call)
 */
export default function PreviewPage() {
  const searchParams = useSearchParams();
  const fixtureId = searchParams.get('fixture') ?? 'example-post';
  const generatedSlug = searchParams.get('generated');
  const isAllGenerated = generatedSlug === 'all';
  const position = Number(searchParams.get('slide') ?? '0');
  const showAll = searchParams.get('all') === '1' || isAllGenerated;
  const scale = Number(searchParams.get('scale') ?? (showAll ? '0.45' : '0.55'));
  const humanized = searchParams.get('humanized') === '1';

  const rawPost = generatedSlug ? null : FIXTURES[fixtureId];
  const [post, setPost] = useState<Post | null>(rawPost ?? null);
  const [allPosts, setAllPosts] = useState<Array<{ slug: string; post: Post }> | null>(null);
  const [humanizeState, setHumanizeState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [humanizeError, setHumanizeError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Multi-post loader — lists all generated slugs, fetches each Post JSON.
  useEffect(() => {
    if (!isAllGenerated) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const listRes = await fetch('/api/social/generated', { cache: 'no-store' });
        if (!listRes.ok) throw new Error(`list HTTP ${listRes.status}`);
        const { slugs } = (await listRes.json()) as { slugs: string[] };
        const posts = await Promise.all(
          slugs.map(async (slug) => {
            const res = await fetch(`/api/social/generated/${slug}`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`${slug}: HTTP ${res.status}`);
            const data = (await res.json()) as Post;
            return { slug, post: data };
          }),
        );
        if (!cancelled) setAllPosts(posts);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load failed');
      }
    })();
    return () => { cancelled = true; };
  }, [isAllGenerated]);

  // Single-post generated loader — reads from /api/social/generated/[slug].
  useEffect(() => {
    if (!generatedSlug || isAllGenerated) return;
    let cancelled = false;
    setLoadError(null);
    (async () => {
      try {
        const res = await fetch(`/api/social/generated/${generatedSlug}`, { cache: 'no-store' });
        if (!res.ok) {
          const err = await res.json().catch(() => ({ error: `${res.status}` }));
          throw new Error(err?.error ?? `HTTP ${res.status}`);
        }
        const data = (await res.json()) as Post;
        if (!cancelled) setPost(data);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'load failed');
      }
    })();
    return () => { cancelled = true; };
  }, [generatedSlug, isAllGenerated]);

  useEffect(() => {
    if (!humanized || !rawPost) {
      setPost(rawPost ?? null);
      return;
    }
    let cancelled = false;
    setHumanizeState('loading');
    (async () => {
      try {
        const res = await fetch('/api/social/humanize', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ post: rawPost }),
        });
        if (!res.ok) throw new Error(`Humanize endpoint returned ${res.status}`);
        const data = (await res.json()) as { post: Post };
        if (!cancelled) {
          setPost(data.post);
          setHumanizeState('done');
        }
      } catch (err) {
        if (!cancelled) {
          setHumanizeError(err instanceof Error ? err.message : 'humanize failed');
          setHumanizeState('error');
          setPost(rawPost);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [humanized, rawPost]);

  if (loadError) {
    return (
      <div className="preview-shell">
        <p>Preview failed to load: {loadError}</p>
      </div>
    );
  }

  // ── Multi-post render (?generated=all) — every generated post stacked. ──
  if (isAllGenerated) {
    if (!allPosts) {
      return (
        <div className="preview-shell">
          <p>Loading all generated posts…</p>
        </div>
      );
    }
    if (allPosts.length === 0) {
      return (
        <div className="preview-shell">
          <p>No generated posts found. Run <code>npm run helios-social:render-dry-run</code> first.</p>
        </div>
      );
    }
    return (
      <div className="preview-shell">
        <div className="preview-shell__meta">
          {allPosts.length} generated post{allPosts.length === 1 ? '' : 's'} — all slides stacked
        </div>
        {allPosts.map(({ slug, post: p }) => {
          const rawHeight = p.format === 'story' ? 1920 : 1350;
          return (
            <section key={slug} className="preview-shell__section">
              <h2 className="preview-shell__section-title">
                {p.source} · {p.storyType} · {p.slides.length} slides
              </h2>
              <p className="preview-shell__section-slug">{slug}</p>
              {p.slides.map((s, i) => (
                <div
                  key={i}
                  className="preview-shell__stage"
                  data-slide-number={`slide ${String(i).padStart(2, '0')} · ${s.layoutVariant} ${s.variant ?? ''} ${s.beat ? `[${s.beat}]` : ''}`}
                  style={{
                    '--slide-scale': String(scale),
                    '--slide-height': `${rawHeight * scale}px`,
                  } as React.CSSProperties}
                >
                  <SlideTemplate post={p} position={i} />
                </div>
              ))}
            </section>
          );
        })}
      </div>
    );
  }

  if (!post) {
    return (
      <div className="preview-shell">
        <p>{generatedSlug ? `Loading generated post ${generatedSlug}…` : `Fixture ${fixtureId} not found.`}</p>
      </div>
    );
  }

  const rawHeight = post.format === 'story' ? 1920 : 1350;
  const slidesToRender = showAll ? post.slides.map((_, i) => i) : [position];

  return (
    <div className="preview-shell">
      <div className="preview-shell__meta">
        {post.format} · {post.storyType}
        {showAll
          ? ` · all ${post.slides.length} slides`
          : ` · slide ${position} of ${post.slides.length}`}
        {humanized && humanizeState === 'loading' && ' · humanizing…'}
        {humanized && humanizeState === 'done' && ' · humanized'}
        {humanized && humanizeState === 'error' && ` · humanize failed: ${humanizeError}`}
      </div>
      {slidesToRender.map((i) => {
        const s = post.slides[i];
        return (
          <div
            key={i}
            className="preview-shell__stage"
            data-slide-number={`slide ${String(i).padStart(2, '0')} · ${s?.layoutVariant ?? ''} ${s?.variant ?? ''} ${s?.beat ? `[${s.beat}]` : ''}`}
            style={{
              '--slide-scale': String(scale),
              '--slide-height': `${rawHeight * scale}px`,
            } as React.CSSProperties}
          >
            <SlideTemplate post={post} position={i} />
          </div>
        );
      })}
    </div>
  );
}
