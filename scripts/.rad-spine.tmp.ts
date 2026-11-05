// Temporary (MD-77): run reporting (when no kept fact sheet) and the spine step only, for Lucas's spine review.
// Usage: npx tsx scripts/.rad-spine.tmp.ts <outDir> <pitchId>[:<jobIdWithKeptFacts>] ...  Delete after the test.
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
  const [outDir, ...specs] = process.argv.slice(2);
  fs.mkdirSync(outDir, { recursive: true });
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
      const [pitchId, keptJob] = spec.split(':');
      const tag = pitchId.slice(0, 8);
      const say = (m: string) => console.log(JSON.stringify({ ts: new Date().toISOString(), pitch: tag, m }));
      try {
        const { rows } = await db.query<{ pitch: unknown; title: string }>('SELECT pitch, title FROM reel_ai_drama.pitches WHERE id = $1', [pitchId]);
        const pitch = parse(rows[0].pitch) as never;
        const ctx = { jobId: null as unknown as string, pitchId, mode: 'production' as const, settings };
        let facts: unknown;
        let inventory: unknown = { assets: [], usable_count: 0, counts: {}, kill: null, usd: 0 };
        if (keptJob?.endsWith('.json')) {
          facts = JSON.parse(fs.readFileSync(keptJob, 'utf8'));
          say('kept fact sheet (file)');
        } else if (keptJob) {
          const kept = await db.query<{ kind: string; content: unknown }>(
            "SELECT DISTINCT ON (kind) kind, content FROM reel_ai_drama.artifacts WHERE job_id = $1 AND kind IN ('fact_sheet','inventory') ORDER BY kind, created_at DESC",
            [keptJob],
          );
          for (const r of kept.rows) (r.kind === 'fact_sheet' ? (facts = parse(r.content)) : (inventory = parse(r.content)));
          say('kept fact sheet');
        } else {
          say('reporting…');
          facts = await deps.reporting.reportStory(pitch, ctx);
          say('reporting done');
        }
        fs.writeFileSync(path.join(outDir, `${tag}.facts.json`), JSON.stringify(facts, null, 1));
        say('spine…');
        const out = await deps.writing.writeSpine!({ pitch, facts: facts as never, inventory: inventory as never, settings }, ctx);
        fs.writeFileSync(path.join(outDir, `${tag}.spine.json`), JSON.stringify({ title: rows[0].title, ...out }, null, 1));
        say('spine done');
      } catch (error) {
        say(`FAILED: ${error instanceof Error ? error.stack : String(error)}`);
      }
    }),
  );
  const { rows } = await db.query<{ c: string; usd: string }>(
    "SELECT component AS c, round(sum(usd)::numeric, 3) AS usd FROM reel_ai_drama.cost_events WHERE job_id IS NULL AND created_at > now() - interval '2 hours' GROUP BY 1",
  );
  console.log(JSON.stringify({ cost: rows }));
  process.exit(0);
})();
