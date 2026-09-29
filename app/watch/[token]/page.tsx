import { notFound } from 'next/navigation';

import { loadReviewClips, reviewTokenMatches } from '@/lib/reels/review';

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
  const clips = await loadReviewClips(token);
  return <ReviewFeed clips={clips} />;
}
