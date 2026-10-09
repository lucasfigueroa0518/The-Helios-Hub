/**
 * Free vs. Paid (plan §5.3; S-07, S-08, S-22, S-46, S-50).
 *
 *   leads    Ball Knowledge ideas (14 days), GitHub Trending, a catalog sample
 *   pair     fvp-pair@1: Sonnet with web search (at most 5 searches) proposes
 *            up to 3 pairs with their official pages
 *   score    fvp-pair-score@1 per pair; pairs shown in 90 days dropped; a
 *            developer tool only when none of the last 3 sets had one (S-08)
 *   verify   fvp-verify@1 re-reads the price and free pages (web fetch); a
 *            pair whose price or install path doesn't hold is dropped
 *   copy     fvp-copy@1: the tease line
 *   logos    the finder's logo route (Wikidata P154, identity-checked)
 */
import { FVP_PAIR_SCORE } from '@/lib/stories/questions';
import { FVP_COPY, FVP_PAIR, FVP_VERIFY, material, type FvpCopyOut, type FvpPair, type FvpPairOut, type FvpVerifyOut } from '@/lib/stories/prompts';
import type { FrameData } from '@/lib/stories/render/types';
import { recentKeys, type NewCandidate } from '@/lib/stories/repository';
import { freeToolLeads, type ToolLead } from '@/lib/stories/sources/reels';
import { writeStructured } from '@/lib/stories/writer';

import { findPhoto, nextBackdrop, toFrames, type BuildDeps, type BuildResult } from './common';

export const FVP_BAR = 0.6;
/** The paid price as struck on the free frame: "$22.99/mo", "$99/yr", else price and period. */
export const struckPrice = (price: string, period: string) => {
  const p = period.trim().toLowerCase();
  return /\bmonth\b|^mo/.test(p) ? `${price}/mo` : /\byear\b|^yr|annual/.test(p) ? `${price}/yr` : `${price} ${period}`.trim();
};
export const pairKey = (p: Pick<FvpPair, 'paid_tool' | 'free_tool'>) => `${p.paid_tool.trim().toLowerCase()}|${p.free_tool.trim().toLowerCase()}`;
const pairScore = (a: Record<string, { noul: number }>) => ['paid_known', 'does_the_job', 'accessible', 'viewer_value'].reduce((s, k) => s + (a[k]?.noul ?? 0), 0) / 4;

/** S-08: at most one developer tool in four sets. */
async function devToolAllowed(deps: BuildDeps): Promise<boolean> {
  const { rows } = await deps.db.query<{ dev: boolean | null }>(
    `SELECT (payload->>'devTool')::boolean AS dev FROM stories.sets WHERE series = 'free_vs_paid' AND id <> $1
      AND status IN ('ready', 'approved', 'scheduled', 'publishing', 'published') ORDER BY ny_date DESC LIMIT 3`,
    [deps.setId],
  );
  return !rows.some((r) => r.dev);
}

export async function buildFreeVsPaid(deps: BuildDeps, leads?: () => Promise<ToolLead[]>): Promise<BuildResult> {
  const log: string[] = [];
  const candidates: NewCandidate[] = [];
  const shown = await recentKeys(deps.db, 'free_vs_paid', 90, deps.now);
  const pooled = deps.pool;
  const found = await (leads ?? (pooled ? async () => pooled.leads : () => freeToolLeads(deps.sourceDb, deps.nyDate)))().catch(() => []);
  if (!found.length) return { ok: false, skip: 'no free-tool leads', candidates };

  const call = <T>(prompt: { id: string; system: string; tool: { name: string; description: string; input_schema: Record<string, unknown> } }, user: string, extra: { webSearch?: { maxUses: number }; webFetch?: { maxUses: number }; effort?: 'low' | 'medium' } = {}) =>
    writeStructured<T>({ create: deps.write, db: deps.db, setId: deps.setId, component: prompt.id, model: deps.settings.models.copy, system: prompt.system, tool: prompt.tool, user, ...extra });

  const proposed = (await call<FvpPairOut>(FVP_PAIR, material({ already_shown: [...shown], leads: found.slice(0, 40).map((l) => ({ name: l.name, url: l.url, description: l.description.slice(0, 400) })) }), { webSearch: { maxUses: 5 } })).value.pairs;
  const devOk = await devToolAllowed(deps);
  const scored: Array<FvpPair & { score: number; answers: Record<string, number> }> = [];
  for (const p of proposed.slice(0, 3)) {
    if (shown.has(pairKey(p))) continue;
    const res = await deps.jev.ask({ component: 'fvp-score', set: FVP_PAIR_SCORE, setId: deps.setId, state: { paid_tool: p.paid_tool, paid_price: `${p.paid_price} ${p.price_period}`, free_tool: p.free_tool, what_it_does: { untrusted_content: p.what_it_does }, how_to_get: p.how_to_get, platforms: p.platforms } });
    scored.push({ ...p, score: pairScore(res.answers as Record<string, { noul: number }>), answers: Object.fromEntries(Object.entries(res.answers).map(([k, v]) => [k, (v as { noul: number }).noul])) });
  }
  scored.sort((a, b) => b.score - a.score);
  let chosen: (typeof scored)[number] | null = null;
  let check: FvpVerifyOut | null = null;
  for (const p of scored) {
    let reason: string | null = null;
    if (p.score < FVP_BAR) reason = 'below the bar';
    else if (p.dev_tool && !devOk) reason = 'developer tool (one already in the last 3 sets)';
    else if (!chosen) {
      check = (await call<FvpVerifyOut>(FVP_VERIFY, material({ paid_tool: p.paid_tool, stated_price: `${p.paid_price} ${p.price_period}`, pricing_page: p.paid_price_url, free_tool: p.free_tool, free_page: p.free_url, stated_how_to_get: p.how_to_get }), { webFetch: { maxUses: 3 }, effort: 'low' })).value;
      if (check.price_confirmed && check.free_confirmed) chosen = p;
      else reason = `verification failed: ${check.note}`;
    } else reason = 'a better pair was chosen';
    candidates.push({ origin: 'generated', ref: pairKey(p), payload: { ...p }, jev: p.answers, score: p.score, chosen: chosen === p, reason: chosen === p ? null : reason });
  }
  if (!chosen) return { ok: false, skip: 'no pair cleared the bar and its checks', candidates };

  const tease = (await call<FvpCopyOut>(FVP_COPY, material({ paid_tool: chosen.paid_tool, price: `${chosen.paid_price} ${chosen.price_period}`, free_tool_kind: chosen.what_it_does }), { effort: 'low' })).value.tease.trim();
  const logo = (name: string, url: string) => findPhoto(deps.photos, { kind: 'logo', query: name, subjects: [{ name, type: 'organization' }], storyDate: null, sourceUrls: [url], exclude: new Set() }, log);
  const [paidLogo, freeLogo] = [await logo(chosen.paid_tool, chosen.paid_price_url), await logo(chosen.free_tool, chosen.free_url)];

  const data: FrameData[] = [
    { role: 'intro' },
    { role: 'paid', tool: chosen.paid_tool, price: chosen.paid_price, period: chosen.price_period, tease, ...(paidLogo ? { logo: { ...paidLogo, kind: 'logo' as const } } : {}) },
    { role: 'free', tool: chosen.free_tool, what: chosen.what_it_does, how: chosen.how_to_get, platforms: chosen.platforms, paidPrice: struckPrice(chosen.paid_price, chosen.price_period), ...(chosen.dev_tool ? { devTool: true } : {}), ...(freeLogo ? { logo: { ...freeLogo, kind: 'logo' as const } } : {}) },
  ];
  const backdrop = await nextBackdrop(deps.db, 'free_vs_paid', deps.setId);
  return {
    ok: true,
    payload: { pair: { ...chosen }, devTool: chosen.dev_tool, check, log },
    frames: toFrames(data, backdrop),
    candidates,
    historyKeys: [pairKey(chosen)],
  };
}
