// Temporary (MD-89 go): queue full renders that reuse the approved spines and scripts (writer + editor not re-run),
// with Lucas's varied joins written in by hand (MD-88). Delete after the test.
// Usage: npx tsx scripts/.rad-seed.tmp.ts <dir> <tag> ...
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}

/** MD-88: the same logic, varied words. Each entry: line id → [old opening, new opening]. */
const JOINS: Record<string, Record<string, [string, string]>> = {
  '8bb006ee': {
    L8: ['But Google has', 'Google, though, has'],
    L10: ['So Musk becomes', 'As a result, Musk becomes'],
    L11: ['But Dario Amodei', 'Yet Dario Amodei'],
  },
  '098829a5': {
    L6: ['Paid online workers', 'So paid online workers'],
  },
};

const read = (f: string) => JSON.parse(fs.readFileSync(f, 'utf8'));

void (async () => {
  const [dir, ...tags] = process.argv.slice(2);
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { loadSettings } = await import('@/lib/reel-ai-drama/settings');
  const { requestJob, addArtifact } = await import('@/lib/reel-ai-drama/production/jobs');
  const db = await explainersDb();
  const settings = await loadSettings(db);
  for (const tag of tags) {
    const draft = read(path.join(dir, `${tag}.draft1.json`));
    let added = 0;
    for (const [id, [from, to]] of Object.entries(JOINS[tag] ?? {})) {
      const line = draft.rungs.flatMap((r: { lines: { id: string; text: string }[] }) => r.lines).find((l: { id: string }) => l.id === id);
      if (!line?.text.startsWith(from)) throw new Error(`${tag} ${id} does not start with "${from}": ${line?.text}`);
      line.text = to + line.text.slice(from.length);
      added += to.split(/\s+/).length - from.split(/\s+/).length;
    }
    draft.word_count += added;
    fs.writeFileSync(path.join(dir, `${tag}.draft2.json`), JSON.stringify(draft, null, 1));
    const { rows } = await db.query<{ id: string }>('SELECT id FROM reel_ai_drama.pitches WHERE id::text LIKE $1', [`${tag}%`]);
    const req = await requestJob(db, { pitchId: rows[0].id, trigger: 'click', settings });
    if (!req.ok) throw new Error(`${tag}: ${req.reason}`);
    const keep = (kind: never, v: unknown) => addArtifact(db, { jobId: req.jobId, kind, content: JSON.stringify(v, null, 2) });
    await keep('fact_sheet' as never, read(path.join(dir, `${tag}.facts.json`)));
    await keep('spine' as never, read(path.join(dir, `${tag}.spine1.json`)));
    await keep('writer_draft' as never, draft);
    await keep('story_edit' as never, read(path.join(dir, `${tag}.edit1.json`)).edit);
    console.log(JSON.stringify({ tag, jobId: req.jobId, joinsAddedWords: added, cap: settings.per_reel_cap_usd }));
  }
  process.exit(0);
})();
