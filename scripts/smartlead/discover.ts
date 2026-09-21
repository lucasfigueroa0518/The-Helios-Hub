/**
 * S0 discovery — GET-only probe of the live Smartlead account.
 *
 * Writes redacted fixtures to tests/fixtures/smartlead/ so `lib/smartlead/types.ts`
 * can be hand-written against verified field shapes instead of guessed ones.
 * This script never writes to Smartlead: every probe is a GET, and the runner
 * refuses any other method.
 *
 *   npx tsx scripts/smartlead/discover.ts
 */
import fs from 'node:fs';
import path from 'node:path';

import { redactApiKey, SMARTLEAD_BASE } from '@/lib/smartlead/client';

for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
}

const API_KEY = process.env.SMARTLEAD_API_KEY?.trim();
if (!API_KEY) {
  console.error('SMARTLEAD_API_KEY is not set in .env.local');
  process.exit(1);
}

const OUT_DIR = path.join('tests', 'fixtures', 'smartlead');

/** Keys whose values never belong in a committed fixture. */
const SECRET_KEY = /(password|secret|token|api_key|apikey|client_id|credential|signature)/i;

function scrub(value: unknown): unknown {
  if (typeof value === 'string') return redactApiKey(value);
  if (Array.isArray(value)) return value.map(scrub);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, inner]) => [
        key,
        SECRET_KEY.test(key) && inner ? '[redacted]' : scrub(inner),
      ]),
    );
  }
  return value;
}

type Probe = {
  name: string;
  path: string;
  query?: Record<string, string | number>;
  /** Why this probe exists, mapped to the §8 question it answers. */
  question: string;
};

type ProbeResult = {
  name: string;
  endpoint: string;
  question: string;
  status: number | 'network_error';
  ok: boolean;
  /** Headers that inform rate limiting and webhook authentication. */
  headers: Record<string, string>;
  durationMs: number;
  body: unknown;
};

const INTERESTING_HEADERS = [
  'content-type',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'ratelimit-limit',
  'ratelimit-remaining',
  'ratelimit-reset',
];

async function probe(entry: Probe): Promise<ProbeResult> {
  const url = new URL(`${SMARTLEAD_BASE}${entry.path}`);
  for (const [key, value] of Object.entries(entry.query ?? {})) {
    url.searchParams.set(key, String(value));
  }
  const endpoint = url.toString();
  url.searchParams.set('api_key', API_KEY!);

  const started = Date.now();
  try {
    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(30_000),
    });
    const text = await response.text();
    const headers: Record<string, string> = {};
    for (const header of INTERESTING_HEADERS) {
      const value = response.headers.get(header);
      if (value) headers[header] = value;
    }
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { _unparseable: text.slice(0, 2000) };
    }
    return {
      name: entry.name,
      endpoint,
      question: entry.question,
      status: response.status,
      ok: response.ok,
      headers,
      durationMs: Date.now() - started,
      body: scrub(body),
    };
  } catch (error) {
    return {
      name: entry.name,
      endpoint,
      question: entry.question,
      status: 'network_error',
      ok: false,
      headers: {},
      durationMs: Date.now() - started,
      body: { error: redactApiKey(error instanceof Error ? error.message : String(error)) },
    };
  }
}

function write(name: string, payload: unknown) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, `${name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

function firstId(body: unknown, key = 'id'): number | string | null {
  const list = Array.isArray(body)
    ? body
    : (body as { data?: unknown[] } | null)?.data ?? [];
  const head = Array.isArray(list) ? list[0] : null;
  if (head && typeof head === 'object' && key in head) {
    return (head as Record<string, number | string>)[key];
  }
  return null;
}

async function main() {
  const results: ProbeResult[] = [];
  const run = async (entry: Probe) => {
    const result = await probe(entry);
    results.push(result);
    write(entry.name, result);
    const count = Array.isArray(result.body)
      ? `${result.body.length} items`
      : typeof result.body === 'object' && result.body
        ? `${Object.keys(result.body).length} keys`
        : 'scalar';
    console.log(
      `${result.ok ? 'ok  ' : 'FAIL'} ${String(result.status).padEnd(14)} ${entry.name.padEnd(28)} ${count} (${result.durationMs} ms)`,
    );
    return result;
  };

  // §8.1 / §8.11 — account shape, paging, Microsoft OAuth fields.
  const accounts = await run({
    name: 'email-accounts',
    path: '/email-accounts/',
    query: { offset: 0, limit: 100 },
    question: '§8.1 paging, from_email, cap, warmup sub-object, status; §8.11 OAuth provider fields',
  });
  const accountId = firstId(accounts.body);

  if (accountId !== null) {
    await run({
      name: 'email-account-detail',
      path: `/email-accounts/${accountId}/`,
      question: '§8.1 single-account field shape',
    });
    // §8.1 — warmup counters that drive lifecycle exit criteria.
    await run({
      name: 'warmup-stats',
      path: `/email-accounts/${accountId}/warmup-stats`,
      question: '§8.1 warmup sent/inbox/spam shape for inbox_health_daily',
    });
  }

  // §8.6 — campaign settings / schedule / sequence keys.
  const campaigns = await run({
    name: 'campaigns',
    path: '/campaigns/',
    question: '§8.6 campaign list shape, status values',
  });
  const campaignId = firstId(campaigns.body);

  if (campaignId !== null) {
    await run({
      name: 'campaign-detail',
      path: `/campaigns/${campaignId}`,
      question: '§8.6 settings/schedule keys: tracking, stop-on-reply, max_new_leads_per_day',
    });
    await run({
      name: 'campaign-sequences',
      path: `/campaigns/${campaignId}/sequences`,
      question: '§8.2 custom-variable rendering; sequence step shape',
    });
    await run({
      name: 'campaign-statistics',
      path: `/campaigns/${campaignId}/statistics`,
      query: { offset: 0, limit: 20 },
      question: '§8.3 per-send rows for the statistics backfill (sequence_number, email_account_id)',
    });
    await run({
      name: 'campaign-analytics-by-date',
      path: `/campaigns/${campaignId}/analytics-by-date`,
      query: { start_date: isoDaysAgo(30), end_date: isoDaysAgo(0) },
      question: '§8.1 daily aggregates',
    });
    await run({
      name: 'campaign-email-accounts',
      path: `/campaigns/${campaignId}/email-accounts`,
      question: '§5E step 5 attach/detach shape',
    });
    const leads = await run({
      name: 'campaign-leads',
      path: `/campaigns/${campaignId}/leads`,
      query: { offset: 0, limit: 5 },
      question: '§8.1 per-lead ids; §8.2 custom field echo',
    });
    await run({
      name: 'campaign-webhooks',
      path: `/campaigns/${campaignId}/webhooks`,
      question: '§8.3 webhook registration shape and auth mode',
    });

    const leadId = firstId(
      (leads.body as { data?: unknown[] } | null)?.data ?? leads.body,
      'lead_id',
    ) ?? firstId((leads.body as { data?: unknown[] } | null)?.data ?? leads.body);
    if (leadId !== null) {
      await run({
        name: 'lead-message-history',
        path: `/campaigns/${campaignId}/leads/${leadId}/message-history`,
        question: '§8.9 message-history shape; §8.8 reply_message_id format',
      });
    }
  }

  // §8.3 — is there a user-level webhook, or only campaign-level? A user-level
  // hook would mean one registration instead of one per lane.
  await run({
    name: 'webhooks-user-level',
    path: '/webhooks',
    question: '§8.3 user-level webhook registration vs per-campaign',
  });

  // §8.1 — POST /leads returns only counts, so handoff must resolve ids by email.
  await run({
    name: 'lead-by-email',
    path: '/leads/',
    query: { email: 'discovery-probe@example.invalid' },
    question: '§8.1 lead-by-email lookup for smartlead_lead_id resolution',
  });
  await run({
    name: 'lead-by-email-alt',
    path: '/leads/by-email',
    query: { email: 'discovery-probe@example.invalid' },
    question: '§8.1 alternate lead-by-email path documented in llms.txt',
  });

  await run({
    name: 'client-list',
    path: '/client/',
    question: '§8.4 plan/whitelabel context',
  });

  const summary = {
    generated_at: new Date().toISOString(),
    base: SMARTLEAD_BASE,
    probes: results.map((result) => ({
      name: result.name,
      endpoint: result.endpoint,
      question: result.question,
      status: result.status,
      ok: result.ok,
      headers: result.headers,
      top_level_keys: topLevelKeys(result.body),
    })),
  };
  write('_summary', summary);

  const failed = results.filter((result) => !result.ok);
  console.log(`\n${results.length - failed.length}/${results.length} probes ok → ${OUT_DIR}`);
  if (failed.length) {
    console.log('Failed probes (expected for endpoints this plan tier does not expose):');
    for (const result of failed) console.log(`  ${result.name}: ${result.status}`);
  }
}

function topLevelKeys(body: unknown): string[] {
  if (Array.isArray(body)) {
    const head = body[0];
    return head && typeof head === 'object' ? Object.keys(head) : [];
  }
  return body && typeof body === 'object' ? Object.keys(body) : [];
}

function isoDaysAgo(days: number): string {
  const date = new Date(Date.now() - days * 86_400_000);
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error(redactApiKey(error instanceof Error ? error.stack ?? error.message : String(error)));
  process.exit(1);
});
