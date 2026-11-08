// Temporary (MD-86): writer + story editor on approved spines, for Lucas's script review. Delete after the test.
// Usage: npx tsx scripts/.rad-script.tmp.ts <dir> <pitchId>:<factsJsonOrJobId> ...   (spine read from <dir>/<tag>.spine.json)
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

const parse = (v: unknown) => {
  let x = v;
  while (typeof x === 'string') x = JSON.parse(x);
  return x;
};

void (async () => {
  const [dir, ...specs] = process.argv.slice(2);
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { loadSettings } = await import('@/lib/reel-ai-drama/settings');
  const { artifactStoreFromEnv } = await import('@/lib/explainers/storage');
  const { liveProductionDeps } = await import('@/lib/reel-ai-drama/production/live');
  const db = await explainersDb();
  const settings = await loadSettings(db);
  const deps = await liveProductionDeps({
    db,
    store: artifactStoreFromEnv(),
    secrets: { anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '', heygenApiKey: process.env.HEYGEN_API_KEY ?? '' },
  });
  await Promise.all(
    specs.map(async (spec) => {
      const [pitchId, source] = spec.split(':');
      const tag = pitchId.slice(0, 8);
      const say = (m: string) => console.log(JSON.stringify({ ts: new Date().toISOString(), pitch: tag, m }));
      const save = (name: string, v: unknown) => fs.writeFileSync(path.join(dir, `${tag}.${name}.json`), JSON.stringify(v, null, 1));
      try {
        const { rows } = await db.query<{ pitch: unknown }>('SELECT pitch FROM reel_ai_drama.pitches WHERE id = $1', [pitchId]);
        const pitch = parse(rows[0].pitch) as never;
        const ctx = { jobId: null as unknown as string, pitchId, mode: 'production' as const, settings };
        let facts: never;
        let inventory = { assets: [], usable_count: 0, counts: {}, kill: null, usd: 0 } as never;
        if (source.endsWith('.json')) facts = JSON.parse(fs.readFileSync(source, 'utf8'));
        else {
          const kept = await db.query<{ kind: string; content: unknown }>(
            "SELECT DISTINCT ON (kind) kind, content FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind IN ('fact_sheet','inventory') ORDER BY kind, created_at DESC",
            [source],
          );
          for (const r of kept.rows) (r.kind === 'fact_sheet' ? (facts = parse(r.content) as never) : (inventory = parse(r.content) as never));
        }
        let spine = JSON.parse(fs.readFileSync(path.join(dir, `${tag}.spine.json`), 'utf8')).spine;
        say('writer…');
        let draft = await deps.writing.writeScript({ pitch, facts, inventory, settings, spine }, ctx);
        save('draft0', draft);
        say('editor round 0…');
        const r0 = await deps.writing.editStory({ draft, spine, pitch, facts, inventory, round: 0, settings }, ctx);
        save('edit0', { edit: r0.edit, problems: r0.problems });
        if (r0.edit.repaired) {
          spine = r0.spine;
          draft = r0.draft;
          save('draft1', draft);
          save('spine1', spine);
          say('editor round 1…');
          const r1 = await deps.writing.editStory({ draft, spine, pitch, facts, inventory, round: 1, settings }, ctx);
          save('edit1', { edit: r1.edit, problems: r1.problems });
        }
        say('done');
      } catch (error) {
        say(`FAILED: ${error instanceof Error ? error.stack : String(error)}`);
      }
    }),
  );
  const { rows } = await db.query<{ c: string; usd: string }>(
    "SELECT component AS c, round(sum(usd)::numeric, 3) AS usd FROM reel_ai_drama.cost_events WHERE job_id IS NULL AND created_at > now() - interval '30 minutes' GROUP BY 1",
  );
  console.log(JSON.stringify({ cost: rows }));
  process.exit(0);
})();
