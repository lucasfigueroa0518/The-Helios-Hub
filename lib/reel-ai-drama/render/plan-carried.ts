import type { Blueprint, DirectorPlan } from '@/lib/reel-ai-drama/types';

/**
 * The plan check on render (ITERATION-10-CONTRACT §6): what each compiled frame really did, from its stage manifest, against
 * its blueprint. Every piece, label, mark, arrow, plate, hook and camera stop must be there, on its word. A miss gets one
 * recompile on a new layout, then a flag. Pure.
 */

export type Manifest = {
  pieces?: { id: string; asset?: string | null; at: number; until?: number; box_at_rest?: { x: number; y: number; w: number; h: number } }[];
  labels?: { text: string; sub?: string | null; owner?: string | null; at: number; until?: number }[];
  marks?: { kind: string; on?: string | null; target?: string | null; at: number }[];
  arrows?: { from: string; to: string; at: number }[];
  speech?: { on: string; text: string; at: number }[];
  hook?: { text: string; at: number } | null;
  camera?: { move?: string; stops?: { at: number; aim: string }[] };
  skipped_marks?: { kind: string; on?: string | null; target?: string | null; skipped?: string }[];
};

/** One frame as compiled-read reports it. */
export type FrameManifest = {
  manifest?: Manifest;
  /** Seconds each phrase resolved to in this frame. */
  cues?: Record<string, number>;
  /** Labels the stage holds back on purpose: a name already introduced; a logo that says its own. */
  names_held_back?: string[];
  /** Pieces a touch spaced out: their arrival isn't the planned word. */
  in_turn?: string[];
  /** A touch replaced the planned move with closer cuts. */
  closer_cuts?: boolean;
  notes?: string[];
  skips?: string[];
  plain?: boolean;
  failed?: string;
};

export type PlanMiss = { frame: number; kind: 'frame' | 'piece' | 'label' | 'mark' | 'arrow' | 'speech' | 'hook' | 'camera'; id: string; why: string };

/** How far from its word something may land: one rendered step. */
export const WORD_SLACK = 0.15;
const FRAME_MIDDLE = 540;
const LABEL_WAIT = 0.35;
const MARK_WAIT = 0.45;
const ARROW_WAIT = 0.3;

const plain = (v: unknown) => String(v ?? '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function missesIn(frame: number, b: Blueprint, m: FrameManifest): PlanMiss[] {
  const out: PlanMiss[] = [];
  const miss = (kind: PlanMiss['kind'], id: string, why: string) => out.push({ frame, kind, id, why });
  if (m.failed) return [{ frame, kind: 'frame', id: 'frame', why: `the frame did not build: ${m.failed}` }];
  if (m.plain) return [{ frame, kind: 'frame', id: 'frame', why: 'the frame fell back to a plain picture' }];
  const shown = m.manifest ?? {};
  const cue = (on: string | undefined) => (!String(on ?? '').trim() ? 0 : m.cues?.[String(on).trim()] ?? null);
  const near = (at: number, want: number | null) => want === null || Math.abs(at - want) <= WORD_SLACK;
  const pieces = new Map((shown.pieces ?? []).map((p) => [p.id, p]));
  const heldBack = new Set((m.names_held_back ?? []).map(plain));
  const earliest = Math.min(...(b.pieces ?? []).map((p) => cue(p.on) ?? 0));

  for (const p of b.pieces ?? []) {
    const got = pieces.get(p.id);
    if (!got) { miss('piece', p.id, `${p.asset ?? p.note ?? p.treatment ?? 'it'} is not on the frame`); continue; }
    if (p.asset && got.asset && got.asset !== p.asset) miss('piece', p.id, `shows ${got.asset}, not ${p.asset}`);
    const rest = got.box_at_rest;
    if (p.side && rest && (rest.x + rest.w / 2 < FRAME_MIDDLE) !== (p.side === 'left')) miss('piece', p.id, `stands on the ${p.side === 'left' ? 'right' : 'left'}, not the ${p.side}`);
    const want = cue(p.on);
    // On a plain ground the stage puts the first piece on from the first instant, and a touch may space pieces out.
    if ((m.in_turn ?? []).includes(p.id) || (got.at === 0 && want === earliest)) continue;
    if (!near(got.at, want)) miss('piece', p.id, `lands at ${got.at}s, not on "${p.on}" (${want}s)`);
  }

  const labels = shown.labels ?? [];
  const wantLabel = (text: string, owner: string | null, on: string) => {
    if (heldBack.has(plain(text))) return;
    // The stage sets a long label on two lines, a name and what it says of them: both are the planned words.
    const got = labels.find((l) => plain(l.text) === plain(text) || plain(`${l.text} ${l.sub ?? ''}`) === plain(text));
    if (!got) { miss('label', text, 'is not on the frame'); return; }
    const c = cue(on);
    const ownerAt = owner ? pieces.get(owner)?.at ?? 0 : 0;
    if (c !== null && !near(got.at, Math.max(c, ownerAt > 0 ? ownerAt + LABEL_WAIT : 0))) miss('label', text, `lands at ${got.at}s, not on "${on}" (${c}s)`);
  };
  for (const p of b.pieces ?? []) if (p.label) wantLabel(p.label, p.id, p.on);
  for (const l of b.labels ?? []) wantLabel(l.text, l.for ?? null, l.on);

  for (const k of b.marks ?? []) {
    const name = `${k.kind} on ${k.on_piece}${k.target ? ` at ${k.target}` : ''}`;
    if (k.kind === 'arrow' && k.from) {
      if (!(shown.arrows ?? []).some((a) => a.from === k.from && a.to === k.on_piece)) miss('mark', name, 'is not drawn');
      continue;
    }
    const got = (shown.marks ?? []).find((x) => x.kind === k.kind && x.on === k.on_piece && (x.target ?? null) === (k.target ?? null));
    const skipped = (shown.skipped_marks ?? []).find((x) => x.kind === k.kind && x.on === k.on_piece);
    if (!got) { miss('mark', name, skipped?.skipped ? `could not land: ${skipped.skipped}` : 'is not drawn'); continue; }
    const c = cue(k.on);
    const ownerAt = pieces.get(k.on_piece)?.at ?? 0;
    if (c !== null && !near(got.at, Math.max(c, ownerAt > 0 ? ownerAt + MARK_WAIT : 0))) miss('mark', name, `lands at ${got.at}s, not on "${k.on}" (${c}s)`);
    const phrase = /^text\s*:\s*(.+)$/is.exec(String(k.target ?? ''))?.[1]?.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '');
    if (phrase && (m.skips ?? []).some((s) => s.includes(phrase))) miss('mark', name, 'its words are not measured on the picture');
  }

  for (const a of b.arrows ?? []) {
    const name = `${a.from} to ${a.to}`;
    const got = (shown.arrows ?? []).find((x) => x.from === a.from && x.to === a.to);
    if (!got) { miss('arrow', name, 'is not drawn'); continue; }
    const c = cue(a.on);
    const wait = Math.max(pieces.get(a.from)?.at ?? 0, pieces.get(a.to)?.at ?? 0) + ARROW_WAIT;
    if (c !== null && !near(got.at, Math.max(c, wait))) miss('arrow', name, `lands at ${got.at}s, not on "${a.on}" (${c}s)`);
  }

  for (const s of b.speech ?? []) {
    const got = (shown.speech ?? []).find((x) => x.on === s.on_piece && plain(x.text) === plain(s.text));
    if (!got) miss('speech', s.text, `is not on ${s.on_piece}`);
    else if (!near(got.at, Math.max(cue(s.on) ?? got.at, pieces.get(s.on_piece)?.at ?? 0))) miss('speech', s.text, `lands at ${got.at}s, not on "${s.on}"`);
  }

  if (b.hook && plain(shown.hook?.text) !== plain(b.hook.text)) miss('hook', b.hook.text, 'is not on the frame');

  const stops = shown.camera?.stops ?? [];
  const peakPush = (m.notes ?? []).some((n) => n.startsWith('slide_on_peak'));
  if (b.camera && shown.camera?.move !== b.camera.move && !m.closer_cuts && !peakPush) miss('camera', b.camera.move, `the camera ${shown.camera?.move ?? 'has no move'}s instead`);
  for (const s of b.camera?.stops ?? []) {
    const got = stops.find((x) => x.aim === s.aim && near(x.at, cue(s.on)));
    if (!got) miss('camera', s.aim, stops.some((x) => x.aim === s.aim) ? `doesn't aim there on "${s.on}"` : 'that aim was not found on the frame');
  }
  return out;
}

/** Every planned thing a frame's render doesn't carry. A frame with no manifest is one miss; the close has no plan to carry. */
export function checkPlanCarried(plan: DirectorPlan, manifests: Record<string, FrameManifest | null | undefined>): PlanMiss[] {
  return plan.frames.flatMap((f) => {
    if (!f.blueprint || f.treatment === 'close') return [];
    const m = manifests[String(f.n)];
    if (!m) return [{ frame: f.n, kind: 'frame' as const, id: 'frame', why: 'no manifest came back for it' }];
    return missesIn(f.n, f.blueprint, m);
  });
}

/** A miss in one line, for a flag. */
export const planMissText = (m: PlanMiss) => `Frame ${m.frame}: planned ${m.kind} ${m.id} ${m.why}.`;
