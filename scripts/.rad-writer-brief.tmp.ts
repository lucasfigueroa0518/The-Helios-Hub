// Temporary: the writer's system prompt plus "The brief" and "The length" for given pitches (no API call).
import fs from 'node:fs';
for (const line of fs.existsSync('.env.local') ? fs.readFileSync('.env.local', 'utf8').split(/\r?\n/) : []) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
}
void (async () => {
  const [out, ...prefixes] = process.argv.slice(2);
  const { explainersDb } = await import('@/lib/explainers/connection');
  const { loadSettings } = await import('@/lib/reel-ai-drama/settings');
  const { lengthNote } = await import('@/lib/reel-ai-drama/writing/writer');
  const { writerSystem } = await import('@/lib/reel-ai-drama/prompts');
  const { pitchBrief } = await import('@/lib/reel-ai-drama/types');
  const db = await explainersDb();
  const settings = await loadSettings(db);
  const parts = [`# What the writer receives (minus the facts and the visual inventory)\n\nModel: ${settings.writer_model}. Tools today: submit_script only.\n\n## SYSTEM PROMPT (writer.md + principles.md), identical for every story\n\n${writerSystem('writer')}\n\n---\n\n## USER MESSAGE, per story\n`];
  for (const p of prefixes) {
    const { rows } = await db.query<{ pitch: any }>('SELECT pitch FROM reel_ai_drama.pitches WHERE id::text LIKE $1', [`${p}%`]);
    const pitch = typeof rows[0].pitch === 'string' ? JSON.parse(rows[0].pitch) : rows[0].pitch;
    parts.push(`### ${pitch.title} (${p})\n\n## The brief\n\n${pitchBrief(pitch) || pitch.title}\n\n## The facts\n\n*(reporting's fact sheet, omitted here)*\n\n## The visual inventory\n\n*(harvest's picture list, omitted here)*\n\n## The length\n\n${lengthNote(settings)}\n`);
  }
  fs.writeFileSync(out, parts.join('\n'));
  console.log(out, fs.statSync(out).size);
  process.exit(0);
})();
