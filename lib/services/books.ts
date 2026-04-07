import { createClient } from '@/lib/supabase/server';
import type {
  BackofficeBook,
  BookFilters,
  BookOwner,
  BookOwnerType,
  BookIndicatorWithGoals,
  MonthlyGoals,
} from '@/types/backoffice';

// =====================================================
// MAPPERS
// =====================================================

const MONTH_KEYS = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'] as const;

function parseGoals(raw: Record<string, unknown> | null): MonthlyGoals {
  if (!raw) return {};
  const goals: MonthlyGoals = {};
  for (const key of MONTH_KEYS) {
    if (raw[key] !== undefined && raw[key] !== null) {
      goals[key] = Number(raw[key]);
    }
  }
  return goals;
}

function countMissingGoals(goals: MonthlyGoals): number {
  return MONTH_KEYS.filter((k) => goals[k] === undefined || goals[k] === null).length;
}

function calcPerformanceLevel(perf: number | undefined): BackofficeBook['performance_level'] {
  if (perf === undefined) return undefined;
  if (perf >= 95) return 'excellent';
  if (perf >= 80) return 'good';
  if (perf >= 70) return 'regular';
  return 'critical';
}

// =====================================================
// READ
// =====================================================

export async function getBooks(filters?: BookFilters): Promise<BackofficeBook[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('books')
    .select(`
      *,
      owner:users!owner_id(id, full_name, email, role),
      book_indicators:book_indicator_config(
        id,
        indicator_id,
        display_order,
        is_manager,
        custom_jan, custom_feb, custom_mar, custom_apr,
        custom_may, custom_jun, custom_jul, custom_aug,
        custom_sep, custom_oct, custom_nov, custom_dec,
        indicator:backoffice_indicators!indicator_id(
          id, name, format, direction, calculation_type,
          tags:indicator_tag_relations(
            tag:indicator_tags(id, name, color, category)
          )
        )
      )
    `)
    .eq('is_active', true)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('[getBooks]', error.message);
    return [];
  }

  let results = (data ?? []).map(rowToBook);

  if (filters?.search) {
    const q = filters.search.toLowerCase();
    results = results.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.owner.name.toLowerCase().includes(q)
    );
  }
  if (filters?.year !== undefined) {
    results = results.filter((b) => b.year === filters.year);
  }
  if (filters?.owner_type && filters.owner_type.length > 0) {
    results = results.filter((b) => filters.owner_type!.includes(b.owner.type));
  }
  if (filters?.has_missing_goals) {
    results = results.filter((b) => b.indicators_with_missing_goals > 0);
  }
  if (filters?.performance_level && filters.performance_level.length > 0) {
    results = results.filter(
      (b) => b.performance_level && filters.performance_level!.includes(b.performance_level)
    );
  }

  return results;
}

export async function getBookById(id: string): Promise<BackofficeBook | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('books')
    .select(`
      *,
      owner:users!owner_id(id, full_name, email, role),
      book_indicators:book_indicator_config(
        id,
        indicator_id,
        display_order,
        is_manager,
        custom_jan, custom_feb, custom_mar, custom_apr,
        custom_may, custom_jun, custom_jul, custom_aug,
        custom_sep, custom_oct, custom_nov, custom_dec,
        indicator:backoffice_indicators!indicator_id(
          id, name, format, direction, calculation_type,
          tags:indicator_tag_relations(
            tag:indicator_tags(id, name, color, category)
          )
        )
      )
    `)
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return rowToBook(data);
}

export async function getBooksByOwner(ownerId: string, year?: number): Promise<BackofficeBook[]> {
  const supabase = await createClient();

  let query = supabase
    .from('books')
    .select(`
      *,
      owner:users!owner_id(id, full_name, email, role),
      book_indicators:book_indicator_config(
        id,
        indicator_id,
        display_order,
        is_manager,
        custom_jan, custom_feb, custom_mar, custom_apr,
        custom_may, custom_jun, custom_jul, custom_aug,
        custom_sep, custom_oct, custom_nov, custom_dec,
        indicator:backoffice_indicators!indicator_id(
          id, name, format, direction, calculation_type,
          tags:indicator_tag_relations(
            tag:indicator_tags(id, name, color, category)
          )
        )
      )
    `)
    .eq('owner_id', ownerId)
    .eq('is_active', true);

  if (year !== undefined) {
    query = query.eq('year', year);
  }

  const { data, error } = await query;
  if (error) return [];
  return (data ?? []).map(rowToBook);
}

// =====================================================
// INTERNAL MAPPER
// =====================================================

function rowToBook(row: Record<string, unknown>): BackofficeBook {
  const ownerRow = row.owner as Record<string, unknown> | null;
  const owner: BookOwner = {
    id: (ownerRow?.id as string) ?? '',
    name: (ownerRow?.full_name as string) ?? '',
    type: 'person' as BookOwnerType, // team books handled separately
    email: ownerRow?.email as string | undefined,
    role: ownerRow?.role as string | undefined,
  };

  const rawIndicators = (row.book_indicators as Record<string, unknown>[]) ?? [];
  const indicators: BookIndicatorWithGoals[] = rawIndicators
    .sort((a, b) => (a.display_order as number) - (b.display_order as number))
    .map((bi) => {
      const ind = bi.indicator as Record<string, unknown>;
      const rawTags = (ind?.tags as Record<string, unknown>[]) ?? [];
      const tags = rawTags.map((tr) => {
        const tag = tr.tag as Record<string, unknown>;
        return {
          id: tag.id as string,
          name: tag.name as string,
          category: (tag.category as 'type' | 'business_unit' | 'support_area') ?? 'type',
          color: (tag.color as string) ?? '#999999',
        };
      });

      // Goals come from custom_* columns in book_indicator_config
      const goals: MonthlyGoals = parseGoals({
        jan: bi.custom_jan,
        feb: bi.custom_feb,
        mar: bi.custom_mar,
        apr: bi.custom_apr,
        may: bi.custom_may,
        jun: bi.custom_jun,
        jul: bi.custom_jul,
        aug: bi.custom_aug,
        sep: bi.custom_sep,
        oct: bi.custom_oct,
        nov: bi.custom_nov,
        dec: bi.custom_dec,
      });

      const missingCount = countMissingGoals(goals);

      return {
        id: bi.id as string,
        indicator_id: bi.indicator_id as string,
        indicator_name: (ind?.name as string) ?? '',
        indicator_format: (ind?.format as BookIndicatorWithGoals['indicator_format']) ?? 'number',
        indicator_direction: (ind?.direction as 'up' | 'down') ?? 'up',
        indicator_calculation_type: (ind?.calculation_type as BookIndicatorWithGoals['indicator_calculation_type']) ?? 'soma',
        indicator_tags: tags,
        display_order: (bi.display_order as number) ?? 0,
        goals,
        has_missing_goals: missingCount > 0,
        missing_goals_count: missingCount,
        current_performance: undefined, // calculated client-side from indicator_data
        is_achieving: undefined,
      };
    });

  const indicatorsWithMissingGoals = indicators.filter((i) => i.has_missing_goals).length;

  return {
    id: row.id as string,
    name: row.name as string,
    year: (row.year as number) ?? new Date().getFullYear(),
    owner,
    description: row.description as string | undefined,
    indicators,
    is_active: (row.is_active as boolean) ?? true,
    total_indicators: indicators.length,
    indicators_with_missing_goals: indicatorsWithMissingGoals,
    overall_performance: undefined,
    indicators_achieving: undefined,
    performance_level: undefined,
    active_quarters: [1, 2, 3, 4],
    current_quarter: Math.ceil((new Date().getMonth() + 1) / 3),
    history: [],
    created_by: (row.created_by as string) ?? '',
    created_by_name: '',
    created_at: new Date(row.created_at as string),
    updated_at: new Date(row.updated_at as string),
  };
}

// =====================================================
// WRITE
// =====================================================

export interface BookFormInput {
  name: string;
  description?: string;
  owner_id: string;
  year: number;
  indicator_ids: string[];
  goals_by_indicator?: Record<string, MonthlyGoals>; // indicator_id → goals
}

export async function createBook(
  input: BookFormInput,
  createdBy: string
): Promise<BackofficeBook | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from('books')
    .insert({
      name: input.name,
      description: input.description,
      owner_id: input.owner_id,
      year: input.year,
    })
    .select()
    .single();

  if (error || !data) {
    console.error('[createBook]', error?.message);
    return null;
  }

  // Add indicators
  if (input.indicator_ids.length > 0) {
    await supabase.from('book_indicator_config').insert(
      input.indicator_ids.map((indicatorId, idx) => {
        const g = input.goals_by_indicator?.[indicatorId] ?? {};
        return {
          book_id: data.id,
          indicator_id: indicatorId,
          display_order: idx + 1,
          custom_jan: g.jan ?? null,
          custom_feb: g.feb ?? null,
          custom_mar: g.mar ?? null,
          custom_apr: g.apr ?? null,
          custom_may: g.may ?? null,
          custom_jun: g.jun ?? null,
          custom_jul: g.jul ?? null,
          custom_aug: g.aug ?? null,
          custom_sep: g.sep ?? null,
          custom_oct: g.oct ?? null,
          custom_nov: g.nov ?? null,
          custom_dec: g.dec ?? null,
        };
      })
    );
  }

  return getBookById(data.id);
}

export async function updateBook(
  id: string,
  input: Partial<BookFormInput>
): Promise<BackofficeBook | null> {
  const supabase = await createClient();

  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name;
  if (input.description !== undefined) payload.description = input.description;
  if (input.year !== undefined) payload.year = input.year;

  if (Object.keys(payload).length > 0) {
    const { error } = await supabase.from('books').update(payload).eq('id', id);
    if (error) {
      console.error('[updateBook]', error.message);
      return null;
    }
  }

  // Re-sync indicators if provided
  if (input.indicator_ids !== undefined) {
    await supabase.from('book_indicator_config').delete().eq('book_id', id);
    if (input.indicator_ids.length > 0) {
      await supabase.from('book_indicator_config').insert(
        input.indicator_ids.map((indicatorId, idx) => {
          const g = input.goals_by_indicator?.[indicatorId] ?? {};
          return {
            book_id: id,
            indicator_id: indicatorId,
            display_order: idx + 1,
            custom_jan: g.jan ?? null,
            custom_feb: g.feb ?? null,
            custom_mar: g.mar ?? null,
            custom_apr: g.apr ?? null,
            custom_may: g.may ?? null,
            custom_jun: g.jun ?? null,
            custom_jul: g.jul ?? null,
            custom_aug: g.aug ?? null,
            custom_sep: g.sep ?? null,
            custom_oct: g.oct ?? null,
            custom_nov: g.nov ?? null,
            custom_dec: g.dec ?? null,
          };
        })
      );
    }
  }

  return getBookById(id);
}

export async function updateBookGoals(
  bookId: string,
  indicatorId: string,
  goals: MonthlyGoals
): Promise<boolean> {
  const supabase = await createClient();

  const { error } = await supabase
    .from('book_indicator_config')
    .update({
      custom_jan: goals.jan ?? null,
      custom_feb: goals.feb ?? null,
      custom_mar: goals.mar ?? null,
      custom_apr: goals.apr ?? null,
      custom_may: goals.may ?? null,
      custom_jun: goals.jun ?? null,
      custom_jul: goals.jul ?? null,
      custom_aug: goals.aug ?? null,
      custom_sep: goals.sep ?? null,
      custom_oct: goals.oct ?? null,
      custom_nov: goals.nov ?? null,
      custom_dec: goals.dec ?? null,
    })
    .eq('book_id', bookId)
    .eq('indicator_id', indicatorId);

  return !error;
}

export async function deleteBook(id: string): Promise<boolean> {
  const supabase = await createClient();
  const { error } = await supabase
    .from('books')
    .update({ is_active: false })
    .eq('id', id);
  return !error;
}
