import {
  blockbusterBonus,
  boostedEntertainment,
  netScore,
  normalizeJevScore,
  openBuckets,
  pickBucket,
  psychologyTerm,
  survivingFrameworks,
  tieredBlockbuster,
  valueTerm,
  winningFramework,
  type BucketId,
  type BucketJudgment,
  type FrameworkId,
  type FrameworkScores,
} from '@/lib/reels/scoring/decide';

type Scored = { score: number; confidence: number };
type YesNo = { noul: number };

export type Pass1Answers = {
  curiosity: Scored;
  arousal: Scored;
  identity: Scored;
  ballKnowledge: Scored;
  theNumber: Scored;
  theSaga: Scored;
  personalProfile: Scored;
  theWarning: Scored;
  theCallout: Scored;
  frontierDrop: YesNo;
  blueChipCompany: YesNo;
  blueChipPerson: YesNo;
};

export type Pass2Answers = {
  /** D-255. Time or money saved or made, or something usable this week. */
  useful: Scored;
  /** D-255. Important to know. The key kept its name from v3. */
  knowledge: Scored;
  entertainment: Scored;
};

const BUCKET_ANSWER: Record<BucketId, keyof Pass1Answers> = {
  ball_knowledge: 'ballKnowledge',
  the_number: 'theNumber',
  the_saga: 'theSaga',
  personal_profile: 'personalProfile',
  the_warning: 'theWarning',
  the_callout: 'theCallout',
};

export type InterpretedScore = {
  psychology: Record<FrameworkId, Scored>;
  surviving: FrameworkId[];
  buckets: Partial<Record<BucketId, Scored>>;
  chosenBucket: BucketId | null;
  chosenFramework: FrameworkId | null;
  psychologyTerm: number | null;
  bucketScore: number | null;
  bucketConfidence: number | null;
  /** Absent on rows scored before scoring-pass2-v4. */
  useful?: Scored | null;
  knowledge: Scored | null;
  entertainment: Scored | null;
  value: number | null;
  blockbusterNouls: { frontierDrop: number; company: number; person: number };
  blockbuster: number;
  /** The Ball Knowledge bump, removed by D-261. Only rows scored before it carry one. */
  ballKnowledge?: number;
  /** D-261. True when the entertainment boost applied to value. */
  entertainmentBoosted?: boolean;
  net: number | null;
};

function level(answer: Scored): Scored {
  return {
    score: normalizeJevScore(answer.score),
    confidence: answer.confidence,
  };
}

/** Pass 1 answers onto the 0–1 scale, then the gate and the winning bucket. */
export function interpretPass1(answers: Pass1Answers): InterpretedScore {
  const psychology: Record<FrameworkId, Scored> = {
    curiosity: level(answers.curiosity),
    arousal: level(answers.arousal),
    identity: level(answers.identity),
  };
  const frameworkScores: FrameworkScores = {
    curiosity: psychology.curiosity.score,
    arousal: psychology.arousal.score,
    identity: psychology.identity.score,
  };
  const confidence: Record<FrameworkId, number> = {
    curiosity: psychology.curiosity.confidence,
    arousal: psychology.arousal.confidence,
    identity: psychology.identity.confidence,
  };
  const surviving = survivingFrameworks(frameworkScores);
  const open = new Set(openBuckets(surviving));

  const buckets: Partial<Record<BucketId, Scored>> = {};
  const judgments: BucketJudgment[] = [];
  for (const bucket of open) {
    const scored = level(answers[BUCKET_ANSWER[bucket]] as Scored);
    buckets[bucket] = scored;
    judgments.push({ bucket, score: scored.score, confidence: scored.confidence });
  }

  const chosenBucket = pickBucket(judgments, frameworkScores, surviving);
  const blockbusterNouls = {
    frontierDrop: answers.frontierDrop.noul,
    company: answers.blueChipCompany.noul,
    person: answers.blueChipPerson.noul,
  };
  const blockbuster = blockbusterBonus(blockbusterNouls);

  if (!chosenBucket) {
    return {
      psychology,
      surviving,
      buckets,
      chosenBucket: null,
      chosenFramework: null,
      psychologyTerm: null,
      bucketScore: null,
      bucketConfidence: null,
      knowledge: null,
      entertainment: null,
      value: null,
      blockbusterNouls,
      blockbuster,
      net: null,
    };
  }

  const chosen = buckets[chosenBucket];
  return {
    psychology,
    surviving,
    buckets,
    chosenBucket,
    chosenFramework: winningFramework(chosenBucket, frameworkScores, surviving, confidence),
    psychologyTerm: psychologyTerm(chosenBucket, frameworkScores, surviving),
    bucketScore: chosen?.score ?? null,
    bucketConfidence: chosen?.confidence ?? null,
    knowledge: null,
    entertainment: null,
    value: null,
    blockbusterNouls,
    blockbuster,
    net: null,
  };
}

/** Folds pass 2 into a pass-1 result. No chosen bucket means there is no net. */
export function applyPass2(base: InterpretedScore, answers: Pass2Answers): InterpretedScore {
  if (
    base.chosenBucket == null ||
    base.psychologyTerm == null ||
    base.bucketScore == null
  ) {
    return base;
  }
  const useful = level(answers.useful);
  const knowledge = level(answers.knowledge);
  const entertainment = level(answers.entertainment);
  const boosted = boostedEntertainment(useful.score, knowledge.score, entertainment.score);
  const value = valueTerm(useful.score, knowledge.score, boosted);
  const blockbuster = tieredBlockbuster(base.blockbuster, value);
  return {
    ...base,
    useful,
    knowledge,
    entertainment,
    value,
    entertainmentBoosted: boosted !== entertainment.score,
    blockbuster,
    net: netScore({
      psychology: base.psychologyTerm,
      bucket: base.bucketScore,
      value,
      blockbuster,
    }),
  };
}
