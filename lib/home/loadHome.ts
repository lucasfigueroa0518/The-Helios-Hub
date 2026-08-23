import { listCampaigns } from '@/lib/campaigns';
import { dbQuery } from '@/lib/db';
import { getAdminProjects } from '@/lib/dashboards/admin-data';
import type { Campaign } from '@/lib/campaigns';
import type { AdminProject } from '@/lib/dashboards/types';
import { displayNameFromEmail } from '@/lib/login-policy';

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

export function getCurrentWeekBounds(now: Date = new Date()): {
  weekStartStr: string;
  weekEndStr: string;
  weekStartTs: string;
  weekEndTs: string;
} {
  const d = new Date(now);
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ... 6 = Saturday
  const weekStart = new Date(d);
  weekStart.setDate(d.getDate() - day);
  weekStart.setHours(0, 0, 0, 0);

  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekStart.getDate() + 6);
  weekEnd.setHours(23, 59, 59, 999);

  const yearS = weekStart.getFullYear();
  const monthS = String(weekStart.getMonth() + 1).padStart(2, '0');
  const dayS = String(weekStart.getDate()).padStart(2, '0');
  const weekStartStr = `${yearS}-${monthS}-${dayS}`;

  const yearE = weekEnd.getFullYear();
  const monthE = String(weekEnd.getMonth() + 1).padStart(2, '0');
  const dayE = String(weekEnd.getDate()).padStart(2, '0');
  const weekEndStr = `${yearE}-${monthE}-${dayE}`;

  return {
    weekStartStr,
    weekEndStr,
    weekStartTs: weekStart.toISOString(),
    weekEndTs: weekEnd.toISOString(),
  };
}

async function loadWeekStats(targetCampaigns: Campaign[]): Promise<{
  emailsThisWeek: number;
  sentThisWeek: number;
  upcomingThisWeek: number;
}> {
  if (targetCampaigns.length === 0) {
    return { emailsThisWeek: 0, sentThisWeek: 0, upcomingThisWeek: 0 };
  }
  const campaignIds = targetCampaigns.map((c) => c.id);
  try {
    const { weekStartStr, weekEndStr, weekStartTs, weekEndTs } = getCurrentWeekBounds();
    const [queueRes, sendsRes] = await Promise.all([
      dbQuery<{ campaign_id: string; queue_sent: string; queue_upcoming: string }>(
        `SELECT
          q.campaign_id,
          count(*) FILTER (WHERE q.status = 'sent' AND q.schedule_date >= $2::date AND q.schedule_date <= $3::date)::text AS queue_sent,
          count(*) FILTER (WHERE q.status IN ('queued', 'sending', 'held') AND q.schedule_date >= $2::date AND q.schedule_date <= $3::date)::text AS queue_upcoming
        FROM outreach.email_send_queue q
        WHERE q.campaign_id = ANY($1::uuid[])
        GROUP BY q.campaign_id`,
        [campaignIds, weekStartStr, weekEndStr],
      ),
      dbQuery<{ campaign_id: string; sends_sent: string }>(
        `SELECT
          w.campaign_id,
          count(*) FILTER (WHERE s.status = 'sent' AND s.sent_at >= $2::timestamptz AND s.sent_at <= $3::timestamptz)::text AS sends_sent
        FROM outreach.email_sends s
        JOIN outreach.drafting_items i ON i.id = s.drafting_item_id
        JOIN outreach.drafting_workspaces w ON w.id = i.workspace_id
        WHERE w.campaign_id = ANY($1::uuid[])
        GROUP BY w.campaign_id`,
        [campaignIds, weekStartTs, weekEndTs],
      ),
    ]);

    const qSentMap = new Map(queueRes.rows.map((r) => [r.campaign_id, Number(r.queue_sent || 0)]));
    const qUpcomingMap = new Map(queueRes.rows.map((r) => [r.campaign_id, Number(r.queue_upcoming || 0)]));
    const sSentMap = new Map(sendsRes.rows.map((r) => [r.campaign_id, Number(r.sends_sent || 0)]));

    let totalSentThisWeek = 0;
    let totalUpcomingThisWeek = 0;
    let totalEmailsThisWeek = 0;

    for (const c of targetCampaigns) {
      const qSent = qSentMap.get(c.id) ?? 0;
      const sSent = sSentMap.get(c.id) ?? 0;
      const sent = Math.max(qSent, sSent);
      const upcoming = qUpcomingMap.get(c.id) ?? 0;
      const actualThisWeek = sent + upcoming;

      const autoWeeklyTarget = c.kind === 'auto' ? Math.max(0, (c.emails_per_day ?? 0) * 5) : 0;
      const campaignTotal = Math.max(actualThisWeek, autoWeeklyTarget);

      totalSentThisWeek += sent;
      totalUpcomingThisWeek += upcoming;
      totalEmailsThisWeek += campaignTotal;
    }

    return {
      emailsThisWeek: totalEmailsThisWeek,
      sentThisWeek: totalSentThisWeek,
      upcomingThisWeek: totalUpcomingThisWeek,
    };
  } catch {
    let fallbackEmailsThisWeek = 0;
    for (const c of targetCampaigns) {
      if (c.kind === 'auto') {
        fallbackEmailsThisWeek += Math.max(0, (c.emails_per_day ?? 0) * 5);
      }
    }
    return {
      emailsThisWeek: fallbackEmailsThisWeek,
      sentThisWeek: 0,
      upcomingThisWeek: 0,
    };
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
  const userSlug = email.toLowerCase().startsWith('tommy') ? 'tommy' : 'lucas';
  const relevant = activeCampaigns.filter((c) => {
    const isOwner = c.owner_id === userId;
    const effectiveSlug = c.sender_identity_slug ?? 'lucas';
    const isSender = effectiveSlug === userSlug;
    return isOwner || isSender;
  });
  const targetCampaigns = relevant.length > 0 ? relevant : activeCampaigns;

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

function computeOutreachStats(
  activeCampaigns: Campaign[],
  userId: string,
  email: string,
  weekStats: { emailsThisWeek: number; sentThisWeek: number; upcomingThisWeek: number },
): OutreachHomeStats {
  const userSlug = email.toLowerCase().startsWith('tommy') ? 'tommy' : 'lucas';

  // Relevant campaigns: created by user OR sender identity matches user (or legacy fallback for lucas)
  const targetCampaigns = activeCampaigns.filter((c) => {
    const isOwner = c.owner_id === userId;
    const effectiveSlug = c.sender_identity_slug ?? 'lucas';
    const isSender = effectiveSlug === userSlug;
    return isOwner || isSender;
  });

  // "live campaigns" is specifically Auto campaigns
  const autoCampaigns = targetCampaigns.filter((c) => c.kind === 'auto');

  const takingAction = autoCampaigns.filter(
    (c) => c.drafting_active || (c.auto_status as string) === 'live' || (c.auto_status as string) === 'active'
  );

  const totalSent = targetCampaigns.reduce((sum, c) => sum + (c.sent_count || 0), 0);
  const totalDelivered = targetCampaigns.reduce((sum, c) => sum + (c.delivered_count || 0), 0);

  // Delivery rate: (Total Sent - Total Bounced) / Total Sent
  const deliveryRate = totalSent > 0 ? totalDelivered / totalSent : null;

  const totalInReviewOrDrafting = targetCampaigns.reduce(
    (sum, c) => sum + (c.drafting_generated || 0),
    0
  );

  return {
    totalCampaigns: autoCampaigns.length,
    liveCampaignsCount: autoCampaigns.length,
    takingActionCampaignsCount: takingAction.length,
    activeCampaignNames: takingAction.map((c) => c.name),
    totalSent,
    totalDelivered,
    deliveryRate,
    totalInReviewOrDrafting,
    emailsThisWeek: weekStats.emailsThisWeek,
    sentThisWeek: weekStats.sentThisWeek,
    upcomingThisWeek: weekStats.upcomingThisWeek,
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
