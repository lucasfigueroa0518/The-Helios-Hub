import fs from 'node:fs';
import path from 'node:path';

import { NextResponse } from 'next/server';

import type { Queryable } from '@/lib/explainers/db';
import { developmentSpendSince } from '@/lib/reel-ai-drama/cost';
import { iso, listJobs, pitchRow } from '@/lib/reel-ai-drama/production/jobs';
import { weekStart } from '@/lib/reel-ai-drama/production/schedule';
import { ensureReelAiDramaSchema } from '@/lib/reel-ai-drama/schema';
import { loadSettings } from '@/lib/reel-ai-drama/settings';
import { ERAS, STORY_TYPES, type DeliveryReport, type PitchRow, type PostText } from '@/lib/reel-ai-drama/types';

/** The Reel AI Drama lab (MD-30: the lab ranks; nothing here spends): what the page shows, and its routes' wrapper. */

export class LabError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

type Session = { email: string } | null;

/**
 * Session check, the explainers connection and this route's schema, and error mapping, for every
 * /api/reel-ai-drama route. In development the lab works without a session (as the Real Case lab).
 */
export async function reelAiDramaRoute(
  fn: (ctx: { db: Queryable }) => Promise<unknown>,
  opts: { session?: () => Promise<Session>; db?: () => Promise<Queryable> } = {},
): Promise<NextResponse> {
  let session = opts.session ? await opts.session() : await (await import('@/lib/session')).getSession();
  if (!session && !opts.session && process.env.NODE_ENV === 'development') session = { email: 'local' };
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const db = opts.db ? await opts.db() : await (await import('@/lib/explainers/connection')).explainersDb();
    await ensureReelAiDramaSchema(db);
    return NextResponse.json(await fn({ db }));
  } catch (err) {
    if (err instanceof LabError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

/** The latest calibration report (MD-52), written by the calibrate route and script. */
export const CALIBRATION_FILE = path.join(process.cwd(), '.explainers-local', 'reel-ai-drama', 'calibration', 'latest.json');

export function saveCalibrationReport(report: unknown, file = CALIBRATION_FILE): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), report }, null, 2)}\n`);
}

export function readCalibrationReport(file = CALIBRATION_FILE): { at: string; report: unknown } | null {
  try {
    return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, 'utf8')) as { at: string; report: unknown }) : null;
  } catch {
    return null;
  }
}

export type LabPitch = {
  id: string;
  title: string;
  logline: string;
  pitch: string;
  centralFigure: string;
  storyType: string;
  storyTypeLabel: string;
  era: string;
  eraLabel: string;
  eventDate: string | null;
  whyNow: string | null;
  engine: string;
  origin: PitchRow['origin'];
  status: PitchRow['status'];
  rankScore: number | null;
  drama: { score: number | null; notes: Record<string, string> };
  material: { score: number | null; notes: Record<string, string> };
  visuals: { grade: PitchRow['visuals_grade']; gaps: string[]; specific: number | null; kinds: string[]; faces: { name: string; found: boolean; count: number }[]; sample: { url: string; kind: string; what: string }[] } | null;
  rejectReason: string | null;
  duplicateOf: string | null;
  reviveWhen: string | null;
  sources: { url: string; title: string; publisher: string }[];
  createdAt: string;
};

function labPitch(r: PitchRow): LabPitch {
  const p = r.pitch ?? ({} as PitchRow['pitch']);
  const card = r.visuals_card;
  return {
    id: r.id,
    title: r.title,
    logline: p.logline ?? '',
    pitch: p.pitch ?? '',
    centralFigure: p.central_figure ?? '',
    storyType: p.story_type ?? '',
    storyTypeLabel: (STORY_TYPES as Record<string, string>)[p.story_type] ?? p.story_type ?? '',
    era: p.era ?? '',
    eraLabel: (ERAS as Record<string, string>)[p.era] ?? p.era ?? '',
    eventDate: r.event_date,
    whyNow: p.why_now ?? null,
    engine: p.engine ?? '',
    origin: r.origin,
    status: r.status,
    rankScore: r.rank_score,
    drama: { score: r.drama_score, notes: r.drama?.notes ?? {} },
    material: { score: r.material_score, notes: r.material?.notes ?? {} },
    visuals: card
      ? { grade: card.grade ?? r.visuals_grade, gaps: card.gaps ?? [], specific: card.specific_count ?? null, kinds: card.kinds ?? [], faces: card.faces ?? [], sample: card.sample ?? [] }
      : r.visuals_grade
        ? { grade: r.visuals_grade, gaps: [], specific: null, kinds: [], faces: [], sample: [] }
        : null,
    rejectReason: r.reject_reason,
    duplicateOf: r.duplicate_of,
    reviveWhen: r.revive_when,
    sources: (p.sources ?? []).map((s) => ({ url: s.url, title: s.title, publisher: s.publisher })),
    createdAt: r.created_at,
  };
}

const parse = <T>(text: string | null): T | null => {
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
};

export async function labData(db: Queryable, opts: { now?: Date; calibrationFile?: string } = {}) {
  const now = opts.now ?? new Date();
  const settings = await loadSettings(db);
  const start = weekStart(now);

  const { rows: poolRows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM reel_ai_drama.pitches WHERE status IN ('pooled', 'picked', 'made')
      ORDER BY CASE status WHEN 'pooled' THEN 0 WHEN 'picked' THEN 1 ELSE 2 END, rank_score DESC NULLS LAST, created_at DESC LIMIT 300`,
  );
  const { rows: otherRows } = await db.query<Record<string, unknown>>(
    `SELECT * FROM reel_ai_drama.pitches WHERE status NOT IN ('pooled', 'picked', 'made') ORDER BY updated_at DESC LIMIT 100`,
  );

  const { rows: cellRows } = await db.query<Record<string, unknown>>(
    `SELECT id, player_id, story_type, era, searches, pitches_made, last_searched_at, due_at, reopen_reason
       FROM reel_ai_drama.cells ORDER BY last_searched_at DESC NULLS LAST, player_id, story_type, era LIMIT 300`,
  );
  const { rows: cellCounts } = await db.query<Record<string, unknown>>(
    `SELECT count(*) AS total, count(last_searched_at) AS searched,
            count(*) FILTER (WHERE last_searched_at IS NULL OR due_at <= $1) AS due,
            count(reopen_reason) AS reopened, COALESCE(sum(pitches_made), 0) AS pitches
       FROM reel_ai_drama.cells`,
    [now.toISOString()],
  );

  const { rows: sessionRows } = await db.query<Record<string, unknown>>(
    `SELECT s.*, COALESCE((SELECT sum(usd) FROM reel_ai_drama.cost_events c WHERE c.session_id = s.id), 0) AS usd
       FROM reel_ai_drama.sessions s ORDER BY started_at DESC LIMIT 30`,
  );

  const jobs = await listJobs(db, 40);
  const ids = jobs.map((j) => j.id);
  const { rows: artifactRows } = ids.length
    ? await db.query<Record<string, unknown>>(
        `SELECT id, job_id, kind, content FROM reel_ai_drama.artifacts
          WHERE job_id = ANY($1::uuid[]) AND kind IN ('video', 'contact_sheet', 'delivery_report', 'post_text') ORDER BY created_at`,
        [ids],
      )
    : { rows: [] as Record<string, unknown>[] };
  const latest = new Map<string, { id: string; content: string | null }>();
  for (const a of artifactRows) latest.set(`${a.job_id}:${a.kind}`, { id: String(a.id), content: (a.content as string) ?? null });
  const art = (jobId: string, kind: string) => latest.get(`${jobId}:${kind}`) ?? null;

  const devWeekUsd = await developmentSpendSince(db, start);
  const { rows: prodWeek } = await db.query<{ usd: unknown }>(
    'SELECT COALESCE(sum(usd), 0) AS usd FROM reel_ai_drama.cost_events WHERE job_id IS NOT NULL AND created_at >= $1',
    [start.toISOString()],
  );
  const { rows: byComponent } = await db.query<Record<string, unknown>>(
    `SELECT mode, vendor, component, count(*) AS calls, COALESCE(sum(usd), 0) AS usd, bool_and(usd_known) AS known
       FROM reel_ai_drama.cost_events WHERE created_at >= $1 GROUP BY mode, vendor, component ORDER BY usd DESC LIMIT 60`,
    [start.toISOString()],
  );

  const labJobs = jobs.map((j) => ({
    id: j.id,
    pitchId: j.pitch_id,
    title: j.title,
    status: j.status,
    trigger: j.trigger,
    stage: j.stage,
    spendUsd: j.spend_usd,
    capUsd: j.spend_cap_usd,
    capped: j.capped,
    flags: j.flags,
    killReason: j.kill_reason,
    error: j.error,
    requestedAt: j.requested_at,
    finishedAt: j.finished_at,
    videoId: art(j.id, 'video')?.id ?? null,
    contactSheetId: art(j.id, 'contact_sheet')?.id ?? null,
  }));
  const c = cellCounts[0] ?? {};

  return {
    settings,
    weekStart: start.toISOString(),
    pool: poolRows.map((r) => labPitch(pitchRow(r))),
    others: otherRows.map((r) => labPitch(pitchRow(r))),
    ledger: {
      total: Number(c.total ?? 0),
      searched: Number(c.searched ?? 0),
      due: Number(c.due ?? 0),
      reopened: Number(c.reopened ?? 0),
      pitches: Number(c.pitches ?? 0),
      cells: cellRows.map((r) => ({
        id: String(r.id),
        playerId: String(r.player_id),
        storyType: String(r.story_type),
        era: String(r.era),
        searches: Number(r.searches),
        pitchesMade: Number(r.pitches_made),
        lastSearchedAt: iso(r.last_searched_at),
        dueAt: iso(r.due_at),
        reopenReason: (r.reopen_reason as string) ?? null,
      })),
    },
    sessions: sessionRows.map((r) => ({
      id: String(r.id),
      status: String(r.status),
      trigger: String(r.trigger),
      cellsSearched: Number(r.cells_searched),
      pitchesMade: Number(r.pitches_made),
      pitchesPooled: Number(r.pitches_pooled),
      usd: Number(r.usd),
      error: (r.error as string) ?? null,
      startedAt: iso(r.started_at)!,
      finishedAt: iso(r.finished_at),
    })),
    jobs: labJobs,
    costs: {
      devWeekUsd,
      devCapUsd: settings.weekly_dev_cap_usd,
      productionWeekUsd: Number(prodWeek[0]?.usd ?? 0),
      perReelCapUsd: settings.per_reel_cap_usd,
      perJob: labJobs.map((j) => ({ jobId: j.id, title: j.title, usd: j.spendUsd, capUsd: j.capUsd, capped: j.capped })),
      byComponent: byComponent.map((r) => ({ mode: String(r.mode), vendor: String(r.vendor), component: String(r.component), calls: Number(r.calls), usd: Number(r.usd), known: Boolean(r.known) })),
    },
    deliveries: jobs
      .filter((j) => j.status === 'ok')
      .map((j) => {
        const report = parse<DeliveryReport>(art(j.id, 'delivery_report')?.content ?? null);
        return {
          jobId: j.id,
          title: j.title,
          finishedAt: j.finished_at,
          videoId: art(j.id, 'video')?.id ?? null,
          contactSheetId: art(j.id, 'contact_sheet')?.id ?? null,
          reportId: art(j.id, 'delivery_report')?.id ?? null,
          usd: report?.usd ?? j.spend_usd,
          seconds: report?.seconds ?? null,
          unknownCosts: report?.usd_unknown_parts ?? [],
          flags: j.flags,
          post: report?.post ?? parse<PostText>(art(j.id, 'post_text')?.content ?? null),
        };
      }),
    calibration: readCalibrationReport(opts.calibrationFile),
  };
}

export type LabData = Awaited<ReturnType<typeof labData>>;
