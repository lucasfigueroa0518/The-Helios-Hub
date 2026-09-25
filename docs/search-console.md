# Search Console → SEO Hub

Helios warehouses Google Search Console performance data in Postgres and
renders it on **SEO Performance** (`/seo`). Properties are never added or
removed in the Hub — verify them in Search Console, then add the service
account as a **Full** user.

## Credentials (existing path)

Do not create a second OAuth client. The worker already documents:

```
GSC_IMPERSONATE_SERVICE_ACCOUNT=helios-gsc-sync@helios-influencer-network.iam.gserviceaccount.com
```

Auth resolution in `lib/seo/gsc-client.ts`:

1. `GSC_SERVICE_ACCOUNT_JSON` — raw service-account JSON (Vercel / local writes)
2. The GCE metadata server at 169.254.169.254. Asked by IP, retried, and
   reused until the token is near expiry. A miss is not treated as "not on
   GCE".
3. `GOOGLE_APPLICATION_CREDENTIALS` or Application Default Credentials, only
   when that file exists on the machine. The worker does not have one.

When `GSC_IMPERSONATE_SERVICE_ACCOUNT` is set, the token from step 2 or 3
impersonates that email.

Scope: `https://www.googleapis.com/auth/webmasters` (read + sitemap write).

Enable **Search Console API** on the GCP project that owns the SA. The VM
service account needs `roles/iam.serviceAccountTokenCreator` on
`helios-gsc-sync` if it impersonates that identity.

## One-time Search Console steps

1. Verify the property in Search Console (e.g. `sc-domain:heliosgroup.ai`).
2. Settings → Users and permissions → add
   `helios-gsc-sync@helios-influencer-network.iam.gserviceaccount.com` with **Full**.
3. Repeat for every property you want in the Hub picker.

## Worker

Daily job `seo.gsc_daily_sync` is enqueued after 09:00 UTC by
`system.reconcile`. After shipping handler code:

```bash
./scripts/gcp/deploy-worker-code.sh
```

Manual first pull (do not wait for 09:00 UTC):

```
POST /api/seo/sync
```

Expect a 2–3 day lag versus “today”. Google only retains 16 months; our
tables keep history after that.
