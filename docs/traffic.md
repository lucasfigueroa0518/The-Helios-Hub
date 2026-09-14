# Traffic → Vercel Web Analytics

Helios live-queries Vercel Web Analytics for the marketing site and renders
it on **Traffic** (`/traffic`) under **Website Hub**. This is not a warehouse:
there is no Postgres schema and no GCP worker job.

The Hub app and `heliosmarketingwebsite` are different Vercel projects. A
team-scoped access token can query the marketing project by `projectId`.

## Credentials

Create a token at [vercel.com/account/tokens](https://vercel.com/account/tokens)
on the Helios team that owns `heliosmarketingwebsite`. Then set these on **Hub**
Vercel Production and in `.env.local` (not on the GCP worker):

```
VERCEL_ANALYTICS_TOKEN=
VERCEL_ANALYTICS_TEAM_ID=       # Helios team id (team_…)
VERCEL_ANALYTICS_PROJECT_ID=    # heliosmarketingwebsite project id (prj_…)
```

Do **not** use `VERCEL_PROJECT_ID` or `VERCEL_ORG_ID` for this. Vercel
reserves those names for the Hub deployment itself, so production would
query `the-helios-hub` analytics instead of the marketing site.

Local `.env.local` may still fall back to `VERCEL_TOKEN` / `VERCEL_ORG_ID` /
`VERCEL_PROJECT_ID` because those system vars are not injected by `next
dev`. On Vercel, only the `VERCEL_ANALYTICS_*` keys are read.

Find the marketing-site ids in that project's Settings → General (not the
Hub project's).

## What the API can return

`GET /v1/query/web-analytics/visits/aggregate` matches the dashboard for:

- Visitors and page views (totals + daily series)
- Environment (`production` / `preview` / all)
- Pages (`requestPath`), routes (`route`)
- Referrers (`referrerHostname`)
- UTM (`utmSource` / `utmMedium` / `utmCampaign`) — Web Analytics Plus
- Country, device, browser, OS

Hub adds period-over-period deltas by querying the previous window of the
same length.

## Gaps (do not fake)

- **Bounce rate** is dashboard-only. Traffic shows **Pages / visitor** instead.
- **Hostnames** cannot be grouped or filtered on the public API.
- **Daily queries are capped at 62 days** by Vercel (`by=day`). Traffic
  presets and custom ranges never exceed that. Period-over-period deltas
  still issue a second query of the same length immediately before.
- Aggregate queries only cover the plan reporting window (12 months on Pro,
  24 months with Web Analytics Plus), but a single daily query cannot span
  more than 62 days.

## Route

Session-gated `GET /api/traffic/summary` fans out the Vercel calls in
parallel and caches the payload for 60 seconds.

Query params: `period` (`24h`|`7d`|`28d`|`62d`|`custom`), `from`/`to`,
`environment` (`production` default), `filters` (JSON array of
`{ dimension, value }` for click-to-filter).
