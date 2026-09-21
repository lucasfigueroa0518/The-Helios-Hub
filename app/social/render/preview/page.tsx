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
  const position = Number(searchParams.get('slide') ?? '0');
  const showAll = searchParams.get('all') === '1';
  const scale = Number(searchParams.get('scale') ?? (showAll ? '0.45' : '0.55'));
  const humanized = searchParams.get('humanized') === '1';

  const rawPost = FIXTURES[fixtureId];
  const [post, setPost] = useState<Post | null>(rawPost ?? null);
  const [humanizeState, setHumanizeState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [humanizeError, setHumanizeError] = useState<string | null>(null);

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

  if (!post) {
    return (
      <div className="preview-shell">
        <p>Fixture <code>{fixtureId}</code> not found.</p>
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
      {slidesToRender.map((i) => (
        <div
          key={i}
          className="preview-shell__stage"
          style={{
            '--slide-scale': String(scale),
            '--slide-height': `${rawHeight * scale}px`,
          } as React.CSSProperties}
        >
          <SlideTemplate post={post} position={i} />
        </div>
      ))}
    </div>
  );
}
