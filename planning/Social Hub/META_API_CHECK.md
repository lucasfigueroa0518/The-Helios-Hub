# Meta API check (P1-M0)

Checked 2026-10-08 against Meta's public docs (documentation only, no Graph calls):

- Account: https://developers.facebook.com/docs/instagram-platform/api-reference/instagram-user/insights
- Media: https://developers.facebook.com/docs/instagram-platform/reference/instagram-media/insights

Status key: **available**: listed in the docs' metric table. **unavailable**: not in the API, so it's dropped (SH-22). **unverified**: the docs contradict themselves or don't settle it. The hub shows an unverified metric only when collected data has it.

## Account level (`GET /{ig-user-id}/insights`), spec §5.1

| Spec metric | API name | Status | Notes |
|---|---|---|---|
| Accounts reached | `reach` (day, total_value / time_series) | available | Breakdowns `follow_type`, `media_product_type` (total_value only). Estimated. |
| Impressions / views | `views` (day, total_value) | available | `impressions` is **deprecated** (v22+, all versions since 2025-04-21). Use `views`. Docs mark `views` "in development". |
| Follower vs non-follower split (reach) | `reach` with `follow_type` breakdown | available | Values FOLLOWER, NON_FOLLOWER, UNKNOWN. |
| Follower vs non-follower split (views) | `views` with `follow_type` / `follower_type` | unverified | The metric table says `follower_type`; the breakdown section says `follow_type`. |
| Accounts engaged | `accounts_engaged` | available | Estimated. |
| Total interactions | `total_interactions` | available | Breakdown `media_product_type`. Likes, comments, saves, shares, replies and reposts are also account metrics. |
| Link-in-bio taps | `profile_links_taps` | available | Breakdown `contact_button_type`. |
| Net follower change | `follows_and_unfollows` (`follow_type` breakdown) | available | Not returned under 100 followers. |
| Follower count (daily) | `follower_count` | unverified | Not in the metrics table, but named in Limitations (unavailable under 100 followers). |
| Demographics (age, gender, country, city) | `follower_demographics`, `engaged_audience_demographics` (lifetime, `timeframe` required) | available | `timeframe` values `this_week`, `this_month`, `prev_month`. Meta's v20 removal of last_14/30/90_days is noted on `engaged_audience_demographics`; the hub uses the three safe values for both. Top 45 only, under 100 followers/engagements nothing. |
| Most active times (hour × day) | `online_followers` | unverified | Not in the metrics table; Limitations say it covers only the **last 30 days** and is unavailable under 100 followers. |
| Top performers | (from per-post data) | available | Computed in the hub from per-post rows. |

## Media level (`GET /{ig-media-id}/insights`), spec §5.2

| Spec metric | Reels | Feed (carousel) | Story | Notes |
|---|---|---|---|---|
| views | available | available | available | |
| reach | available | available | available | |
| likes, comments | available | available | n/a | Stories have no likes or comments. |
| saved | available | available | n/a | |
| shares | available | available | available | |
| total_interactions | available | available | available | |
| reposts | available | available | available | Only Trial Reels stores it today. |
| avg watch time (`ig_reels_avg_watch_time`) | available | n/a | n/a | |
| total watch time (`ig_reels_video_view_total_time`) | available | n/a | n/a | |
| skip rate (`reels_skip_rate`) | available | n/a | n/a | |
| follows | **unavailable** | available | available | Not listed for REELS, so dropped from the reels column (SH-22). |
| profile visits | **unavailable** | available | available | Not listed for REELS. Feed `profile_visits` exists but isn't collected yet (OUT_OF_SCOPE, P2-M1). |
| replies | n/a | n/a | available | Returns 0 for EU/Japan creators. |
| taps forward / back, exits, swipe forward | n/a | n/a | available | `navigation` + `story_navigation_action_type` (TAP_FORWARD, TAP_BACK, TAP_EXIT, SWIPE_FORWARD). |
| Story completion, exits on frames 1–3 | n/a | n/a | available (derived) | Computed from per-frame `reach` and `navigation` exits. |
| Follower vs non-follower split (per post) | **unavailable** | **unavailable** | **unavailable** | No breakdown on media insights. Account-level only. |

## Dropped (spec §5.2 "expected drops", confirmed)

- Retention curves: not in the API.
- Initial plays vs replays: `plays` isn't listed for any type. Dropped.
- Per-surface traffic sources (feed / Explore / Reels tab): no surface breakdown. Dropped.
- `impressions`: deprecated for media created after 2024-07-02 and for account insights.

## Limits that shape the design

- Data can lag up to 48 h, and a missing value comes back as an empty set, not 0, so the hub shows a blank, never 0.
- Story metrics live only 24 h; values under 5 return error 10.
- Album children have no insights, so a carousel has one row per post.
- Media metrics are kept up to 2 years, which is why SH-24 stores account snapshots forever.

## Spec §5 trimmed to this check

- §5.1 Profile shows Reach (`reach`, follower split), Views, Accounts engaged, Total interactions, Link-in-bio taps, Net follows (`follows_and_unfollows`), Demographics (this_week / this_month / prev_month), and Top 5. It shows **Most active times** and a **follower count** line only when collected rows have them (unverified).
- §5.2 Reels: no follows or profile visits. Feed: follows and profile visits are API-available but not collected (shown when present). Per-post discovery split: dropped.
