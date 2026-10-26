/**
 * The pool week the hub shows and the pool actions change: the newest pooled week up to the
 * coming one. One string for both, so the page and a Pin click can never disagree on the week.
 */
export const SHOWN_POOL_WEEK_SQL = `SELECT max(week_key) AS week_key FROM ai_events.pool WHERE week_key <= $1`;
