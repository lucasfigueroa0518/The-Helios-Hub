import { redirect } from 'next/navigation';

import { NetworkingCalendar } from '@/app/events/networking-calendar';
import { getSession } from '@/lib/session';

export const metadata = {
  title: 'Networking',
  robots: { index: false, follow: false },
};

export default async function NetworkingPage() {
  const session = await getSession();
  if (!session) redirect('/');
  return <NetworkingCalendar />;
}
