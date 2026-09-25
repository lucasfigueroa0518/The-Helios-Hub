import { dbQuery, dbTransaction } from '@/lib/db';
import type { InterpretedScore } from '@/lib/reels/scoring/interpret';
import type { RankedIdea } from '@/lib/reels/scoring/decide';
import type { MemberRole } from '@/lib/reels/types';

export type TimelyIdea = { id: string; lastJoinedMs: number };

export type IdeaMaterial = TimelyIdea & {
  members: Array<{
    role: MemberRole;
    sourceName: string;
    headline: string;
    body: string;
  }>;
};

export type StoredScore = {
  postIdeaId: string;
  origin: 'timely' | 'carryover';
  net: number | null;
  rank: number | null;
  selected: boolean;
  chosenBucket: string | null;
  chosenFramework: string | null;
  psychology: number | null;
  bucketScore: number | null;
  value: number | null;
  blockbuster: number;
  confidence: number | null;
  components: InterpretedScore;
  headlines: string[];
};

export type StoredSlate = {
  id: string;
  runId: string;
  nyDate: string;
  scoredAt: string;
  scores: StoredScore[];
};

/** One New York day, using that day's latest slate. */
export type SlateDay = {
  id: string;
  nyDate: string;
  scoredAt: string;
  scoreCount: number;
  selectedCount: number;
};

type SlateRow = { id: string; run_id: string; ny_date: string; scored_at: string };

export async function listTimelyIdeas(): Promise<TimelyIdea[]> {
  const { rows } = await dbQuery<{ id: string; last_joined: string }>(
    `SELECT id, last_joined FROM reels.post_ideas WHERE timely`,
  );
  return rows.map((row) => ({ id: row.id, lastJoinedMs: new Date(row.last_joined).getTime() }));
}

/** Idea ids on the latest slate for a New York date, if that night was scored. */
export async function slateIdeaIds(nyDate: string): Promise<string[]> {
  const { rows } = await dbQuery<{ post_idea_id: string }>(
    `SELECT s.post_idea_id
       FROM reels.idea_scores s
      WHERE s.slate_id = (
        SELECT id FROM reels.score_slates
         WHERE ny_date = $1::date
         ORDER BY scored_at DESC
         LIMIT 1
      )`,
    [nyDate],
  );
  return rows.map((row) => row.post_idea_id);
}

/** Yesterday's scored ideas, in the shape the carryover rule ranks. */
export async function loadSlateRanked(nyDate: string): Promise<Array<RankedIdea & { selected: boolean }>> {
  const { rows } = await dbQuery<{
    post_idea_id: string;
    net: number | null;
    bucket_score: number | null;
    psychology: number | null;
    confidence: number | null;
    selected: boolean;
    last_joined: string;
  }>(
    `SELECT s.post_idea_id, s.net, s.bucket_score, s.psychology, s.confidence, s.selected,
            i.last_joined
       FROM reels.idea_scores s
       JOIN reels.post_ideas i ON i.id = s.post_idea_id
      WHERE s.slate_id = (
        SELECT id FROM reels.score_slates
         WHERE ny_date = $1::date
         ORDER BY scored_at DESC
         LIMIT 1
      )`,
    [nyDate],
  );
  return rows.map((row) => ({
    id: row.post_idea_id,
    net: row.net,
    bucketScore: row.bucket_score ?? 0,
    psychologyScore: row.psychology ?? 0,
    lastJoinedMs: new Date(row.last_joined).getTime(),
    confidence: row.confidence ?? 0,
    selected: row.selected,
  }));
}

export async function loadIdeaMaterial(ids: readonly string[]): Promise<IdeaMaterial[]> {
  if (ids.length === 0) return [];
  const { rows } = await dbQuery<{
    id: string;
    last_joined: string;
    role: MemberRole;
    source_name: string;
    headline: string;
    body: string;
  }>(
    `SELECT i.id, i.last_joined, m.role, s.source_name, s.headline, s.body
       FROM reels.post_ideas i
       JOIN reels.post_idea_members m ON m.post_idea_id = i.id
       JOIN reels.sources s ON s.id = m.source_id
      WHERE i.id = ANY($1::uuid[])
      ORDER BY i.id,
               CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END,
               m.joined_at`,
    [ids],
  );

  const byId = new Map<string, IdeaMaterial>();
  for (const row of rows) {
    const idea = byId.get(row.id) ?? {
      id: row.id,
      lastJoinedMs: new Date(row.last_joined).getTime(),
      members: [],
    };
    idea.members.push({
      role: row.role,
      sourceName: row.source_name,
      headline: row.headline,
      body: row.body,
    });
    byId.set(row.id, idea);
  }
  return [...byId.values()];
}

export type ScoreInsert = {
  postIdeaId: string;
  origin: 'timely' | 'carryover';
  interpreted: InterpretedScore;
  rank: number | null;
  selected: boolean;
};

export async function insertSlate(input: {
  runId: string;
  nyDate: string;
  pass1Version: string;
  pass2Version: string;
  scores: readonly ScoreInsert[];
}): Promise<string> {
  return dbTransaction(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO reels.score_slates (run_id, ny_date, pass1_version, pass2_version)
       VALUES ($1, $2::date, $3, $4)
       RETURNING id`,
      [input.runId, input.nyDate, input.pass1Version, input.pass2Version],
    );
    const slateId = rows[0].id;

    for (const score of input.scores) {
      const interpreted = score.interpreted;
      await client.query(
        `INSERT INTO reels.idea_scores (
           slate_id, post_idea_id, origin, net, rank, selected,
           chosen_bucket, chosen_framework, psychology, bucket_score, value_score,
           blockbuster, confidence, components
         ) VALUES (
           $1, $2, $3, $4, $5, $6,
           $7, $8, $9, $10, $11,
           $12, $13, $14::jsonb
         )`,
        [
          slateId,
          score.postIdeaId,
          score.origin,
          interpreted.net,
          score.rank,
          score.selected,
          interpreted.chosenBucket,
          interpreted.chosenFramework,
          interpreted.psychologyTerm,
          interpreted.bucketScore,
          interpreted.value,
          interpreted.blockbuster,
          interpreted.bucketConfidence,
          JSON.stringify(interpreted),
        ],
      );
    }

    return slateId;
  });
}

/** Latest slate per New York date, newest day first. */
export async function listSlateDays(): Promise<SlateDay[]> {
  const { rows } = await dbQuery<{
    id: string;
    ny_date: string;
    scored_at: string;
    score_count: number;
    selected_count: number;
  }>(
    `SELECT DISTINCT ON (ny_date)
            id,
            ny_date::text AS ny_date,
            scored_at,
            (SELECT count(*)::int FROM reels.idea_scores s WHERE s.slate_id = sl.id) AS score_count,
            (SELECT count(*)::int FROM reels.idea_scores s WHERE s.slate_id = sl.id AND s.selected) AS selected_count
       FROM reels.score_slates sl
      ORDER BY ny_date DESC, scored_at DESC`,
  );
  return rows.map((row) => ({
    id: row.id,
    nyDate: row.ny_date,
    scoredAt: row.scored_at,
    scoreCount: row.score_count,
    selectedCount: row.selected_count,
  }));
}

export async function loadLatestSlate(): Promise<StoredSlate | null> {
  const { rows } = await dbQuery<{ id: string }>(
    `SELECT id FROM reels.score_slates ORDER BY scored_at DESC LIMIT 1`,
  );
  const id = rows[0]?.id;
  if (!id) return null;
  return loadSlate(id);
}

/** One slate. `selectedOnly` keeps the day's top 3. */
export async function loadSlate(
  slateId: string,
  options?: { selectedOnly?: boolean },
): Promise<StoredSlate | null> {
  const { rows } = await dbQuery<SlateRow>(
    `SELECT id, run_id, ny_date::text AS ny_date, scored_at
       FROM reels.score_slates
      WHERE id = $1`,
    [slateId],
  );
  const slate = rows[0];
  if (!slate) return null;

  const { rows: scores } = await dbQuery<{
    post_idea_id: string;
    origin: 'timely' | 'carryover';
    net: number | null;
    rank: number | null;
    selected: boolean;
    chosen_bucket: string | null;
    chosen_framework: string | null;
    psychology: number | null;
    bucket_score: number | null;
    value_score: number | null;
    blockbuster: number;
    confidence: number | null;
    components: InterpretedScore;
    headlines: string[] | null;
  }>(
    `SELECT s.post_idea_id, s.origin, s.net, s.rank, s.selected,
            s.chosen_bucket, s.chosen_framework, s.psychology, s.bucket_score,
            s.value_score, s.blockbuster, s.confidence, s.components,
            (
              SELECT jsonb_agg(src.headline ORDER BY
                       CASE m.role WHEN 'primary' THEN 0 WHEN 'supporting' THEN 1 ELSE 2 END,
                       m.joined_at)
                FROM reels.post_idea_members m
                JOIN reels.sources src ON src.id = m.source_id
               WHERE m.post_idea_id = s.post_idea_id
            ) AS headlines
       FROM reels.idea_scores s
      WHERE s.slate_id = $1
        AND ($2::boolean = false OR s.selected)
      ORDER BY s.rank NULLS LAST, s.net DESC NULLS LAST`,
    [slate.id, options?.selectedOnly === true],
  );

  return {
    id: slate.id,
    runId: slate.run_id,
    nyDate: slate.ny_date,
    scoredAt: slate.scored_at,
    scores: scores.map((row) => ({
      postIdeaId: row.post_idea_id,
      origin: row.origin,
      net: row.net,
      rank: row.rank,
      selected: row.selected,
      chosenBucket: row.chosen_bucket,
      chosenFramework: row.chosen_framework,
      psychology: row.psychology,
      bucketScore: row.bucket_score,
      value: row.value_score,
      blockbuster: row.blockbuster,
      confidence: row.confidence,
      components: row.components,
      headlines: row.headlines ?? [],
    })),
  };
}
