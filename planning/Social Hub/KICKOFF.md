# Kickoff prompt (paste into Claude Code at the repo root)

Build **Phase 1** of the Social Hub, autonomously.

Read, in order: `CLAUDE.md`, `planning/Social Hub/BUILD_PLAN.md` (§S first), `planning/Social Hub/PRODUCT_SPEC.md`, `docs/social-overnight.md`.

**§S Scope confinement overrides everything.** You are a UI/UX and wiring agent: build screens over data that already exists, SELECT-only reads from other schemas, one new `social_hub` schema written but not applied, and action buttons wired only to existing exported functions behind flags that default off. Edit only the allowed paths in §S3. Do not change any pipeline's behavior, settings, workers, dependencies or other schemas; do not refactor existing code; no git, no deletions, no live calls of any kind. Before your first change, write the scope baseline (§S4) and check it at every gate. If the right fix is outside scope, log it in `OUT_OF_SCOPE.md` and degrade the UI gracefully (§S6) — never work around it.

Run P1-M0 through P1-M7 in order (§B). Do not do any Phase 2 work. Every gate is your own verification loop (§A1): scope guard, tests, typecheck, build, Playwright screenshots at 1440 and 390 px, independent subagent critique, max 3 fix loops. Decide unclear points by §A2 and log them in `DECISIONS_LOG.md`; never stop to ask me anything. Keep `BUILD_LOG.md` current; finish with `BUILD_REPORT.md`.
