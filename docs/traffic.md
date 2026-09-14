# Traffic → Vercel Web Analytics

Helios live-queries Vercel Web Analytics for the marketing site and renders
it on **Traffic** (`/traffic`) under **Website Hub**. This is not a warehouse:
there is no Postgres schema and no GCP worker job.

The Hub app and `heliosmarketingwebsite` are different Vercel projects. A
team-scoped access token can query the marketing project by `projectId`.

## Credentials

Create a token at [vercel.com/account/tokens](https://vercel.com/account/tokens)
on the Helios team that owns `heliosmarketingwebsite`. Then set, on **Hub**
Vercel Production and in `.env.local` (not on the GCP worker):

```
VERCEL_TOKEN=
VERCEL_ORG_ID=          # Helios team id (team_…)
VERCEL_PROJECT_ID=      # heliosmarketingwebsite project id (prj_…)
```

`VERCEL_ORG_ID` is the team id, not a personal account id. Find both ids in
the Vercel project Settings → General.

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
- Aggregate queries only cover the plan reporting window (12 months on Pro,
  24 months with Web Analytics Plus).

## Route

Session-gated `GET /api/traffic/summary` fans out the Vercel calls in
parallel and caches the payload for 60 seconds.

Query params: `period` (`24h`|`7d`|`28d`|`3m`|`custom`), `from`/`to`,
`environment` (`production` default), `filters` (JSON array of
`{ dimension, value }` for click-to-filter).
