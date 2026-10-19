import { score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * Explainers 3.2 analogy scoring (EX3-30, EX3-85). Question, state fields, judge rule, and level
 * text are the register's verbatim (planning/Explainer Reels/DECISIONS.md, "Analogy scoring v3");
 * tests/explainers-questions.test.ts fails if they drift. Approved in the 3.2 plan (Lucas,
 * 2026-10-13). Levels are indexes 0 to 4. Each candidate gets all seven questions in one call;
 * code applies the weights, the invented-rules rule and the tie-breaks
 * (lib/explainers/ideas/analogy.ts), never the model.
 */
export const ANALOGY_SCORING = defineQuestionSet({
  id: 'explainers-analogy-scoring',
  version: 'explainers-analogy-scoring-v3',
  questions: {
    simplicity: score(
      {
        question: "Is this analogy on the lowest rung of the ladder of simplicity that still carries the whole mechanism without invented rules?",
        judge: "The ladder: rung 1 is one object or physical effect; rung 2 is one everyday action by one character with at most three objects; rung 3 is a familiar everyday situation or place almost everyone has lived. Judge whether the candidate sits on the lowest rung that carries the whole mechanism, including why the concept matters, with no invented rules (anything the viewer must be told about how the analogy itself works). A lower rung that needs an invented rule is worse than a higher rung that needs none. Count the parts the viewer must track and penalize parts that add tracking without helping the mechanism. Do not reward simplicity for its own sake: a slightly richer analogy that fits the mechanism perfectly is not penalized for its extra fitting parts.",
      },
      [
        "Wrong rung. Cluttered with parts and rules the mechanism does not need, or stripped down so far that it only works once its own rules are explained.",
        "Off. Either an invented contraption the viewer must be taught, or a busy situation whose parts compete with the mechanism.",
        "Workable. Close to the right rung: one part could be cut, or the scene leans on one small rule the viewer must be told.",
        "Right rung. The lowest rung that carries the mechanism without invented rules; every part helps.",
        "Effortless. The simplest picture that could carry this mechanism: nothing to cut and nothing to explain, whether a basic object or a familiar situation.",
      ],
    ),
    reach: score(
      {
        question: "How many people would instantly understand the everyday situation this analogy uses?",
        judge: "Judge the everyday situation or objects themselves, not the technical concept. Reward situations and objects that nearly anyone understands instantly, whatever their country, job, or age, whether they are basic objects or familiar everyday situations. Penalize situations that need a specific culture, profession, hobby, or prior knowledge to understand.",
      },
      [
        "Niche. Only people with specific expertise or experience would follow the situation.",
        "Limited. Familiar to a particular group, region, or profession, but many viewers would not recognize it.",
        "Common. Most adults would recognize the situation, though some details need explaining.",
        "Widely shared. Almost everyone has been in this situation and understands how it works without any setup.",
        "Universal. Anybody understands the situation instantly, with no setup, whoever they are.",
      ],
    ),
    mapping_fidelity: score(
      {
        question: "How closely does the way this analogy's elements interact, or the way its process unfolds, match how the concept actually works?",
        judge: "Compare the analogy's elements and process with the real mechanism, step by step. Reward analogies where each element stands for a real component and the interactions happen for the same reasons and in the same order as in the real system. Penalize mappings that break at an important step, teach a wrong mental model, or match only on the surface.",
      },
      [
        "Misleading. The process works differently from the real mechanism; the viewer would learn the wrong model.",
        "Surface match. The elements resemble the real parts, but how they interact does not match how the system works.",
        "Partial. The central interaction matches, but at least one important step or part breaks and needs careful handling.",
        "Strong. The elements map onto the real components and the process unfolds the way the real one does, with only minor limits.",
        "Exact. Every element and every step corresponds to the real mechanism; the scene could carry the mapping and the example without becoming inaccurate.",
      ],
    ),
    visual_strength: score(
      {
        question: "How strong is this analogy as a picture in the Helios paper style?",
        judge: "Judge the scene as drawn animation: isometric paper objects with ink outlines, simple cartoon critters for every character, everyday props, short labels, lines that draw themselves, and cuts between wide shots, close-ups and cutaways. Reward scenes where every element is recognizable at phone size without a label, from its silhouette alone, and whose mechanism is visible as motion and changing state rather than explained by narration. Penalize scenes that need people, hands or other body parts, facial detail, text, or things that are hard to draw simply.",
      },
      [
        "Hard to show. The analogy lives in words; drawn, it would be static or unreadable.",
        "Weak picture. Some objects can be drawn, but the mechanism would mostly be told rather than shown.",
        "Workable picture. Recognizable objects and at least one meaningful motion show part of the mechanism.",
        "Strong picture. Clear silhouettes, a readable layout, and motion that shows the mechanism at work.",
        "Exceptional picture. The scene is instantly readable at phone size, the mechanism plays out as visible motion and state changes, and the eye moves through it naturally.",
      ],
    ),
    visual_payoff: score(
      {
        question: "How satisfying is the visual payoff this analogy builds to?",
        judge: "Judge the moment the analogy builds toward: the outcome the scene resolves on. Reward a payoff the viewer can anticipate and then see land as a clear, physical result (a stack completes, a door opens, the right package arrives). It must come from the mechanism itself. Penalize payoffs that are only stated, arbitrary, or decorative.",
      },
      [
        "No payoff. Nothing in the scene resolves; it only shows a state.",
        "Weak payoff. Something resolves, but it is small, unclear, or only explained by narration.",
        "Clear payoff. A visible result lands, though with little anticipation or satisfaction.",
        "Satisfying payoff. The scene builds anticipation and resolves on a clear, physical result that comes from the mechanism.",
        "Memorable payoff. A built-up, visible, physical result that resolves the scene's tension so cleanly the viewer remembers it.",
      ],
    ),
    familiarity: score(
      {
        question: "Does the viewer already know how this analogy behaves, without being told?",
        judge: "Judge the analogy on its own, as a viewer who has never seen it before. Reward situations, objects, and actions whose behavior the viewer already knows from life, so the reel can use what they know instead of teaching it. List any rule the viewer would have to be told for the analogy to work, such as what an invented object does or a property a familiar object does not really have; a candidate with any such invented rule scores at most 1. Penalize contraptions built to fit the concept.",
      },
      [
        "Invented. A made-up contraption; nothing about it works until it is explained.",
        "Needs teaching. At least one rule about how it works must be told to the viewer.",
        "Mostly known. The viewer knows the situation, but one behavior the analogy relies on is unusual or must be pointed out.",
        "Known. The viewer already knows how everything in it behaves; the reel only has to show it.",
        "Second nature. Behavior so familiar the viewer predicts what happens next before it happens.",
      ],
    ),
    hook_clarity: score(
      {
        question: "Would a viewer with no context understand this analogy's opening moment within one second?",
        judge: "Judge the candidate's hook alone, as the very first thing a scrolling viewer sees, with no title, no narration, and no idea what the video is about. Reward a familiar situation with recognizable characters and objects and an obvious problem, surprise, or near-miss that makes the viewer want to see what happens. Penalize hooks that are niche, strange for their own sake, depend on the analogy's own rules, or show something the viewer cannot name.",
      },
      [
        "Baffling. The viewer cannot tell what they are looking at.",
        "Confusing. Recognizable pieces, but the moment only makes sense once the analogy is explained.",
        "Readable. The viewer gets what they see after a moment, but nothing pulls them in.",
        "Clear. Understood at a glance, with a problem or surprise that invites a second look.",
        "Instant. Understood in a heartbeat and impossible not to watch: a familiar moment going wrong or about to happen.",
      ],
    ),
  },
});

/** The register's "State fields": every analogy question sees the same three. */
export const ANALOGY_SCORING_FIELDS = ['topic_title', 'topic_scope', 'candidate'] as const;
