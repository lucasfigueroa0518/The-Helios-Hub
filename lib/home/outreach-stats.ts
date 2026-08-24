import { computeAutoReservations, type LiveAutoReservationSource } from '@/lib/auto-campaigns/reservations';
import { isLiveAutoCampaign } from '@/lib/auto-campaigns/status';
import { addCalendarDays, formatNyDate, nyWallTimeToUtc } from '@/lib/drafting/send-queue-schedule';
import { nyWeekdayIndex } from '@/lib/auto-campaigns/schedule';

export { isLiveAutoCampaign } from '@/lib/auto-campaigns/status';

export type OutreachCampaignSlice = {
  id: string;
  name: string;
  status: 'active' | 'archived';
  kind: string;
  auto_status: string | null;
  owner_id: string;
  sender_identity_slug?: string | null;
  emails_per_day?: number | null;
  sent_count?: number;
  delivered_count?: number;
  drafting_active?: boolean;
  drafting_generated?: number;
};

export type WeekEmailTotals = {
  emailsThisWeek: number;
  sentThisWeek: number;
  upcomingThisWeek: number;
};

/** America/New_York Monday–Sunday of the week containing `now`. */
export function getCurrentWeekBounds(now: Date = new Date()): {
  weekStartStr: string;
  weekEndStr: string;
} {
  const today = formatNyDate(now);
  const dow = nyWeekdayIndex(nyWallTimeToUtc(today, 12, 0));
  const mondayOffset = dow === 0 ? -6 : 1 - dow;
  const weekStartStr = addCalendarDays(today, mondayOffset);
  return {
    weekStartStr,
    weekEndStr: addCalendarDays(weekStartStr, 6),
  };
}

export function relevantOutreachCampaigns(
  campaigns: OutreachCampaignSlice[],
  userId: string,
  email: string,
): OutreachCampaignSlice[] {
  const userSlug = email.toLowerCase().startsWith('tommy') ? 'tommy' : 'lucas';
  const relevant = campaigns.filter((campaign) => {
    const isOwner = campaign.owner_id === userId;
    const effectiveSlug = campaign.sender_identity_slug ?? 'lucas';
    return isOwner || effectiveSlug === userSlug;
  });
  return relevant.length > 0 ? relevant : campaigns;
}

export function reconcileWeekEmails(input: {
  sent: number;
  queued: number;
  held: number;
}): WeekEmailTotals {
  const sentThisWeek = Math.max(0, input.sent);
  const upcomingThisWeek = Math.max(0, input.queued) + Math.max(0, input.held);
  return {
    sentThisWeek,
    upcomingThisWeek,
    emailsThisWeek: sentThisWeek + upcomingThisWeek,
  };
}

export function reservationSourcesFromCampaigns(
  campaigns: OutreachCampaignSlice[],
  queuedOrSentByDate: Map<string, Record<string, number>>,
): LiveAutoReservationSource[] {
  return campaigns.filter(isLiveAutoCampaign).map((campaign) => ({
    campaignId: campaign.id,
    campaignName: campaign.name,
    emailsPerDay: campaign.emails_per_day ?? 0,
    queueColor: null,
    leadAttributes: {
      industry: '',
      seniority: '',
      geography: '',
      business_size: '',
    },
    expansionStep: 0,
    queuedOrSentByDate: queuedOrSentByDate.get(campaign.id) ?? {},
  }));
}

export function heldSeatsThisWeek(input: {
  today: string;
  weekStart: string;
  weekEnd: string;
  sources: LiveAutoReservationSource[];
}): number {
  return computeAutoReservations({
    today: input.today,
    from: input.weekStart,
    to: input.weekEnd,
    campaigns: input.sources,
  }).reduce((sum, lock) => sum + lock.reserved, 0);
}

export function computeOutreachStats(
  activeCampaigns: OutreachCampaignSlice[],
  userId: string,
  email: string,
  weekStats: WeekEmailTotals,
) {
  const targetCampaigns = relevantOutreachCampaigns(activeCampaigns, userId, email);
  const liveCampaigns = targetCampaigns.filter(isLiveAutoCampaign);
  const autoCampaigns = targetCampaigns.filter((campaign) => campaign.kind === 'auto');

  const totalSent = targetCampaigns.reduce((sum, campaign) => sum + (campaign.sent_count || 0), 0);
  const totalDelivered = targetCampaigns.reduce((sum, campaign) => sum + (campaign.delivered_count || 0), 0);

  return {
    totalCampaigns: autoCampaigns.length,
    liveCampaignsCount: liveCampaigns.length,
    takingActionCampaignsCount: liveCampaigns.length,
    activeCampaignNames: liveCampaigns.map((campaign) => campaign.name),
    totalSent,
    totalDelivered,
    deliveryRate: totalSent > 0 ? totalDelivered / totalSent : null,
    totalInReviewOrDrafting: targetCampaigns.reduce(
      (sum, campaign) => sum + (campaign.drafting_generated || 0),
      0,
    ),
    emailsThisWeek: weekStats.emailsThisWeek,
    sentThisWeek: weekStats.sentThisWeek,
    upcomingThisWeek: weekStats.upcomingThisWeek,
  };
}
