import { notFound } from 'next/navigation';

import { REVIEW_PAUSED_COPY, loadReviewClips, reviewFeedOpen, reviewTokenMatches } from '@/lib/reels/review';

import '../review.css';
import { ReviewFeed } from './review-feed';

export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const fetchCache = 'force-no-store';
export const runtime = 'nodejs';

export const metadata = {
  title: 'Reels',
  robots: { index: false, follow: false },
};

export default async function WatchPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!(await reviewTokenMatches(decodeURIComponent(token)))) notFound();
  if (!(await reviewFeedOpen())) {
    return (
      <main className="ig-missing">
        <p>{REVIEW_PAUSED_COPY}</p>
      </main>
    );
  }
  const clips = await loadReviewClips(token);
  return <ReviewFeed clips={clips} />;
}
