// Temporary: the fact sheet exactly as the writer reads it ("The facts" section), from a run's saved facts (no API call).
import fs from 'node:fs';
void (async () => {
  const [factsFile, out] = process.argv.slice(2);
  const { factTimeline } = await import('@/lib/reel-ai-drama/writing/timeline');
  fs.writeFileSync(out, `# The facts, as the writer reads them\n\n${factTimeline(JSON.parse(fs.readFileSync(factsFile, 'utf8')))}\n`);
  console.log(out, fs.statSync(out).size);
})();
