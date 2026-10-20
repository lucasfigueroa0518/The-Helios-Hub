/**
 * The LFD lab's live run report. Tommy's engine has no progress hooks, and it stays unchanged, so its progress is
 * read off the calls it makes through its dependencies (tap). The report writer folds repeated steps into one
 * line with a count, so the timeline reads "Fact-checking the copy (6 calls)", not six lines.
 */
import type Anthropic from '@anthropic-ai/sdk';

import type { LfdRunDeps } from '@/lib/lfd/run';

import type { Queryable } from '../db';

export type Progress = { step: string; usd: number };

/** Plain words for each Jev question set the engine asks. */
const JEV_STEPS: Array<[RegExp, string]> = [
  [/major-news/, 'Scoring candidate stories (is it major news?)'],
  [/same-event/, 'Checking for duplicates and repeats of the last post'],
  [/grounding/, 'Fact-checking the written copy'],
  [/lfd-lead/, 'Ordering the slides by story strength'],
  [/photo/, 'Finding photos'],
];

/**
 * Wrap the engine's dependencies so each call reports what step it belongs to. `emit` gets every call; `spent`
 * is read at each one, so the report's cost moves while the engine runs.
 */
export function tap(deps: LfdRunDeps, emit: (p: Progress) => void, spent: () => number): LfdRunDeps {
  const say = (step: string) => {
    try {
      emit({ step, usd: spent() });
    } catch {
      /* reporting never breaks a run */
    }
  };
  return {
    ...deps,
    jev: async (req, meta) => {
      say(JEV_STEPS.find(([re]) => re.test(meta.version))?.[1] ?? `Jev: ${meta.version}`);
      return deps.jev(req, meta);
    },
    create: (async (p: Anthropic.MessageCreateParamsNonStreaming) => {
      const tool = (p.tools?.[0] as { name?: string } | undefined)?.name;
      say(tool === 'submit_rundown' ? 'Writing the stories (Claude)' : tool === 'submit_verdict' ? 'Checking each slide\'s photo (vision)' : 'Claude call');
      return deps.create(p);
    }) as LfdRunDeps['create'],
    photos: {
      ...deps.photos,
      find: async (...a: Parameters<LfdRunDeps['photos']['find']>) => {
        say('Finding photos');
        return deps.photos.find(...a);
      },
      ...(deps.photos.findSet
        ? {
            findSet: async (...a: Parameters<NonNullable<LfdRunDeps['photos']['findSet']>>) => {
              say('Finding photos');
              return deps.photos.findSet!(...a);
            },
          }
        : {}),
    } as LfdRunDeps['photos'],
    fetchFeeds: async () => {
      say('Reading the fresh-article feeds');
      return deps.fetchFeeds();
    },
    fetchBody: async (url) => {
      say('Fetching article text');
      return deps.fetchBody(url);
    },
    readPage: async (url) => {
      say('Reading article pages for lead images');
      return deps.readPage(url);
    },
    fitCheck: async (post, opts) => {
      say('Rendering the slides');
      return deps.fitCheck(post, opts);
    },
    upload: async (p, body) => {
      say('Saving the slide images');
      return deps.upload(p, body);
    },
  };
}

/** Appends to memes.lfd_sim_events, folding a repeated step into its last line. */
export function reporter(db: Queryable, simId: string, opts: { onUsd?: (usd: number) => void } = {}) {
  let last: { id: string; stage: string; message: string; count: number } | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const write = async (stage: string, message: string, usd: number | null) => {
    if (last && last.stage === stage && last.message === message) {
      last.count += 1;
      await db.query(`UPDATE memes.lfd_sim_events SET count = $2, usd = COALESCE($3, usd) WHERE id = $1`, [last.id, last.count, usd]);
      return;
    }
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO memes.lfd_sim_events (sim_id, stage, message, usd) VALUES ($1, $2, $3, $4) RETURNING id::text`,
      [simId, stage, message, usd],
    );
    last = { id: rows[0]!.id, stage, message, count: 1 };
  };
  /** Queue an event (events are written in order; a failure to write one is ignored). */
  const event = (stage: string, message: string, usd: number | null = null) => {
    chain = chain.then(() => write(stage, message, usd)).catch(() => undefined);
    if (usd != null) opts.onUsd?.(usd);
    return chain;
  };
  return { event, flush: () => chain };
}
