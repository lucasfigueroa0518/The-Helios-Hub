/**
 * Reading aids for the tag view (Lucas, 2026-11-22): a plain headline and the
 * main point per story, written offline by Claude Code into
 * .memes-local/news-ranker-lab/digests/out/*.json. Display only: variants
 * always score the story's original text.
 */
import fs from 'node:fs';
import path from 'node:path';

export type Digest = { headline: string; point: string };

export function readDigests(dir = path.join(process.cwd(), '.memes-local/news-ranker-lab/digests/out')): Record<string, Digest> {
  const out: Record<string, Digest> = {};
  let files: string[] = [];
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return out; }
  for (const f of files) {
    try {
      for (const d of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) as Array<{ storyId?: unknown; headline?: unknown; point?: unknown }>) {
        if (typeof d.storyId === 'string' && typeof d.headline === 'string' && typeof d.point === 'string') out[d.storyId] = { headline: d.headline, point: d.point };
      }
    } catch { /* a half-written shard is skipped until it parses */ }
  }
  return out;
}
