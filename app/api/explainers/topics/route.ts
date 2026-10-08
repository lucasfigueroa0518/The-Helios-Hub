import { NextResponse } from 'next/server';

import { anthropic } from '@/lib/anthropic';
import { explainersDb } from '@/lib/explainers/connection';
import { addAndEvaluateTopics, type HandTopic } from '@/lib/explainers/ideas/cycle';
import { anthropicIdeaModel } from '@/lib/explainers/ideas/generator';
import { parseTopicList } from '@/lib/explainers/repository';
import { liveJevTransport } from '@/lib/reels/jev/client';
import { getSession } from '@/lib/session';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A paste is capped so one click cannot fan out into an unbounded Jev bill. */
const MAX_TOPICS_PER_REQUEST = 25;
const MAX_SOURCE_CHARS = 20_000;

type Body = {
  title?: string;
  sourceUrl?: string;
  sourceText?: string;
  /** Paste-a-list: one title per line. */
  list?: string;
};

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * Lucas adds topic titles by hand (A-7, A-9). One Sonnet call writes every
 * scope, then Jev scores and dedupes each topic. This click is the approval
 * for those calls.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return NextResponse.json({ error: 'Expected a JSON body' }, { status: 400 });

  let topics: HandTopic[];
  if (text(body.list)) {
    topics = parseTopicList(body.list!).map((title) => ({ title, origin: 'seeded' as const }));
  } else if (text(body.title)) {
    const sourceUrl = text(body.sourceUrl);
    if (sourceUrl && !/^https?:\/\//i.test(sourceUrl)) {
      return NextResponse.json({ error: 'Source URL must start with http:// or https://' }, { status: 400 });
    }
    const sourceText = text(body.sourceText);
    if (sourceText && sourceText.length > MAX_SOURCE_CHARS) {
      return NextResponse.json({ error: `Source notes are limited to ${MAX_SOURCE_CHARS} characters` }, { status: 400 });
    }
    topics = [{ title: text(body.title)!, sourceUrl, sourceText, origin: 'manual' }];
  } else {
    return NextResponse.json({ error: 'Give a title or a list' }, { status: 400 });
  }
  if (topics.length === 0) return NextResponse.json({ error: 'No topics found' }, { status: 400 });
  if (topics.length > MAX_TOPICS_PER_REQUEST) {
    return NextResponse.json({ error: `At most ${MAX_TOPICS_PER_REQUEST} topics at a time` }, { status: 400 });
  }

  try {
    const results = await addAndEvaluateTopics(
      { db: await explainersDb(), jevTransport: liveJevTransport, ideaModel: anthropicIdeaModel(anthropic) },
      topics,
    );
    return NextResponse.json({ results });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
