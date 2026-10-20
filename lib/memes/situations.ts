/**
 * The audience situations Lucas approved on 2026-10-13
 * (planning/Memes/AUDIENCE_SITUATIONS.md, ME-63), as data: the "feeling"
 * layer (ME-02). A change here needs his approval again. A situation used in
 * a published meme rests for 3 days (ME-65).
 */
import type { Situation } from './types';

/** The rules every situation follows (AUDIENCE_SITUATIONS.md), in the prompt's words. */
export const SITUATION_RULES = [
  "It is about the viewer's experience, never a company's personality. The company is whoever is in today's news.",
  'It never punches down. When a story hurts people (layoffs, harm), the joke is never on them.',
  'It takes no political side.',
  "The viewer line is a pattern. Fill the bracket from the story's facts and invent nothing.",
] as const;

export const SITUATION_REST_DAYS = 3;

export const AUDIENCE_SITUATIONS: readonly Situation[] = [
  {
    id: 'AS-01', name: 'Just learned it', audience: 'everyday',
    feeling: 'I finally figured out how to use it, and now there\'s a new one.',
    broughtUpBy: 'a new model or version; a redesign of an app people use',
    viewerLine: 'Me, still using the tricks I learned for [the old version]',
    shapes: ['abandon A for B', 'reject A, approve B'],
    keepClearOf: "implying the old one stopped working when it didn't",
  },
  {
    id: 'AS-02', name: 'Subscription pile-up', audience: 'everyday',
    feeling: 'How many AI subscriptions am I paying for now?',
    broughtUpBy: 'a new paid tier; a price change; a bundle',
    viewerLine: 'Me, adding a [new tier] to the [N] I already pay for',
    shapes: ['refuse the obvious choice', 'two buttons (dilemma)'],
    keepClearOf: 'inventing prices; every number comes from the story',
  },
  {
    id: 'AS-03', name: 'It answered differently today', audience: 'everyday',
    feeling: 'The same question got a different answer than yesterday.',
    broughtUpBy: 'a model update; a reported change in how a model behaves',
    viewerLine: 'Me, asking the exact same thing after [the update]',
    shapes: ['expectation vs. reality', 'a reveal that reframes it'],
    keepClearOf: "claiming a change the story doesn't report",
  },
  {
    id: 'AS-04', name: 'The free tier shrinks', audience: 'everyday',
    feeling: 'The thing I used for free now has limits, ads or a paywall.',
    broughtUpBy: 'new usage limits; ads in an AI product; features moving to paid',
    viewerLine: 'Me, hitting [the new limit] by lunch',
    shapes: ['refuse the obvious choice', 'expectation vs. reality'],
    keepClearOf: 'exaggerating the limit beyond what was announced',
  },
  {
    id: 'AS-05', name: 'Best model ever, again', audience: 'everyday',
    feeling: "Every week there's a new 'best model ever'. Which one do I actually use?",
    broughtUpBy: 'several launches close together; benchmark claims; a stack-up week',
    viewerLine: 'Me, deciding which one to use this week',
    shapes: ['chain or stack-up', 'dilemma', 'abandon A for B'],
    keepClearOf: "ranking models ourselves; any ranking must be the sources'",
  },
  {
    id: 'AS-06', name: 'The keynote vs. my screen', audience: 'everyday',
    feeling: 'The launch looked amazing. Then I opened the app.',
    broughtUpBy: 'a launch event; a big announcement before the rollout',
    viewerLine: 'Me, after the demo vs. me, opening the app',
    shapes: ['expectation vs. reality', 'naive hope, ominous answer'],
    keepClearOf: "calling a product bad; the gap is between the demo and the viewer's day",
  },
  {
    id: 'AS-07', name: 'The AI person at the table', audience: 'everyday',
    feeling: "I'm the one family and coworkers ask about every AI headline.",
    broughtUpBy: 'a mainstream story (a big deal, a policy move, a viral moment)',
    viewerLine: 'Me, explaining [the headline] at dinner',
    shapes: ['a plan with a flaw at the last step', 'the reveal'],
    keepClearOf: 'making the asker look stupid',
  },
  {
    id: 'AS-08', name: 'Work just discovered AI', audience: 'everyday',
    feeling: "My company announced we're 'using AI for everything now'.",
    broughtUpBy: 'big enterprise adoption deals; companies announcing AI rollouts',
    viewerLine: 'Me, reading the company-wide AI memo',
    shapes: ['a plan with a flaw at the last step', 'refuse the obvious choice'],
    keepClearOf: 'layoffs; a story about job cuts never gets this situation',
  },
  {
    id: 'AS-09', name: 'Wait, it remembers that?', audience: 'everyday',
    feeling: 'Hold on, it saved that? Who can see it?',
    broughtUpBy: 'memory features; a privacy-policy change; a data deal',
    viewerLine: 'Me, remembering what I told it last month',
    shapes: ['naive hope, ominous answer', 'the reveal'],
    keepClearOf: "claiming data misuse the story doesn't report",
  },
  {
    id: 'AS-10', name: "My app didn't get it first", audience: 'everyday',
    feeling: "The feature I've wanted just shipped in a different app.",
    broughtUpBy: 'a rival launching what another app lacks (a stack-up story)',
    viewerLine: 'Me, looking at [the feature] in the other app',
    shapes: ['abandon A for B', 'reject A, approve B'],
    keepClearOf: "declaring a winner; this is about the viewer's envy",
  },
  {
    id: 'AS-11', name: 'Not on my account yet', audience: 'everyday',
    feeling: "It's 'rolling out gradually'. Just not to me.",
    broughtUpBy: 'a staged rollout; a feature for one country, one plan or a waitlist first',
    viewerLine: 'Me, refreshing the app for [the feature]',
    shapes: ['waiting forever', 'expectation vs. reality'],
    keepClearOf: 'saying a rollout is fake or late unless the story does',
  },
  {
    id: 'AS-12', name: 'Numbers too big to feel', audience: 'everyday',
    feeling: "They raised how many billions? I'm debating a $20 plan.",
    broughtUpBy: 'funding rounds; valuations; data-center spending',
    viewerLine: 'Me, comparing [the figure] to my budget',
    shapes: ['reject A, approve B', 'scale contrast'],
    keepClearOf: 'rounding or inflating the figure; quote it as the source writes it',
  },
  {
    id: 'AS-13', name: 'Everything is in the old app', audience: 'everyday',
    feeling: 'The new one is better, but all my chats and projects are in the old one.',
    broughtUpBy: 'a strong launch from a competitor; export or import features',
    viewerLine: 'Me, with [N] months of chats in the old app',
    shapes: ['dilemma', "the swerve (the exit you shouldn't take)"],
    keepClearOf: "claiming you can't export when you can",
  },
  {
    id: 'AS-14', name: 'Confidently wrong', audience: 'everyday',
    feeling: 'It sounded so sure. It was wrong.',
    broughtUpBy: 'a widely reported AI mistake; a study of accuracy failures',
    viewerLine: 'Me, checking the answer it was very sure about',
    shapes: ['the reveal', 'naive hope, ominous answer'],
    keepClearOf: 'harm; when a mistake hurt someone, no joke at all',
  },
  {
    id: 'AS-15', name: 'Agents vs. my actual errands', audience: 'everyday',
    feeling: 'They demo agents that run your life. I just want it to fill in this form right.',
    broughtUpBy: 'agent launches; "it does tasks for you" announcements',
    viewerLine: 'Me, asking the agent to do [one simple task]',
    shapes: ['expectation vs. reality', 'a plan with a flaw at the last step'],
    keepClearOf: 'claiming the agent fails unless the story says so',
  },
  {
    id: 'AS-16', name: 'What is it called now?', audience: 'everyday',
    feeling: 'Mini, Pro, Ultra, 4.5, 5.1, a new name... which one is the good one?',
    broughtUpBy: 'confusing model names; a rename or rebrand',
    viewerLine: 'Me, trying to tell [name] from [name]',
    shapes: ["they're the same picture", 'dilemma'],
    keepClearOf: 'getting a name wrong; names come from the registry',
  },
  {
    id: 'AS-17', name: 'Is this allowed where I live?', audience: 'everyday',
    feeling: 'One place allows it, another bans it. Can I use it here?',
    broughtUpBy: 'a new law or ruling; a feature blocked in one region',
    viewerLine: 'Me, checking if [the feature] works in my country',
    shapes: ['dilemma', 'the swerve'],
    keepClearOf: 'taking sides on the policy; the confusion is the joke, never the government',
  },
  {
    id: 'AS-18', name: 'It changed under my code', audience: 'builder',
    feeling: 'The API I built on just changed: price, limit or deprecation.',
    broughtUpBy: 'API pricing changes; rate limits; a model deprecation date',
    viewerLine: 'Me, reading the deprecation email for [the model]',
    shapes: ['naive hope, ominous answer', 'refuse the obvious choice'],
    keepClearOf: "jargon the everyday viewer can't follow; it must read without knowing what an API is",
  },
  {
    id: 'AS-19', name: 'New model mid-project', audience: 'builder',
    feeling: 'We just finished tuning everything for the last model.',
    broughtUpBy: 'a model release that obsoletes last month\'s choice',
    viewerLine: 'Me, two days after finishing the setup for [the old model]',
    shapes: ['the swerve', 'abandon A for B'],
    keepClearOf: 'implying the old model stopped working',
  },
  {
    id: 'AS-20', name: 'My idea is now a feature', audience: 'builder',
    feeling: 'A big company just shipped the thing my product does, for free.',
    broughtUpBy: 'a platform launching a feature a category of startups sells',
    viewerLine: 'Me, watching [the company] announce [the feature]',
    shapes: ['the reveal', 'reject A, approve B'],
    keepClearOf: 'naming a startup as the victim; the viewer is the builder',
  },
];

const byId = new Map(AUDIENCE_SITUATIONS.map((x) => [x.id, x]));
export const situation = (id: string): Situation | undefined => byId.get(id);
