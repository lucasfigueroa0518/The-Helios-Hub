import { redirect } from 'next/navigation';

import { TrafficPerformance } from '@/app/traffic/traffic-performance';
import { getSession } from '@/lib/session';

export default async function TrafficPage() {
  const session = await getSession();
  if (!session) redirect('/');
  return <TrafficPerformance />;
}
