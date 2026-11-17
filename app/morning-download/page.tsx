import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Morning Download', robots: { index: false, follow: false } };

/** Morning Download: the Stories-format type that kept the hub id `stories` (SS-1). /stories redirects here. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ContentTypePage vertical="stories" openSettings={tab === 'settings'} />;
}
