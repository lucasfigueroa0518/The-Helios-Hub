import { redirect } from 'next/navigation';

import { SfxReviewPage } from '@/app/reels/sfx/sfx-review';
import finalsJson from '@/lib/reels/sfx/finals-review.json';
import { SFX_PICKS } from '@/lib/reels/sfx/picks';
import reviewJson from '@/lib/reels/sfx/review.json';
import type { SfxFinalsReview, SfxReview } from '@/lib/reels/sfx/review';
import { getSession } from '@/lib/session';

import '../reels.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Hook sounds · Trial Reels',
  robots: { index: false, follow: false },
};

export default async function SfxPage() {
  const session = await getSession();
  if (!session) redirect('/');
  return (
    <SfxReviewPage
      review={reviewJson as unknown as SfxReview}
      finals={finalsJson as unknown as SfxFinalsReview}
      picks={SFX_PICKS}
    />
  );
}
