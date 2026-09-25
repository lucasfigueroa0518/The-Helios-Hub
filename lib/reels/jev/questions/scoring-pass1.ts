import { noul, score } from '@typesafe-ai/sdk';

import { defineQuestionSet } from '@/lib/reels/jev/question-set';
import {
  AUDIENCE_RULE,
  BLUE_CHIP_COMPANIES,
  BLUE_CHIP_PEOPLE,
  BUCKETS,
  ELEMENT_RULE,
  FRAMEWORKS,
  SOURCE_RULE,
} from '@/lib/reels/jev/questions/scoring-shared';

/**
 * P-08. Psychology, bucket fit, and blockbuster (D-073 through D-075, D-077,
 * D-083, D-084). Approved 2026-09-22 (D-086) as `scoring-pass1-v1`.
 *
 * One request. The questions are independent, so a bucket score cannot see the
 * psychology scores. Code applies the 0.60 / 0.25 gate and ignores a bucket
 * whose frameworks all failed it. Code also turns the three Nouls into one
 * +0.25 or nothing (D-087).
 *
 * Every Score uses the same five levels, indexes 0 through 4. Code divides the
 * raw score by 4. On that scale, 2 is 0.50 (workable, not viable) and 3 is
 * 0.75 (strong). A framework clears 0.60 only when the score leans strong.
 */

const companies = BLUE_CHIP_COMPANIES.join('; ');
const people = BLUE_CHIP_PEOPLE.join('; ');

export const SCORING_PASS_1 = defineQuestionSet({
  id: 'scoring-pass1',
  version: 'scoring-pass1-v1',
  questions: {
    curiosity: score(
      {
        question: 'How hook-worthy is the element in this source for a curiosity-gap post?',
        framework: FRAMEWORKS.curiosity.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
      },
      [
        'Absent. No element opens a gap between what a viewer knows and a specific thing they would want to know. There is no hidden cause and no result that cuts against the obvious explanation.',
        'Thin. A gap can be gestured at, but it is vague, or the source already gives the answer away. A developer, founder, executive, or operator would not feel the need to resolve it.',
        'Workable. The source contains a concrete unknown: a cause, a method, or a result that is not the obvious one. It could become an ordinary curiosity post. The pull is mild.',
        'Strong. A specific element withholds a high-reward answer the source actually supports. One of those audiences would want the missing piece, and getting it would be cheap once they stopped.',
        'Unmistakable. That hidden cause or counter-intuitive result is what the source is about. The gap is specific, the source holds the resolution, and it is the reason one of those audiences would stop.',
      ],
    ),
    arousal: score(
      {
        question: 'How hook-worthy is the element in this source for a high-arousal post?',
        framework: FRAMEWORKS.arousal.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
      },
      [
        'Absent. Nothing here would raise anger, awe, anxiety, or amusement. The material is calm, sad, or only informative.',
        'Thin. A mild charge is present, but it is generic hype or a soft mood. It would not push one of the audiences to watch, comment, or share.',
        'Workable. The source contains a real stake, surprise, or threat. It could become an ordinary high-arousal post. The urge to act on it is limited.',
        'Strong. A specific fact in the source would produce awe, anxiety, anger, or amusement for a developer, founder, executive, or operator in their own work. The charge comes from that fact.',
        'Unmistakable. The source is organized around that charge: a figure, a loss, a reversal, or a scene one of those audiences would stop for and pass on.',
      ],
    ),
    identity: score(
      {
        question: 'How hook-worthy is the element in this source for a social-identity post?',
        framework: FRAMEWORKS.identity.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
      },
      [
        'Absent. Nothing here gives a viewer a way to signal who they are. No practice, tool, or status line is at stake.',
        'Thin. A group or a role is mentioned, but sharing a post from this would not say anything about the person who shared it.',
        'Workable. A real in-group line or a contrarian stance is present. It could become an ordinary identity post. The boundary is soft.',
        'Strong. A specific element names a practice, tool, or stance that developers, founders, executives, or operators use to tell insiders from everyone else. Sharing it would signal membership or expertise.',
        'Unmistakable. The source is organized around that boundary. The line is one those viewers already feel, and the source gives them something sharp to stand with.',
      ],
    ),

    ballKnowledge: score(
      {
        question: 'How well could this source carry a Ball Knowledge post?',
        bucket: BUCKETS.ballKnowledge.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
      },
      [
        'Absent. No tool, repo, or concrete cost in the source could be the payoff of a list a developer or operator would save.',
        'Thin. A tool or a cost is mentioned, but it is generic or already obvious. Holding the specifics back would not create a reason to stop.',
        'Workable. The source has real tools, repos, or a concrete cost. It could become an ordinary payoff post. The reward for stopping is modest.',
        'Strong. A specific payoff is in the source: named tools or repos, or a concrete cost, that one of the audiences could act on. The hook can name the outcome and hold the list back.',
        'Unmistakable. That payoff is what the source is about. The items are specific, the gain or the savings is concrete, and a developer or operator would stop to get the list.',
      ],
    ),
    theNumber: score(
      {
        question: 'How well could this source carry a Number post?',
        bucket: BUCKETS.theNumber.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
      },
      [
        'Absent. The source has no hard figure that could carry a post on its own.',
        'Thin. It has a number, but the number is expected, decorative, or too vague to change what a viewer believes.',
        'Workable. A real figure is in the source and it pushes against what a developer, founder, executive, or operator would assume. It could become an ordinary stat post. The implication is soft.',
        'Strong. One figure in the source contradicts the expectation, and the consequence for one of those audiences is clear from the source. The stat can be the whole post.',
        'Unmistakable. That figure is the center of the source. It is specific, it is surprising to one of those audiences, and the implication is already in the material.',
      ],
    ),
    theSaga: score(
      {
        question: 'How well could this source carry a Saga post?',
        bucket: BUCKETS.theSaga.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
      },
      [
        'Absent. There is no sequence of events. Nothing here has a tense moment and a before and after.',
        'Thin. Events are mentioned, but there is no peak to open on and no chain a viewer would follow. A company announcement with no story sits here.',
        'Workable. The source has a real sequence and a moment of tension. It could become an ordinary narrative post. The stakes barely move.',
        'Strong. A specific moment in the source is the tense open, and the material holds the chronology that leads there. One of the audiences would follow it to see how it resolved.',
        'Unmistakable. The source is that story. The peak is concrete, the beats escalate, and the resolution is in the material.',
      ],
    ),
    personalProfile: score(
      {
        question: 'How well could this source carry a Personal Profile post?',
        bucket: BUCKETS.personalProfile.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
      },
      [
        'Absent. No person is the subject. A product or a company, even with a named executive in passing, is not a profile.',
        'Thin. A person is present, but the source offers a résumé rather than a turn. Two facts do not collide, and nothing improbable becomes inevitable.',
        'Workable. One person is the subject and the source has a turn: two facts that sit oddly together, or a path that changed. It could become an ordinary profile. The gap is small.',
        'Strong. The person is the subject, and the source holds a real collision or a real turn that one of the audiences would want resolved. The facts are specific and they are in the source.',
        'Unmistakable. The source is that person\'s turn. The unlikely facts are concrete, the change is in the material, and the profile is the reason to stop.',
      ],
    ),
    theWarning: score(
      {
        question: 'How well could this source carry a Warning post?',
        bucket: BUCKETS.theWarning.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        guardrail:
          'Levels Strong and Unmistakable require a concrete cost the source itself states, in money, time, or a measured failure, and the mechanism behind that cost. "Inefficient" or "risky" is not a cost. A warning that only works if a number is invented stays at Thin.',
      },
      [
        'Absent. No behavior in the source is costing one of the audiences money, time, or a result they already have. A general worry is not a warning.',
        'Thin. A risk is mentioned, but the cost is vague or it is not supported by the source. Making it sting would require inventing a number.',
        'Workable. The source states a real cost, but the mechanism is thin, or the cost is not one a developer, founder, executive, or operator is currently paying. It could become an ordinary warning.',
        'Strong. The source itself states a concrete cost, and it contains the mechanism behind that cost. One of the audiences could be doing the thing. A later fix would not have to invent the harm.',
        'Unmistakable. That cost and its mechanism are what the source is about. The harm is specific, sourced, and aimed at a behavior one of those audiences recognizes.',
      ],
    ),
    theCallout: score(
      {
        question: 'How well could this source carry a Callout post?',
        bucket: BUCKETS.theCallout.meaning,
        judge: ELEMENT_RULE,
        audiences: AUDIENCE_RULE,
        source: SOURCE_RULE,
        guardrail:
          'Levels Strong and Unmistakable require a line aimed at a practice, a tool, or a vendor. If the only sharp line attacks who the viewer is (founders, executives, operators, or developers as people who do not understand, are behind, or are not serious), the score stays at Thin, however hot the tone is. The voice has to be able to read as a peer raising a standard.',
      },
      [
        'Absent. No stance in the source draws a line around a practice, a tool, or a vendor. There is nothing a peer could challenge.',
        'Thin. The only sharp line attacks who the viewer is, or the stance is too vague to land. A practice-or-vendor line the source supports is not here.',
        'Workable. A real stance about a practice, tool, or vendor is present. It could become an ordinary callout. The line is hedged, or it could be read as scolding from outside the group.',
        'Strong. The source supports a clear position aimed at a practice, tool, or vendor. A developer, founder, executive, or operator can cross the line by changing what they do. The position can land without a hedge that lets everyone off.',
        'Unmistakable. That line is what the source is about. The target is a practice or a vendor, the position is specific, and one of those audiences would share it to mark which side they are on.',
      ],
    ),

    frontierDrop: noul(
      {
        question: 'Is the subject of this post idea a frontier model drop?',
        subject:
          'The subject is who or what the story is about. A name dropped in passing is not the subject.',
        counts:
          'A new model, or a new flagship product, released by one of these companies: ' + companies + '.',
        does_not_count:
          'A price change, a minor API update, a feature tweak, or a post about a model that already exists. A launch by a company that is not on the list.',
        source: SOURCE_RULE,
      },
      {
        true: 'The story is about that launch. The company on the list is the subject, and the event is a new model or a new flagship product.',
        false: 'The story is not about that kind of launch. A passing mention, a minor update, an existing model, or a company off the list.',
      },
    ),
    blueChipCompany: noul(
      {
        question: 'Is the subject of this post idea one of the seeded companies?',
        subject:
          'The subject is who the story is about. A company mentioned as background, as a customer, or in passing is not the subject.',
        companies,
        notes: 'Grok counts as xAI. A story about Google DeepMind is about a company on this list.',
        source: SOURCE_RULE,
      },
      {
        true: 'The story is about one of those companies, or about that company\'s model or flagship product.',
        false: 'None of those companies is the subject. A different company that merely uses one of them as a vendor is not about the vendor.',
      },
    ),
    blueChipPerson: noul(
      {
        question: 'Is the subject of this post idea one of the seeded people?',
        subject:
          'The subject is who the story is about. A person quoted, mentioned in passing, or listed among many names is not the subject.',
        people,
        source: SOURCE_RULE,
      },
      {
        true: 'The story is about one of those people.',
        false: 'None of those people is the subject.',
      },
    ),
  },
});
