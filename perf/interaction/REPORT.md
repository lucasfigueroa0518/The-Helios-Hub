# Interaction latency pass (Sub-10ms playbook, loop 1), 2026-11-24

Branch `perf/interaction-latency` (worktree `Helios-Hub-inp`), off main a5a0ff58. Nothing pushed or deployed.
System map: see `perf/STACK.md` (unchanged).

## How it was measured
- `perf/interaction/harness.mjs`: Playwright with real pointer input (move, 120 ms hover, down, 60 ms, up) at 4× CPU
  throttle (low tier). It records M1 (main-thread work), M2 (first visible change), M3 (content settled), long frames
  (LoAF) and Event Timing for every visible in-app control on 35 routes, with up to 15 controls per route and 2 runs each, plus a double-click pass.
- Every non-GET request and every off-localhost request is answered 503 after an 800 ms hold, so clicks write nothing and spend nothing.
- The test stack is a production build with a local Postgres 16 behind a latency proxy (2.5 ms each way) and ~598k seeded rows.
- **Env gotcha:** `perf/env.sh` defaults to port 54329, which on this Mac is the Explainers embedded PG. Run with
  `PERF_PG_PORT=54339` (the perf cluster lives in `.local/`). A run against the wrong DB shows an empty queue board and RSC errors.
- `analyze.mjs` turns samples into the ledger. Class is inferred: B nav, D/F writes, C select, A local. Budgets at
  p95: M1 ≤ 10 ms and M2 ≤ 27 ms; class A also needs M3 ≤ 27 ms.

## Results (low tier, 523 interactions, same sweep both times)
| | Baseline | After |
|---|---|---|
| Interactions in budget | 191 | **338** |
| M2 p95, all clicks | 191.5 ms | **33.9 ms** |
| M2 median, nav clicks (280) | 63.1 ms | **7.1 ms** |
| M1 p95, all clicks | 16.2 ms | 20.2 ms (see Regressions) |
| Duplicate writes on double-click | 6 flagged | **0** (the 6 were a harness artifact; every control guards) |
| Page errors | 0 | 0 |

Ledgers: `LEDGER-baseline.csv` and `INTERACTION_LEDGER.csv` (after), ranked by pain score.

## Changes (both flags are on by default; set the env var to `0` and redeploy to roll back)
1. **NAV_ACK** (`NEXT_PUBLIC_PERF_NAV_ACK`), in `components/hub-shell/warm-link.tsx` and `app/hub-shell.css`.
   - **Problem:** a sidebar click waited for the full RSC prefetch before anything changed on screen, which took 200–500 ms.
   - **Fix:** the link gets a `data-pending` attribute on the next frame. It reuses the existing active style (no new
     visuals) with `cursor: progress`. Repeat clicks while pending are ignored, so there is no second push. The
     attribute clears on pathname change, with a 12 s safety clear.
2. **QUEUE_CV** (`NEXT_PUBLIC_PERF_QUEUE_CV`), in `app/hub/send-queue-hub.tsx` and `app/components.css`.
   - **Problem:** the queue board has ~36.5k DOM nodes (about 5k cards in 22 day columns, ~5 on screen), which costs 80–100 ms on every frame.
   - **Fix:** cards get `content-visibility: auto` with `contain-intrinsic-size: auto 133px` (the median card height).
   - **A/B result** on the same build, with `--no-cv` forcing cards visible, 5 runs per control:

     | Control | CV off | CV on |
     |---|---|---|
     | Filter selects, M1 p95 | 305–346 ms | 95–203 ms |
     | Sidebar nav from the queue, M1 p95 | 87–120 ms | 48–67 ms |
     | Collapse sidebar, M1 p95 | 148 ms | 105 ms |
     | Tab switches away from the board, M1 p95 | 10–57 ms | 58–99 ms (worse) |

## Regressions / open
- **Queue tab switches** (Inboxes, Campaigns, Conversations, Analytics) are slower with QUEUE_CV. This is likely the cost of
  tearing down ~5k contained cards. Net effect is still positive, so the flag stays on. The real fix is virtualizing or
  paginating the board (below).
- The overall M1 p95 rose from 16 to 20 ms. The rise sits on the queue tabs above plus nav commit frames, and the latter vary from run to run
  (the React commit `3284-*.js:w` takes 50–140 ms either way).

## Deferred (not done this loop)
- **Queue board virtualization or windowing:** the root cause behind both queue rows above. It is a product-visible change, so it is your call.
- **Route-commit long frames** (50–140 ms React commit on every navigation at 4× CPU): split heavy client trees or defer below-fold sections.
- **`/social/analytics` "All" button** (M2 357 ms) and the **`/explainers` "Ideas" tab** (M2 249 ms): show feedback state instantly. Next loop's top items.
- **Trello** (M3 ~1.4 s): the known 15.8 MB document.
- **Field RUM**: web-vitals INP attribution. It needs a new dependency, and package.json is pinned by a test. After that come CI budgets and synthetic monitoring.
- **Native `<select>`**: the popup inflates input delay in the lab, so treat those M1 numbers as an upper bound.

## Re-run
```
cd Helios-Hub-inp && export PERF_PG_PORT=54339 && source perf/env.sh
node perf/interaction/harness.mjs --out after-low --max 15 --runs 2 --double
node perf/interaction/analyze.mjs perf/runs/interaction/after-low --top 25
```
