# 04 — Media sourcing: pre-scout and harvest (research)

Research for AI Mini Docs, parts 2 (media pre-scout) and 4 (media harvest) of `../PLAN.md`.
Written 2026-10-28. Nothing here is built or decided; it is input for the build plan.

**Rights rule (Lucas, 2026-10-28):** "Any photos that we can ingest without a watermark are fair game."
A watermark is a reject; the licence type is not a filter; every item still records its source and credit.
**No AI-generated images**, which means the harvest must also reject AI art it finds in the wild (§4.3).

Status notes are "checked 2026-10-28" unless dated otherwise. "(unverified)" means I could not confirm it
from an official page or a live test today.

---

## 0. Summary

- **The free, open signals are strong enough to run the pre-scout at about $0.003 per idea (worst case about $0.02)**, far
  under the $0.35 target: Wikidata/Commons counts, GDELT article lists (each with its og:image), the
  discovery articles' own figures, logo/place/ticker lookups, and screenshot targets (posts, filings, repos,
  papers). One optional Haiku 5.5 vision call on a 16-tile contact sheet costs about $0.0005.
- **Live-tested today (free, no key):** Commons structured-data counts, GDELT GKG files, Sentinel-2 via
  Earth Search STAC, Wayback availability, SEC EDGAR full-text search, Hacker News Algolia, iTunes Lookup
  (app screenshots).
- **The biggest gap in the repo is breadth for the harvest.** It has no general image search, no fan-out
  across many news articles, no video frames, no screenshots of posts or documents, and no maps or satellite
  imagery. Based only on the file headers I read, I also found no watermark classifier, perceptual
  deduplication or recency ranking (unverified).
- **What changed in 2025–26:** Bing Image Search is gone (2025-08-11). Google's Custom Search JSON API is
  closed to new customers and shuts down on 2027-01-01. Clearbit Logo shut down in Dec 2025. GDELT's image
  graph (VGKG) has not updated since 2024-12-01. The X API has been pay-per-use since 2026-02-06. Reddit
  needs approval for new apps (Nov 2025). Threads oEmbed has needed no token since 2026-04-21. Wikimedia
  added new API rate limits (Mar–Apr 2026). CourtListener cut its default limits (2026-05-07). yt-dlp now
  wants a JavaScript runtime (Nov 2025). The full list is in §8.
- **Top additions beyond the repo:** Serper Google Images, GDELT (DOC ArtList + GKG), mass og:image and
  figure scraping, YouTube official-video frames, Flickr event albums, Playwright screenshots of real
  embeds with Wayback provenance, MapLibre with OpenFreeMap and Natural Earth maps plus Sentinel-2, and
  the document APIs (EDGAR, CourtListener, arXiv HTML, GitHub).

---

## 1. What the repo already has (headers only)

| Lane | Where | What it does today |
|---|---|---|
| Photo finder | `lib/social/photos/find.ts` + `sources/{wikidata,article,stock,bank}.ts` | Tier-1 kinds: person, company, logo, product, event, thematic, setting. **Person:** Wikidata P18 (identity-verified), then a second photo, then an article photo whose caption names them. **Company:** CEO headshot and HQ (`org-pool.ts`), then official images, then article photos. **Logo:** Wikidata P154. **Product:** official, then article, then Commons search. **Event:** article, then Commons search, then Openverse. **Thematic/setting:** StockSnap lane, then Commons, then Openverse. The results are ranked to 2 candidates. AI calls: Jev identity, the stock pre-screen, the HQ check, and the vision pick (`pick.ts`). |
| Supporting modules | `lib/social/photos/` | `identity.ts`, `faces.ts` (face boxes), `vision.ts`, `credit.ts`, `logo.ts`, `official-domains.ts`, `size.ts`, `used-photos.ts`, `vetted.ts`, `second-photo.ts`, `p18.ts` |
| Photo bank | `lib/media-library/bank.ts` (+ `ingest`, `policy`, `reader`, `store`) | Non-blocking `offer()` of vetted photos into a tagged bank (D49); `policy.ts` has `licenceOf`/`shouldStore`. |
| Object cutouts | `lib/real-case/objects/stock.ts` | Openverse, StockSnap/rawpixel first; **CC0/PD/CC BY only**. That licence filter is stricter than the new Mini Docs rule. |
| Person cutouts | `scripts/real_case_cutout_bank.ts` | Wikidata QID → P18 from Commons → 2160px copy → macOS Vision background removal → Lucas approves. |

Reuse as is: identity, faces, credit, the bank, and the cutout pipeline. Generalise: the article source
(from a few articles to dozens) and the Commons search (add date and depicts filters). The rest is new.

---

## 2. Taxonomy of visuals for a 60-second news documentary

"Findable when" lists the signals the pre-scout can count. Uses refer to the existing kit: Ken Burns,
paper cutouts, board pins, marker markups, newspaper scenes.

### 2.1 People

| Type | Findable when | Best sources (in order) | On-screen use | Integrity notes |
|---|---|---|---|---|
| Headshot (reference) | Person has a QID with P18; on a leadership page; in the cutout bank | Bank → Wikidata P18 → Commons `depicts` → company leadership page → conference speaker page | Cutout on the board, name card, "the players" line-up | It is the reference face for identity checks. Label the year if the photo is old. |
| Candid / interview | Recent interviews or podcasts on YouTube; article photos with captions | Official or interview video frames → article figures → Flickr → Commons | Ken Burns, reaction beat, "who is he" | A frame from a network interview may carry a channel bug, which counts as a watermark (§4.2). |
| On stage / keynote | Event in the window with an official livestream; Flickr albums of conferences | Official keynote frames (YouTube) → event Flickr (Web Summit, TechCrunch, ITU AI for Good …) → article figures → Commons | Wide establishing shot, push-in, cut to the screen behind them | Event date is known, so recency is strong. |
| Group / meeting / hearing witness | Gov or committee video, wire photos in articles | Committee video (US federal works are public domain) → article figures → Commons | Tension beat, "in the room" | Captions must name the person; verify the face against the reference. |

### 2.2 Places

| Type | Findable when | Sources | Use | Notes |
|---|---|---|---|---|
| HQ / campus | Org QID has P159 (HQ) and coordinates; the HQ building has its own QID or a Commons category | Commons (building category) → Wikidata P18 of the HQ item → Mapillary street-level → Serper images → satellite or aerial | Establishing shot, map pin to photo | HQs move (check the address date). Street-level photos need a credit. |
| City / region | Always (Wikidata P18 of the city, Commons) | Commons → Wikidata → Unsplash/Pexels (real places, generic) | Location card, "meanwhile in …" | Stock city photos are real but generic; say so in the inventory. |
| Venue | Event page names the venue; venue QID | Commons → venue site → article figures | Opening of an event beat | |
| Physical site (data center, fab, plant) | Coordinates from news, permits or OSM | Sentinel-2 (recent, 10 m) → NAIP (US, ~0.6 m, older) → Commons and press aerials → Overpass footprint on a map | Before/after, scale reveal, zoom from orbit | Satellite capture dates must be shown. Sentinel-2 revisits every few days, so it is very recent. |

### 2.3 Events

| Type | Findable when | Sources | Use | Notes |
|---|---|---|---|---|
| Launch / keynote / demo | Official blog post, livestream, press kit | Newsroom or press-kit images → official video frames → article figures → Flickr → Commons | The "moment" beat | Official renders of products are fine; AI-generated marketing art is not (§4.3). |
| Hearing / regulatory moment | Committee schedule, Federal Register, gov video | Committee or congress video frames → official photos → article figures | Stakes beat, quote card next to the face | C-SPAN video carries a bug, so prefer committee or House/Senate feeds (unverified per committee). |
| Protest / strike / incident | GDELT spike, Reddit or X posts with photos | Article figures → Commons (quick uploads) → Flickr (`min_taken_date`) → post embeds | Conflict beat | Higher risk of misattributed or old photos: run a date check and a reverse search. |
| Deal / lawsuit / filing | EDGAR, CourtListener, press release | Document page plus people and logos | Paper cutouts, highlighted lines | See documents. |

### 2.4 Products and UI, logos

| Type | Findable when | Sources | Use | Notes |
|---|---|---|---|---|
| Product photo / render | Press kit, newsroom, product page | Official → article figures → Commons | Hero object, cutout | |
| App / website UI | Product URL, App Store listing | Playwright live capture → App Store `screenshotUrls` (iTunes Lookup) → official demo video frames | Phone mock-up, scroll, markup | Capture at DPR 2–3 for crisp text. Log the capture time. |
| Logo / wordmark | Org QID has P154; official brand page; Simple Icons | Bank → Wikidata P154 (SVG) → official brand kit → Simple Icons / SVGL → logo.dev | Logo card, pins, chyron | Prefer SVG. Use the logo that was current at the time of the story. |

### 2.5 Maps

| Type | Sources | Use | Notes |
|---|---|---|---|
| Street / city map | MapLibre rendered headless with OpenFreeMap or Protomaps (self-hosted PMTiles) | Pin drop, zoom, route draw | Render it ourselves rather than hitting OSM's tile server (§3 F). |
| Region / country | Natural Earth (public domain) + D3, or MapLibre | "Across the Atlantic", country fills | No tiles needed. |
| Satellite | Sentinel-2 (Earth Search STAC), NAIP, NASA GIBS (coarse) | Orbit-to-site zoom, before/after | Esri and Google Earth have restrictive terms (§3 G). |
| Route / flow | OSRM or GraphHopper route geometry, or hand-drawn arcs in code | Supply chains, chip shipments | Code-built from real coordinates. |

### 2.6 Screens, posts, documents, data

| Type | Findable when | Sources | Use | Notes |
|---|---|---|---|---|
| Official announcement page / blog | URL on the official domain (P856) appears in the articles | Playwright + Wayback snapshot | Full screen scroll, marker underline | Archive at capture time (provenance). |
| Website "before / after" | Wayback CDX has snapshots | Wayback CDX → render the archived page | Timeline device ("on Sept 1 the page said …") | Wayback banner: crop the toolbar or use the `id_` raw mode (unverified that raw mode renders cleanly). |
| X / Threads / Bluesky / LinkedIn posts | Post URLs inside articles; handles from Wikidata P2002 / P11892 / P12361 / P6634 | Render the real oEmbed or embed in Playwright | Post card, pull quote, reply pile-up | Never mock a post with invented text. Record the metrics with the capture time. |
| Reddit thread / HN thread | HN Algolia search; Reddit (if access) | Screenshot of the real page or embed | "The internet reacts" | HN is fully open; Reddit's API needs approval now. |
| SEC filing | EDGAR full-text search hit | EDGAR HTML/PDF → page render → highlight | Paper cutout, red circle on a number | Text coordinates from PDF/HTML allow exact markups. |
| Court record | CourtListener / RECAP; DocumentCloud | PDF page render | Stamped complaint, quote highlight | RECAP holds only what someone already bought from PACER. |
| Patent / trademark | Google Patents, USPTO | Drawing sheets, filing page | "They filed this in March" | US patent drawings are widely reproduced (licence varies; fine under the rule). |
| Government release | Federal Register API, agency press pages, congress.gov | Page or PDF render | Seal plus quote | US federal works are public domain. |
| Stock price chart | Ticker from Wikidata P249/P414 | Stooq / Alpha Vantage / yfinance data → code-built chart | Line draws on, drop marker | Code-built from data, so there are no image rights. Cite the data source. |
| Other public-data chart | Epoch AI, OWID, FRED, EIA | Data → code-built chart | Scale beats | |
| GitHub repo / commit / PR | Repo URL in articles; Wikidata P2037 | GitHub API + page screenshot; star-history | "The commit that started it" | Contributor avatars are people: verify before naming anyone. |
| Research paper / figure | arXiv ID in the articles | arXiv abstract screenshot; figures from arXiv HTML or the e-print source; pdffigures2 | Figure cutout, highlighted abstract line | Use the real figure, never redrawn data. |
| Model page / leaderboard | Hugging Face, LMArena | Screenshot | Ranking beat | Date-stamp it; leaderboards change daily. |
| Investor deck / earnings slide | IR site PDF | PDF page render | Number highlight | |

### 2.7 Press, video, archive, other

| Type | Sources | Use | Notes |
|---|---|---|---|
| Headlines | Article header screenshot (Playwright) + Wayback; GDELT for the list | Headline montage, newspaper kit filled with **real** headlines | Show outlet and date; never invent a headline. |
| Newspaper front pages | Freedom Forum Today's Front Pages (terms unverified), kiosko.net, frontpages.com | Front-page wall | Check for watermarks; many sites overlay their own branding. |
| Official video frames | YouTube official channels (Wikidata P2397), newsroom MP4s | Stage, demo, the CEO's face during a keynote | Sample at shot boundaries; reject channel bugs. |
| TV news frames | Internet Archive TV News Archive, network YouTube | — | Almost always carry a network bug, so treat them as watermarked. |
| Archival / historical | Commons, Library of Congress API, Internet Archive, NASA Image Library, Smithsonian Open Access (CC0), Europeana, Computer History Museum | "It started in 1956 …" flashback | Label the year; sepia treatment is allowed, colourising is not. |
| Leaked memo / email / Slack / Discord | The publishing outlet's embed or screenshot | Document beat | Credit the outlet that published it; capture their version. |
| Job posting / careers page | Company careers site, LinkedIn job page | "They're hiring for X" | Wayback the page (postings vanish). |
| Lobbying / political money | Senate LDA API, FEC API, USAspending | Number reveal | Code-built from data. |
| Local permits / council meetings | City or county agendas (PDF), meeting video | Data-center stories | Often the only "site" document. |
| Court sketches | Articles | Courtroom beat | They are artworks; credit the artist. |

---

## 3. Source catalogue

Effort: **S** ≤ ½ day, **M** 1–2 days, **L** 3+ days. "WM risk" is the typical chance that a result is
watermarked.

### A. Open knowledge and CC media

| Source | Serves | Cost | Key | Limits | Recency filter | WM risk | Terms notes | Effort |
|---|---|---|---|---|---|---|---|---|
| **Wikidata** (wbgetentities, SPARQL) | QIDs; P18 image, P154 logo, P8972 icon, P159 HQ, P625 coords, P856 site, P2002 X, P11892 Threads, P12361 Bluesky, P6634/P4264 LinkedIn, P2397 YouTube, P2037 GitHub, P249/P414 ticker; P8592 aerial, P5775 interior, P3451 night views (IDs verified 2026-10-28) | Free | No (compliant User-Agent) | New 2026 limits: anon < UA-identified < OAuth bots (enforced Mar–Apr 2026) | None (entity data) | None | CC0 data; images follow Commons | S (exists) |
| **Wikimedia Commons** API | Files; `haswbstatement:P180=Q…` (depicts), categories, `extmetadata` (Artist, Credit, LicenseShortName, DateTimeOriginal) | Free | No | Same as Wikidata | Search sort `create_timestamp_desc` (upload date). Taken date comes from `extmetadata.DateTimeOriginal`. Tested: upload ≠ taken ("Dario Amodei in 2023" uploaded 2026-09-16) | Very low | Licence per file; credit the author | S (exists, add depicts and date) |
| **Openverse** | Aggregated CC images (Flickr, StockSnap, rawpixel, museums …) | Free | Optional (registration raises limits) | Tiered anon vs registered; numbers unverified | No date filter (unverified) | Low | Licence per item | S (exists) |
| **Flickr API** | `flickr.photos.search` with `text`, `min_taken_date`, `min_upload_date`, `license`, `extras=url_o,url_k,date_taken,owner_name,geo` | Free non-commercial; commercial use needs an approved commercial key (Flickr terms) | Yes | ~3,600 queries/hr (secondary sources) | **Yes**, by taken or upload date | Low (some photographers watermark) | A 2025 blog claims only Pro accounts can create keys (unverified) | M |
| Event Flickr accounts (Web Summit, TechCrunch, ITU AI for Good, WEF, European Parliament, White House) | Hi-res stage photos of AI leaders | Free | Via Flickr API | — | Yes | Very low | Many are CC BY / CC BY-NC-SA (unverified per account in 2026) | S once Flickr is in |
| NASA Image & Video Library (`images-api.nasa.gov`) | Archival tech and space photos | Free | No | — | Year filter | None | Mostly public domain | S |
| Library of Congress JSON API, Internet Archive advancedsearch, Smithsonian Open Access (CC0; api.data.gov key), Europeana (free key) | Archival / historical | Free | Some | Modest (unverified) | Date facets | Low | Rights statements per item | M (one adapter each) |

### B. Stock (thematic / b-roll only; rarely news)

| Source | Serves | Cost | Key | Limits | Recency | WM risk | Terms | Effort |
|---|---|---|---|---|---|---|---|---|
| Unsplash API | Generic photos | Free | Yes | 50 req/hr demo, 1,000/hr approved (help.unsplash.com) | Sort by latest | None | Wants hotlinking and a download-event ping; attribution | S |
| Pexels API | Photos and video b-roll | Free | Yes | 200/hr, 20,000/month (raisable free) | No | None | Attribution requested | S |
| Pixabay API | Photos, video, vectors | Free | Yes | 100 req / 60 s; **must cache results 24 h**; no permanent hotlinking; 1280px max unless granted full access (official docs, checked) | Sort `latest` | None | Can't redistribute as a stock service | S |

### C. Image and web search APIs (the big gap)

| Source | Serves | Cost | Key | Limits | Recency | WM risk | Terms | Effort |
|---|---|---|---|---|---|---|---|---|
| **Serper.dev** `/images` | Google Images results: `imageUrl`, width/height, source page, domain | 2,500 free queries; packs ~$1.00 → $0.30 per 1k (secondary sources; pricing page behind signup) | Yes | High | `tbs=qdr:d/w/m/y` (Google); custom range `tbs=cdr:1,cd_min:…,cd_max:…` passthrough (unverified on images) | **High** unless filtered: stock sites dominate (block their domains, §4.1) | Scrapes Google; resale terms are Serper's | S |
| SerpAPI (Google Images, **Google Lens**, Google Reverse Image) | Same + **reverse image search** for provenance and the earliest copy | Paid plans (~$15 per 1k on low tiers, unverified); small free tier (unverified) | Yes | Plan-based | `tbs` | High | — | S |
| **Brave Search API** | Web, news, images, video | **$5 per 1k; $5 monthly credit applied automatically; 50 qps**; images included in the Search plan (official page, checked 2026-10-28). The old 2,000-free tier was removed in Feb 2026 (secondary). | Yes | 50 qps | `freshness` on web/news; on images (unverified) | Medium–high | Storing results needs a plan "with storage rights" | S |
| Google Programmable Search JSON API | Web + image search | Existing customers only: 100/day free, $5 per 1k | Yes | 10k/day | `dateRestrict` | High | **Closed to new customers; shuts down 2027-01-01.** New projects get 403 (Jan 2026 reports). **Do not build on it.** | — |
| Bing Image / Visual Search API | — | — | — | — | — | — | **Retired 2025-08-11** (Microsoft Learn). Only "Grounding with Bing" in Azure AI Agents remains, and it returns no image URLs (unverified). | — |
| Tavily (`include_images`) | Image URLs alongside search answers | ~1 credit per basic search (unverified) | Yes | — | `days` / `time_range` (unverified) | Medium | — | S |
| TinEye API | Reverse image: oldest copy, all copies | Paid bundles (unverified) | Yes | — | "Oldest" sort reveals recycled photos | — | — | S |
| Claude `web_search` | Pages, not image URLs | $10 per 1k searches + tokens | — | — | — | — | Not needed for media; Serper/GDELT are cheaper | — |

### D. News, articles and newsrooms

| Source | Serves | Cost | Key | Limits | Recency | WM risk | Terms | Effort |
|---|---|---|---|---|---|---|---|---|
| **GDELT DOC 2.0 API** (`mode=ArtList`) | Up to 250 articles per query with url, title, seendate, domain, **`socialimage` (og:image)** | Free | No | **1 request per 5 s** (server message). Both test calls today were throttled with that message. | `timespan=` up to the recent 3 months for list modes | Mixed (article heroes can be wire photos) | Open | S |
| GDELT DOC image modes (`ImageCollageInfo`, `imagetag:`, `imagewebtag:`, `imageocrmeta:`) | Image search by Cloud Vision tags | Free | No | Same | — | — | **Backed by the VGKG, whose `lastupdate.txt` points to 2024-12-01** (checked 2026-10-28). Treat image modes as stale. | — |
| **GDELT GKG 2.1** (15-min files or BigQuery) | Per article: `V2.1SHARINGIMAGE`, `RELATEDIMAGES`, `SOCIALIMAGEEMBEDS`, `SOCIALVIDEOEMBEDS` | Free files; BigQuery is billed by bytes scanned (free tier, unverified) | No | — | 15-min granularity | Mixed | Open | M |
| ↳ live test, file 2026-10-28 17:00 | 1,736 articles: sharing image 1,540 (89%), related images 222, social image embeds 157, social video embeds 965 (YouTube and similar) | | | | | | | |
| NewsAPI.org | Articles with `urlToImage` | Dev plan free (100/day, delayed, non-production); business plans expensive (unverified 2026) | Yes | — | `from`/`to` | Mixed | Dev plan not for production | S |
| GNews / NewsData.io / TheNewsAPI | Articles with image fields | Free tiers ~100–200/day (unverified) | Yes | — | Date params | Mixed | — | S |
| Google News RSS (`news.google.com/rss/search?q=…+when:7d`) | Article links | Free | No | Unofficial | `when:` | — | Unofficial; ToS grey | S |
| **Article scraping** (metascraper, open-graph-scraper [Node, MIT]; trafilatura [Apache-2.0], newspaper4k [Python]) | og:image, `<figure>` + `<figcaption>`, `srcset` largest, JSON-LD `ImageObject` (`creditText`, `creator`, `copyrightNotice`, `license`) | Free | No | Be polite (1–2 req/s per domain) | Article date | **Medium**: wire photos are usually unwatermarked; stock previews are not | Paywalls: read the Wayback copy; respect robots | M (extends `sources/article.ts`) |
| Company newsrooms and press kits | Hi-res official images, leadership headshots, product renders | Free | No | — | Release date | Very low | Usually "for editorial use" | M (discover via P856 + `/news`, `/newsroom`, `/press`, `/media`, `/brand`, `/press-kit`, `/leadership`, sitemaps). Strong examples: Apple Newsroom, NVIDIA Newsroom, Microsoft Source, Meta media gallery, Amazon press (galleries unverified per company). |
| PR Newswire / Business Wire / GlobeNewswire multimedia | Photos attached to releases (e.g., `mma.prnewswire.com`) | Free | No | — | Release date | Low | Editorial use with credit | S |

### E. Logos

| Source | Serves | Cost | Key | Limits | WM risk | Terms | Effort |
|---|---|---|---|---|---|---|---|
| Wikidata P154 → Commons SVG | Official logos, many in SVG | Free | No | — | None | Trademarks; logos may be PD-textlogo or non-free | Exists |
| **Simple Icons** (npm `simple-icons`) | ~3k brand SVG icons | Free | No | — | None | CC0 data; brand guidelines apply | S |
| SVGL (svgl.app, open-source + API) | Brand SVGs incl. many AI companies (coverage unverified) | Free | No | — | None | Open source | S |
| **logo.dev** | Logo by domain or ticker | Free Community plan 500k req/month; **attribution link required** for commercial use on free plan | Yes | Monthly hard cap | None | Paid plans drop attribution | S |
| Brandfetch Logo API | Logo by domain | Free, 500k/month fair use, no attribution | Client ID | Fair use | None | **Must hotlink, no caching**, which conflicts with ingesting into a video. Use for lookup only. | S |
| Clearbit Logo API | — | — | — | — | — | **Shut down Dec 2025** (Dec 1 or Dec 8 per sources; HubSpot names logo.dev as the successor) | — |
| Official brand pages | Wordmarks, current marks | Free | No | — | None | Brand guidelines | S |

### F. Maps

| Source | Serves | Cost | Key | Limits | Terms notes | Effort |
|---|---|---|---|---|---|---|
| OSM standard tiles (`tile.openstreetmap.org`) | Raster tiles | Free | No | **Bulk download, prefetch, headless bots panning, and offline archives are prohibited**; generic library User-Agents are blocked; attribution required | Don't render video maps from it. Use a self-hosted or permissive provider. | — |
| **OpenFreeMap** | Vector tiles + styles (liberty, positron …) | Free, **no key, no request limits**; commercial use allowed per FAQ | No | — | OSM attribution | S |
| **Protomaps** (PMTiles) | One-file planet basemap, self-hosted (S3/R2) | Storage only | No | None (own hosting) | ODbL attribution | M |
| **MapLibre GL** in headless Playwright, or `@maplibre/maplibre-gl-native` | Our own static or animated renders (pin drops, zooms) | Free | No | — | Our style, our animation | M |
| Natural Earth + D3 | Country and region outlines | Free | No | — | Public domain | S |
| Overpass API / Nominatim | Building footprints; geocoding | Free | No | Nominatim **1 req/s**, no bulk; Overpass fair use | Attribution ODbL | S |
| Stadia Maps (Stamen styles, static maps) | Tiles / static | Free non-commercial tier; paid commercial (unverified) | Yes | Plan-based | — | S |
| Mapbox Static Images | Static maps incl. satellite | Free monthly allowance (unverified) | Yes | — | Media/broadcast use terms (unverified) | S |
| Google Static Maps / Street View Static | Map and street images | Since **2025-03-01** the $200 credit was replaced by free monthly caps per SKU (10k for Essentials); Static Maps is Essentials per secondary source | Yes | — | Google Geo guidelines: video use allowed with attribution for non-ad content (verify per use) | S |
| Mapillary API | Street-level photos near coordinates | Free | Client token | — | CC BY-SA 4.0 imagery | S |

### G. Satellite and aerial

| Source | Serves | Cost | Key | Recency | Terms notes | Effort |
|---|---|---|---|---|---|---|
| **Earth Search STAC (Element 84, AWS open data): Sentinel-2 L2A COGs** | 10 m true colour, global, ~5-day revisit | Free | **No** (live-tested: Memphis point, 30 scenes 2026-09-01→10-28, newest 2026-10-26) | Excellent | Copernicus free and open; credit "Contains modified Copernicus Sentinel data [year]" (wording unverified) | M (COG crop + colour stretch) |
| Copernicus Data Space (Sentinel Hub Process API) | Same data, server-side rendering | Free with registration | Yes | Excellent | Quotas conflict across sources (10k processing units/month vs other figures, unverified) | M |
| NAIP (USDA) via Planetary Computer / AWS | ~0.6–1 m US aerials | Free | No (Planetary Computer: unverified) | 2–3-year cycles | Public domain | M |
| NASA GIBS (WMTS) | Daily MODIS/VIIRS, 250 m+ | Free | No | Daily | Open | S |
| Esri World Imagery (+ Wayback archive) | Sub-metre imagery and historical versions | Needs an ArcGIS account | Yes | Months–years | Esri Master License; "for Export" layer for offline use; **video use unclear**. Use only after a terms decision. | — |
| Google Earth Studio | 3D flyovers | Free (web app, manual) | Google account | Mixed | **Commercial use not licensed**; attribution is burned into every frame. Promotional videos need approval. Treat as off-limits unless Lucas decides otherwise. | — |
| Planet / Maxar | High-res, very recent | Paid | — | Daily | Often credited in news; use via articles | — |

### H. Screenshots and social posts

| Source | Serves | Cost | Key | Limits | Notes | Effort |
|---|---|---|---|---|---|---|
| **Playwright** (headless Chromium) | Any page at DPR 2–3, element-level crops, mobile viewport | Free | No | Self | Use DuckDuckGo **autoconsent** (open source) to answer cookie banners with "reject". Don't evade bot checks; fall back to Wayback. | M |
| **Wayback Machine**: Availability API, CDX API, Save Page Now | Archived copies, history, provenance | Free (SPN2 API keys with a free account) | Partly | Polite use | Live-tested availability (anthropic.com/news, 2026-09-01 snapshot). Archive every source page at harvest. | S |
| X: `publish.twitter.com/oembed`; `cdn.syndication.twimg.com/tweet-result` (used by react-tweet) | Real post embeds without the API | Free | No | Unofficial | Both endpoints responded today. The syndication endpoint is undocumented, so it could break. | S |
| X API v2 | Post data | **Pay-per-use since 2026-02-06**; ~$0.005 per post read (secondary) | Yes | — | Avoid; embeds suffice | — |
| **Threads oEmbed** | Embed HTML | Free | **No token since 2026-04-21** (Meta changelog); Meta oEmbed tokenless for FB/IG/Threads from 2026-06-15 | Lower without app review | S |
| Bluesky (`public.api.bsky.app`, `embed.bsky.app`) | Posts, images, embeds | Free | No | Generous | Fully open | S |
| Reddit | Threads, images | Free tier for approved apps | **New OAuth apps need approval (Responsible Builder Policy, Nov 2025)** | — | Use `embed.reddit.com` for render; `.json` endpoints are unofficial | S–M |
| **Hacker News Algolia API** | Stories, comments, points, dates | Free | No | ~10k req/hr per IP (doc, unverified) | Live-tested | S |
| LinkedIn | Public post embed iframes | Free | No | — | No public post API; embed render only; don't scrape profiles | S |
| **iTunes Search / Lookup API** | App metadata **with `screenshotUrls`** | Free | No | ~20 req/min (unverified) | Live-tested: ChatGPT app → 8 screenshot URLs | S |
| google-play-scraper (open source) | Play Store screenshots | Free | No | Unofficial | ToS grey | S |

### I. Video

| Source | Serves | Cost | Key | Limits | Notes | Effort |
|---|---|---|---|---|---|---|
| **YouTube Data API v3** | Search, channel uploads, `publishedAfter` | Free | Yes | 10,000 units/day; `search.list` = 100 units, `playlistItems.list`/`videos.list` = 1 | Use channel uploads (from Wikidata P2397) at 1 unit instead of search | S |
| `i.ytimg.com/vi/<id>/maxresdefault.jpg` | 1280×720 thumbnails | Free | No | — | Thumbnails often have overlaid text, so they are mostly unusable full-frame | S |
| **yt-dlp** + ffmpeg | Download sections; frames | Free | No | — | Since Nov 2025 yt-dlp wants an external JS runtime (Deno preferred) for YouTube; PO tokens are needed in some cases. **YouTube ToS forbids downloads**, which is a risk (§8). | M |
| PySceneDetect (BSD) | Shot-boundary detection for picking frames | Free | No | — | Pick the sharpest frame per shot, with faces | S |
| **gallery-dl** | Bulk image download from Flickr, Reddit, Bluesky, Tumblr, X, Instagram and 100+ sites | Free | No | Per site | Never feed it Lucas's personal login cookies | S |
| Committee / congress video, newsroom MP4s | Hearings, keynotes | Free | No | — | US federal works are public domain | M |
| Internet Archive TV News Archive | TV clips | Free to view | — | — | Network bugs, so treat as watermarked | — |

### J. Documents, data, code, papers

| Source | Serves | Cost | Key | Limits | Notes | Effort |
|---|---|---|---|---|---|---|
| **SEC EDGAR full-text search** (`efts.sec.gov/LATEST/search-index`) + submissions/XBRL APIs | Filings since 2001 by phrase, form, date | Free | No (**declared User-Agent required**) | 10 req/s fair access | Live-tested: 524 8-K hits for "artificial intelligence", 2026-10-01→28 | S |
| **CourtListener** REST v4 / RECAP | Dockets, opinions, free PDFs | Free | Token | **Default cut 2026-05-07**; secondary sources say 5/min, 50/hr, 125/day; more with membership | Enough for per-story lookups, not sweeps | S |
| DocumentCloud | Documents newsrooms uploaded (lawsuits, memos) | Free | Search open (unverified) | — | Often the cleanest copy of a leaked or legal document | S |
| Federal Register API; congress.gov API, GovInfo, regulations.gov (api.data.gov keys) | Rules, bills, hearings | Free | Some | api.data.gov default ~1k/hr (unverified) | Public domain | S |
| USPTO (patents via PatentsView / ODP; Google Patents pages; TSDR trademarks) | Drawings, filings | Free | Some (PatentsView key, unverified) | — | Trademark filings are a classic "they filed for …" beat | M |
| USAspending, Senate LDA (lobbying), FEC | Contracts, lobbying, PAC money | Free | FEC: api.data.gov key | — | Code-built charts | S |
| **arXiv** API + arXiv HTML + e-print source | Abstracts; figures (HTML `<img>` or original files in the source tarball) | Free | No | 1 request / 3 s (terms; unverified 2026) | Licence per paper | S |
| pdffigures2 (AllenAI) / PyMuPDF / pdftoppm | Figure and caption extraction; page renders at 300 dpi with text coordinates for markups | Free | No | — | Exact highlight boxes | M |
| **GitHub REST API** | Repos, commits, stars, contributors; `opengraph.githubassets.com` cards | Free | Optional | 60/hr anon, 5,000/hr with a token | | S |
| Hugging Face Hub API | Model cards, downloads, likes | Free | Optional | — | | S |
| Stooq CSV / Alpha Vantage / yfinance | Daily prices | Free | AV key | AV ~25/day (unverified); yfinance unofficial | Code-built charts only | S |
| FRED, EIA, Epoch AI, Our World in Data | Macro, energy, AI compute datasets | Free | FRED key | — | Epoch / OWID are CC BY (unverified per dataset) | S |

### K. Local tooling (open source, no per-call cost)

| Tool | Job | Notes |
|---|---|---|
| exiftool / exifr (JS) | EXIF `DateTimeOriginal`, GPS; IPTC `By-line`, `Credit`, `Source`, `CopyrightNotice`, `DateCreated`; XMP | Credit capture and recency; many news CDNs strip metadata |
| c2patool / c2pa-node (CAI) | C2PA Content Credentials | Detect AI-generated media (`trainedAlgorithmicMedia`) and edits |
| Meta **PDQ**, Python `imagehash`, npm `sharp-phash` / `blockhash` | Perceptual hashes | Deduplication and cross-source matching |
| CLIP / SigLIP (open weights) | Zero-shot tags (screenshot, stage, headshot, chart), "same scene" grouping | Local CPU/GPU |
| Apple Vision (macOS, already used for cutouts), Tesseract, PaddleOCR | OCR | Watermark keywords, text-heavy detection, screenshot text coordinates |
| OpenCV YuNet (MIT) + SFace (Apache-2.0) | Face detection + embedding | Commercial-safe licences. **InsightFace's pretrained packs are non-commercial**; AuraFace is an Apache-2.0 alternative (unverified) |
| pyiqa (MUSIQ, NIQE, BRISQUE), Laplacian variance | Quality and blur scoring | Quality floors |
| rembg / macOS Vision | Background removal for cutouts | Already in the repo (Vision) |

---

## 4. Watermark detection (and AI-art rejection)

### 4.1 Layered check, cheapest first

| Layer | How | Cost | Accuracy notes |
|---|---|---|---|
| 1. Domain blocklist | Reject image hosts and landing pages on stock and agency preview domains: gettyimages.*, istockphoto, shutterstock (incl. editorial/rexfeatures), alamy, dreamstime, 123rf, depositphotos, stock.adobe.com, bigstockphoto, agefotostock, superstock, imago-images, picture-alliance, zumapress, sipausa, abacapress, alamy CDN (`c8.alamy.com`), vecteezy/freepik premium previews, pond5, stocksy, eyeem | Free | Removes most watermarked results from Serper/Brave. Not complete: re-hosts exist. |
| 2. URL / filename patterns | `watermark`, `/comp/`, `/preview/`, `_wm`, `?wm=`; Getty `media.gettyimages.com/...?s=` (preview sizes) | Free | High precision, low recall |
| 3. Metadata | IPTC `Credit`/`Source`/`CopyrightNotice` naming a stock agency is a **flag, not a reject** (unwatermarked wire photos in articles are fair game under the rule) | Free | Informs the credit line |
| 4. OCR keywords | Apple Vision / Tesseract on the full image and a 3×3 tile grid; match "Getty Images", "iStock", "shutterstock", "alamy", "dreamstime", "123RF", "Depositphotos", "Adobe Stock", "©" with low-contrast or diagonal text, "SAMPLE", "PREVIEW" | Free (local, ~100–300 ms per image, unverified) | Very high precision on stock marks; misses logo-only or faint tiled marks |
| 5. Classifier | Candidates: `qwertyforce/watermark_detection` (EfficientNetV2-B0, cc-by-sa-4.0, sigmoid score); `boomb0om/watermark-detectors` (ConvNeXt-tiny, ResNeXt50/101 checkpoints; no published accuracy); LAION watermark-detection (MIT, 2022 training toolkit; mirror `finetrainers/laion-watermark-detection`); `mnemic/nsfw_watermarks_yolov8` (box detector, cc-by-4.0, trained on another domain) | Free (CPU tens of ms per image, unverified) | **None publishes accuracy on news photos.** Expect false positives on chyrons, captions, burned-in subtitles and UI screenshots. Calibrate on ~200 labelled harvest images; use the score as a flag above a high threshold and send the middle band to layer 6. |
| 6. Vision LLM tie-break | Contact sheet of ambiguous items → Haiku 5.5 ("watermark / channel bug / overlay text: yes/no + where") | ~$0.0005 per 16-image sheet (§6.4 maths) | Good at "is this a stock watermark vs a caption"; never the only identity check |

### 4.2 Rules

- **Never crop, blur or inpaint a watermark out.** That removes copyright management information
  (17 U.S.C. §1202) and breaks the integrity principle. Reject the image and look for an unwatermarked
  copy instead (reverse search, §5.1).
- **Channel bugs on TV frames** (CNBC, Bloomberg, C-SPAN logos) are treated as watermarks by default.
  *Lucas to confirm.*
- **Screenshots of real pages** carry the site's own branding; that is the subject, not a watermark.
- **Platform UI around a post** (the X logo in an embed) is the subject too.

### 4.3 AI-generated images found in the wild (must reject)

News sites increasingly run AI-made hero art. Checks, cheapest first: C2PA manifest present with an AI
`digitalSourceType`; IPTC `DigitalSourceType` = `trainedAlgorithmicMedia` or
`compositeWithTrainedAlgorithmicMedia`; caption, alt or credit text containing "AI-generated",
"illustration", "Midjourney", "DALL·E", "generated with", "image: AI"; credit lines like "Getty Images /
AI"; and a domain list of outlets known to use AI heroes (built up over time). Open AI-image detectors on
Hugging Face exist, but their accuracy across generators is poor (unverified); use them only as a flag
for the vision tie-break. Note: upscaling with AI super-resolution invents detail. *Lucas to decide
whether that counts as generation; default off for faces.*

---

## 5. Recency and identity

### 5.1 Dating an image (most to least reliable)

| Basis | Where | Reliability |
|---|---|---|
| Event-bound capture | Frame from a dated official livestream; Flickr album of a dated event | High |
| EXIF `DateTimeOriginal` / IPTC `DateCreated` | File metadata (often stripped by CDNs) | High when present (camera clocks can be wrong) |
| Commons `extmetadata.DateTimeOriginal`; Flickr `date_taken` | API | Medium–high |
| Caption date ("on Tuesday, Oct 14") | Article figcaption | Medium |
| Article publish date / GDELT `seendate` | Upper bound only: the photo can be years old | Low |
| Commons upload timestamp | **Not** the taken date (tested) | Low |
| Reverse-image earliest sighting (TinEye "oldest", Lens) | Paid API | Best defence against recycled photos |

**Recency score** (for ranking, never a hard filter): `taken ≤ 60 days` → 1.0; `≤ 90 days` → 0.8;
`≤ 1 yr` → 0.5; older → 0.3; unknown → 0.4. Archival images are tagged `archival` and judged on their
own. The inventory always shows the date and its basis, so the director can say "in 2019" when he must.

**Source-side filters:** Flickr `min_taken_date`; YouTube `publishedAfter`; Serper `tbs=qdr:m` or a
custom range; GDELT `timespan`; Commons sorted by upload date, then filtered by `DateTimeOriginal`;
EDGAR/CourtListener/HN date params; Sentinel-2 `datetime`.

### 5.2 Verifying who and where (journalistic integrity)

| Subject | Verified = | Probable = | Reject |
|---|---|---|---|
| **Person** | Face embedding matches a reference (bank cutout or Wikidata P18, itself QID-verified) **and** the caption or alt text names them. Or an official source names them (company leadership page, event's own Flickr caption). | Face match without a caption, or a caption without a face check (e.g., a back view). Usable only when the narration doesn't hinge on the face. | Face mismatch; caption names several people and the face can't be told apart; a namesake (QID mismatch) |
| **Multi-face photo** | Match each named face separately; store boxes with names | — | Labelling the wrong person in a group |
| **Place** | EXIF GPS within ~1 km of Wikidata P625/P159 coordinates, or caption plus landmark match against Commons reference photos (CLIP/SigLIP similarity, local features), or Mapillary/Street View comparison | Caption-only | Recycled "generic data center" photos labelled as a specific site |
| **Event** | Date matches, place matches, caption names the event | Two of three | — |
| **Logo** | From Wikidata P154 of the right QID, or from the official domain (P856) | logo.dev / Simple Icons by domain | Lookalike or outdated mark |
| **Screenshot** | Captured live by us from the real URL, with timestamp and a Wayback snapshot ID | — | Mock-ups with invented text |

**Face tooling.** The repo already has `faces.ts` (boxes) and `identity.ts` (Jev). Add a local
embedding check: YuNet + SFace (both commercial-safe), with cosine thresholds calibrated on the
18-person cutout bank. Avoid InsightFace's non-commercial weights. AWS Rekognition `RecognizeCelebrities`
(~$0.001 per image, unverified) is an optional second opinion for well-known CEOs.

---

## 6. Recommended PRE-SCOUT design

**Goal:** decide in under a minute, and for about a cent, whether a story has enough findable real
visuals. The pre-scout counts candidates; it does not verify them all.

### 6.1 Inputs

From discovery (no new cost): headline, date, 3–8 named entities (people, orgs, places, products), and
3–10 article URLs. If discovery doesn't already extract entities, add them to its existing call rather
than paying for a new one.

### 6.2 Free signals, in order (parallel where possible; ~25–40 HTTP calls; ~30 s wall time because of GDELT's 5 s spacing)

| # | Signal | How | Cost |
|---|---|---|---|
| 1 | **Entities → QIDs** | `wbsearchentities` + `wbgetentities` (one batched call): P18, P154, P856, P159/P625, P249/P414, P2002/P11892/P12361, P2397, P2037 | $0 |
| 2 | **Commons depth** | Per QID: `haswbstatement:P180=Q…` total hits; category size; newest 20 files' `DateTimeOriginal` (count ≤ 90 d). Tested: Sam Altman → 50 depicts hits. | $0 |
| 3 | **Coverage + article images** | GDELT DOC `ArtList`, `timespan=3m`, `maxrecords=250` → article count, distinct domains, distinct `socialimage` URLs (dHash on thumbnails in step 9) | $0 |
| 4 | **Discovery articles' figures** | Fetch 5–10 article HTMLs: og:image + `<figure>` count + figcaptions naming entities; JSON-LD credit; outbound links to x.com, threads, bsky, youtube, sec.gov, courtlistener, arxiv, github | $0 |
| 5 | **Logos** | P154 / Simple Icons / logo.dev lookup per org | $0 |
| 6 | **Places** | P159/P625 coordinates; venue via Nominatim (1/s); if a physical site (data center, fab), Sentinel-2 scene count in the window (Earth Search) | $0 |
| 7 | **Screens + documents** | Official announcement URL on the P856 domain; post URLs from step 4; HN Algolia (story count, max points); GitHub repo; arXiv ID; EDGAR FTS hits (company × window); CourtListener search (legal stories only); Federal Register (policy stories) | $0 |
| 8 | **Official video** | YouTube uploads playlist of the org's channel (P2397) since the event date (1–3 units); `search.list` only if no channel (100 units). Default 10k units/day → 50–100 ideas/day. | $0 |
| 9 | **Fresh web images** (cheap paid) | 1–2 Serper `/images` queries (`"<protagonist>" <event noun>`, `tbs=qdr:m`); drop blocklisted domains; count results ≥ 1000 px short side | ~$0.001–0.002 (or free from the 2,500 starter credits) |

### 6.3 Scoring

The shot math: 60 s ≈ 18–25 shots. With multi-move Ken Burns and the code-built kit, a film needs about
**10–15 distinct real images plus 4+ screens or documents**. Expect roughly half the raw candidates to
survive the harvest screens (unverified; measure it), so the pre-scout aims for about 25+ candidates.

| Bucket | Points per item | Cap |
|---|---|---|
| Protagonist with a verified reference photo (P18 / bank) | 3 | 9 |
| Recent photo candidates of protagonists (captions naming them, Commons ≤ 90 d, Serper fresh) | 1 | 5 |
| "What happened" candidates (distinct article images about this story, official images, Flickr) | 1 | 8 |
| Official video in window | 2 | 4 |
| Places (geocoded HQ, venue or site; satellite-worthy site) | 1 | 3 |
| Logos | 1 | 3 |
| Screens / posts (announcement, posts, HN ≥ 50 points, repo, paper, model page) | 1 | 6 |
| Documents (filing, docket, gov release, patent) | 1 | 4 |
| Data for a chart (ticker, dataset) | 1 | 2 |

**Gates**
- **G1 human anchor:** ≥ 1 protagonist with a reference photo, or ≥ 3 event images that name the actors.
- **G2 story-specific proof:** ≥ 3 visuals specific to *this* story (event, product, document, screen),
  not generic.
- **G3 variety:** ≥ 4 buckets non-empty.

**Verdict:** **GREEN** = score ≥ 20 and all gates pass. **AMBER** = 12–19, or one of G1/G3 misses: it
enters the pool with a "thin visuals: <why>" flag the director sees. **RED** = < 12, or G2 misses: it
does not enter. Thresholds are starting points. Calibrate them by replaying ~30 past stories offline,
from cached responses (no live model calls by agents, CLAUDE.md rule 1), against Lucas's
"could we have made it?" labels.

### 6.4 The one model call worth paying for

For GREEN and AMBER ideas, send **one Haiku 5.5 vision call** on a 4×4 contact sheet (≈1,092 px square)
of the top 16 deduplicated candidates (dHash). Per tile it returns: type, watermark or bug, overlay text,
AI-art suspicion, whether it is plausibly about this story, and "usable". The usable fraction then scales
the "what happened" and "recent photo" buckets, and the verdict is recomputed. The stable system prompt
carries `cache_control` (repo caching rule); the image is the per-request suffix. Tests stub this call.

**Cost per idea (pricing page checked 2026-10-28):**

| Item | Tokens / units | Cost |
|---|---|---|
| Free signals 1–8 | ~25–40 HTTP calls | $0 |
| Serper images ×2 | — | $0.002 |
| Haiku 5.5 vision: ~1.6k image tokens (approx., ~w·h/750) + ~0.4k uncached text in; ~0.4k out | in $0.10/MTok (cached system $0.01/MTok); out $0.50/MTok | ≈ $0.0004 |
| (If Sonnet 5.5 were used instead: $2 / $10 per MTok) | same | ≈ $0.008 |
| **Typical total** | | **≈ $0.003** |
| **Worst case** (4 Serper queries, Sonnet, a second sheet) | | **≈ $0.02** |

That is 15–100× under the $0.35 ceiling. The spare budget is better spent in the harvest than in the
pre-scout. Claude `web_search` ($0.01 per search plus tokens) is not needed here.

### 6.5 Output: the media card stored with the idea

Verdict, score, gate results; counts per bucket; the 6 best thumbnails; key URLs (announcement, best
post, filing); gaps in plain words ("no photo of the hearing room; newest photo of X is from 2023");
and the cost spent.

---

## 7. Recommended HARVEST design (after a story is picked)

**Goal:** gather everything usable, so the director is not limited by the pre-scout. The budget guide
is ≤ $0.50 per story in paid calls; the run is triggered by Lucas's pick, not by an agent.

### 7.1 Pipeline

1. **Plan** (code): from the fact sheet, list entities × the visual types in §2, plus key moments (dated)
   and places. Each pair becomes a "want".
2. **Gather** (fan-out per want; per-source caps; polite rate limits): follow the order in §7.2.
   Expected size: 150–400 raw candidates.
3. **Fetch and normalise:** largest variant (`srcset`; strip CDN resize params, such as WordPress
   `-1024x683` suffixes, `?w=`), original bytes, `sha256`, dimensions. Archive the landing page with
   Wayback Save Page Now.
4. **Screen:** watermark layers 1–5 (§4.1), AI-art checks (§4.3), size floor (below), duplicates of
   rejected items.
5. **Deduplicate:** PDQ (256-bit) or pHash (64-bit). Near-duplicate = PDQ distance ≤ ~31 or pHash
   Hamming ≤ ~8 (starting values, unverified; tune). Cluster, then keep the best representative:
   highest resolution, no overlay, earliest or most authoritative credit, best date basis. Keep siblings
   as alternates (other crops). CLIP/SigLIP cosine ≥ ~0.92 groups "same moment, different angle" (not
   duplicates, but the director should know).
6. **Identify:** faces (§5.2), places, logos, screenshot provenance.
7. **Date:** §5.1. Optional reverse-image search on hero candidates only (SerpAPI Lens or TinEye, about
   10–20 per story).
8. **Grade:** short side, blur (Laplacian), IQA (MUSIQ/NIQE), text-heavy share (OCR), face boxes,
   subject size, and which treatments it supports.
9. **Vision pass:** contact sheets (16 per sheet) through Haiku 5.5 for the ambiguous middle band and for
   tags (shot scale, mood, composition). ~10–20 sheets ≈ $0.01. Optionally Sonnet 5.5 for the final
   20 hero picks (≈ $0.005 each).
10. **Ledger + inventory** (§7.4), and `offer()` the verified items to the photo bank for future stories.

### 7.2 Source order per visual type

| Want | Order |
|---|---|
| Person headshot | Cutout bank → Wikidata P18 → Commons `depicts` → leadership page → speaker pages → event Flickr → Serper (face-verified) |
| Person recent (candid, stage) | Official event video frames → event Flickr (`min_taken_date`) → article figures (GKG/DOC list, 50–200 articles) → Commons (taken ≤ 90 d) → Serper `tbs` → post images (Bluesky/Threads/X embeds) |
| HQ / building | Commons category → Wikidata item P18 / P8592 aerial / P3451 night → Mapillary → Serper → NAIP/Sentinel → MapLibre pin |
| City / region | Commons / Wikidata P18 → Unsplash / Pexels (labelled generic) → Natural Earth + D3 map |
| Physical site | Sentinel-2 (before/after pair) → NAIP → press aerials in articles → Overpass footprint on a MapLibre map |
| Launch / keynote | Newsroom / press kit → official video frames → article figures → event Flickr → Commons → Serper |
| Hearing | Committee / congress video frames → official photos → article figures → Commons |
| Protest / incident | Article figures → Commons → Flickr → post embeds → Serper (with reverse-image date check) |
| Product / UI | Live Playwright capture → App Store `screenshotUrls` → official renders → demo video frames → article figures |
| Logo | Bank → Wikidata P154 SVG → brand page → Simple Icons / SVGL → logo.dev |
| Websites, before/after | Live capture + Wayback CDX history |
| Posts | Real oEmbed/embed render (X, Threads, Bluesky, Reddit, LinkedIn); HN page capture |
| Documents | EDGAR / CourtListener / DocumentCloud / Federal Register / USPTO → PDF render at 300 dpi + text boxes for markups |
| Charts | Data APIs → code-built chart (source line on screen) |
| Papers / code | arXiv HTML figures or e-print originals → pdffigures2; GitHub page + API + star history |
| Headlines | Live article header capture (+ Wayback) → newspaper kit with real headlines → front-page sites (watermark check) |
| Archival | Commons → LoC → Internet Archive → NASA → Smithsonian OA → Europeana |

### 7.3 Quality floors (vertical 1080 × 1920)

A 9:16 crop from a 16:9 photo uses about 32% of its width, so a native full-bleed crop needs the source
height ≥ 1920 px. Most news photos are 1200–2000 px wide, so full-bleed is the exception and the kit's
board, print and cutout treatments are the norm.

| Treatment | Floor |
|---|---|
| Full-bleed still (with ≤ 1.5× upscale) | Crop height ≥ 1280 px |
| Ken Burns pan across a landscape | Short side ≥ 1080 px |
| Framed print / board pin / polaroid | Short side ≥ 600 px |
| Person cutout | Subject box height ≥ 700 px, sharp edges |
| Logo | SVG, else PNG ≥ 512 px with alpha |
| Screenshot | Captured at DPR ≥ 2 (text ≥ 24 px tall on output) |
| Video frame | Source ≥ 1080p; Laplacian blur above threshold; no motion blur on faces |

### 7.4 The ledger and the director's inventory

**Ledger row (one per kept item; JSON beside the story, mirrored to the bank):** `id`, `story_id`,
`type/subtype`, `entity_qids`, `subject_names`, `image_url`, `landing_url`, `wayback_url`,
`source_kind`, `domain`, `credit_line` (on-screen text), `author`, `licence` (if known; else
"unknown — fair game per 2026-10-28 rule"), `retrieved_at`, `taken_at` + `date_basis`, `published_at`,
`w/h`, `sha256`, `pdq`, `dup_group`, `watermark {verdict, score, layer}`, `ai_generated {verdict, basis}`,
`identity {verified|probable|unverified, face_score, caption_match, ref_id}`, `geo {lat, lon, basis}`,
`quality {short_side, blur, iqa}`, `treatments_ok [full_bleed, ken_burns, board, cutout]`,
`faces [{box, name}]`, `text_heavy`, `caption`, `alt`, `notes`.

**Inventory for the director (`MEDIA.md` + contact sheets).** It is honest by construction: grouped by
entity and by beat-relevant type, with counts, dates and confidence, **and an explicit "not found" list**
generated by diffing the §2 checklist against the ledger. Example:

```
SAM ALTMAN — 14 items (9 verified, 5 probable)
  headshot: 3 (newest 2026-09, Web Summit Flickr)   stage: 4 (DevDay keynote frames, 2026-10-06)
  candid: 2 (article figures, captions name him)    cutout: ready (bank)
OPENAI HQ — 2 items: street-level (Mapillary, 2025-07), Commons exterior (2023, label year)
DOCUMENTS — 8-K p.3 (highlight boxes ready), complaint p.1 (RECAP)
POSTS — 3 real embeds (X ×2, Threads ×1), captured 2026-10-27 14:02 UTC
NOT FOUND — no photo inside the hearing room; no recent photo of <exec>, newest is 2023;
  satellite of the site is 10 m only (shows the campus, not buildings)
CODE-BUILT FALLBACKS AVAILABLE — map of Abilene → site; stock chart NVDA; newspaper wall (real headlines ×6)
```

---

## 8. What changed in 2025–2026 (checked 2026-10-28)

| Item | Status | Date | Basis |
|---|---|---|---|
| Bing Search APIs (incl. Image, Visual) | Retired; only "Grounding with Bing" in Azure AI Agents | 2025-08-11 | Microsoft Learn lifecycle notice |
| Google Custom Search JSON API | Closed to new customers; discontinued for existing customers | 2027-01-01 | Secondary sources quoting Google docs; Jan 2026 forum 403 reports |
| Brave Search API | $5 per 1k with a $5 monthly credit; old free 2k tier removed | Feb 2026 (secondary); page checked today | brave.com/search/api |
| Clearbit Logo API | Shut down; logo.dev named as successor | Dec 2025 (Dec 1 vs Dec 8) | HubSpot changelog, logo.dev |
| GDELT VGKG (image graph) | No update since 2024-12-01 | Checked today | `gdeltv3/vgkg/lastupdate.txt` |
| GDELT GKG 2.1 | Live, image fields populated | Checked today | 15-min file 20261028170000 |
| X API | Pay-per-use default; free tier closed to new developers | 2026-02-06 | Secondary sources |
| Reddit Data API | New OAuth apps need approval (Responsible Builder Policy) | Nov 2025 | r/redditdev admin post |
| Threads oEmbed | Callable without an access token | 2026-04-21 (Meta oEmbed tokenless 2026-06-15) | Meta changelog / dev blog |
| Wikimedia APIs | New rate-limit tiers; compliant UA required | Mar–Apr 2026 | mediawiki.org Rate limits / Changelog |
| CourtListener | Default API limits lowered; higher via membership | 2026-05-07 | free.law post; secondary figures |
| yt-dlp / YouTube | External JS runtime (Deno) needed for full support; PO tokens in some cases | 2025-11-12 release | Secondary reports; yt-dlp EJS wiki |
| Google Maps Platform | $200 credit → free monthly caps per SKU | 2025-03-01 | Google billing doc |
| Flickr API keys | Claimed Pro-only for new keys (unverified) | 2025 | One blog |

---

## 9. Risks

1. **Legal exposure from unwatermarked wire photos.** The rule makes them fair game, but AP, Reuters,
   AFP and Getty enforce through PicRights or Copytrack demand letters. Mitigation within the rule:
   record credit on screen, keep the ledger, and keep a swap path for any item challenged.
2. **Watermark removal.** Never crop or inpaint marks (§4.2). Channel bugs need Lucas's call.
3. **Wrong person / wrong place.** This is the biggest integrity risk, especially from Serper and
   articles. "Verified" requires a face match plus a caption (§5.2); "probable" items are labelled for
   the director.
4. **AI art passing as real.** Many outlets now use AI heroes. Use the §4.3 checks plus the vision
   tie-break.
5. **Recycled old photos presented as new.** Upload date ≠ taken date. Show the date basis; run a
   reverse-image check on heroes.
6. **API churn.** Seven relevant changes in 18 months (§8). GDELT throttles hard: both of today's DOC
   calls were refused. Keep each source behind an adapter with a cache and a fail-open path.
7. **Terms grey zones:** YouTube downloads, the X syndication endpoint, Google News RSS, OSM tiles,
   Esri, Google Earth Studio (commercial use not licensed), Brandfetch (hotlink-only). The design avoids
   the worst and flags the rest.
8. **Cost creep in the harvest.** Cap Serper queries and vision sheets per story; log spend on the
   media card.
9. **Classifier accuracy is unknown.** No watermark model publishes news-photo accuracy; calibrate on
   our own labelled set before trusting thresholds.

---

## 10. Sources

- Repo: `lib/social/photos/find.ts`, `lib/media-library/bank.ts`, `lib/real-case/objects/stock.ts`, `scripts/real_case_cutout_bank.ts` (headers)
- Bing retirement: https://learn.microsoft.com/en-us/lifecycle/announcements/bing-search-api-retirement ; https://www.theregister.com/2025/05/15/bing_search_apis_retired/
- Google CSE closure: https://brave.com/learn/google-api-shutdown/ ; https://discuss.google.dev/t/custom-search-json-api-returns-403-permission-denied-on-new-org-new-account-restriction/347093 ; https://cloro.dev/blog/google-custom-search-api-shutdown/
- Brave Search API: https://brave.com/search/api/
- Serper pricing (secondary): https://apiserpent.com/blog/serper-pricing-credits-explained ; https://costbench.com/software/web-scraping/serper/
- Clearbit / logo.dev / Brandfetch: https://developers.hubspot.com/changelog/upcoming-sunset-of-clearbits-free-logo-api ; https://www.logo.dev/clearbit ; https://www.logo.dev/docs/platform/attribution ; https://www.logo.dev/docs/platform/rate-limits ; https://docs.brandfetch.com/logo-api/guidelines ; https://brandfetch.com/developers/logo-api
- GDELT: https://blog.gdeltproject.org/gdelt-doc-2-0-api-debuts/ ; https://blog.gdeltproject.org/?p=3531 (VGKG 2.0) ; live: https://data.gdeltproject.org/gdeltv3/vgkg/lastupdate.txt , https://data.gdeltproject.org/gdeltv2/lastupdate.txt
- Flickr: https://www.flickr.com/services/api/ ; https://www.flickr.com/help/terms/api ; https://www.cantoni.org/2025/12/12/downsizing-flickr-library-free-tier/
- Openverse: https://api.openverse.org/v1/ ; https://wordpress.github.io/openverse-api/reference/api/authentication_and_throttling.html
- Unsplash / Pexels / Pixabay: https://help.unsplash.com/api-guidelines ; https://www.pexels.com/api/documentation/ ; https://pixabay.com/api/docs/
- Wikimedia limits: https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits ; https://www.mediawiki.org/wiki/Wikimedia_APIs/Changelog ; https://www.mediawiki.org/wiki/Wikimedia_APIs/Access_policy
- OSM tiles: https://operations.osmfoundation.org/policies/tiles/ ; OpenFreeMap: https://openfreemap.org ; Protomaps: https://protomaps.com ; MapLibre: https://maplibre.org ; Natural Earth: https://www.naturalearthdata.com ; Nominatim policy: https://operations.osmfoundation.org/policies/nominatim/
- Google Maps pricing change: https://developers.google.com/maps/billing-and-pricing/march-2025 ; https://developers.google.com/maps/billing-and-pricing/faq ; Geo guidelines: https://about.google/brand-resource-center/products-and-services/geo-guidelines/
- Google Earth Studio: https://www.google.com/earth/studio/faq/ ; https://earth.google.com/studio/docs/attribution/
- Esri: https://developers.arcgis.com/documentation/mapping-apis-and-services/deployment/basemap-attribution/ ; https://community.esri.com/t5/imagery-and-remote-sensing/arcgis-online-basemap-imagery-licensing/m-p/257788
- Sentinel / CDSE / GIBS: https://earth-search.aws.element84.com/v1 (live) ; https://documentation.dataspace.copernicus.eu/Quotas.html ; https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Overview/RateLimiting.html ; https://nasa-gibs.github.io/gibs-api-docs/
- X API: https://docs.x.com ; https://roboin.io/article/en/2026/02/08/x-transitions-api-to-pay-per-use-model-ending-free-plan/ ; https://gigazine.net/gsc_news/en/20260209-x-api-pay-per-use
- Threads / Meta oEmbed: https://developers.facebook.com/docs/threads/changelog ; https://developers.facebook.com/blog/post/2026/06/15/tokenless-access-to-meta-oembed-apis/
- Reddit: https://r.datuan.dev/r/redditdev/comments/1oug31u/introducing_the_responsible_builder_policy_new/ (mirror of the r/redditdev announcement)
- yt-dlp: https://github.com/yt-dlp/yt-dlp/wiki/EJS ; https://www.gigazine.net/gsc_news/en/20251113-yt-dlp-required-deno-javascript-runtime
- YouTube Data API quota: https://developers.google.com/youtube/v3/determine_quota_cost
- CourtListener: https://www.courtlistener.com/help/api/rest/ ; https://free.law/2026/05/07/api-included-in-memberships/ ; https://learn.microsoft.com/en-us/connectors/courtlistener/
- SEC EDGAR: https://www.sec.gov/search-filings/edgar-search-assistance/accessing-edgar-data ; https://efts.sec.gov/LATEST/search-index (live)
- HN Algolia: https://hn.algolia.com/api ; arXiv API terms: https://info.arxiv.org/help/api/tou.html ; GitHub rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- iTunes Search/Lookup: https://performance-partners.apple.com/search-api
- Wayback APIs: https://archive.org/help/wayback_api.php ; https://github.com/internetarchive/wayback/tree/master/wayback-cdx-server
- Watermark models: https://huggingface.co/qwertyforce/watermark_detection ; https://huggingface.co/boomb0om/watermark-detectors ; https://github.com/LAION-AI/watermark-detection ; https://huggingface.co/finetrainers/laion-watermark-detection ; https://huggingface.co/mnemic/nsfw_watermarks_yolov8
- C2PA / IPTC: https://opensource.contentauthenticity.org/docs/c2patool/ ; https://cv.iptc.org/newscodes/digitalsourcetype/
- Hashing / faces / tools: https://github.com/facebook/ThreatExchange/tree/main/pdq ; https://github.com/JohannesBuchner/imagehash ; https://github.com/opencv/opencv_zoo ; https://github.com/deepinsight/insightface (model licence) ; https://github.com/chaofengc/IQA-PyTorch ; https://github.com/mikf/gallery-dl ; https://github.com/Breakthrough/PySceneDetect ; https://github.com/allenai/pdffigures2 ; https://github.com/duckduckgo/autoconsent ; https://github.com/simple-icons/simple-icons
- Claude pricing (Haiku 5.5, Sonnet 5.5, web search): https://platform.claude.com/docs/en/about-claude/pricing
