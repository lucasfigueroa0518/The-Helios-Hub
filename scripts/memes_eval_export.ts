/**
 * Export the meme lab's graded set to .memes-local/eval/ (UPGRADE_PLAN U0,
 * ME-108). The lab's PGlite directory belongs to the running dev server, so
 * this copies it to a temp folder and reads the copy; the live database is
 * never opened. No model calls.
 *
 *   npx tsx scripts/memes_eval_export.ts [--out .memes-local/eval/graded-YYYY-MM-DD.json]
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { PGlite } from '@electric-sql/pglite';

import { DEFAULT_LOCAL_DIR } from '@/lib/memes/db';
import { EVAL_DIR, type EvalMeme, type EvalRun, type EvalSet, type EvalStory, type Rating } from '@/lib/memes/eval';
import type { SlotFill } from '@/lib/memes/fill';

const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

type Row = Record<string, unknown>;

async function main() {
  const today = new Date().toISOString().slice(0, 10);
  const out = arg('--out') ?? path.join(EVAL_DIR, `graded-${today}.json`);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'memes-eval-'));
  fs.cpSync(DEFAULT_LOCAL_DIR, tmp, { recursive: true });
  fs.rmSync(path.join(tmp, 'postmaster.pid'), { force: true });
  const pg = new PGlite(tmp);
  try {
    const q = async (sql: string) => (await pg.query<Row>(sql)).rows;
    const requests = await q(`SELECT id::text, kind, status, post_id, requested_at::text, cost_usd::float8 AS cost, detail FROM memes.requests ORDER BY requested_at`);
    const slates = await q(`SELECT id::text, request_id::text, stories, shape FROM memes.slates`);
    const memes = await q(`SELECT m.id::text, m.slate_id::text, m.template_id, m.in_slate, m.rank, m.situation_id, m.mapping, m.judges, m.image_path, p.rating, p.tags, p.note
                             FROM memes.memes m LEFT JOIN memes.picks p ON p.meme_id = m.id ORDER BY m.created_at`);
    const stories = await q(`SELECT id, headline, brief_source, length(body) AS body_chars, brief FROM memes.lfd_stories WHERE brief IS NOT NULL`);

    const slateByRequest = new Map(slates.map((s) => [String(s.request_id), s]));
    const requestBySlate = new Map(slates.map((s) => [String(s.id), String(s.request_id)]));
    const reqById = new Map(requests.map((r) => [String(r.id), r]));
    const storyIdsOf = (r: Row, s: Row | undefined): string[] => {
      if (r.post_id) return [String(r.post_id)];
      const fromDetail = (r.detail as { storyIds?: string[] } | null)?.storyIds;
      if (fromDetail?.length) return fromDetail;
      return ((s?.stories as Array<{ postId?: string }> | null) ?? []).map((x) => x.postId ?? '').filter(Boolean);
    };
    const pipelineOf = (s: Row | undefined) => String((s?.shape as { pipeline?: string } | null)?.pipeline ?? 'v2');

    const runs: EvalRun[] = requests.map((r) => {
      const s = slateByRequest.get(String(r.id));
      return {
        id: String(r.id), kind: String(r.kind), status: String(r.status), requestedAt: String(r.requested_at), costUsd: Number(r.cost),
        storyIds: storyIdsOf(r, s), pipeline: pipelineOf(s), shape: (s?.shape as Record<string, unknown> | null) ?? null,
      };
    });

    const evalMemes: EvalMeme[] = memes.map((m) => {
      const runId = requestBySlate.get(String(m.slate_id))!;
      const r = reqById.get(runId)!;
      const s = slateByRequest.get(runId);
      const mapping = m.mapping as { relation?: string; turnId?: string | null; turnType?: string | null; pattern?: string | null; why?: Record<string, string>; fill: { fills: SlotFill[] } };
      const judges = (m.judges as Record<string, unknown>) ?? {};
      return {
        id: String(m.id), runId, kind: String(r.kind), pipeline: pipelineOf(s), storyIds: storyIdsOf(r, s),
        headline: ((s?.stories as Array<{ title?: string }> | null) ?? []).map((x) => x.title).filter(Boolean).join(' · '),
        templateId: String(m.template_id), situationId: (m.situation_id as string | null) ?? null, turnId: mapping.turnId ?? null, turnType: mapping.turnType ?? null, pattern: mapping.pattern ?? null,
        inSlate: Boolean(m.in_slate), rank: (m.rank as number | null) ?? null, relation: mapping.relation ?? '',
        fills: mapping.fill.fills, why: mapping.why ?? {}, judges,
        dropped: (judges.dropped as string | null) ?? null, belowBar: (judges.belowBar as string | null) ?? null,
        imagePath: (m.image_path as string | null) ?? null, rating: (m.rating as Rating | null) ?? null,
        tags: (m.tags as string[] | null) ?? [], note: (m.note as string | null) ?? null,
      };
    });

    const evalStories: EvalStory[] = stories.map((s) => ({
      id: String(s.id), headline: String(s.headline), briefSource: (s.brief_source as string | null) ?? null,
      bodyChars: s.body_chars == null ? null : Number(s.body_chars), brief: s.brief as EvalStory['brief'],
    }));

    const set: EvalSet = { version: 1, exportedAt: new Date().toISOString(), runs, stories: evalStories, memes: evalMemes };
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, JSON.stringify(set));
    const rated = evalMemes.filter((m) => m.rating != null).length;
    console.log(`Wrote ${out}: ${runs.length} runs, ${evalMemes.length} memes (${rated} rated), ${evalStories.length} briefed stories.`);
  } finally {
    await pg.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
