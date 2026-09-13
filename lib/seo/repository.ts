import { dbQuery } from '@/lib/db';
import { dimensionLabel, weightedMetrics } from '@/lib/seo/format';
import type {
  GscSitemap,
  SeoBreakdownTab,
  SeoDailyPoint,
  SeoDimension,
  SeoDimensionRow,
  SeoMetrics,
  SeoProperty,
  SeoSearchType,
  SeoSitemap,
  SeoSyncRun,
} from '@/lib/seo/types';

export async function upsertProperty(siteUrl: string, permissionLevel?: string | null): Promise<SeoProperty> {
  const { rows } = await dbQuery<SeoProperty>(
    `INSERT INTO seo.properties (site_url, permission_level, updated_at)
     VALUES ($1, $2, now())
     ON CONFLICT (site_url) DO UPDATE
        SET permission_level = COALESCE(EXCLUDED.permission_level, seo.properties.permission_level),
            updated_at = now()
     RETURNING id, site_url, permission_level, last_synced_at::text`,
    [siteUrl, permissionLevel ?? null],
  );
  return rows[0];
}

export async function markPropertySynced(propertyId: string): Promise<void> {
  await dbQuery(
    `UPDATE seo.properties SET last_synced_at = now(), updated_at = now() WHERE id = $1`,
    [propertyId],
  );
}

export async function listProperties(): Promise<SeoProperty[]> {
  const { rows } = await dbQuery<SeoProperty>(
    `SELECT id, site_url, permission_level, last_synced_at::text
       FROM seo.properties
      ORDER BY site_url`,
  );
  return rows;
}

export async function getPropertyByIdOrUrl(idOrUrl: string | null | undefined): Promise<SeoProperty | null> {
  if (!idOrUrl) {
    const properties = await listProperties();
    return properties.find((row) => row.site_url === 'sc-domain:heliosgroup.ai') ?? properties[0] ?? null;
  }
  const { rows } = await dbQuery<SeoProperty>(
    `SELECT id, site_url, permission_level, last_synced_at::text
       FROM seo.properties
      WHERE id::text = $1 OR site_url = $1
      LIMIT 1`,
    [idOrUrl],
  );
  return rows[0] ?? null;
}

export async function upsertDailyTotal(input: {
  propertyId: string;
  date: string;
  searchType: SeoSearchType;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}): Promise<void> {
  await dbQuery(
    `INSERT INTO seo.daily_totals (
        property_id, date, search_type, clicks, impressions, ctr, position
     ) VALUES ($1, $2::date, $3, $4, $5, $6, $7)
     ON CONFLICT (property_id, date, search_type) DO UPDATE SET
        clicks = EXCLUDED.clicks,
        impressions = EXCLUDED.impressions,
        ctr = EXCLUDED.ctr,
        position = EXCLUDED.position`,
    [input.propertyId, input.date, input.searchType, input.clicks, input.impressions, input.ctr, input.position],
  );
}

export async function replaceDimensionDay(input: {
  propertyId: string;
  date: string;
  searchType: SeoSearchType;
  dimension: SeoDimension;
  rows: Array<{ key: string; clicks: number; impressions: number; ctr: number; position: number }>;
}): Promise<void> {
  await dbQuery(
    `DELETE FROM seo.dimension_rows
      WHERE property_id = $1 AND date = $2::date AND search_type = $3 AND dimension = $4`,
    [input.propertyId, input.date, input.searchType, input.dimension],
  );
  if (input.rows.length === 0) return;
  const chunkSize = 200;
  for (let start = 0; start < input.rows.length; start += chunkSize) {
    const chunk = input.rows.slice(start, start + chunkSize);
    const values: unknown[] = [];
    const tuples = chunk.map((row, index) => {
      const offset = index * 9;
      values.push(
        input.propertyId,
        input.date,
        input.searchType,
        input.dimension,
        row.key,
        row.clicks,
        row.impressions,
        row.ctr,
        row.position,
      );
      return `($${offset + 1}, $${offset + 2}::date, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9})`;
    });
    await dbQuery(
      `INSERT INTO seo.dimension_rows (
          property_id, date, search_type, dimension, dimension_key, clicks, impressions, ctr, position
       ) VALUES ${tuples.join(', ')}
       ON CONFLICT (property_id, date, search_type, dimension, dimension_key) DO UPDATE SET
          clicks = EXCLUDED.clicks,
          impressions = EXCLUDED.impressions,
          ctr = EXCLUDED.ctr,
          position = EXCLUDED.position`,
      values,
    );
  }
}

export async function existingTotalDates(
  propertyId: string,
  searchType: SeoSearchType,
): Promise<Set<string>> {
  const { rows } = await dbQuery<{ date: string }>(
    `SELECT date::text AS date
       FROM seo.daily_totals
      WHERE property_id = $1 AND search_type = $2`,
    [propertyId, searchType],
  );
  return new Set(rows.map((row) => row.date));
}

export async function latestAvailableDate(propertyId?: string): Promise<string | null> {
  const { rows } = await dbQuery<{ date: string }>(
    propertyId
      ? `SELECT MAX(date)::text AS date FROM seo.daily_totals WHERE property_id = $1`
      : `SELECT MAX(date)::text AS date FROM seo.daily_totals`,
    propertyId ? [propertyId] : undefined,
  );
  return rows[0]?.date ?? null;
}

export async function getSummary(input: {
  propertyId: string;
  from: string;
  to: string;
  searchType: SeoSearchType;
}): Promise<{ totals: SeoMetrics; series: SeoDailyPoint[] }> {
  const { rows } = await dbQuery<SeoDailyPoint>(
    `SELECT date::text AS date, clicks, impressions, ctr, position
       FROM seo.daily_totals
      WHERE property_id = $1
        AND search_type = $2
        AND date BETWEEN $3::date AND $4::date
      ORDER BY date`,
    [input.propertyId, input.searchType, input.from, input.to],
  );
  return { totals: weightedMetrics(rows), series: rows };
}

export async function listDimensionRows(input: {
  propertyId: string;
  from: string;
  to: string;
  searchType: SeoSearchType;
  dimension: SeoBreakdownTab;
  filter?: string | null;
  sort?: 'clicks' | 'impressions' | 'ctr' | 'position' | 'key';
  dir?: 'asc' | 'desc';
  limit: number;
  offset: number;
}): Promise<{ rows: SeoDimensionRow[]; total: number }> {
  const sort = input.sort ?? (input.dimension === 'date' ? 'key' : 'clicks');
  const dir = input.dir ?? (input.dimension === 'date' ? 'desc' : 'desc');
  const filter = input.filter?.trim() || null;
  const orderExpr = sort === 'key' ? 'dimension_key' : sort;

  if (input.dimension === 'date') {
    const { rows } = await dbQuery<SeoDailyPoint & { total: string }>(
      `SELECT date::text AS date, clicks, impressions, ctr, position,
              COUNT(*) OVER()::text AS total
         FROM seo.daily_totals
        WHERE property_id = $1
          AND search_type = $2
          AND date BETWEEN $3::date AND $4::date
        ORDER BY ${orderExpr === 'dimension_key' ? 'date' : orderExpr} ${dir === 'asc' ? 'ASC' : 'DESC'}
        LIMIT $5 OFFSET $6`,
      [input.propertyId, input.searchType, input.from, input.to, input.limit, input.offset],
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      rows: rows.map((row) => ({
        key: row.date,
        label: dimensionLabel('date', row.date),
        clicks: row.clicks,
        impressions: row.impressions,
        ctr: row.ctr,
        position: row.position,
      })),
    };
  }

  const { rows } = await dbQuery<{
    dimension_key: string;
    clicks: number;
    impressions: number;
    ctr: number;
    position: number;
    total: string;
  }>(
    `SELECT dimension_key,
            SUM(clicks) AS clicks,
            SUM(impressions) AS impressions,
            CASE WHEN SUM(impressions) > 0 THEN SUM(clicks) / SUM(impressions) ELSE 0 END AS ctr,
            CASE WHEN SUM(impressions) > 0 THEN SUM(position * impressions) / SUM(impressions) ELSE 0 END AS position,
            COUNT(*) OVER()::text AS total
       FROM seo.dimension_rows
      WHERE property_id = $1
        AND search_type = $2
        AND dimension = $3
        AND date BETWEEN $4::date AND $5::date
        AND ($6::text IS NULL OR dimension_key ILIKE '%' || $6 || '%')
      GROUP BY dimension_key
      ORDER BY ${orderExpr} ${dir === 'asc' ? 'ASC' : 'DESC'}, dimension_key ASC
      LIMIT $7 OFFSET $8`,
    [input.propertyId, input.searchType, input.dimension, input.from, input.to, filter, input.limit, input.offset],
  );

  return {
    total: Number(rows[0]?.total ?? 0),
    rows: rows.map((row) => ({
      key: row.dimension_key,
      label: dimensionLabel(input.dimension, row.dimension_key),
      clicks: Number(row.clicks),
      impressions: Number(row.impressions),
      ctr: Number(row.ctr),
      position: Number(row.position),
    })),
  };
}

export async function replaceSitemaps(propertyId: string, sitemaps: GscSitemap[]): Promise<void> {
  await dbQuery(`DELETE FROM seo.sitemaps WHERE property_id = $1`, [propertyId]);
  for (const sitemap of sitemaps) {
    await dbQuery(
      `INSERT INTO seo.sitemaps (
          property_id, path, last_submitted_at, last_downloaded_at,
          is_pending, is_sitemaps_index, errors, warnings, contents, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, now())`,
      [
        propertyId,
        sitemap.path,
        sitemap.lastSubmitted ?? null,
        sitemap.lastDownloaded ?? null,
        sitemap.isPending ?? false,
        sitemap.isSitemapsIndex ?? false,
        sitemap.errors ?? 0,
        sitemap.warnings ?? 0,
        JSON.stringify(sitemap.contents ?? []),
      ],
    );
  }
}

export async function listStoredSitemaps(propertyId: string): Promise<SeoSitemap[]> {
  const { rows } = await dbQuery<SeoSitemap>(
    `SELECT id, path, last_submitted_at::text, last_downloaded_at::text,
            is_pending, is_sitemaps_index, errors, warnings
       FROM seo.sitemaps
      WHERE property_id = $1
      ORDER BY path`,
    [propertyId],
  );
  return rows;
}

export async function startSyncRun(): Promise<string> {
  const { rows } = await dbQuery<{ id: string }>(
    `INSERT INTO seo.sync_runs (status) VALUES ('running') RETURNING id`,
  );
  return rows[0].id;
}

export async function finishSyncRun(
  id: string,
  input: { status: 'succeeded' | 'failed'; newestDate?: string | null; propertiesSynced: number; daysPulled: number; error?: string | null },
): Promise<void> {
  await dbQuery(
    `UPDATE seo.sync_runs
        SET finished_at = now(),
            status = $2,
            newest_date = $3::date,
            properties_synced = $4,
            days_pulled = $5,
            error = $6
      WHERE id = $1`,
    [id, input.status, input.newestDate ?? null, input.propertiesSynced, input.daysPulled, input.error ?? null],
  );
}

export async function latestSyncRun(): Promise<SeoSyncRun | null> {
  const { rows } = await dbQuery<SeoSyncRun>(
    `SELECT id, started_at::text, finished_at::text, status,
            newest_date::text, properties_synced, days_pulled, error
       FROM seo.sync_runs
      ORDER BY started_at DESC
      LIMIT 1`,
  );
  return rows[0] ?? null;
}

export async function saveInspection(propertyId: string, inspectionUrl: string, payload: unknown): Promise<void> {
  await dbQuery(
    `INSERT INTO seo.url_inspections (property_id, inspection_url, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [propertyId, inspectionUrl, JSON.stringify(payload ?? {})],
  );
}
