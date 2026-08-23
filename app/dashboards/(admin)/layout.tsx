import { redirect } from 'next/navigation';

import AdminHeader from '@/components/dashboards/admin/AdminHeader';
import { getSession } from '@/lib/session';

export const metadata = {
  title: 'Admin — Helios Dashboards',
  robots: { index: false, follow: false },
};

export default async function DashboardsAdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getSession();
  if (!session) redirect('/');

  return <AdminHeader email={session.email}>{children}</AdminHeader>;
}
