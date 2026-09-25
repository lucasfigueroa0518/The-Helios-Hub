import { BUCKET_IDS, FRAMEWORK_IDS, type BucketId, type FrameworkId } from '@/lib/reels/scoring/decide';

/**
 * Pulls the already-written strategy text out of PRODUCT_SPEC.md and the
 * humanizer skill, word for word. The writer prompt (P-10) must carry these
 * unchanged, so they are extracted rather than retyped.
 *
 * The worker deploy excludes `.cursor/`, so the text is frozen into
 * `source-text.generated.ts` by `npm run reels:sync-copy-text`, and a test
 * fails when that file drifts from these sources.
 */

export type SpecSection = { title: string; body: string };

/** Lines a bucket carries that the writer has no use for. */
const BUCKET_LINES_OMITTED = [/^- Frameworks:/, /^- Feeds from:/];

function trimBlankEdges(lines: string[]): string[] {
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start].trim() === '') start += 1;
  while (end > start && lines[end - 1].trim() === '') end -= 1;
  return lines.slice(start, end);
}

function dedent(lines: string[]): string[] {
  const indents = lines
    .filter((line) => line.trim() !== '')
    .map((line) => line.length - line.trimStart().length);
  const cut = indents.length > 0 ? Math.min(...indents) : 0;
  return lines.map((line) => line.slice(Math.min(cut, line.length - line.trimStart().length)));
}

function findLine(lines: string[], test: (line: string) => boolean, from = 0): number {
  for (let index = from; index < lines.length; index += 1) {
    if (test(lines[index])) return index;
  }
  return -1;
}

/** The three frameworks under "Key Psychological Frameworks", in spec order. */
export function extractFrameworks(spec: string): Record<FrameworkId, SpecSection> {
  const lines = spec.split('\n');
  const intro = findLine(lines, (line) => line.startsWith('Below are the Key Psychological Frameworks'));
  if (intro < 0) throw new Error('PRODUCT_SPEC.md: framework list not found');
  const end = findLine(lines, (line) => line.startsWith('### '), intro);
  if (end < 0) throw new Error('PRODUCT_SPEC.md: end of framework list not found');

  const starts: number[] = [];
  for (let index = intro + 1; index < end; index += 1) {
    if (/^\d\. /.test(lines[index])) starts.push(index);
  }
  if (starts.length !== FRAMEWORK_IDS.length) {
    throw new Error(`PRODUCT_SPEC.md: expected 3 frameworks, found ${starts.length}`);
  }

  const out = {} as Record<FrameworkId, SpecSection>;
  FRAMEWORK_IDS.forEach((id, position) => {
    const start = starts[position];
    const stop = starts[position + 1] ?? end;
    out[id] = {
      title: lines[start].replace(/^\d\. /, '').trim(),
      body: dedent(trimBlankEdges(lines.slice(start + 1, stop))).join('\n'),
    };
  });
  return out;
}

/** The six buckets under "THE SIX BUCKETS", in spec order. */
export function extractBuckets(spec: string): Record<BucketId, SpecSection> {
  const lines = spec.split('\n');
  const intro = findLine(lines, (line) => line.startsWith('### THE SIX BUCKETS'));
  if (intro < 0) throw new Error('PRODUCT_SPEC.md: bucket section not found');
  const end = findLine(lines, (line) => line.startsWith('### '), intro + 1);
  if (end < 0) throw new Error('PRODUCT_SPEC.md: end of bucket section not found');

  const starts: number[] = [];
  for (let index = intro + 1; index < end; index += 1) {
    if (lines[index].startsWith('#### ')) starts.push(index);
  }
  if (starts.length !== BUCKET_IDS.length) {
    throw new Error(`PRODUCT_SPEC.md: expected 6 buckets, found ${starts.length}`);
  }

  const out = {} as Record<BucketId, SpecSection>;
  BUCKET_IDS.forEach((id, position) => {
    const start = starts[position];
    const stop = starts[position + 1] ?? end;
    const body = lines
      .slice(start + 1, stop)
      .filter((line) => !BUCKET_LINES_OMITTED.some((pattern) => pattern.test(line)));
    out[id] = {
      title: lines[start].replace(/^#### \d\. /, '').trim(),
      body: trimBlankEdges(body).join('\n'),
    };
  });
  return out;
}

/** The humanizer skill without its YAML front matter. */
export function extractHumanizer(skill: string): string {
  const lines = skill.split('\n');
  if (lines[0]?.trim() !== '---') return skill.trim();
  const close = findLine(lines, (line) => line.trim() === '---', 1);
  if (close < 0) throw new Error('humanizer SKILL.md: unterminated front matter');
  return trimBlankEdges(lines.slice(close + 1)).join('\n');
}

export const SPEC_PATH = 'planning/Trial Reels/PRODUCT_SPEC.md';
export const HUMANIZER_PATH = '.cursor/skills/humanizer/SKILL.md';
