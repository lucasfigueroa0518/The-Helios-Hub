/**
 * Performance feature flags (Sub-10ms playbook rule 5: every change sits behind a flag).
 * Each is on by default. Rollback is one Vercel env var set to "0" plus a redeploy; the
 * old code path stays in place behind each check. Decision records: perf/DECISIONS.md.
 * NEXT_PUBLIC_* values are inlined at build time, so each flag reads its variable directly.
 */

/** INV-NAV: sidebar links show a pending state on the next frame and ignore repeat clicks. */
export const PERF_NAV_ACK = process.env.NEXT_PUBLIC_PERF_NAV_ACK !== '0';

/**
 * INV-QUEUE: off-screen send-queue cards skip style, layout and paint (content-visibility).
 * The board holds ~5k cards in 22 day columns with ~5 on screen, so every frame on
 * /hub/queue re-laid them all out.
 */
export const PERF_QUEUE_CV = process.env.NEXT_PUBLIC_PERF_QUEUE_CV !== '0';
