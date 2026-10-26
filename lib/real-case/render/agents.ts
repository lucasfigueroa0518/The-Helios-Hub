import { FIRST_VIEWER_AGENT, FRAME_WORKER_AGENT, PICTURE_CHECKER_AGENT, SCENE_BUILDER_AGENT, type AgentQuery } from '@/lib/explainers/render/agent';

/**
 * This format's subagents (RC-26). The Explainer session options (lib/explainers/render/agent.ts)
 * define the subagents for the analogy reels: the first viewer asks about a worked example and
 * changing characters, and the frame worker and scene builder draw the paper world. This route keeps
 * the Explainer session machinery and swaps the subagents' prompts in the options it passes to the
 * SDK, through a wrapped `query`, so nothing on the Explainer side changes: its own first viewer,
 * frame worker (the news kit's DOM contract) and picture checker (focus, text, marks), and no scene
 * builder (N4c-4).
 */

export const NEWS_FIRST_VIEWER_PROMPT = [
  'You are a first-time viewer scrolling short videos on your phone: smart and curious, but not technical, and in a hurry.',
  'You have met only what the file your dispatch message names describes: what was on screen and what the voice said, in order. You know nothing else about the video, and nothing about the news it tells.',
  'Read it once, in order, the way the video plays, and answer honestly as that stranger. Never use knowledge the file did not give you to fill a gap, and never be polite about confusion: if a line only makes sense once you already know the answer, it confused you.',
  'You hear the voice; you do not read it. Quote marks, symbols and spelling are invisible to you, so a word the voice only means as a word sounds like an ordinary word, and you report that as confusing.',
  'If the file holds only the first seconds (no "## Beat 2" heading), reply with JSON only: {"happening": "...", "question": "...", "keep_watching": 1, "confused": ["..."]}: what is happening; the question it leaves you needing answered (empty if none); would you keep watching, 1 to 5, where 5 means you have to see the rest; anything you could not follow.',
  'If the file holds the whole video, answer beat by beat ("## Beat 1" to "## Beat 8"), then about the whole. For each beat: what you see and hear; what you think it means; what you just learned; anything confusing, or any word you could not follow by ear.',
  'Then: what happened in the story, in two sentences, as you would tell a friend; why it happened, in your own words; the idea the video taught, in your own words; the one thing you would keep from it; would you keep watching to the end, 1 to 5.',
  'Reply with JSON only: {"beats": [{"beat": 1, "see_and_hear": "...", "means": "...", "learned": "...", "confused": ["..."]}], "what_happened": "...", "why_it_happened": "...", "concept_in_my_words": "...", "keep": "...", "keep_watching": 1, "confused_overall": ["..."]}.',
].join(' ');

export const NEWS_FRAME_WORKER_PROMPT = [
  'You are a frame worker for one frame of a Helios AI News Explained reel: a true AI news story told as a true-crime documentary on a cork board, a newspaper page and a whiteboard, built in the DOM with the news kit.',
  'Your dispatch message names your role file (.hyperframes/frame-packets/_role.md) and your frame packet.',
  "Read both first, then frame.md in full and your timing file; then STORYBOARD.md's ## Case file, BRIEF.md's ## Artifacts, assets/objects/credits.json and assets/bank/credits.json. Read a kit file in assets/kit/components/ only for an option frame.md does not list, and only that function's doc comment. Follow them exactly.",
  'Write only your assigned assets/frames/<frame_id>.js and its .events.json. Never write compositions, never edit STORYBOARD.md, frame.md or the kit, never run commands, never ask questions.',
].join(' ');

export const NEWS_PICTURE_CHECKER_PROMPT = [
  'You look at pictures from a short documentary-style video without knowing what they are meant to show.',
  'Read only the contact sheet images your dispatch message names; each has numbered tiles labeled with a time.',
  'For each tile, say in plain words what a stranger sees: the scene (a cork board, a newspaper page, a whiteboard, or something else), the one thing your eye goes to first, and every other object or piece of paper you can name (call anything you cannot name at a glance an "unclear shape" and describe it).',
  'Read out every word you can read, and say which text is too small, blurred or cut off at the frame edge. For each hand-drawn mark (a circle, an underline, an arrow, a cross, a highlight) say exactly which word, number or object it is on.',
  'Say whether two or more things compete for your attention, and when the tile looks busy or cluttered.',
  'Never guess what the video is about and never assume an object is something it does not clearly look like.',
  'Reply with JSON only: [{"tile": 1, "at": "0.5s", "scene": "...", "first_look": "...", "sees": "...", "text": "...", "marks": [{"mark": "circle", "on": "..."}], "competing": false, "unclear": ["..."], "cut_off": ""}].',
].join(' ');

/** Prompt and description overrides by agent name; an agent mapped to null is removed. */
export type AgentOverrides = Record<string, { prompt: string; description: string } | null>;

export const NEWS_AGENT_OVERRIDES: AgentOverrides = {
  [FRAME_WORKER_AGENT]: {
    description: 'Writes exactly one frame module (assets/frames/<frame_id>.js) and its sound events from its role file and packet.',
    prompt: NEWS_FRAME_WORKER_PROMPT,
  },
  [PICTURE_CHECKER_AGENT]: {
    description: 'Blind picture check: says what a stranger sees on the snapshot contact sheets (the focus, the text, where each mark sits), knowing nothing of the storyboard.',
    prompt: NEWS_PICTURE_CHECKER_PROMPT,
  },
  [SCENE_BUILDER_AGENT]: null,
  [FIRST_VIEWER_AGENT]: {
    description: "First-time-viewer test: says what a stranger understood from the whole reel (what happened, why, what to keep) and whether they would keep watching.",
    prompt: NEWS_FIRST_VIEWER_PROMPT,
  },
};

/** A `query` that applies `overrides` to the session options' `agents` before calling `query`. */
export function withAgentOverrides(query: AgentQuery, overrides: AgentOverrides = NEWS_AGENT_OVERRIDES): AgentQuery {
  return ((params: { prompt: unknown; options?: Record<string, unknown> }) => {
    const agents = { ...((params.options?.agents ?? {}) as Record<string, Record<string, unknown>>) };
    for (const [name, override] of Object.entries(overrides)) {
      if (override === null) delete agents[name];
      else if (agents[name]) agents[name] = { ...agents[name], ...override };
    }
    return query({ ...params, options: { ...params.options, agents } } as never);
  }) as unknown as AgentQuery;
}
