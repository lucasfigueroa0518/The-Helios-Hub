/**
 * Field Notes in intake mode (planning/Central Intake/PHASE2-CONTRACT.md, Owner D).
 *
 * When the 'field-notes' consumer switch says 'intake' (readConsumerMode), a run does not collect or score: the central
 * intake already fetched Field Notes' own sources (SOURCE_REGISTRY, each item its own story) and scored them with
 * field-notes-score. The run reads the order's scored stories, maps each back to the candidate the legacy path would
 * have built (link = the item's key in canonical form, kind and label from the item's SOURCE_REGISTRY entry), drops
 * links already in field_notes.tips (one lookup), and saves the rest as candidate tips with the stored score, tags and
 * scorecard version. Selection and everything after it are unchanged (run.ts selectStoredTips).
 *
 * No model and no network here: the intake is read, never re-scored (CLAUDE.md Rule 2: only stories the intake scored
 * are touched, and only those not already a tip are written). 'legacy' and 'stale-fallback' never reach this file.
 */
import { fieldNotesCandidateOf, type FieldNotesMember } from '@/lib/intake/scorecards';
import type { IntakeItem, IntakeQuery, ScorecardId, ScoredStory } from '@/lib/intake/types';
import type { HubQuery } from '@/lib/social-hub/db';

import { canonicalSourceUrl, UNTRUSTED_MAX_CHARS, type TipCandidate } from './sources/candidate';
import { SOURCE_REGISTRY } from './sources/registry';
import type { TipTags } from './sources/score';
import { saveCandidateTip, storedSourceUrls } from './store';
import type { TipSourceKind } from './types';

/** The order's lookback: the legacy collect's window (live.ts SINCE_DAYS). */
export const FIELD_NOTES_INTAKE_LOOKBACK_DAYS = 45;
export const FIELD_NOTES_SCORECARD: ScorecardId = 'field-notes-score';

export type FieldNotesIntakeMode = 'intake' | 'legacy' | 'stale-fallback';

/** The intake reads Field Notes uses (live: lib/intake/read.ts; tests: stubs). */
export type FieldNotesIntakeDeps = {
  readConsumerMode: (q: IntakeQuery, order: 'field-notes', now: Date) => Promise<FieldNotesIntakeMode>;
  listOrderStories: (q: IntakeQuery, order: 'field-notes', o: { since: Date; needScores: ScorecardId[] }) => Promise<ScoredStory[]>;
};

/** The registry fields a stored item maps back to (SOURCE_REGISTRY entries satisfy it). */
export type FieldNotesSourceRef = { id: string; kind: TipSourceKind; label: string };

/** The hub's query handle in the intake's shape. */
export const asIntakeQuery = (q: HubQuery): IntakeQuery => ({ query: (text, params) => q(text, params) });

/**
 * The SOURCE_REGISTRY id an item came from: an explicit field-notes source id when the intake stores one, else the
 * item's source id (contract: item.sourceId is the registry entry id), a 'field-notes:' prefix dropped either way.
 */
export function fieldNotesSourceIdOf(item: IntakeItem): string {
  const own = (item as IntakeItem & { fieldNotesSourceId?: string | null }).fieldNotesSourceId;
  return (own ?? item.sourceId).replace(/^field-notes:/, '');
}

/**
 * The candidate a story stands for: its first member from a Field Notes source ('field-notes' members first), as the
 * legacy collect would have built it (registry kind and label, never scraped; scraped title and body only in
 * untrustedContent). Null when no member comes from a registry source.
 */
export function storyToCandidate(story: ScoredStory, registry: readonly FieldNotesSourceRef[] = SOURCE_REGISTRY): TipCandidate | null {
  const byId = new Map(registry.map((e) => [e.id, e]));
  const members = [...story.members.filter((m) => m.family === 'field-notes'), ...story.members.filter((m) => m.family !== 'field-notes')];
  for (const m of members) {
    const entry = byId.get(fieldNotesSourceIdOf(m));
    if (!entry) continue;
    const sourceUrl = canonicalSourceUrl(m.key || m.url);
    if (!sourceUrl) continue;
    // The item's Field Notes metadata (field_notes_meta) holds the date the legacy collect stored as published_at;
    // the item's publish_time is only the fallback, as in the intake's own mapping (scorecards.fieldNotesCandidateOf).
    const fromMeta = fieldNotesCandidateOf(m as FieldNotesMember);
    return {
      sourceUrl,
      sourceKind: entry.kind,
      sourceLabel: entry.label,
      publishedAt: fromMeta ? fromMeta.publishedAt : m.publishTime ? m.publishTime.toISOString() : null,
      item: (fromMeta?.item ?? {}) as TipCandidate['item'],
      untrustedContent: `${m.headline}\n\n${m.body}`.trim().slice(0, UNTRUSTED_MAX_CHARS),
    };
  }
  return null;
}

type StoredScore = { score: number; tags: TipTags; version: string };

/** The stored field-notes-score of these stories (one bounded read: only the ids the order returned). */
export async function readFieldNotesScores(q: HubQuery, storyIds: readonly string[]): Promise<Map<string, StoredScore>> {
  const out = new Map<string, StoredScore>();
  if (!storyIds.length) return out;
  const { rows } = await q<{ story_id: string; version: string; result: unknown }>(
    `SELECT story_id::text AS story_id, version, result FROM intake.scores WHERE scorecard = $1 AND story_id = ANY($2::uuid[])`,
    [FIELD_NOTES_SCORECARD, [...storyIds]],
  );
  for (const row of rows) {
    const r = (typeof row.result === 'string' ? JSON.parse(row.result) : row.result) as { kind?: string; score?: unknown; tags?: Partial<TipTags> } | null;
    const score = Number(r?.score);
    if (r?.kind !== FIELD_NOTES_SCORECARD || r.score == null || !Number.isFinite(score)) continue;
    const t = r.tags ?? {};
    out.set(row.story_id, {
      score,
      version: row.version,
      tags: { leaf: t.leaf ?? null, want: t.want ?? null, tier: t.tier ?? null, purposes: Array.isArray(t.purposes) ? t.purposes : [], fresh: t.fresh === true },
    });
  }
  return out;
}

export type IntakeTipsFound = {
  source: 'intake';
  stories: number;
  scored: number;
  unmapped: number;
  alreadyStored: number;
  added: number;
};

/**
 * Save the order's scored stories that are not a tip yet as candidate tips (same columns as the legacy save:
 * saveCandidateTip with the stored score, tags and score_version = the scorecard version). Throws when the intake
 * read fails, so the caller can fall back to the legacy path.
 */
export async function saveIntakeTips(
  q: HubQuery,
  deps: FieldNotesIntakeDeps,
  now: Date,
  registry: readonly FieldNotesSourceRef[] = SOURCE_REGISTRY,
): Promise<IntakeTipsFound> {
  const since = new Date(now.getTime() - FIELD_NOTES_INTAKE_LOOKBACK_DAYS * 86_400_000);
  const stories = await deps.listOrderStories(asIntakeQuery(q), 'field-notes', { since, needScores: [FIELD_NOTES_SCORECARD] });
  const scores = await readFieldNotesScores(q, stories.map((s) => s.id));
  // One candidate per link (the best-scored story wins), best first.
  const byUrl = new Map<string, { candidate: TipCandidate; stored: StoredScore }>();
  let unmapped = 0;
  let scored = 0;
  for (const story of stories) {
    const stored = scores.get(story.id);
    if (!stored) continue;
    scored += 1;
    const candidate = storyToCandidate(story, registry);
    if (!candidate) {
      unmapped += 1;
      continue;
    }
    const prev = byUrl.get(candidate.sourceUrl);
    if (!prev || stored.score > prev.stored.score) byUrl.set(candidate.sourceUrl, { candidate, stored });
  }
  const found = [...byUrl.values()].sort((a, b) => b.stored.score - a.stored.score);
  const already = await storedSourceUrls(q, found.map((f) => f.candidate.sourceUrl));
  let added = 0;
  for (const f of found) {
    if (already.has(f.candidate.sourceUrl)) continue;
    if (await saveCandidateTip(q, f.candidate, f.stored.score, { ...f.stored.tags, questionSetVersion: f.stored.version })) added += 1;
  }
  return { source: 'intake', stories: stories.length, scored, unmapped, alreadyStored: already.size, added };
}
