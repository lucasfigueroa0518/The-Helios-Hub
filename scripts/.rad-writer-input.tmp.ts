// Temporary: rebuild the writer's exact system prompt and user message from a run's saved files (no API call).
// Usage: npx tsx scripts/.rad-writer-input.tmp.ts <runDir> <prefix> <outFile>
import fs from 'node:fs';
import path from 'node:path';
for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
void (async () => {
  const [dir, prefix, out] = process.argv.slice(2);
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { loadSettings } = await import('@/lib/reel-ai-drama/settings');
  const { writerUserMessage } = await import('@/lib/reel-ai-drama/writing/writer');
  const { writerSystem } = await import('@/lib/reel-ai-drama/prompts');
  const db = await explainersDb();
  const settings = await loadSettings(db);
  const { rows } = await db.query<{ pitch: unknown }>('SELECT pitch FROM reel_ai_drama.pitches WHERE id::text LIKE $1', [`${prefix}%`]);
  const read = (n: string) => JSON.parse(fs.readFileSync(path.join(dir, `${prefix}.${n}.json`), 'utf8'));
  const user = writerUserMessage({ pitch: rows[0].pitch as never, facts: read('facts'), inventory: read('inventory'), settings } as never);
  fs.writeFileSync(out, `# Writer input — ${prefix}\n\nModel: ${settings.writer_model}. Tools: submit_script only (no web search).\n\n## SYSTEM PROMPT (writer.md + principles.md)\n\n${writerSystem('writer')}\n\n---\n\n## USER MESSAGE\n\n${user}\n`);
  console.log(out, fs.statSync(out).size);
  process.exit(0);
})();
