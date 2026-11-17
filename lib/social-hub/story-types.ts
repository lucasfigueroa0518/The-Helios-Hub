/**
 * The Stories-format content types (Stories Split, SS-1; planning/Stories Split/CONTRACT.md §1–§2).
 *
 * "IG Stories" became three content types that share one Stories engine (lib/stories/**): Morning Download keeps the
 * hub id `stories`; "Are you smarter than AI?" is `ai_trivia`; "Real or AI?" is `real_or_ai`. The engine still keys
 * sets, pools and history by series; each type has exactly one series.
 *
 * Pure: types and constants only, so client views, workers and tests can all import it.
 */
import type { StorySeries } from '@/lib/social-hub/slots/types';
import type { Vertical } from '@/lib/social-hub/types';

export const STORY_VERTICALS = ['stories', 'ai_trivia', 'real_or_ai'] as const satisfies readonly Vertical[];
export type StoryVertical = (typeof STORY_VERTICALS)[number];

/** True for every Stories-format type. Code that means Morning Download in particular keeps `=== 'stories'`. */
export function isStoryVertical(v: unknown): v is StoryVertical {
  return typeof v === 'string' && (STORY_VERTICALS as readonly string[]).includes(v);
}

/** Each Stories-format type's one engine series. */
export const SERIES_OF_VERTICAL: Readonly<Record<StoryVertical, StorySeries>> = Object.freeze({
  stories: 'morning_download',
  ai_trivia: 'ai_trivia',
  real_or_ai: 'real_or_ai',
});

/** The type a series belongs to. Retired series (guess_the_number, free_vs_paid) and unknown ones read as Morning Download's `stories`. */
export function verticalOfSeries(series: string | null | undefined): StoryVertical {
  return series === 'ai_trivia' || series === 'real_or_ai' ? series : 'stories';
}

export const STORY_TYPE_LABEL: Readonly<Record<StoryVertical, string>> = Object.freeze({
  stories: 'Morning Download',
  ai_trivia: 'Are you smarter than AI?',
  real_or_ai: 'Real or AI?',
});

export const STORY_TYPE_SHORT: Readonly<Record<StoryVertical, string>> = Object.freeze({
  stories: 'Morning',
  ai_trivia: 'Trivia',
  real_or_ai: 'Real/AI',
});

/**
 * Set-less Stories cost events that belong to one type, by component (SS-1): AI Trivia's daily writer (`trivia-*`)
 * and Real or AI?'s candidate maker (`roa-*`). Every other set-less event (the pool, Morning Download's helpers) is
 * Morning Download's. One rule for the engine's spend caps (repository.costTypeSql) and the hub's cost page.
 */
export const SETLESS_COMPONENT_PREFIX: Readonly<Partial<Record<StoryVertical, string>>> = { ai_trivia: 'trivia-', real_or_ai: 'roa-' };

/** The Stories-format type a set-less cost event belongs to, by its component. */
export function typeOfSetlessComponent(component: string): StoryVertical {
  for (const v of STORY_VERTICALS) {
    const prefix = SETLESS_COMPONENT_PREFIX[v];
    if (prefix && component.startsWith(prefix)) return v;
  }
  return 'stories';
}
