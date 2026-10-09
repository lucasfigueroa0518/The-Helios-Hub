import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Explainers', robots: { index: false, follow: false } };

export default function Page() {
  return <ContentTypePage vertical="explainers" />;
}
