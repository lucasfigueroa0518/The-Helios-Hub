/** Operator-facing Auto health. Pause is the stop switch; archive hides the campaign. */

export function isLiveAutoCampaign(campaign: {
  kind?: string | null;
  status?: string | null;
  auto_status?: string | null;
}): boolean {
  return campaign.kind === 'auto'
    && campaign.status === 'active'
    && campaign.auto_status === 'live';
}
