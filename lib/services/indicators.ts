import { createClient } from '@/lib/supabase/server';
import type { BackofficeIndicator, IndicatorFilters, IndicatorTag, IndicatorTagCategory } from '@/types/backoffice';

// =====================================================
// TYPE MAPPING
// DB: indicator_format enum → TS: IndicatorFormat
// =====================================================

function mapFormatToTS(format: string): BackofficeIndicator['format'] {
  const map: Record<string, BackofficeIndicator['format']> = {
    percentage: 'percentage',
    number: 'number',
    currency: 'currency',
    boolean: 'boolean',
    hours: 'hours',
  };
  return map[format] ?? 'number';
}

function mapTagCategory(category: string | null): IndicatorTagCategory {
  if (category === 'business_unit' || category === 'support_area') return category;
  return 'type';
}

function rowToIndicator(row: Record<string, unknown>): BackofficeIndicator {
  const rawTags = Array.isArray(row.tags) ? row.tags : [];
  const tags: IndicatorTag[] = rawTags.map((t: Record<string, unknown>) => ({
    id: t.id as string,
    name: t.name as string,
    category: mapTagCategory(t.category as string | null),
    color: (t.color as string) ?? '#999999',
  }));

  const rawLog = Array.isArray(row.change_log) ? row.change_log : [];

  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string) ?? '',
    notes: (row.notes as string) ?? undefined,
    format: mapFormatToTS(row.format as string),
    direction: (row.direction as 'up' | 'down') ?? 'up',
    status: (row.status as BackofficeIndicator['status']) ?? 'in_construction',
    aggregation_type: (row.aggregation_type as BackofficeIndicator['aggregation_type']) ?? 'none',
    tags,
    created_by: row.created_by as string,
    created_by_name: (row.created_by_name as string) ?? '',
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
    total_books: (row.total_books as number) ?? 0,
    average_achievement: (row.average_achievement as number) ?? undefined,
    change_log: rawLog.map((l: Record<string, unknown>) => ({
      id: l.id as string,
      indicator_id: l.indicator_id as string,
      user_id: l.user_id as string,
      user_name: (l.user_name as string) ?? '',
      action: l.action as BackofficeIndicator['change_log'] extends Array<infer E> ? E['action'] : never,
      field_changed: l.field_changed as string | undefined,
      old_value: l.old_value as string | undefined,
      new_value: l.new_value as string | undefined,
      created_at: new Date(l.created_at as string),
    })),
  };
}

// =====================================================
// QUERIES
// =====================================================

export async function getIndicators(filters?: IndicatorFilters): Promise<BackofficeIndicator[]> {
  const supabase = await createClient();

  let query = supabase
    .from('indicators_with_stats')
    .select('*')
    .order('created_at', { ascending: false });

  if (filters?.status && filters.status.length > 0) {
    query = query.in('status', filters.status);
  }
  if (filters?.created_by) {
    query = query.eq('created_by', filters.created_by);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[getIndicators]', error.message);
    return [];
  }

  let results = (data ?? []).map(rowToIndicator);

  // Client-side filters that can't be done via SQL on the view
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.description.toLowerCase().includes(q)
    );
  }
  if (filters?.format && filters.format.length > 0) {
    results = results.filter((i) => filters.format!.includes(i.format));
  }
  if (filters?.tags && filters.tags.length > 0) {
    results = results.filter((i) =>
      filters.tags!.some((tagId) => i.tags.some((t) => t.id === tagId))
    );
  }
  if (filters?.has_books !== undefined) {
    results = results.filter((i) =>
      filters.has_books ? (i.total_books ?? 0) > 0 : (i.total_books ?? 0) === 0
    );
  }

  return results;
}

export async function getIndicatorById(id: string): Promise<BackofficeIndicator | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('indicators_with_stats')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;

  // Fetch change log separately
  const { data: logData } = await supabase
    .from('indicator_change_log')
    .select('*, users(full_name)')
    .eq('indicator_id', id)
    .order('created_at', { ascending: false })
    .limit(50);

  const enriched = {
    ...data,
    change_log: (logData ?? []).map((l: Record<string, unknown>) => ({
      ...l,
      user_name: (l.users as Record<string, unknown>)?.full_name ?? '',
    })),
  };

  return rowToIndicator(enriched as Record<string, unknown>);
}

// =====================================================
// MUTATIONS
// =====================================================

export interface IndicatorFormInput {
  name: string;
  description: string;
  notes?: string;
  format: BackofficeIndicator['format'];
  direction: 'up' | 'down';
  status: BackofficeIndicator['status'];
  aggregation_type: BackofficeIndicator['aggregation_type'];
  tag_ids: string[];
  data_source?: 'manual' | 'snowflake';
  category?: number;
}

export async function createIndicator(
  input: IndicatorFormInput,
  userId: string
): Promise<BackofficeIndicator | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('backoffice_indicators')
    .insert({
      name: input.name,
      description: input.description,
      notes: input.notes,
      format: input.format,
      direction: input.direction,
      status: input.status,
      aggregation_type: input.aggregation_type,
      data_source: input.data_source ?? 'manual',
      category: input.category ?? 3,
      created_by: userId,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[createIndicator]', error?.message);
    return null;
  }

  // Upsert tag relations
  if (input.tag_ids.length > 0) {
    await supabase.from('indicator_tag_relations').insert(
      input.tag_ids.map((tagId) => ({ indicator_id: data.id, tag_id: tagId }))
    );
  }

  return getIndicatorById(data.id);
}

export async function updateIndicator(
  id: string,
  input: Partial<IndicatorFormInput>
): Promise<BackofficeIndicator | null> {
  const supabase = await createClient();

  const updatePayload: Record<string, unknown> = {};
  if (input.name !== undefined) updatePayload.name = input.name;
  if (input.description !== undefined) updatePayload.description = input.description;
  if (input.notes !== undefined) updatePayload.notes = input.notes;
  if (input.format !== undefined) updatePayload.format = input.format;
  if (input.direction !== undefined) updatePayload.direction = input.direction;
  if (input.status !== undefined) updatePayload.status = input.status;
  if (input.aggregation_type !== undefined) updatePayload.aggregation_type = input.aggregation_type;
  if (input.data_source !== undefined) updatePayload.data_source = input.data_source;
  if (input.category !== undefined) updatePayload.category = input.category;

  const { error } = await supabase
    .from('backoffice_indicators')
    .update(updatePayload)
    .eq('id', id);

  if (error) {
    console.error('[updateIndicator]', error.message);
    return null;
  }

  // Re-sync tags if provided
  if (input.tag_ids !== undefined) {
    await supabase.from('indicator_tag_relations').delete().eq('indicator_id', id);
    if (input.tag_ids.length > 0) {
      await supabase.from('indicator_tag_relations').insert(
        input.tag_ids.map((tagId) => ({ indicator_id: id, tag_id: tagId }))
      );
    }
  }

  return getIndicatorById(id);
}

export async function deleteIndicator(id: string): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('backoffice_indicators')
    .update({ is_active: false })
    .eq('id', id);

  if (error) {
    console.error('[deleteIndicator]', error.message);
    return false;
  }
  return true;
}

// =====================================================
// TAGS
// =====================================================

export async function getTags(): Promise<IndicatorTag[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('indicator_tags')
    .select('id, name, color, category')
    .order('name');

  if (error) return [];

  return (data ?? []).map((t) => ({
    id: t.id,
    name: t.name,
    category: mapTagCategory(t.category),
    color: t.color ?? '#999999',
  }));
}
