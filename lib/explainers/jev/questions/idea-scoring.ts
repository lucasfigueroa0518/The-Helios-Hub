import { score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';

/**
 * E-15 idea scoring, approved by Lucas in the kickoff packet (2026-10-07); v2 for
 * Explainers 3.0 (EX3-32, EX3-33: beginner concepts favored inside audience_fit,
 * the eight-beat reel, the new visual system); v3 for Explainers 3.1 (the
 * one-minute reel, and Q7 ai_focus, EX3-73), drafted 2026-10-13, awaiting
 * Lucas's approval (R6). Question, state fields, judge rule, and level text are
 * the register's verbatim (planning/Explainer Reels/DECISIONS.md, "Idea scoring
 * v3"); tests/explainers-questions.test.ts fails if they drift. Levels are
 * indexes 0 to 4. Code applies the weights,
 * gates, and tie-breaks (lib/explainers/scoring.ts), never the model.
 *
 * Each question is sent only the state fields the packet lists for it, so
 * questions are grouped into calls by their field list (IDEA_SCORING_FIELDS).
 */
export const IDEA_SCORING = defineQuestionSet({
  id: 'explainers-idea-scoring',
  version: 'explainers-idea-scoring-v3',
  questions: {
    audience_fit: score(
      {
        question: "How strongly would teaching this topic advance durable practical literacy in AI, software, or computer science for the Explainer Reels audience?",
        judge: "Judge the educational value of the underlying concept for a broad audience ranging from nontechnical business people to technically curious professionals. Reward durable mental models that help someone understand how modern technology works. Favor beginner concepts: the more beginner the concept, the larger its total addressable audience, because more viewers can enter it with no prior knowledge and use it in their own life. Between two equally valuable concepts, the more beginner one scores higher. Do not reward a beginner topic that teaches little, and do not reward a topic merely because it is timely, popular, surprising, or related to AI.",
      },
      [
        "Outside the curriculum. Primarily news, consumer technology, product commentary, speculation, prompt hacks, future-of-work discussion, opinion, or another subject that does not meaningfully teach durable AI/software/computer-science knowledge.",
        "Weak fit. Technically related to the curriculum, but mostly trivia, an excessively niche implementation detail, an advanced concept only specialists meet, or a concept with little useful mental-model value for this audience.",
        "Valid curriculum topic. Teaches a legitimate technical concept with some practical value. A viewer would learn something useful, but the concept is not especially high-leverage or broadly relevant.",
        "Strong curriculum topic. A durable concept that people working around modern software or AI are likely to encounter and benefit from understanding, and that a beginner can follow with no background. It clearly improves the viewer's technical literacy.",
        "Exceptional curriculum topic. A foundational, beginner-level mental model that nearly everyone in the audience meets and that unlocks understanding of multiple other concepts or meaningfully changes how a nontechnical person understands modern technology. Merely being relevant is not enough.",
      ],
    ),
    teachability_45s: score(
      {
        question: "Can this topic be taught as one complete and genuinely understandable thought in a one-minute Explainer Reel?",
        judge: "Judge scope, not underlying technical difficulty. An advanced concept may score highly if one useful thought about it can genuinely be taught to a nontechnical viewer. Assume the reel must support a curiosity-gap hook, a plain definition, one everyday analogy, a mapping of that analogy onto the real components, one tiny real example, and one real-world context beat. Do not reward a topic that only fits by racing through several subtopics or removing information necessary for understanding.",
      },
      [
        "Cannot fit. The topic contains several independent lessons, requires substantial prerequisite knowledge, or is so broad that a one-minute explanation would be superficial rather than educational.",
        "Fits only through harmful compression. A reel could technically discuss it, but only by hand-waving important mechanics, skipping necessary context, or cramming multiple thoughts together.",
        "Teachable with careful narrowing. There is a coherent one-minute lesson inside the topic, although the treatment must be tightly scoped and some surrounding complexity must be deliberately excluded.",
        "Naturally teachable. The topic maps cleanly onto one curiosity gap, definition, analogy, mapping, tiny example, and real-world implication with little prerequisite knowledge.",
        "Exceptionally clean learning unit. The topic contains one crisp mechanism or distinction that can be fully developed rather than merely summarized within the format. The definition, analogy, mapping, example, and real-world beat all fit comfortably.",
      ],
    ),
    analogy_potential: score(
      {
        question: "How naturally can this concept be mapped to one everyday analogy without materially distorting how the concept actually works?",
        judge: "Reward analogies whose parts map meaningfully onto the technical concept and that can become one full, drawable everyday scene the whole reel revolves around, with the mapping and the example playing out inside it. Do not reward catchy metaphors that break down immediately or teach the wrong mental model.",
      },
      [
        "No useful analogy. An everyday analogy would substantially misrepresent the concept or provide no meaningful help.",
        "Forced or misleading analogy. A metaphor can be invented, but important parts of the mapping fail and could leave the viewer with the wrong understanding.",
        "Workable analogy. There is a reasonable everyday comparison that communicates the central idea, although its limits need careful handling.",
        "Strong analogy. A familiar situation maps naturally onto the concept's important components and would materially improve comprehension.",
        "Exceptional analogy. The everyday system maps unusually cleanly onto the technical system and becomes one scene that can carry multiple beats of the reel—including the mapping and the example—without becoming inaccurate.",
      ],
    ),
    visual_potential: score(
      {
        question: "How much potential does this topic have for an engaging, visually explanatory one-minute animation, including a highly visual everyday analogy?",
        judge: "Judge how effectively the intended lesson could be communicated and made entertaining through code-drawn animation in the Helios paper style: isometric paper objects with ink outlines, drawn on demand for each reel, so any everyday object or place can be built from simple solids; simple characters when someone has to act or react; short labels on objects; lines and paths that draw themselves; and a calm camera. Do not assume photography, stock footage, realistic illustration, or 3D renders.\nReward visuals that actively explain the mechanism rather than merely decorate narration: semantic motion that communicates the idea, anticipatory motion that builds an outcome to await, and state-driven motion where a rule produces a visible consequence. Consider whether processes, relationships, transformations, sequences, comparisons, data flows, or changing states can be animated clearly.\nAlso give modest additional credit when the concept naturally supports a highly visual everyday analogy that can anchor the whole reel as one scene, with a satisfying visual payoff and moments for synchronized sound effects. Do not make analogy potential the dominant factor here; it has its own separate score.",
      },
      [
        "Poor visual fit. The lesson is fundamentally difficult to demonstrate visually in the available medium. Even with drawn objects, labels, and motion, most of the understanding would have to come from narration.",
        "Limited visual potential. Recognizable visuals can accompany the explanation, but they would mostly decorate the narration. The concept offers little useful animation, visual transformation, or engaging analogy material.",
        "Solid visual potential. The topic supports at least one useful explanatory animation or drawn analogy scene, plus some meaningful use of objects, labels, flows, comparisons, or changing state. Visuals improve the lesson but do not carry most of it.",
        "Strong visual potential. The reel can repeatedly show rather than tell. The analogy can become an engaging animated scene that the mapping or the example plays out in, with clear motion, relationships, or visual state changes.",
        "Exceptional visual potential. The topic naturally lends itself to a memorable visual story. A compelling everyday analogy can be richly animated as one scene of simple drawn objects, labels, motion, and sound cues; it maps cleanly onto the technical system; and multiple beats can communicate meaning primarily through animation rather than narration. This level should be difficult to reach.",
      ],
    ),
    accuracy_under_simplification: score(
      {
        question: "Can this concept be simplified enough for the format while remaining materially correct?",
        judge: "Judge the risk created by simplifying the topic for a nontechnical audience. Reward concepts whose essential mechanism remains correct when jargon and secondary details are removed. Penalize topics where crucial exceptions, prerequisites, disputed claims, or interacting mechanisms would need to be omitted. When source text is provided, the proposed lesson must also be supportable from that source because sourced reels may not introduce unsupported claims.",
      },
      [
        "Cannot be simplified safely. Any one-minute treatment would likely communicate a materially false mental model, omit a defining qualification, or—when a source exists—require claims the source does not support.",
        "High distortion risk. The concept can only be made accessible by removing so many essential caveats or mechanics that the explanation risks being misleading.",
        "Accurate with careful framing. A correct simplified lesson is possible if the scope is explicitly constrained and at least one important caveat is handled well.",
        "Strong simplification resilience. The important mechanism can be expressed plainly while remaining materially correct. Secondary details can be excluded without changing the viewer's core mental model.",
        "Exceptionally robust. The concept has a precise central mechanism or distinction that remains fully valid after simplification and lends itself to a concrete, accurate miniature example. There are few material traps.",
      ],
    ),
    hook_strength: score(
      {
        question: "How strong is the truthful, non-hype hook potential inherent in this topic?",
        judge: "Judge whether the lesson naturally creates immediate curiosity, recognition, useful tension, or a knowledge gap for the target audience. Reward a gap that reaches the most viewers, because it touches almost everyone's life, or whose answer is the most valuable to know. The hook must emerge from the concept itself. Do not reward sensationalism, fear, exaggerated claims, artificial controversy, or clickbait wording.",
      },
      [
        "No credible hook. There is little reason for the intended viewer to care immediately unless the topic is exaggerated or sensationalized.",
        "Weak hook. A reasonable introduction can be written, but the concept creates little natural curiosity or relevance.",
        "Solid hook. The topic connects to a recognizable question, confusion, system, or problem and can support a credible opening.",
        "Strong hook. The concept contains a meaningful curiosity gap, misconception, counterintuitive mechanism, or familiar technology the viewer likely uses without understanding.",
        "Exceptional hook. The topic contains an immediate, specific, and truthful tension that naturally makes someone want the explanation, and it reaches almost everyone or answers something genuinely valuable to know. It is surprising or highly recognizable without needing hype.",
      ],
    ),
    ai_focus: score(
      {
        question: "How directly does this topic teach a concept about artificial intelligence?",
        judge: "Judge the subject of the lesson, not its wording. Reward topics whose core concept is part of how AI systems work. Give partial credit to computer-science or tech concepts that directly enable or explain AI systems, when the lesson makes that link. Do not reward a general computing topic merely because AI uses it, and do not reward the word AI in a title when the lesson itself is not about AI.",
      },
      [
        "Not about AI. A general computing or technology concept with no direct link to how AI works.",
        "General computing that AI merely uses. A general building block taught without its role in AI.",
        "Enables AI. A computer-science or tech concept that directly enables or explains AI systems, taught with that link.",
        "An AI concept. The lesson teaches how some part of AI systems works.",
        "A core AI concept. A foundational idea about how modern AI works that many other AI concepts depend on.",
      ],
    ),
  },
});

/** E-15 "State fields" per question, verbatim. */
export const IDEA_SCORING_FIELDS = {
  audience_fit: ["topic_title", "theme_brief"],
  teachability_45s: ["topic_title", "topic_scope", "source_text, if present"],
  analogy_potential: ["topic_title", "topic_scope"],
  visual_potential: ["topic_title", "topic_scope", "source_text, if present"],
  accuracy_under_simplification: ["topic_title", "topic_scope", "source_text, if present"],
  hook_strength: ["topic_title", "topic_scope"],
  ai_focus: ["topic_title", "topic_scope"],
} as const satisfies Record<keyof typeof IDEA_SCORING.questions, readonly string[]>;
