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

  const { data, error } = await supabase
    .from('indicator_data')
    .select('*')
    .in('indicator_id', indicatorIds)
    .eq('year', year)
    .order('month');

  if (error) {
    console.error('[getMultipleIndicatorsData]', error.message);
    return {};
  }

  const result: Record<string, MonthlyDataPoint[]> = {};
  for (const row of data ?? []) {
    if (!result[row.indicator_id]) result[row.indicator_id] = [];
    result[row.indicator_id].push({
      year: row.year,
      month: row.month,
      meta: Number(row.meta),
      real: Number(row.real),
      percentage: Number(row.percentage),
      updated_at: row.updated_at ? new Date(row.updated_at) : undefined,
    });
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

  const upsertPayload: Record<string, unknown> = {
    indicator_id: input.indicator_id,
    year: input.year,
    month: input.month,
    updated_by: input.updated_by,
  };
  if (input.real !== undefined) upsertPayload.real = input.real;
  if (input.meta !== undefined) upsertPayload.meta = input.meta;

  // Use service-role client for the write: indicator_data has no user-facing write RLS policy.
  // Auth is already verified in the API route handler before this function is called.
  const supabase = createServiceClient();
  const { error } = await supabase
    .from('indicator_data')
    .upsert(upsertPayload, { onConflict: 'indicator_id,year,month' });

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
