'use client';

import { Suspense } from 'react';

import '../preview/preview.css';
import '@/lib/social/render/drafts/chips.css';
import '@/lib/social/render/drafts/cover-bleed.css';
import '@/lib/social/render/drafts/cover-split.css';
import '@/lib/social/render/drafts/cover-logo.css';
import '@/lib/social/render/drafts/cover-icon.css';
import '@/lib/social/render/drafts/text.css';
import '@/lib/social/render/drafts/landing.css';
import '@/lib/social/render/drafts/stat.css';
import '@/lib/social/render/drafts/split-stat.css';
import '@/lib/social/render/drafts/quote.css';
import '@/lib/social/render/drafts/image.css';
import '@/lib/social/render/drafts/follow.css';
import './review.css';

import { ReviewStudio } from './ReviewStudio';

export default function TemplatesReviewPage() {
  return (
    <Suspense fallback={<div className="tpl-studio" />}>
      <ReviewStudio />
    </Suspense>
  );
}
