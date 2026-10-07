# Vendored HyperFrames skills

Source: https://github.com/heygen-com/hyperframes, directory `skills/`
Pinned commit: `5c7f6316d3646477a0f725176c00335cb8575560` (release v0.8.140, 2026-10-07)
License: Apache License 2.0 (`LICENSE`, copied unchanged). Third-party credits: `CREDITS.md`.

Skills copied unchanged: faceless-explainer, hyperframes, hyperframes-creative,
hyperframes-animation, hyperframes-core, hyperframes-cli, hyperframes-audio, media-use.
The rest of upstream `skills/` is not used by the faceless-explainer workflow and is not copied.

Rules (planning/Explainer Reels/BUILD_PLAN.md §5):
- Never run `hyperframes skills update`, never let `hyperframes init` refresh skills, and never
  accept an update prompt. These files change only by re-vendoring a new pinned commit.
- Do not edit files here. Helios behavior lives in `explainers/helios-preset/`,
  `explainers/recipe/`, and `explainers/director/`.
- The matching CLI is the npm package `hyperframes@0.8.140`, pinned in `explainers/runtime/`.
