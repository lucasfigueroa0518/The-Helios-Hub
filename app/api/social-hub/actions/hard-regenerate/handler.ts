import { isUuid, type ActionSpec } from '@/lib/social-hub/action-route';

type RenderRequest = { ok: boolean; reason?: string };
type Deps = {
  explainersDb: () => Promise<unknown>;
  loadExplainerSettings: (db: never) => Promise<unknown>;
  explainerRerender: (db: never, input: { topicId: string; settings: never }) => Promise<RenderRequest>;
  storiesRegenerate: (db: never, setId: string, by: string) => Promise<unknown>;
  storiesDb: unknown;
};

export type HardRegenerateBody = { vertical: 'explainers' | 'stories'; ref: string };

const REFUSAL: Record<string, string> = {
  daily_render_cap: 'Today’s explainer render cap is used up.',
  daily_spend_cap: 'Today’s explainer spend cap is used up.',
  already_in_flight: 'A render for this topic is already queued or running.',
  topic_not_found: 'That topic no longer exists.',
  topic_not_renderable: 'That topic can’t be rendered (rejected or displaced).',
};

/**
 * Hard regenerate (SH-15, SH-16, SH-54): a one-post rerun queued in the
 * vertical's own run table (the worker executes). Explainers:
 * `requestRerender` (P2-M3; caps enforced, refusals returned). Stories:
 * `regenerate`. Carousels and Trial Reels have no one-post rerun (link out).
 */
export function hardRegenerate(deps: Deps): ActionSpec<HardRegenerateBody> {
  return {
    flag: 'hardRegenerate',
    parse: (b) => {
      const body = b as { vertical?: unknown; ref?: unknown } | null;
      if (!isUuid(body?.ref) || (body.vertical !== 'explainers' && body.vertical !== 'stories')) return null;
      return { vertical: body.vertical, ref: body.ref };
    },
    run: async ({ vertical, ref }, ctx) => {
      if (vertical === 'stories') {
        await deps.storiesRegenerate(deps.storiesDb as never, ref, ctx.email);
        return { ok: true, note: 'A new set is queued for the same day.' };
      }
      const db = await deps.explainersDb();
      const settings = await deps.loadExplainerSettings(db as never);
      const out = await deps.explainerRerender(db as never, { topicId: ref, settings: settings as never });
      return out.ok
        ? { ok: true, note: 'A new render is queued. It replaces the current version when it finishes.' }
        : { ok: false, note: REFUSAL[out.reason ?? ''] ?? `Refused: ${out.reason}` };
    },
  };
}
