/**
 * Generate for one idea, as the page is handed it (idea pool standard, 2026-10-21). The page's read code makes no network
 * call of its own: a type that can generate one idea by itself passes this function in (Explainers: ExplainersHub).
 * It answers `ask: 'over_cap'` when a daily cap is hit: the person can confirm one render over it, and that click is the
 * authorization.
 */
export type GenerateOutcome = { ok: true } | { ok: false; ask: 'over_cap'; message: string; costUsd: number } | { ok: false; ask?: undefined; message: string };

export type GenerateIdea = (ideaId: string, overrideCaps: boolean) => Promise<GenerateOutcome>;
