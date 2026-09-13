import { addUtcDays, eachIsoDate, isoDate } from '@/lib/seo/format';
import { listSites, querySearchAnalytics } from '@/lib/seo/gsc-client';
import {
  existingTotalDates,
  finishSyncRun,
  markPropertySynced,
  replaceDimensionDay,
  startSyncRun,
  upsertDailyTotal,
  upsertProperty,
} from '@/lib/seo/repository';
import type { SeoDimension, SeoSearchType } from '@/lib/seo/types';

const SEARCH_TYPE: SeoSearchType = 'web';
const DIMENSIONS: SeoDimension[] = ['query', 'page', 'country', 'device', 'search_appearance'];
const GSC_DIMENSION: Record<SeoDimension, string> = {
  query: 'query',
  page: 'page',
  country: 'country',
  device: 'device',
  search_appearance: 'searchAppearance',
};

export type SeoSyncResult = {
  propertiesSynced: number;
  daysPulled: number;
  newestDate: string | null;
};

async function newestAvailableDate(siteUrl: string): Promise<string | null> {
  const end = isoDate(new Date());
  const start = addUtcDays(end, -10);
  const rows = await querySearchAnalytics({
    siteUrl,
    startDate: start,
    endDate: end,
    dimensions: ['date'],
    searchType: SEARCH_TYPE,
    dataState: 'final',
  });
  const dates = rows.map((row) => row.keys[0]).filter(Boolean).sort();
  return dates[dates.length - 1] ?? null;
}

async function pullDay(propertyId: string, siteUrl: string, date: string): Promise<void> {
  const totals = await querySearchAnalytics({
    siteUrl,
    startDate: date,
    endDate: date,
    searchType: SEARCH_TYPE,
  });
  const total = totals[0] ?? { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  await upsertDailyTotal({
    propertyId,
    date,
    searchType: SEARCH_TYPE,
    clicks: total.clicks,
    impressions: total.impressions,
    ctr: total.ctr,
    position: total.position,
  });

  if (total.impressions <= 0 && total.clicks <= 0) return;

  for (const dimension of DIMENSIONS) {
    const rows = await querySearchAnalytics({
      siteUrl,
      startDate: date,
      endDate: date,
      dimensions: [GSC_DIMENSION[dimension]],
      searchType: SEARCH_TYPE,
    });
    await replaceDimensionDay({
      propertyId,
      date,
      searchType: SEARCH_TYPE,
      dimension,
      rows: rows.map((row) => ({
        key: row.keys[0] ?? '',
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      })).filter((row) => row.key),
    });
  }
}

export async function runGscDailySync(options: { backfillDays?: number } = {}): Promise<SeoSyncResult> {
  const runId = await startSyncRun();
  let propertiesSynced = 0;
  let daysPulled = 0;
  let newestDate: string | null = null;
  try {
    const sites = await listSites();
    if (sites.length === 0) {
      const sa = process.env.GSC_IMPERSONATE_SERVICE_ACCOUNT?.trim()
        || 'helios-gsc-sync@helios-influencer-network.iam.gserviceaccount.com';
      throw new Error(
        `Search Console returned no properties. In Search Console, add ${sa} as a Full user on each property (e.g. sc-domain:heliosgroup.ai), then Sync now.`,
      );
    }

    const backfillDays = options.backfillDays ?? 16 * 30;
    for (const site of sites) {
      const property = await upsertProperty(site.siteUrl, site.permissionLevel ?? null);
      const latest = await newestAvailableDate(site.siteUrl);
      if (!latest) {
        await markPropertySynced(property.id);
        propertiesSynced += 1;
        continue;
      }
      if (!newestDate || latest > newestDate) {
        newestDate = latest;
      }
      const have = await existingTotalDates(property.id, SEARCH_TYPE);
      const windowStart = addUtcDays(latest, -(backfillDays - 1));
      const wanted = eachIsoDate(windowStart, latest);
      const missing = wanted.filter((date) => !have.has(date));
      // Re-pull the last 3 available days so "final" data can settle.
      const refresh = eachIsoDate(addUtcDays(latest, -2), latest);
      const dates = [...new Set([...missing, ...refresh])].sort();
      for (const date of dates) {
        await pullDay(property.id, site.siteUrl, date);
        daysPulled += 1;
      }
      await markPropertySynced(property.id);
      propertiesSynced += 1;
    }

    await finishSyncRun(runId, {
      status: 'succeeded',
      newestDate,
      propertiesSynced,
      daysPulled,
    });
    return { propertiesSynced, daysPulled, newestDate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishSyncRun(runId, {
      status: 'failed',
      newestDate,
      propertiesSynced,
      daysPulled,
      error: message,
    }).catch(() => undefined);
    throw error;
  }
}

