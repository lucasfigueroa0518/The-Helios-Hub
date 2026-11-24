/**
 * Call plumbing for the Writer and Editor. The client is injected so tests
 * pass a stub with canned tool_use responses; this module never builds a
 * real client and makes no network call itself.
 */
import { TIP_SLIDES_MAX, TIP_SLIDES_MIN, type Tip } from '@/lib/field-notes/types';
import { callTool, type CacheUsage, type FieldNotesClient } from './client';
import { enforceCutOnly } from './edit';
import { modelFactCheck } from './factcheck';
import { runGates } from './gates';
import { parseDraft, parseWriterOutput } from './parse';
import { buildEditorRequest, buildWriterRequest, EDITOR_TOOL_NAME, WRITER_TOOL_NAME } from './prompts';
import type { DroppedSlide, FactChecker, GateReport, InsufficientSource, PostDraft } from './types';

export type { CacheUsage, FieldNotesClient } from './client';

export type WriteDraftResult =
  | { ok: true; draft: PostDraft; skipped: InsufficientSource[]; usage: CacheUsage }
  | { ok: false; reason: string; skipped?: InsufficientSource[]; usage?: CacheUsage };

/**
 * One Writer call for TIP_SLIDES_MIN to TIP_SLIDES_MAX tips. Tips the source cannot support come back in `skipped` and get no
 * slide. Fewer than TIP_SLIDES_MIN supported slides is `insufficient-source` (the Editor is never
 * called, nothing more is paid). A tip count outside that range is refused before any call.
 */
export async function writeDraft(client: FieldNotesClient, tips: Tip[]): Promise<WriteDraftResult> {
  if (tips.length < TIP_SLIDES_MIN || tips.length > TIP_SLIDES_MAX) {
    return { ok: false, reason: `the Writer takes ${TIP_SLIDES_MIN} to ${TIP_SLIDES_MAX} tips, got ${tips.length}` };
  }
  const r = await callTool(client, buildWriterRequest(tips), WRITER_TOOL_NAME);
  if (!r.ok) return r;
  const parsed = parseWriterOutput(r.input, tips.map((t) => t.id));
  if (!parsed.ok) return { ok: false, reason: `invalid draft: ${parsed.problems.join('; ')}`, usage: r.usage };
  if (parsed.draft.slides.length < TIP_SLIDES_MIN) return { ok: false, reason: INSUFFICIENT_SOURCE_REASON, skipped: parsed.skipped, usage: r.usage };
  return { ok: true, draft: parsed.draft, skipped: parsed.skipped, usage: r.usage };
}

/** The reason writePost returns when fewer than TIP_SLIDES_MIN tips can be written (the source says what the thing is and what it does for the reader). */
export const INSUFFICIENT_SOURCE_REASON = 'insufficient-source';

/** Editor pass: the model proposes cuts; code keeps only what is a pure cut. */
export async function editDraft(client: FieldNotesClient, draft: PostDraft) {
  const r = await callTool(client, buildEditorRequest(draft), EDITOR_TOOL_NAME);
  if (!r.ok) return r;
  const parsed = parseDraft(r.input);
  if (!parsed.ok) return { ok: false as const, reason: `invalid editor output: ${parsed.problems.join('; ')}` };
  const modelNotes = Array.isArray((r.input as { cut_notes?: unknown }).cut_notes)
    ? ((r.input as { cut_notes: unknown[] }).cut_notes.filter((n) => typeof n === 'string') as string[])
    : [];
  const cut = enforceCutOnly(draft, parsed.draft);
  return { ok: true as const, draft: cut.draft, notes: [...modelNotes, ...cut.notes], usage: r.usage };
}

export type WritePostResult =
  | { ok: true; draft: PostDraft; skipped: InsufficientSource[]; dropped: DroppedSlide[]; notes: string[]; gates: GateReport; usage: CacheUsage[] }
  | { ok: false; reason: string; skipped?: InsufficientSource[]; dropped?: DroppedSlide[]; draft?: PostDraft; gates?: GateReport; notes: string[]; usage: CacheUsage[] };

/**
 * Tips -> Writer -> Editor -> gates. `ok` is false only for a hard failure, a failed call, or an
 * `insufficient-source` answer (fewer than TIP_SLIDES_MIN tips are supported; nothing more is paid). On success
 * `draft.slides[].tipId` are the tips used, `skipped` the tips set aside, each with what its
 * source lacked, and `dropped` the slides the fact check failed while the caption and at least
 * TIP_SLIDES_MIN other slides passed (gates.ts): they are off the draft, each with its problems. `factCheck: 'model'` builds the model-backed checker on the SAME client passed
 * here, so a guarded client meters the fact check too; a function is used as given; omitted means
 * the offline numeral check.
 */
/**
 * The models see each tip as a short ordinal label (`tip-1` ...), never the stored uuid: a model mixes up long random
 * ids (first local runs, 2026-11-08: a correct slide was filed under another tip's uuid and failed the fact check).
 * Labels follow the request order, which is also the slide order. Code maps every label back to the real tip id.
 */
export const tipLabel = (i: number): string => `tip-${i + 1}`;

export async function writePost(client: FieldNotesClient, tips: Tip[], opts: { factCheck?: FactChecker | 'model' } = {}): Promise<WritePostResult> {
  const labelled = tips.map((t, i) => ({ ...t, id: tipLabel(i) }));
  const realId = new Map(labelled.map((t, i) => [t.id, tips[i]!.id]));
  const back = (id: string) => realId.get(id) ?? id;
  const unlabel = (r: WritePostResult): WritePostResult => {
    const fixDraft = (d: PostDraft): PostDraft => ({ ...d, slides: d.slides.map((sl) => ({ ...sl, tipId: back(sl.tipId) })) });
    const fixSkips = (xs?: InsufficientSource[]) => xs?.map((x) => ({ ...x, tipId: back(x.tipId) }));
    const fixNote = (n: string) => n.replace(/\btip-\d+\b/g, (m) => back(m));
    const fixDropped = (xs?: DroppedSlide[]) => xs?.map((x) => ({ tipId: back(x.tipId), problems: x.problems.map(fixNote) }));
    const fixGates = (g?: GateReport): GateReport | undefined => g && { ...g, draft: fixDraft(g.draft), dropped: fixDropped(g.dropped)!, notes: g.notes.map(fixNote) };
    return r.ok
      ? { ...r, draft: fixDraft(r.draft), skipped: fixSkips(r.skipped)!, dropped: fixDropped(r.dropped)!, gates: fixGates(r.gates)!, notes: r.notes.map(fixNote) }
      : { ...r, draft: r.draft && fixDraft(r.draft), skipped: fixSkips(r.skipped), dropped: fixDropped(r.dropped), gates: fixGates(r.gates), notes: r.notes.map(fixNote) };
  };
  // A model that answers with a stored id instead of its label is mapped to the label (tolerant, never a failure).
  const labelOf = new Map(tips.map((t, i) => [t.id, tipLabel(i)]));
  const relabel = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(relabel);
    if (v && typeof v === 'object') {
      const o = { ...(v as Record<string, unknown>) };
      if (typeof o.tipId === 'string' && labelOf.has(o.tipId.trim())) o.tipId = labelOf.get(o.tipId.trim());
      for (const k of Object.keys(o)) if (k !== 'tipId') o[k] = relabel(o[k]);
      return o;
    }
    return v;
  };
  const tolerant: FieldNotesClient = {
    messages: {
      create: async (params) => {
        const res = await client.messages.create(params);
        return { ...res, content: res.content.map((b) => (b.type === 'tool_use' ? { ...b, input: relabel(b.input) } : b)) } as typeof res;
      },
    },
  };
  return unlabel(await writePostLabelled(tolerant, labelled, opts));
}

async function writePostLabelled(client: FieldNotesClient, tips: Tip[], opts: { factCheck?: FactChecker | 'model' }): Promise<WritePostResult> {
  const usage: CacheUsage[] = [];
  const written = await writeDraft(client, tips);
  if (written.usage) usage.push(written.usage);
  if (!written.ok) {
    const notes = (written.skipped ?? []).map((s) => `Tip ${s.tipId} skipped: ${s.missing}`);
    return { ok: false, reason: written.reason, skipped: written.skipped, notes, usage };
  }
  const notes: string[] = written.skipped.map((s) => `Tip ${s.tipId} skipped: ${s.missing}`);
  const edited = await editDraft(client, written.draft);
  let draft = written.draft;
  if (edited.ok) { draft = edited.draft; notes.push(...edited.notes); usage.push(edited.usage); }
  else notes.push(`Editor pass skipped: ${edited.reason}`);
  const checker = opts.factCheck === 'model' ? modelFactCheck(client) : opts.factCheck;
  const gates = await runGates(draft, tips, checker);
  if (gates.factCheckUsage) usage.push(gates.factCheckUsage);
  notes.push(...gates.notes);
  if (gates.factCheckUnavailable) {
    // Nothing was verified, so the draft is neither passed nor failed on a fact: the run treats it as a failed write.
    return { ok: false, reason: `fact check could not run: ${gates.factCheckUnavailable}`, skipped: written.skipped, draft, notes, usage };
  }
  if (gates.hard.length) {
    return { ok: false, reason: gates.hard.map((h) => `${h.gate}: ${h.detail}`).join(' | '), skipped: written.skipped, dropped: gates.dropped, draft: gates.draft, gates, notes, usage };
  }
  // The post carries the gated draft: any slide the fact check dropped is gone from it.
  return { ok: true, draft: gates.draft, skipped: written.skipped, dropped: gates.dropped, notes, gates, usage };
}
