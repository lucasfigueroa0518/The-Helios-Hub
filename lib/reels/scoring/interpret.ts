import {
  ballKnowledgeBump,
  blockbusterBonus,
  netScore,
  normalizeJevScore,
  openBuckets,
  pickBucket,
  psychologyTerm,
  survivingFrameworks,
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
  knowledge: Scored | null;
  entertainment: Scored | null;
  value: number | null;
  blockbusterNouls: { frontierDrop: number; company: number; person: number };
  blockbuster: number;
  /** 0.08 when the winning bucket is Ball Knowledge. 0 otherwise. */
  ballKnowledge: number;
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
  const ballKnowledge = ballKnowledgeBump(chosenBucket);

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
      ballKnowledge,
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
    ballKnowledge,
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
  const knowledge = level(answers.knowledge);
  const entertainment = level(answers.entertainment);
  const value = valueTerm(knowledge.score, entertainment.score);
  return {
    ...base,
    knowledge,
    entertainment,
    value,
    net: netScore({
      psychology: base.psychologyTerm,
      bucket: base.bucketScore,
      value,
      blockbuster: base.blockbuster,
      ballKnowledge: base.ballKnowledge,
    }),
  };
}
