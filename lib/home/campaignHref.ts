export function campaignHref(campaign: {
  id: string;
  kind?: string | null;
  drafting_active?: boolean;
}): string {
  if (campaign.kind === 'auto') return `/campaigns/${campaign.id}/prospect`;
  if (campaign.drafting_active) return `/campaigns/${campaign.id}/draft`;
  return `/campaigns/${campaign.id}`;
}
