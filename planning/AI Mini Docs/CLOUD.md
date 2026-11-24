# Working on Reel AI Drama in a cloud session (2026-10-29)

## One-time, by Lucas (secrets never go in the repo)
In the cloud environment's settings, add these environment variables, and give the environment
**full network access** (HeyGen, Serper, Wikimedia, news sites, GitHub, npm, HyperFrames' Chrome download):

| Variable | Used for |
|---|---|
| `HELIOS_ANTHROPIC_API_KEY` | the app's Claude calls (named so it doesn't clash with Claude Code's own `ANTHROPIC_*`) |
| `HEYGEN_API_KEY` | the narration voice |
| `SERPER_API_KEY` | image search in the harvest |
| `OPENAI_API_KEY` | MD-14 traced sketches |
| `TYPESAFE_API_KEY` | Jev scores |

## First thing the cloud session runs
`bash scripts/cloud-setup.sh`. It installs ffmpeg, yt-dlp, Postgres (and Real-ESRGAN when it can), runs
`npm ci`, loads the database snapshot from `db/cloud-seed/` (the whole `reel_ai_drama` schema plus the
Explainers settings, which hold the HeyGen voice id), and writes `.env.local` from the variables above.

## What did not travel
- `.explainers-local/` (25 GB of job folders, renders, media). The two delivered reels stay on the Mac.
  A new live run recreates everything it needs.
- The other schemas (`public`, `social_hub`, `explainers2`, `real_case`): Reel AI Drama doesn't read them.
- Real-ESRGAN needs a Vulkan GPU; without one the harvest keeps the original image and flags it (fail open).

## Rules that still hold
- Live runs only with Lucas's in-the-moment go-ahead and a cap; tests never call live APIs.
- Run live with `env -u ANTHROPIC_API_KEY -u ANTHROPIC_BASE_URL -u ANTHROPIC_AUTH_TOKEN` so the app uses `.env.local`.
- The cloud database is a copy. Pitches/jobs made in the cloud don't reach the Mac's database
  (bring them back with `pg_dump -n reel_ai_drama` if Lucas wants them).
- Commit only to `reels-iterations`, never to main, and no deploys.
