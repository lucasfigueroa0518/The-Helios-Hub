# Network and delivery (Phase 5)

What was checked locally against the production build (`next start`), and what Vercel does in front of it. No config changes were needed for headers. Two items need someone with account access (DECISIONS D1, D6).

| Playbook item | State | Evidence / action |
|---|---|---|
| Brotli (gzip fallback) for HTML, JS, CSS, JSON | **On at the Vercel edge** (Brotli for every text type, JSON included). | Under `next start`, pages and static assets are gzipped, but **route-handler JSON is not compressed** (`/api/send-queue` sends 9.4 MB raw). On Vercel this costs nothing. If the app is ever self-hosted, put a compressing proxy (Caddy or nginx with Brotli) in front. Local Lighthouse numbers for pages that fetch JSON client-side (`/hub/*`) are pessimistic for the same reason. |
| `immutable` on content-hashed assets | **Done by Next.** | `/_next/static/**` (JS, CSS, fonts): `Cache-Control: public, max-age=31536000, immutable`. |
| Short or revalidating cache on HTML | **Correct as is.** | Every page is per-user and dynamic: `private, no-cache, no-store, max-age=0, must-revalidate`. Files in `/public` are `public, max-age=0` with an ETag (revalidated, correct for unhashed URLs). The one duplicate `/public` font download was removed in this branch (dashboards). |
| HTTP/2 or HTTP/3 at the edge | **Vercel serves HTTP/2 and HTTP/3** to clients. | No action. |
| `preconnect` for required third-party origins | **None added.** | Fonts are self-hosted (`next/font`), and there are no third-party scripts. The only third-party origin on page load is Supabase Storage, for signed story-frame and photo URLs on Social Hub pages. A `preconnect` to `NEXT_PUBLIC_SUPABASE_URL` would likely save one connection setup on those pages, but it can't be measured here (no Supabase in this environment), so it wasn't added (playbook: measure first). The way to test it: add `<link rel="preconnect" href={process.env.NEXT_PUBLIC_SUPABASE_URL} crossOrigin="">` in `app/social/(hub)/layout.tsx` on a preview deploy and compare Lighthouse LCP on `/social`. |
| CDN setup and target region | **Vercel Edge Network** (implicit; no `vercel.json`). Workers run in GCP `us-west1-a`. The Supabase region is not in the repo. | **DECISIONS D1**: the Vercel function region must match the Supabase region. Every route here makes 1–89 queries, and cross-region adds 50–150 ms to each. |
| API, app and DB in the same region | Unknown from here. | DECISIONS D1. Also D6 (Postgres JIT), which was the largest single cost in the slowest queries locally. |

## Response sizes worth knowing about

| Response | Size (synthetic data) | Note |
|---|---|---|
| `/trello` HTML | 15.8 MB | The whole workspace as RSC props (REPORT: over budget, with a plan). |
| `/api/send-queue` JSON | 9.4 MB | About 8 300 queue items. The synthetic seed fills optional text columns, so production rows are smaller. Compressed at the edge. |
| `/social/content/library/music` HTML | 1.9 MB | 800 rows, each with a native audio player. |
