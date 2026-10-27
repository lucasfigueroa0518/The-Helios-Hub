/**
 * Project pages share this group. The GitHub token check lives in each page
 * (`access.tsx`), under loading.tsx, so a prefetch of the shell does not query.
 */
export default function DashboardsMainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
