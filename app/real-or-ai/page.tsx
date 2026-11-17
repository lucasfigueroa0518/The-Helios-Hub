import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Real or AI?', robots: { index: false, follow: false } };

/** "Real or AI?": a Stories-format type of its own on the shared Stories engine (SS-1). Its swipe lab is /real-or-ai/lab. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ContentTypePage vertical="real_or_ai" openSettings={tab === 'settings'} />;
}
