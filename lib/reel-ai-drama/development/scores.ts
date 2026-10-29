import { noul, score } from '@typesafe-ai/sdk';

import type { DramaJevRunner } from '@/lib/reel-ai-drama/jev';
import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import { ERAS, STORY_TYPES, type Pitch, type Score } from '@/lib/reel-ai-drama/types';

/**
 * The two Jev scores (PROCESS.md D4, D5), kept separate (research 05 §11: a blended score lets a
 * thrilling story with no photos pass). Code combines the answers into 0–1 with fixed weights; Jev
 * never sees a weight or a bar. Bump a set's version on any wording change.
 *
 * Prompt-pollution rule (CALIBRATION.md): no question names a calibration story or a real AI event.
 */

const LEVELS = 4; // score rubrics are indexed 0..4

// ── Drama (MD-29 weighted most; MD-24's three criteria; a turn and stakes) ───

const NOT_THE_TELLING =
  'Judge the events the pitch describes, not how it is written. A large number, a clever ending, or a small act with a big consequence earns nothing here on its own.';

export const DRAMA_SET = defineQuestionSet({
  id: 'reel-ai-drama-drama-v4',
  version: '4',
  questions: {
    central_want: score(
      {
        question: 'Is there one central figure from the AI world whose own want (a fight, a pursuit, a bet or a decision) drives the events of this story?',
        judge: `A central figure is a named person (or a small named group acting as one) whose wish, ambition, fear, conviction or decision sets the events moving and is tested by them. A quiet want counts as fully as a fight: years spent pursuing a goal, a bet on one choice, a decision to do something a certain way. A company counts only when it acts through named people whose choices we follow. A product, a market, a ranking or an announcement is not a figure. People who only comment on, react to, or are swept along by events do not count. ${NOT_THE_TELLING}`,
      },
      [
        'No one. The story is a product, a figure, a ranking, a market move or an announcement.',
        'People appear, but they react to events rather than drive them, or the actor is a faceless organization.',
        'A figure is present, but their want or decision is vague or only implied, and the events would happen without them.',
        'A named figure with a clear want or decision whose choices move the events.',
        'A named figure with a specific want, pursuit or decision that sets the events moving and is tested by what happens.',
      ],
    ),
    stakes: score(
      {
        question: 'How much did the people in this story stand to win or lose, in a situation that mattered?',
        judge: `Reward situations where a person's career, company, reputation, principles, survival or a relationship was really on the line, and where the outcome was genuinely uncertain at the time. Penalize stakes that are only money changing hands, only asserted, or carried by no one in particular. ${NOT_THE_TELLING}`,
      },
      [
        'Nothing real was at stake for anyone in particular.',
        'Small or routine stakes; the outcome was never in doubt.',
        'Real stakes for someone, though contained.',
        'High stakes for named people, with an uncertain outcome.',
        'Everything was on the line for named people: a company, a career, a life\'s work or a conviction, with the outcome in real doubt.',
      ],
    ),
    scene: score(
      {
        question: 'Does the story hold one vivid, concrete detail or moment that makes it a scene a viewer can see?',
        judge: `A scene is a specific place, object, message, room or exchange at a specific moment: something a viewer could picture. Generic settings (a meeting, a statement, a launch, an interview) are not scenes unless something particular happened in them. ${NOT_THE_TELLING}`,
      },
      [
        'No scene: the story is a summary of outcomes.',
        'A generic setting with nothing particular in it.',
        'A specific setting, but nothing memorable happens in it.',
        'A concrete moment or detail a viewer can picture.',
        'An unforgettable concrete moment or object that carries the story by itself.',
      ],
    ),
    turn: score(
      {
        question: 'Does the story turn: a reversal, a surprise or a decision that changes what the story is about?',
        judge: `A turn is something that happens inside the events and changes their direction or meaning (a betrayal, a refusal, a reversal of fortune, a hidden fact coming out). A neat closing line is not a turn. ${NOT_THE_TELLING}`,
      },
      [
        'No turn: events run in a straight line.',
        'A minor development that changes little.',
        'A real development, but expected.',
        'A clear reversal or surprise that changes the direction of the story.',
        'A reversal that changes what the whole story was about.',
      ],
    ),
    implication: score(
      {
        question: 'Does what happened have a real implication for the AI world: how it was built, who leads it, or where it is going?',
        judge: `Reward stories whose outcome shaped the companies, people, technology or rules of the AI world, or still does. Penalize stories that matter only to the people in them, or whose implication is claimed rather than shown. ${NOT_THE_TELLING}`,
      },
      [
        'None: it changed nothing beyond itself.',
        'A small or short-lived effect.',
        'A real but local effect on one company or person.',
        'A clear effect on how the AI world was built or who leads it.',
        'A defining effect: the AI world would look different without it.',
      ],
    ),
    mostly_spectacle: noul({
      question: 'Is this pitch mainly about a figure, a valuation, a ranking, a market move, or a corporate announcement, rather than about people\'s choices and what came of them?',
      judge: 'Answer yes when the heart of the pitch is a number or an announcement and the people in it are incidental. Answer no when a person\'s choices are the heart of it, even if a number or an announcement is part of it.',
    }),
    about_ai: noul({
      question: 'Is this story part of how the AI world was built: building AI, the people and companies racing in it, a fight over it, or the origins of a person, lab or company that went on to shape it?',
      judge: 'Answer yes when AI, or the making of someone or something that later shaped AI (a lab, a chipmaker, a founder), is at the heart of what happens. Answer no when the story is about some other business of the people involved (retail, cloud contracts, labor, politics, rockets, cars) with no line to AI, even if the people are famous in AI.',
    }),
    announced_plan: noul({
      question: 'Is this mainly the announcement of something planned or promised (a project, an investment, a product to come), rather than events that actually happened and turned?',
      judge: 'Answer yes when the story is a plan, pledge or launch event and what it leads to has not happened yet. Answer no when the events played out and something changed because of them, even if they began with an announcement.',
    }),
  },
});

export const DRAMA_WEIGHTS = { central_want: 0.4, stakes: 0.15, scene: 0.15, turn: 0.15, implication: 0.15 } as const;

/** Without a central want (index below 2) the score is capped under any sensible bar (MD-29: a skip). */
export const NO_CENTRAL_WANT_CAP = 0.45;
/** "Mostly spectacle" (noul at or above SPECTACLE_YES) caps the score the same way. */
export const SPECTACLE_YES = 0.5;
export const SPECTACLE_CAP = 0.5;
/** "Mainly an announced plan" (Lucas skipped the announcement of a plan) caps the score the same way. */
export const ANNOUNCED_YES = 0.5;
/** Without an AI-world player at the center (MD-11, MD-29: why Lucas skipped the pin) the score is capped. */
export const NO_PLAYER_CAP = 0.45;
/** Not an AI story (a famous AI figure's other business) caps the score under the bar. */
export const ABOUT_AI_NO = 0.5;
export const NOT_AI_CAP = 0.45;

type ScoreAnswers = Record<string, { score?: number; noul?: number } | undefined>;

function level(answers: ScoreAnswers, key: string): number {
  const v = answers[key]?.score;
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`Jev returned no ${key} score`);
  return Math.min(LEVELS, Math.max(0, v));
}

const round = (n: number) => Math.round(n * 1000) / 1000;

export function combineDrama(answers: ScoreAnswers): Score {
  const notes: Record<string, string> = {};
  let total = 0;
  for (const [key, w] of Object.entries(DRAMA_WEIGHTS)) {
    const v = level(answers, key);
    total += w * (v / LEVELS);
    notes[key] = `${v.toFixed(2)}/4`;
  }
  const want = level(answers, 'central_want');
  if (want < 2 && total > NO_CENTRAL_WANT_CAP) {
    total = NO_CENTRAL_WANT_CAP;
    notes.cap = 'no central figure whose want drives the events (MD-29)';
  }
  const spectacle = answers.mostly_spectacle?.noul;
  if (typeof spectacle === 'number') {
    notes.mostly_spectacle = spectacle.toFixed(2);
    if (spectacle >= SPECTACLE_YES && total > SPECTACLE_CAP) {
      total = SPECTACLE_CAP;
      notes.cap = notes.cap ?? 'mainly a number or an announcement, not people acting on a want';
    }
  }
  const aboutAi = answers.about_ai?.noul;
  if (typeof aboutAi === 'number') {
    notes.about_ai = aboutAi.toFixed(2);
    if (aboutAi < ABOUT_AI_NO && total > NOT_AI_CAP) {
      total = NOT_AI_CAP;
      notes.cap = notes.cap ?? 'not an AI story';
    }
  }
  const announced = answers.announced_plan?.noul;
  if (typeof announced === 'number') {
    notes.announced_plan = announced.toFixed(2);
    if (announced >= ANNOUNCED_YES && total > SPECTACLE_CAP) {
      total = SPECTACLE_CAP;
      notes.cap = notes.cap ?? 'mainly an announced plan, not events that happened';
    }
  }
  return { score: round(total), notes };
}

// ── Material (MD-22): how likely real visuals exist, from the idea alone ─────

export const MATERIAL_SET = defineQuestionSet({
  id: 'reel-ai-drama-material-v1',
  version: '1',
  questions: {
    famous_faces: score(
      {
        question: 'How heavily photographed are the central people of this story?',
        judge: 'Judge how likely many usable, real photographs of the central people exist: public figures who appear often at events, on stages and in the press score high; private or rarely seen people score low.',
      },
      [
        'No one in it is likely to have any public photo.',
        'A photo or two may exist of someone in it.',
        'The central people have some public photos.',
        'The central people are widely photographed.',
        'The central people are among the most photographed figures in their field, over many years.',
      ],
    ),
    named_place: score(
      {
        question: 'Does the story happen in a real, nameable place that could be photographed or shown on a map?',
        judge: 'A specific building, room, venue, city or site scores high. "Online", "at the company" or no place at all scores low.',
      },
      [
        'No place.',
        'Only a vague place (a city, "the office").',
        'A named organization\'s offices or a known city.',
        'A specific, named place.',
        'A specific, named and well-photographed place tied to the moment.',
      ],
    ),
    published_artifacts: score(
      {
        question: 'How likely is it that published artifacts of this story exist and can be shown: posts, statements, documents, filings, papers, web pages, headlines?',
        judge: 'Reward stories that left a public paper trail with dates. Penalize stories known only through retellings or anonymous accounts.',
      },
      [
        'None likely.',
        'Perhaps a passing mention in the press.',
        'Some press coverage or an official statement.',
        'Several published artifacts: posts, statements, documents or a paper.',
        'A rich paper trail: dated documents, posts, filings or papers that show the key moments themselves.',
      ],
    ),
    photographed_events: score(
      {
        question: 'Were the key moments, or the public events around them, photographed or filmed?',
        judge: 'Hearings, trials, stages, keynotes, ceremonies, launches and press events are usually photographed. Private meetings, calls and messages are not, unless images surfaced later.',
      },
      [
        'Nothing in the story was photographed.',
        'Only unrelated or generic images exist.',
        'Some public events around the story were photographed.',
        'The main public moments were photographed or filmed.',
        'The key moments themselves were widely photographed or filmed.',
      ],
    ),
    variety: score(
      {
        question: 'How many different kinds of real visual could plausibly tell this story (people, places, documents, posts, products, logos, maps, charts, archival)?',
        judge: 'Count kinds, not quantity: a story told only through portraits scores low even if many exist.',
      },
      ['One kind at most.', 'Two kinds.', 'Three kinds.', 'Four or five kinds.', 'Six or more kinds.'],
    ),
    era_photos: score(
      {
        question: 'Do photos from the right time exist: the people as they looked then, the places and things as they were then?',
        judge: 'Recent stories about public figures score high. Stories from before the people were public, or from before photos were common online, score lower unless archival images are known to exist.',
      },
      [
        'Nothing from the time is likely to exist.',
        'Little from the time; mostly later photos.',
        'Some images from the time.',
        'Good images from the time.',
        'Abundant images from the time.',
      ],
    ),
  },
});

export const MATERIAL_WEIGHTS = {
  famous_faces: 0.25,
  photographed_events: 0.2,
  published_artifacts: 0.2,
  variety: 0.15,
  named_place: 0.1,
  era_photos: 0.1,
} as const;

export function combineMaterial(answers: ScoreAnswers): Score {
  const notes: Record<string, string> = {};
  let total = 0;
  for (const [key, w] of Object.entries(MATERIAL_WEIGHTS)) {
    const v = level(answers, key);
    total += w * (v / LEVELS);
    notes[key] = `${v.toFixed(2)}/4`;
  }
  return { score: round(total), notes };
}

// ── State and calls ─────────────────────────────────────────────────────────

/** Drama is judged from the pitch alone: no expected visuals, no sources, no engine. */
export function dramaState(p: Pitch) {
  return {
    title: p.title,
    logline: p.logline,
    pitch: p.pitch,
    story_type: STORY_TYPES[p.story_type],
    era: ERAS[p.era],
    event_date: p.event_date,
    cast: p.cast.map((c) => ({ name: c.name, role: c.role, want: c.want })),
    central_figure: p.central_figure,
    scene: p.scene,
    turn: p.turn,
    implication: p.implication,
    why_now: p.why_now,
  };
}

/** Material is judged from the idea, not the producer's own list of visuals (no self-grading). */
export function materialState(p: Pitch) {
  return {
    title: p.title,
    logline: p.logline,
    pitch: p.pitch,
    era: ERAS[p.era],
    event_date: p.event_date,
    cast: p.cast.map((c) => ({ name: c.name, role: c.role, kind: c.kind })),
    scene: p.scene,
  };
}

export type Scorable = { id: string | null; pitch: Pitch };

export async function scoreDrama(jev: DramaJevRunner, row: Scorable): Promise<Score> {
  const result = await jev.ask({ component: 'drama_score', state: dramaState(row.pitch), set: DRAMA_SET, questions: DRAMA_SET.questions, pitchId: row.id });
  const drama = combineDrama(result.answers as unknown as ScoreAnswers);
  return capWithoutPlayer(drama, row.pitch);
}

/** The story must center on someone from the central blue-chip list (MD-11): a cast member with a player_id. */
export function capWithoutPlayer(drama: Score, pitch: Pitch): Score {
  if (pitch.cast.some((c) => c.player_id) || drama.score <= NO_PLAYER_CAP) return drama;
  return { score: NO_PLAYER_CAP, notes: { ...drama.notes, cap: drama.notes.cap ?? 'no AI-world player at the center (MD-11)' } };
}

export async function scoreMaterial(jev: DramaJevRunner, row: Scorable): Promise<Score> {
  const result = await jev.ask({ component: 'material_score', state: materialState(row.pitch), set: MATERIAL_SET, questions: MATERIAL_SET.questions, pitchId: row.id });
  return combineMaterial(result.answers as unknown as ScoreAnswers);
}
