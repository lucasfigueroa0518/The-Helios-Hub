import { redirect } from 'next/navigation';

import { SeoPerformance } from '@/app/seo/seo-performance';
import { getSession } from '@/lib/session';

export default async function SeoPerformancePage() {
  const session = await getSession();
  if (!session) redirect('/');
  return <SeoPerformance />;
}
