import { createClient, createServiceClient } from '@/lib/supabase/server';
// Note: reads (getIndicatorData, getMultipleIndicatorsData) use the user JWT client so RLS
// SELECT policies apply.  Writes (upsertIndicatorData, bulkUpsertIndicatorData) use the
// service-role client to bypass RLS — auth is verified at the API route level.

export interface MonthlyDataPoint {
  year: number;
  month: number; // 1–12
  meta: number;
  real: number;
  percentage: number;
  updated_at?: Date;
}

export interface IndicatorYearData {
  indicator_id: string;
  year: number;
  data: MonthlyDataPoint[];
}

// =====================================================
// READ
// =====================================================

export async function getIndicatorData(
  indicatorId: string,
  year: number
): Promise<MonthlyDataPoint[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('indicator_data')
    .select('*')
    .eq('indicator_id', indicatorId)
    .eq('year', year)
    .order('month');

  if (error) {
    console.error('[getIndicatorData]', error.message);
    return [];
  }

  return (data ?? []).map((row) => ({
    year: row.year,
    month: row.month,
    meta: Number(row.meta),
    real: Number(row.real),
    percentage: Number(row.percentage),
    updated_by: row.updated_by ?? undefined,
    updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
  }));
}

export async function getMultipleIndicatorsData(
  indicatorIds: string[],
  year: number
): Promise<Record<string, MonthlyDataPoint[]>> {
  if (indicatorIds.length === 0) return {};

  const supabase = await createClient();

  // PostgREST encodes the ID list in the URL — chunk to avoid 414 Request-URI Too Long
  // when there are hundreds/thousands of indicator IDs (e.g. global fallback dashboard).
  const CHUNK = 200;
  const chunks: string[][] = [];
  for (let i = 0; i < indicatorIds.length; i += CHUNK) {
    chunks.push(indicatorIds.slice(i, i + CHUNK));
  }

  const result: Record<string, MonthlyDataPoint[]> = {};

  for (const chunk of chunks) {
    const { data, error } = await supabase
      .from('indicator_data')
      .select('indicator_id, year, month, meta, real, percentage, updated_at')
      .in('indicator_id', chunk)
      .eq('year', year)
      .order('month');

    if (error) {
      console.error('[getMultipleIndicatorsData]', error.message);
      continue;
    }

    for (const row of data ?? []) {
      if (!result[row.indicator_id]) result[row.indicator_id] = [];
      result[row.indicator_id].push({
        year: row.year,
        month: row.month,
        meta: Number(row.meta),
        real: Number(row.real),
        percentage: Number(row.percentage ?? 0),
        updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
      });
    }
  }

  return result;
}

// =====================================================
// WRITE
// =====================================================

export interface UpsertDataInput {
  indicator_id: string;
  year: number;
  month: number;
  real?: number;
  meta?: number;
  updated_by: string;
}

export async function upsertIndicatorData(input: UpsertDataInput): Promise<boolean> {
  // Use user-JWT client only for the read check (RLS SELECT policy allows authenticated reads).
  const userClient = await createClient();
  const { data: indicator } = await userClient
    .from('backoffice_indicators')
    .select('data_source, category')
    .eq('id', input.indicator_id)
    .single();

  // Category 1 (Snowflake, fully automated) cannot be manually edited
  if (indicator?.category === 1 && indicator?.data_source === 'snowflake') {
    console.warn('[upsertIndicatorData] Attempted to edit a read-only (cat. 1) indicator');
    return false;
  }

  const supabase = createServiceClient();

  // Can't use .upsert() with onConflict here — the unique constraint on indicator_data
  // is a PARTIAL index (WHERE user_id IS NULL AND team_id IS NULL), which PostgREST
  // can't target via column names. Use SELECT-then-UPDATE/INSERT instead.
  const { data: existing } = await supabase
    .from('indicator_data')
    .select('id')
    .eq('indicator_id', input.indicator_id)
    .eq('year', input.year)
    .eq('month', input.month)
    .is('user_id', null)
    .is('team_id', null)
    .maybeSingle();

  const payload: Record<string, unknown> = { updated_by: input.updated_by };
  if (input.real !== undefined) payload.real = input.real;
  if (input.meta !== undefined) payload.meta = input.meta;

  let error;
  if (existing?.id) {
    ({ error } = await supabase.from('indicator_data').update(payload).eq('id', existing.id));
  } else {
    ({ error } = await supabase.from('indicator_data').insert({
      indicator_id: input.indicator_id,
      year: input.year,
      month: input.month,
      user_id: null,
      team_id: null,
      ...payload,
    }));
  }

  if (error) {
    console.error('[upsertIndicatorData]', error.message);
    return false;
  }
  return true;
}

export interface BulkUpsertRow {
  indicator_id: string;
  year: number;
  month: number;
  real: number;
  meta?: number;
}

/**
 * Called by sync pipelines (Monday, Snowflake).
 * Uses the service-role client to bypass RLS.
 */
export async function bulkUpsertIndicatorData(
  rows: BulkUpsertRow[],
  syncedBy?: string
): Promise<{ synced: number; errors: string[] }> {
  const supabase = createServiceClient();
  const errors: string[] = [];
  let synced = 0;

  // Process in chunks of 100
  const chunkSize = 100;
  for (let i = 0; i < rows.length; i += chunkSize) {
    // user_id/team_id are NULL for system sync rows — matches the partial index
    // indicator_data_system_key ON (indicator_id, year, month) WHERE user_id IS NULL AND team_id IS NULL
    const chunk = rows.slice(i, i + chunkSize).map((row) => ({
      indicator_id: row.indicator_id,
      year: row.year,
      month: row.month,
      real: row.real,
      ...(row.meta !== undefined ? { meta: row.meta } : {}),
      user_id: null,
      team_id: null,
    }));

    const { error, count } = await supabase
      .from('indicator_data')
      .upsert(chunk, { onConflict: 'indicator_id,year,month', count: 'exact' });

    if (error) {
      errors.push(error.message);
    } else {
      synced += count ?? chunk.length;
    }
  }

  return { synced, errors };
}
