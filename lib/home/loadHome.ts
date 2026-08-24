import { listCampaigns } from '@/lib/campaigns';
import { dbQuery } from '@/lib/db';
import { getAdminProjects } from '@/lib/dashboards/admin-data';
import type { Campaign } from '@/lib/campaigns';
import type { AdminProject } from '@/lib/dashboards/types';
import { formatNyDate } from '@/lib/drafting/send-queue-schedule';
import { displayNameFromEmail } from '@/lib/login-policy';
import {
  computeOutreachStats,
  getCurrentWeekBounds,
  heldSeatsThisWeek,
  reconcileWeekEmails,
  relevantOutreachCampaigns,
  reservationSourcesFromCampaigns,
  type WeekEmailTotals,
} from '@/lib/home/outreach-stats';

export { getCurrentWeekBounds, computeOutreachStats } from '@/lib/home/outreach-stats';

export type HomeBoard = {
  id: string;
  name: string;
  accent: string;
};

export type OutreachHomeStats = {
  totalCampaigns: number;
  liveCampaignsCount: number;
  takingActionCampaignsCount: number;
  activeCampaignNames: string[];
  totalSent: number;
  totalDelivered: number;
  deliveryRate: number | null;
  totalInReviewOrDrafting: number;
  emailsThisWeek: number;
  sentThisWeek: number;
  upcomingThisWeek: number;
};

export type HomePayload = {
  displayName: string;
  boards: HomeBoard[];
  projects: AdminProject[];
  campaigns: Campaign[];
  outreachStats: OutreachHomeStats;
};

async function loadWeekStats(targetCampaigns: Campaign[]): Promise<WeekEmailTotals> {
  if (targetCampaigns.length === 0) {
    return { emailsThisWeek: 0, sentThisWeek: 0, upcomingThisWeek: 0 };
  }
  const campaignIds = targetCampaigns.map((campaign) => campaign.id);
  const { weekStartStr, weekEndStr } = getCurrentWeekBounds();
  const today = formatNyDate();
  try {
    const [queueRes, sendsRes] = await Promise.all([
      dbQuery<{ campaign_id: string; schedule_date: string; queue_sent: string; queue_upcoming: string }>(
        `SELECT
          q.campaign_id::text AS campaign_id,
          coalesce((timezone('America/New_York', es.sent_at))::date, q.schedule_date)::text AS schedule_date,
          count(*) FILTER (WHERE q.status = 'sent')::text AS queue_sent,
          count(*) FILTER (WHERE q.status IN ('queued', 'sending'))::text AS queue_upcoming
        FROM outreach.email_send_queue q
        LEFT JOIN LATERAL (
          SELECT sent_at
            FROM outreach.email_sends es
           WHERE es.drafting_item_id = q.drafting_item_id
             AND es.status = 'sent'
             AND es.sent_at IS NOT NULL
           ORDER BY es.sent_at DESC
           LIMIT 1
        ) es ON true
        WHERE q.campaign_id = ANY($1::uuid[])
          AND (
            (
              q.status IN ('queued', 'sending')
              AND q.schedule_date >= $2::date
              AND q.schedule_date <= $3::date
            )
            OR (
              q.status = 'sent'
              AND coalesce((timezone('America/New_York', es.sent_at))::date, q.schedule_date) >= $2::date
              AND coalesce((timezone('America/New_York', es.sent_at))::date, q.schedule_date) <= $3::date
            )
          )
        GROUP BY 1, 2`,
        [campaignIds, weekStartStr, weekEndStr],
      ),
      dbQuery<{ campaign_id: string; sends_sent: string }>(
        `SELECT
          w.campaign_id::text AS campaign_id,
          count(*) FILTER (
            WHERE s.status = 'sent'
              AND (timezone('America/New_York', s.sent_at))::date >= $2::date
              AND (timezone('America/New_York', s.sent_at))::date <= $3::date
          )::text AS sends_sent
        FROM outreach.email_sends s
        JOIN outreach.drafting_items i ON i.id = s.drafting_item_id
        JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
        WHERE w.campaign_id = ANY($1::uuid[])
        GROUP BY w.campaign_id`,
        [campaignIds, weekStartStr, weekEndStr],
      ),
    ]);

    const sentByCampaign = new Map<string, number>();
    const queuedByCampaign = new Map<string, number>();
    const slottedByDate = new Map<string, Record<string, number>>();
    for (const row of queueRes.rows) {
      const sent = Number(row.queue_sent || 0);
      const queued = Number(row.queue_upcoming || 0);
      sentByCampaign.set(row.campaign_id, (sentByCampaign.get(row.campaign_id) ?? 0) + sent);
      queuedByCampaign.set(row.campaign_id, (queuedByCampaign.get(row.campaign_id) ?? 0) + queued);
      const byDate = slottedByDate.get(row.campaign_id) ?? {};
      byDate[row.schedule_date] = (byDate[row.schedule_date] ?? 0) + sent + queued;
      slottedByDate.set(row.campaign_id, byDate);
    }
    for (const row of sendsRes.rows) {
      const sendsSent = Number(row.sends_sent || 0);
      sentByCampaign.set(row.campaign_id, Math.max(sentByCampaign.get(row.campaign_id) ?? 0, sendsSent));
    }

    let sent = 0;
    let queued = 0;
    for (const campaign of targetCampaigns) {
      sent += sentByCampaign.get(campaign.id) ?? 0;
      queued += queuedByCampaign.get(campaign.id) ?? 0;
    }
    const held = heldSeatsThisWeek({
      today,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      sources: reservationSourcesFromCampaigns(targetCampaigns, slottedByDate),
    });
    return reconcileWeekEmails({ sent, queued, held });
  } catch {
    const held = heldSeatsThisWeek({
      today,
      weekStart: weekStartStr,
      weekEnd: weekEndStr,
      sources: reservationSourcesFromCampaigns(targetCampaigns, new Map()),
    });
    return reconcileWeekEmails({ sent: 0, queued: 0, held });
  }
}

export async function loadHome(userId: string, email: string): Promise<HomePayload> {
  const [boards, projects, campaigns, displayName] = await Promise.all([
    listHomeBoards(userId),
    getAdminProjects().catch(() => [] as AdminProject[]),
    listCampaigns(userId).catch(() => [] as Campaign[]),
    loadDisplayName(userId, email),
  ]);

  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'active');
  const targetCampaigns = relevantOutreachCampaigns(activeCampaigns, userId, email);

  const weekStats = await loadWeekStats(targetCampaigns);
  const outreachStats = computeOutreachStats(activeCampaigns, userId, email, weekStats);

  return {
    displayName,
    boards,
    projects: projects.filter((project) => project.status === 'ACTIVE'),
    campaigns: activeCampaigns,
    outreachStats,
  };
}

async function loadDisplayName(userId: string, email: string): Promise<string> {
  try {
    const { rows } = await dbQuery<{
      display_name: string | null;
      first_name: string | null;
      last_name: string | null;
    }>(
      `SELECT u.display_name, p.first_name, p.last_name
         FROM outreach.users u
         LEFT JOIN boards.user_profiles p ON p.user_id = u.id
        WHERE u.id = $1
        LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    const fromProfile = [row?.first_name, row?.last_name].filter(Boolean).join(' ').trim();
    const fromUser = row?.display_name?.trim() ?? '';
    return fromProfile || fromUser || displayNameFromEmail(email);
  } catch {
    return displayNameFromEmail(email);
  }
}

async function listHomeBoards(userId: string): Promise<HomeBoard[]> {
  try {
    const { rows } = await dbQuery<{
      id: string;
      name: string;
      background: string | null;
    }>(
      `SELECT b.id, b.name, b.background
         FROM boards.boards b
        WHERE COALESCE(b.archived, false) = false
          AND (
            EXISTS (
              SELECT 1 FROM boards.workspace_members wm
               WHERE wm.workspace_id = b.workspace_id AND wm.user_id = $1
            )
            OR EXISTS (
              SELECT 1 FROM boards.board_members bm
               WHERE bm.board_id = b.id AND bm.user_id = $1
            )
          )
        ORDER BY b.name ASC`,
      [userId],
    );
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      accent: row.background ?? '#FF5E1A',
    }));
  } catch {
    return [];
  }
}
