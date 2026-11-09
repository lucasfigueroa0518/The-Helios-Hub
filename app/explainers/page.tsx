import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Explainers', robots: { index: false, follow: false } };

/** `/explainers?tab=settings` (the old settings page redirects here) opens the settings drawer. */
export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <ContentTypePage vertical="explainers" openSettings={tab === 'settings'} />;
}
