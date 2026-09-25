import { MONTHLY_WATCH_USD } from '@/lib/reels/config';
import { copyInFlight, loadCopyJobsForIdeas, type StoredCopyJob } from '@/lib/reels/copy/jobs';
import { loadSlateCopy, type StoredCopy } from '@/lib/reels/copy/store';
import { loadReelsInsights, type ReelsInsights } from '@/lib/reels/insights';
import { listRuns, monthToDateUsd, type RunRow } from '@/lib/reels/repository';
import { nextRunAt } from '@/lib/reels/schedule';
import {
  listSlateDays,
  loadSlate,
  type SlateDay,
  type StoredSlate,
} from '@/lib/reels/scoring/store';
import { loadFramesForIdeas, visualInFlight, type StoredFrame } from '@/lib/reels/visual/run';
import { loadFinishStatus } from '@/lib/reels/visual/finish';
import { loadVideosForIdeas, videoInFlight, type StoredVideo } from '@/lib/reels/visual/video-run';

export type ReelsOverview = {
  runs: RunRow[];
  latest: RunRow | null;
  /** Costs (including Kling) and recent job errors for the Insights panel. */
  insights: ReelsInsights;
  /** Newest New York day first. The first day is the current pool. */
  slateDays: SlateDay[];
  /** Full score list for the current day. */
  slate: StoredSlate | null;
  /** Earlier days, each reduced to that day's selected top 3. */
  archive: ArchivedSlate[];
  /** On-screen copy and captions for the current slate, by post idea id. */
  copy: Record<string, StoredCopy>;
  /** Latest frame job for each post idea on the current slate. */
  frames: Record<string, StoredFrame>;
  /** Latest video job for each post idea on the current slate. */
  videos: Record<string, StoredVideo>;
  /** Latest copy job for each post idea on the current slate. */
  copyJobs: Record<string, StoredCopyJob>;
  /** Whole-generation walk for each post idea on the current slate. */
  finishes: Record<string, FinishStatus>;
  visualInFlight: boolean;
  copyInFlight: boolean;
  videoInFlight: boolean;
  spend: { monthToDateUsd: number; watchUsd: number };
  nextRunAt: string;
  b6Approved: boolean;
  copyApproved: boolean;
};

export type ArchivedSlate = {
  slate: StoredSlate;
  copy: Record<string, StoredCopy>;
  frames: Record<string, StoredFrame>;
  videos: Record<string, StoredVideo>;
  copyJobs: Record<string, StoredCopyJob>;
  finishes: Record<string, FinishStatus>;
};

export type FinishStatus = {
  status: 'active' | 'done' | 'failed';
  error: string | null;
};

/** Everything the reels hub shows, in one round trip (REV-01/02 / D-062). */
export async function loadReelsOverview(): Promise<ReelsOverview> {
  const [runs, insights, slateDays, spend, framesRunning, copiesRunning, videosRunning] = await Promise.all([
    listRuns(14),
    loadReelsInsights(),
    listSlateDays(),
    monthToDateUsd(),
    visualInFlight(),
    copyInFlight(),
    videoInFlight(),
  ]);
  const [currentDay, ...pastDays] = slateDays;
  const [slate, archive] = await Promise.all([
    currentDay ? loadSlate(currentDay.id) : Promise.resolve(null),
    Promise.all(pastDays.map((day) => loadArchivedSlate(day.id))),
  ]);
  const ideaIds = slate ? slate.scores.map((score) => score.postIdeaId) : [];
  const [copy, frames, copyJobs, videos, finishes] = slate
    ? await Promise.all([
        loadSlateCopy(slate.id),
        loadFramesForIdeas(ideaIds),
        loadCopyJobsForIdeas(ideaIds),
        loadVideosForIdeas(ideaIds),
        loadFinishStatus(ideaIds),
      ])
    : [
        {} as Record<string, StoredCopy>,
        {} as Record<string, StoredFrame>,
        {} as Record<string, StoredCopyJob>,
        {} as Record<string, StoredVideo>,
        {} as Record<string, FinishStatus>,
      ];

  return {
    runs,
    latest: runs[0] ?? null,
    insights,
    slateDays,
    slate,
    archive: archive.filter((day): day is ArchivedSlate => day !== null),
    copy,
    frames,
    videos,
    copyJobs,
    finishes,
    visualInFlight: framesRunning,
    copyInFlight: copiesRunning,
    videoInFlight: videosRunning,
    spend: { monthToDateUsd: spend, watchUsd: MONTHLY_WATCH_USD },
    nextRunAt: nextRunAt(new Date()).toISOString(),
    b6Approved: process.env.REELS_B6_PROMPT_APPROVED === 'true',
    copyApproved: process.env.REELS_COPY_PROMPT_APPROVED === 'true',
  };
}

async function loadArchivedSlate(slateId: string): Promise<ArchivedSlate | null> {
  const slate = await loadSlate(slateId, { selectedOnly: true });
  if (!slate) return null;
  const ideaIds = slate.scores.map((score) => score.postIdeaId);
  const [copy, frames, copyJobs, videos, finishes] = await Promise.all([
    loadSlateCopy(slate.id),
    loadFramesForIdeas(ideaIds),
    loadCopyJobsForIdeas(ideaIds),
    loadVideosForIdeas(ideaIds),
    loadFinishStatus(ideaIds),
  ]);
  return { slate, copy, frames, videos, copyJobs, finishes };
}
