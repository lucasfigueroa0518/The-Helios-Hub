import { ContentTypePage } from '@/components/content-type/ContentTypePage';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Last Few Days', robots: { index: false, follow: false } };

export default function Page() {
  return <ContentTypePage vertical="last_few_days" />;
}
