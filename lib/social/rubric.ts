import { formatWatchlistForPrompt } from '@/lib/social/watchlist';

/**
 * Shared relevance rubric — used by both the Jev production judge
 * (judge-relevance.ts) and the Haiku shadow judge (shadow-haiku-judge.ts).
 *
 * Keeping this in one place means the two realities are judged by the exact
 * same criteria, which is the whole point of the A/B comparison Lucas wants.
 * If either provider drifts on its own prompt, the comparison becomes noise.
 */
export const HELIOS_RELEVANCE_RUBRIC = `
Should Helios Marketing turn this article into an Instagram post?

Helios is a Madison-Avenue-meets-AI marketing agency. Their editorial voice on
Instagram comments on AI industry news through a marketing lens. An article
qualifies when it substantively covers a watchlist entity OR a watchlist topic.

Watchlist:
${formatWatchlistForPrompt()}

Say YES (probability near 1) when the article covers:
- A specific model launch, product release, agent capability, or benchmark
- A notable brand campaign where AI is central to creative or media
- Ad-industry deals, agency moves, or industry-shaping analysis
- AI safety incidents, alignment research, or corporate safety policy
- AI regulation (laws, executive orders, court rulings that create precedent)
- Chip supply, GPU costs, or AI infrastructure moves
- Enterprise AI adoption at Fortune 500 scale
- AI startup funding rounds of $100M or more
- Coding assistant tools or benchmarks
- A notable image or video generation advance

Say NO (probability near 0) when:
- No watchlist entity or topic is central to the article
- Off-topic business or political news
- Product PR blast without a larger story
- Coding tutorials or dev-only announcements
- Generic marketing or social media listicle content
`.trim();
