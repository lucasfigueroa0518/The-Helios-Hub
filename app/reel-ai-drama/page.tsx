import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'AI Drama Reels', robots: { index: false, follow: false } };

/** `/reel-ai-drama?tab=settings` opens the settings drawer (the Explainers page pattern). */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ContentTypePage vertical="reel_ai_drama" openSettings={tab === 'settings'} />;
}
