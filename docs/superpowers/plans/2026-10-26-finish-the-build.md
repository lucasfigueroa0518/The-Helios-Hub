# Finishing the idea pool build (2026-10-26)

Where it stands: the pool standard (pin, drag, archive, cap 30, always-generatable) is built for Explainers, Text on Screen, Carousels and Stories; seeding is built for Explainers, Stories and Carousels; main is merged in (0 behind, 20 ahead). Nothing is pushed or deployed.

## Steps

| # | Step | Who | State |
|---|---|---|---|
| 1 | Merge main in, resolve the two Explainers conflicts, keep Lucas's retry gate and transient-cap rule, keep old Demote rows working | me | Done (`ae1c2ce2`) |
| 2 | Full test suite on the merged tree | me | Running |
| 3 | Independent code review of the whole pool standard diff (read-only) | subagent | Dispatched |
| 4 | Text on Screen seeding: design pass (read-only, writes one spec) | subagent | Dispatched |
| 5 | Last Few Days queue and seeding: design pass (read-only, writes one spec) | subagent | Dispatched |
| 6 | Fix what the review finds | me | After 3 |
| 7 | Tommy decides the open questions in the two design specs | Tommy | After 4, 5 |
| 8 | Build Text on Screen seeding and the LFD work from the approved specs | me / subagents | After 7 |
| 9 | Coordinate with the calendar session: one push, then apply its schema (new columns) | Tommy + me | Before 10 |
| 10 | Push `unify-social-hub` (not main) | me, on Tommy's word | After 2, 6, 9 |
| 11 | Deploy the two worker VMs (gcloud login is fresh; main's per-deploy file names remove the /tmp clash) | me, on Tommy's word | After 10 |
| 12 | Tommy clicks through on the live pages: pin, drag, archive, seed, Generate on an Explainers idea that used to error; then check the first night's run | Tommy | After 11 |

## Not changing

Last Few Days stays on Promote/Demote until step 8. Stories' Regenerate keeps its slot (R28) unless Tommy says otherwise.
