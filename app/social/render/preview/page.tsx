'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

import { FIXTURES } from '@/fixtures/social/example-post';
import { SlideTemplate } from '@/lib/social/render/SlideTemplate';

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
 */
export default function PreviewPage() {
  const searchParams = useSearchParams();
  const fixtureId = searchParams.get('fixture') ?? 'example-post';
  const position = Number(searchParams.get('slide') ?? '0');
  const scale = Number(searchParams.get('scale') ?? '0.55');

  const post = FIXTURES[fixtureId];

  // Compute stage height from the un-scaled slide + scale factor.
  const [stageHeight, setStageHeight] = useState<string>('742px');
  useEffect(() => {
    if (!post) return;
    const rawHeight = post.format === 'story' ? 1920 : 1350;
    setStageHeight(`${rawHeight * scale}px`);
  }, [post, scale]);

  if (!post) {
    return (
      <div className="preview-shell">
        <p>Fixture <code>{fixtureId}</code> not found.</p>
      </div>
    );
  }

  return (
    <div className="preview-shell">
      <div className="preview-shell__meta">
        {post.format} · {post.storyType} · slide {position} of {post.slides.length}
      </div>
      <div
        className="preview-shell__stage"
        style={{
          '--slide-scale': String(scale),
          '--slide-height': stageHeight,
        } as React.CSSProperties}
      >
        <SlideTemplate post={post} position={position} />
      </div>
    </div>
  );
}
