/**
 * Photo-finder bench (link B), step 1: collect every IMAGE request from the
 * saved rebuild runs into a fixed test set (Tommy, 2026-10-06).
 *
 * Sources: runs/daily-* run.json and the Writer prototype logs; the
 * Writer's and the Editor's ok drafts. `none` is not a photo request and is
 * skipped. Deduplicated by kind + value + slot. Each entry carries what the
 * finder needs: its story's brief, the pages' photo lists (no page text),
 * the slide's words, slot and quote speaker.
 *
 *   npx tsx scripts/social_photo_bench_collect.ts
 *   → fixtures/social/photo-bench/requests.json
 */
import { promises as fsp } from 'node:fs';
import path from 'node:path';

import { slotFor } from '@/lib/social/photos/design';
import { fillDraft, type DraftSubmission } from '@/lib/social/writer/draft';

const OUT = path.join(process.cwd(), 'fixtures/social/photo-bench/requests.json');

async function sources(): Promise<Array<{ file: string; stories: Record<string, any> }>> {
  const out: Array<{ file: string; stories: Record<string, any> }> = [];
  for (const dir of (await fsp.readdir('runs')).filter((d) => d.startsWith('daily-')).sort()) {
    const runFile = path.join('runs', dir, 'run.json');
    try {
      out.push({ file: runFile, stories: JSON.parse(await fsp.readFile(runFile, 'utf8')).stories ?? {} });
    } catch { /* no run.json */ }
    for (const sub of await fsp.readdir(path.join('runs', dir)).catch(() => [] as string[])) {
      if (!sub.startsWith('hook-writer-prototype-')) continue;
      const f = path.join('runs', dir, sub, 'hook-writer-prototype.json');
      try {
        const logs = JSON.parse(await fsp.readFile(f, 'utf8')).logs ?? {};
        // The prototype's logs have no Reporter; borrow the brief from the run it read.
        const parent = JSON.parse(await fsp.readFile(runFile, 'utf8')).stories ?? {};
        for (const [id, l] of Object.entries<any>(logs)) l.reporter = parent[id]?.reporter;
        out.push({ file: f, stories: logs });
      } catch { /* none */ }
    }
  }
  return out;
}

async function main() {
  const stories: Record<string, { brief: any; pages: any[]; from: string }> = {};
  const requests: any[] = [];
  const seen = new Set<string>();
  const backfilled = new Set<string>();
  let total = 0;
  let nones = 0;
  for (const { file, stories: s } of await sources()) {
    for (const [storyId, l] of Object.entries<any>(s)) {
      const brief = l.reporter?.ok ? structuredClone(l.reporter.brief) : null;
      if (!brief) continue;
      // Briefs from before quote speakers by ID (dfac719) have no subject IDs. For the fixed bench
      // set only, give subjects IDs and match each quote's speaker to a subject by name, and record it.
      if (brief.subjects.some((x: any) => !x.id)) {
        brief.subjects.forEach((x: any, i: number) => (x.id = `S${i + 1}`));
        for (const q of brief.quotes) q.speaker_id ??= brief.subjects.find((x: any) => q.speaker.toLowerCase().includes(x.name.toLowerCase()))?.id ?? null;
        backfilled.add(storyId);
      }
      const key = storyId;
      stories[key] ??= {
        brief,
        pages: (l.reporter.pages ?? []).map((p: any) => ({ ok: true, url: p.url, resolvedUrl: p.resolvedUrl, title: p.title ?? null, text: '', photos: p.photos ?? [] })),
        from: file,
      };
      const drafts: DraftSubmission[] = [...(l.writer ?? []), ...(l.editor ?? [])].filter((r: any) => r?.ok).map((r: any) => r.draft);
      for (const d of drafts) {
        let filled;
        try { filled = fillDraft(d, brief); } catch { continue; }
        const chosen = d.cover_options[d.chosen_cover - 1]!;
        const places = [
          { image: chosen.image, slot: 'split', cover: true, text: [chosen.text], speaker: null, where: 'cover' },
          ...filled.slides.map((x, i) => ({ image: x.image, slot: slotFor(x.type), cover: false, text: [x.headline.text, x.body?.text ?? '', x.quote?.text ?? ''], speaker: x.quote?.speaker_subject ?? null, where: `slide ${i + 2} (${x.type})` })),
        ];
        for (const p of places) {
          total++;
          if (p.image.kind === 'none') { nones++; continue; }
          const k = `${p.image.kind}|${p.image.value.trim().toLowerCase()}|${p.slot}`;
          if (seen.has(k)) continue;
          seen.add(k);
          requests.push({ id: `R${String(requests.length + 1).padStart(2, '0')}`, story: key, request: p.image, slot: p.slot, cover: p.cover, where: p.where, slideText: p.text.filter(Boolean), speaker: p.speaker });
        }
      }
    }
  }
  const used = new Set(requests.map((r) => r.story));
  const fixture = { collectedAt: new Date().toISOString(), note: 'Every IMAGE request from the saved rebuild runs, deduplicated by kind + value + slot (link B bench, Tommy 2026-10-06). speakerIdsBackfilled: briefs from before quote speakers by ID; their subject IDs and quote speaker_ids were set here by name match, for this fixture only.', speakerIdsBackfilled: [...backfilled].filter((k) => requests.some((r) => r.story === k)), stories: Object.fromEntries(Object.entries(stories).filter(([k]) => used.has(k))), requests };
  await fsp.mkdir(path.dirname(OUT), { recursive: true });
  await fsp.writeFile(OUT, JSON.stringify(fixture, null, 2));
  const mix = Object.fromEntries(['subject', 'article', 'stock'].map((k) => [k, requests.filter((r) => r.request.kind === k).length]));
  console.log(`${requests.length} unique requests (${JSON.stringify(mix)}) from ${used.size} stories; ${total} places seen, ${nones} none → ${path.relative(process.cwd(), OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
