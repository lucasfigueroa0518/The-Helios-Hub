import { redirect } from 'next/navigation';
import { CampaignHub } from '@/app/hub/campaign-hub';
import { listCampaigns } from '@/lib/campaigns';
import { getSession } from '@/lib/session';

export default async function HubPage() {
  const session = await getSession();
  if (!session) redirect('/');

  // Start the list on the server and stream it with the page instead of waiting for the
  // browser to hydrate and then call /api/campaigns. Not awaited: the shell still paints at
  // once. JSON round trip = the exact shape the API returns. A failure falls back to the GET.
  const initialCampaigns = listCampaigns(session.userId)
    .then((rows) => JSON.parse(JSON.stringify({ campaigns: rows })).campaigns)
    .catch(() => null);

  return <CampaignHub email={session.email} initialCampaigns={initialCampaigns} />;
}
