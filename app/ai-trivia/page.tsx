import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Are you smarter than AI?', robots: { index: false, follow: false } };

/** "Are you smarter than AI?": a Stories-format type of its own on the shared Stories engine (SS-1). */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ContentTypePage vertical="ai_trivia" openSettings={tab === 'settings'} />;
}
