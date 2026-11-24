// Temporary (MD-126 label check): rewrite from a run's saved facts and inventory (no reporting, no harvest):
// writer → blind editor → rewrite → facts check (+ one fix) → final script. No render. Delete after the test.
// Usage: npx tsx scripts/.rad-rewrite.tmp.ts <fromDir> <outDir> <pitchIdPrefix> ...
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

void (async () => {
  const [fromDir, outDir, ...prefixes] = process.argv.slice(2);
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
  const jobs: string[] = [];
  const started = new Date().toISOString();
  await Promise.all(
    prefixes.map(async (prefix) => {
      const say = (m: string) => console.log(JSON.stringify({ ts: new Date().toISOString(), pitch: prefix, m }));
      const save = (name: string, v: unknown) => fs.writeFileSync(path.join(outDir, `${prefix}.${name}.json`), JSON.stringify(v, null, 1));
      try {
        const { rows } = await db.query<{ id: string; pitch: unknown }>('SELECT id, pitch FROM reel_ai_drama.pitches WHERE id::text LIKE $1', [`${prefix}%`]);
        const pitchId = rows[0].id;
        const pitch = (typeof rows[0].pitch === 'string' ? JSON.parse(rows[0].pitch) : rows[0].pitch) as never;
        // The pitch is already picked, so reuse the earlier test job's id (it is already closed as failed).
        const req = { jobId: (JSON.parse(fs.readFileSync(path.join(fromDir, `${prefix}.job.json`), 'utf8')) as { jobId: string }).jobId };
        jobs.push(req.jobId);
        save('job', { jobId: req.jobId, pitchId });
        const ctx = { jobId: req.jobId, pitchId, mode: 'production' as const, settings };
        const read = (n: string) => JSON.parse(fs.readFileSync(path.join(fromDir, `${prefix}.${n}.json`), 'utf8'));
        const facts = read('facts');
        const inventory = read('inventory');
        say('writer…');
        let draft = await deps.writing.writeScript({ pitch, facts, inventory, settings }, ctx);
        save('draft0', draft);
        say('blind editor…');
        const notes = await deps.writing.editStory({ draft, settings }, ctx);
        save('notes', notes);
        if (notes.notes.length) {
          say('rewrite…');
          draft = await deps.writing.reviseScript({ draft, notes: notes.notes.map((n) => ({ source: 'Story editor' as const, lines: n.lines, note: n.note })), facts, inventory }, ctx);
          save('draft1', draft);
        }
        say('facts check…');
        const jev = deps.jev(ctx);
        let check = await deps.checks.checkFacts(jev, { draft, facts });
        save('facts_check0', check.unsupported);
        if (check.unsupported.length) {
          draft = await deps.writing.reviseScript({ draft, notes: check.unsupported.map((u) => ({ source: 'Facts check' as const, lines: [u.line_id], note: u.why })), facts, inventory }, ctx);
          check = await deps.checks.checkFacts(jev, { draft, facts });
          save('facts_check1', check.unsupported);
        }
        save('final', draft);
        say(`done (${check.unsupported.length} line(s) still unsupported)`);
      } catch (error) {
        say(`FAILED: ${error instanceof Error ? error.stack : String(error)}`);
      }
    }),
  );
  // These jobs were script-only: close them so no worker ever picks them up.
  const { rows } = await db.query<{ job: string; c: string; usd: string }>(
    'SELECT job_id::text AS job, component AS c, round(sum(usd)::numeric, 3) AS usd FROM reel_ai_drama.cost_events WHERE job_id = ANY($1::uuid[]) AND created_at >= $2 GROUP BY 1, 2 ORDER BY 1, 3 DESC',
    [jobs, started],
  );
  console.log(JSON.stringify({ cost: rows }));
  process.exit(0);
})();
