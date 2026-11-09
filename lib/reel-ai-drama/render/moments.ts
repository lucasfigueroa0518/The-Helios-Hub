import path from 'node:path';

import type { CompiledFrameRecord } from '@/lib/reel-ai-drama/render/compile';
import { spawnRunner, type Runner } from '@/lib/reel-ai-drama/render/runner';
import { OPENING_STILL_AT, type FrameSpan } from '@/lib/reel-ai-drama/render/video';

/**
 * Which moments of a reel are worth seeing (Iteration 11 contract §2). Code picks them, so a reviewer never judges a frame
 * from one still: each frame's edges, everything its timeline does, every time range a measured check names, and every
 * sharp change in the pixels no timeline explains. Pure apart from the ffmpeg read (`sceneChanges`).
 */

/** One moment to look at. `id` is the frame's id; `t` is seconds into the frame, `reel_t` seconds into the reel. */
export type Moment = { frame: number; id: string; t: number; reel_t: number; what: string; source: 'timeline' | 'finding' | 'change' | 'edge' };

/** How long after an event starts it is shot, so what arrived has landed. */
export const SETTLE = 0.6;
/** Moments of one frame this close merge and keep every label. Near-identical moments are never dropped. */
export const MERGE_WITHIN = 0.15;
/** How far inside its edges a frame's first and last moments sit, so they never land on the neighbouring frame. */
export const EDGE_INSET = 0.05;
/** The ffmpeg scene score that counts as a sharp change: 24 hits on an 81 s reel, its cuts and its unplanned jumps. */
export const SCENE_THRESHOLD = 0.08;

const LABEL_MAX = 60;
const RANK: Record<Moment['source'], number> = { edge: 0, finding: 1, timeline: 2, change: 3 };

const round = (n: number) => Math.round(n * 1000) / 1000;
const clip = (s: string) => (s.length > LABEL_MAX ? `${s.slice(0, LABEL_MAX - 1).trimEnd()}…` : s);

/** A frame's planned events, each at the second it starts. Pure. */
function timelineEvents(record: CompiledFrameRecord | undefined, duration: number): { at: number; what: string }[] {
  const m = record?.manifest;
  if (!m) return [];
  return [
    ...(m.pieces ?? []).flatMap((p) => [
      { at: p.at, what: `${p.id} arrives` },
      // A piece that stays to the end has no exit: `until` is then the frame's length.
      ...(typeof p.until === 'number' && p.until < duration - EDGE_INSET ? [{ at: p.until, what: `${p.id} leaves` }] : []),
    ]),
    ...(m.marks ?? []).map((k) => ({ at: k.at, what: `${k.kind} mark${k.on ? ` on ${k.on}` : ''}` })),
    ...(m.labels ?? []).map((l) => ({ at: l.at, what: `label "${clip(l.text)}"` })),
    ...(m.speech ?? []).map((s) => ({ at: s.at, what: `speech "${clip(s.text)}"` })),
    ...(m.hook ? [{ at: m.hook.at, what: `hook "${clip(m.hook.text)}"` }] : []),
    ...(m.camera?.stops ?? []).map((s) => ({ at: s.at, what: `camera stop on ${s.aim}` })),
  ].filter((e) => Number.isFinite(e.at) && e.at >= 0 && e.at < duration);
}

/** The frame a measured check's line is about: by the id it names, else a `Frame N`, else an id-shaped word. Pure. */
function findingFrame(finding: string, frames: { number: number; id: string | null }[]): number | null {
  const byId = frames.find((f) => f.id && finding.includes(f.id));
  if (byId) return byId.number;
  const n = /\bframe\s+(\d+)\b/i.exec(finding)?.[1] ?? /(?:^|[\s:\]])(\d{2})-[a-z0-9]/.exec(finding)?.[1];
  return n !== undefined && frames.some((f) => f.number === Number(n)) ? Number(n) : null;
}

/** The middle of each time range a line names: `(1.2s)` or `(1.2s–3.4s)`, in seconds into the frame. Pure. */
export function findingTimes(finding: string): number[] {
  return [...finding.matchAll(/\((\d+(?:\.\d+)?)s(?:\s*[–-]\s*(\d+(?:\.\d+)?)s)?\)/g)].map((m) => round((Number(m[1]) + Number(m[2] ?? m[1])) / 2));
}

/** A check's line as a label: its rule and what it found, without the script and frame it already belongs to. Pure. */
function findingLabel(finding: string, id: string | undefined): string {
  const text = (id ? finding.replace(id, '') : finding).replace(/^[^[]*(?=\[)/, '').replace(/\s+:\s+/, ' ').trim();
  return `check: ${clip(text)}`;
}

/** Merge a frame's moments, sorted by time. An edge keeps its exact time; otherwise the latest time wins, being the most settled. */
function merged(moments: Moment[]): Moment[] {
  const out: Moment[] = [];
  let group: Moment[] = [];
  const flush = () => {
    if (!group.length) return;
    const at = group.find((m) => m.source === 'edge') ?? group[group.length - 1]!;
    const source = [...group].sort((a, b) => RANK[a.source] - RANK[b.source])[0]!.source;
    out.push({ ...at, source, what: [...new Set(group.map((m) => m.what))].join('; ') });
    group = [];
  };
  for (const m of [...moments].sort((a, b) => a.t - b.t || RANK[a.source] - RANK[b.source])) {
    if (group.length && m.t - group[0]!.t > MERGE_WITHIN + 1e-6) flush();
    group.push(m);
  }
  flush();
  return out;
}

/**
 * Every moment worth seeing, in reel order. `spans` are the paced storyboard's frames (the close is left out, as it's the same
 * every reel); `records` is `CompiledRead.frames`, keyed by frame number, and a frame with no manifest still gets its edges,
 * its findings and its changes; `findings` are the measured checks' lines; `changes` are `sceneChanges`' reel times.
 */
export function pickMoments(input: { spans: FrameSpan[]; records: Record<string, CompiledFrameRecord>; findings: string[]; changes: number[] }): Moment[] {
  const spans = input.spans.filter((s) => s.treatment !== 'close' && s.end > s.start).sort((a, b) => a.start - b.start);
  const opening = spans[0];
  const named = spans.map((s) => ({ number: s.number, id: input.records[s.number]?.id ?? null }));
  const out: Moment[] = [];
  for (const span of spans) {
    const duration = span.end - span.start;
    const record = input.records[span.number];
    const last = Math.max(0, duration - EDGE_INSET);
    const moment = (t: number, what: string, source: Moment['source']): Moment => {
      const inside = round(Math.min(Math.max(t, Math.min(EDGE_INSET, last)), last));
      return { frame: span.number, id: record?.id ?? `frame-${String(span.number).padStart(2, '0')}`, t: inside, reel_t: round(span.start + inside), what, source };
    };
    const events = timelineEvents(record, duration);
    const moments = [
      span === opening ? moment(OPENING_STILL_AT - span.start, "the reel's first instant", 'edge') : moment(EDGE_INSET, 'the frame starts', 'edge'),
      moment(last, 'the frame ends', 'edge'),
      ...events.map((e) => moment(e.at + SETTLE, e.what, 'timeline')),
    ];
    for (const finding of input.findings) {
      if (findingFrame(finding, named) !== span.number) continue;
      for (const t of findingTimes(finding)) if (t < duration) moments.push(moment(t, findingLabel(finding, record?.id), 'finding'));
    }
    // A change the timeline explains is its event landing, or the cut at the frame's edge, which those moments already show.
    const explained = (t: number) => t <= MERGE_WITHIN || duration - t <= MERGE_WITHIN || events.some((e) => t >= e.at - MERGE_WITHIN && t <= e.at + SETTLE + MERGE_WITHIN);
    for (const c of input.changes) {
      const t = c - span.start;
      if (t >= 0 && t < duration && !explained(t)) moments.push(moment(t, 'the picture changes sharply', 'change'));
    }
    out.push(...merged(moments));
  }
  return out;
}

/**
 * The reel times where the rendered video's pixels change sharply: ffmpeg's scene score, with the kept frames' times read from
 * showinfo. A net rather than a requirement, so it fails open: no reading is no change moments.
 */
export function sceneChanges(videoPath: string, deps: { run?: Runner } = {}): number[] {
  const run = deps.run ?? spawnRunner;
  const video = path.resolve(videoPath);
  const res = run('ffmpeg', ['-hide_banner', '-nostats', '-i', video, '-an', '-vf', `scale=270:-2,select='gt(scene,${SCENE_THRESHOLD})',showinfo`, '-f', 'null', '-'], { cwd: path.dirname(video), timeoutMs: 5 * 60 * 1000 });
  if (res.status !== 0) return [];
  return [...res.stderr.matchAll(/pts_time:\s*(\d+(?:\.\d+)?)/g)].map((m) => round(Number(m[1])));
}
