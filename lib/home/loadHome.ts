import { listCampaigns } from '@/lib/campaigns';
import { dbQuery, isDbConnectTimeout } from '@/lib/db';
import { logInfo } from '@/lib/observability/log-event';
import { getAdminProjects } from '@/lib/dashboards/admin-data';
import type { Campaign } from '@/lib/campaigns';
import type { AdminProject } from '@/lib/dashboards/types';
import { displayNameFromEmail } from '@/lib/login-policy';
import {
  computeOutreachStats,
  getCurrentWeekBounds,
  reconcileWeekEmailsFromQueueDays,
  type WeekEmailTotals,
} from '@/lib/home/outreach-stats';
import { listSendQueue } from '@/lib/drafting/send-queue';

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
  /** A section whose read timed out. An empty list here is a failed load, not "nothing yet". */
  unavailable?: {
    boards?: boolean;
    projects?: boolean;
    campaigns?: boolean;
  };
};

async function loadWeekStats(email: string): Promise<WeekEmailTotals> {
  const { weekStartStr, weekEndStr } = getCurrentWeekBounds();
  try {
    const identitySlug = email.toLowerCase().startsWith('tommy') ? 'tommy' : undefined;
    const { days } = await listSendQueue({
      from: weekStartStr,
      to: weekEndStr,
      identitySlug,
    });
    return reconcileWeekEmailsFromQueueDays(days.map((day) => ({
      used: day.used,
      sentCount: day.sent_count,
      queuedCount: day.queued_count,
      reserved: day.reserved,
      capacity: day.capacity,
    })));
  } catch {
    return { emailsThisWeek: 0, sentThisWeek: 0, upcomingThisWeek: 0 };
  }
}

export async function loadHome(userId: string, email: string): Promise<HomePayload> {
  const started = performance.now();
  const unavailable: NonNullable<HomePayload['unavailable']> = {};
  const [boards, projects, campaigns, displayName, weekStats] = await Promise.all([
    listHomeBoards(userId, unavailable),
    getAdminProjects().catch((error: unknown) => {
      if (isDbConnectTimeout(error)) unavailable.projects = true;
      return [] as AdminProject[];
    }),
    listCampaigns(userId).catch((error: unknown) => {
      if (isDbConnectTimeout(error)) unavailable.campaigns = true;
      return [] as Campaign[];
    }),
    loadDisplayName(userId, email),
    loadWeekStats(email),
  ]);

  const activeCampaigns = campaigns.filter((campaign) => campaign.status === 'active');
  const outreachStats = computeOutreachStats(campaigns, userId, email, weekStats);

  const payload = {
    displayName,
    boards,
    projects: projects.filter((project) => project.status === 'ACTIVE'),
    campaigns: activeCampaigns,
    outreachStats,
    unavailable,
  };
  logInfo({
    component: 'home',
    event: 'load_complete',
    durationMs: Math.round(performance.now() - started),
    boards: payload.boards.length,
    projects: payload.projects.length,
    liveCampaigns: payload.outreachStats.liveCampaignsCount,
    unavailable: payload.unavailable,
  });
  return payload;
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

async function listHomeBoards(
  userId: string,
  unavailable: NonNullable<HomePayload['unavailable']>,
): Promise<HomeBoard[]> {
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
  } catch (error) {
    if (isDbConnectTimeout(error)) unavailable.boards = true;
    return [];
  }
}
