# Morning plan — Wed Oct 14, 2026

Written ~1:40 AM ET from the six open chats, git, and the plan ledgers.

## What's running tonight

**One chat is still working:** [Content page planning and design].
- It's building **Task 3 of 9** of the Content page Phase B plan (Approve on an explainer books today's posting window).
- It works in its own worktree, `.worktrees/content-page-phase-b`, on the `content-page-phase-b` branch. It doesn't push or deploy, and the overnight run doesn't see this code.
- Tasks 1 and 2 are committed (`d85ad26`, `f456265`). Task 3's changes are in the worktree but not committed yet.
- It will probably finish Task 3 and then stop to ask you before Task 4.

**Correction (checked on the VM at 10:10 AM):** the social worker VM **was** redeployed at **12:39 AM ET**, most likely by the archived "Carousel generation article ordering bug" chat. All five units restarted then. The deployed code matches the branch from just before LFD Task 1 (`73b04fe`):
- **Live:** carousel scoring `@4`.
- **Not live:** the weights rebalance (`4637ac5`), LFD, the photo size floors, Content page Phase B.

The orchestration VM (`helios-orch-worker`) was last restarted Oct 12, 8:44 PM ET.

## What stopped tonight and is waiting on you

| Chat | Waiting on |
|---|---|
| **Last Few Days content type** | Plan 2 has **Tasks 1–3 of 13 done**. Task 4 (publishing) was in progress. `lib/lfd/publish.ts`, `lib/lfd/items.ts` and `tests/lfd-publish.test.ts` are uncommitted, with no review yet. The chat is idle, so tell it to pick Task 4 back up. |
| **Cost analytics, photo finder, run reliability** | A **yes on the photo rules**: the size floors, uncommitted in `lib/social/photos/*`, `stories/photos.ts` and `morning-download.ts`. Its Stories test run was killed by a timeout (exit 144) while 3+ chats were testing at once. Re-run it before committing. |
| **Social hub cost analytics page** | Your **go on two database changes plus a worker deploy**. Until they're applied, cost pages and IG Stories "Generate" error locally against real data. Also, pick the **auto-publish bar** (it suggests 95% / 20 decisions). |
| **Photo bank storage for carousels** | It offered to run the full test suite and read the `lib/social/overnight/publish.ts` diff (~130 lines, the **carousel posting path**) before you commit. You didn't answer, so `@4` didn't go live tonight. |
| **Organizing multiple chats** | Whether to delete the empty Misc group. Low priority. |

## State of the code (the main checkout, `unify-social-hub`)

- **12 commits ahead of GitHub, not pushed:** the LFD Tasks 1–3, health scoreboard and alerts, `@4` weights, readiness rings, Free vs. Paid known tools.
- **Uncommitted work from three chats mixed in one tree:**
  - photo floors,
  - LFD Task 4,
  - `overnight/publish.ts` (shared by LFD Task 4 and the carousel posting path).

  Commit each chat's work separately so the history stays readable.
- `tsc` is clean apart from the known `seo-gsc-auth` test errors. The `lib/lfd/publish.ts` errors from earlier tonight are gone.
- One known flaky test: an explainers test fails when all of them run together and passes alone. It looks like a missing local Python setup (`explainers-render`) and needs a quick confirmation.

## Tomorrow, in order

1. **Read the 5:30 AM overnight check and the scoreboard** (`scripts/overnight_scoreboard.ts`). See what last night made and what failed on the old code.
2. **Approve what's due before the windows close.** Stories must be approved by **10 AM**, or the set is never scheduled.
3. **Untangle the working tree**, one chat at a time, in this order:
   1. **Photo chat:** say yes or no to the photo rules. If yes, re-run its tests alone and commit only its files.
   2. **LFD chat:** finish Task 4, review it, and commit (it owns `lfd/*` and its part of `overnight/publish.ts`).
   3. **Photo-bank chat:** let it run the full suite and read the final `overnight/publish.ts` diff, since that's the carousel posting path.
4. **Decide the database changes** in the cost-analytics chat. Apply them in the **daytime**.
5. **One daytime deploy** of the VM workers with everything above (`@4`, photo floors, cost DB, LFD through Task 4). It must not run between 12:30 and 5 AM. **Push** the branch afterwards.
6. **Content page Phase B:** continue with Tasks 4–8 in the worktree. Task 9 is a deploy list for you, not something the agents execute.
7. **LFD Plan 2:** Tasks 5–13. Task 8 is a stop for the worker redeploy.

## Decisions only you can make

- Photo rules: yes or no.
- The two cost database changes plus the deploy: go or no go.
- Auto-publish bar (95% / 20 decisions suggested).
- From the reliability plan: where alerts go (email, Slack, push, or the hub banner), the approval policy (#9), and the Free vs. Paid daytime test budget (about $1–2, Rule 1).
- LFD: whether posts are capped at 5 stories (you said "keep it at 5"; the chat read that as allowing 6 when enough stories survive).
