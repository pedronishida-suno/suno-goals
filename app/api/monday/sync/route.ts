import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { fetchMondayIndicators, normalize } from '@/lib/services/monday';
import { bulkUpsertIndicatorData, type BulkUpsertRow } from '@/lib/services/indicatorData';

/**
 * POST /api/monday/sync
 * Pulls indicator meta/real data from Monday.com and upserts into Supabase indicator_data.
 * Matches Monday items to Supabase indicators by name (case-insensitive).
 *
 * Protected: admin only or service-role bearer token.
 * Body: { year?: number }  — defaults to current year
 */
export async function POST(request: NextRequest) {
  // Auth: admin session or service-role bearer
  const authHeader = request.headers.get('authorization');
  const isServiceCall = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;

  if (!isServiceCall) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }
  }

  const body = await request.json().catch(() => ({}));
  const year: number = body.year ?? new Date().getFullYear();

  // 1. Fetch all indicators from Supabase (id + name for matching)
  const supabase = createServiceClient();
  const { data: supabaseIndicators, error: supabaseError } = await supabase
    .from('backoffice_indicators')
    .select('id, name')
    .eq('is_active', true);

  if (supabaseError) {
    return NextResponse.json({ error: supabaseError.message }, { status: 500 });
  }

  // Build a normalized name → ID map
  const nameToId = new Map<string, string>();
  for (const ind of supabaseIndicators ?? []) {
    nameToId.set(normalize(ind.name), ind.id);
  }

  // 2. Fetch Monday data
  let mondayItems;
  try {
    mondayItems = await fetchMondayIndicators(year);
  } catch (err) {
    return NextResponse.json(
      { error: `Monday.com fetch failed: ${String(err)}` },
      { status: 502 }
    );
  }

  // 3. Match Monday items → Supabase indicator IDs
  const rows: BulkUpsertRow[] = [];
  const unmatched: string[] = [];
  const matched: string[] = [];

  for (const item of mondayItems) {
    // Try matching by Monday "Nome Indicador" text, then by item name
    const candidateNames = [item.indicatorName, item.name].map(normalize);
    let indicatorId: string | undefined;
    for (const candidate of candidateNames) {
      indicatorId = nameToId.get(candidate);
      if (indicatorId) break;
    }

    if (!indicatorId) {
      unmatched.push(item.indicatorName || item.name);
      continue;
    }

    matched.push(item.indicatorName || item.name);

    for (const m of item.monthly) {
      if (m.meta == null && m.real == null) continue;
      rows.push({
        indicator_id: indicatorId,
        year,
        month: m.month,
        ...(m.meta != null ? { meta: m.meta } : {}),
        ...(m.real != null ? { real: m.real } : {}),
      } as BulkUpsertRow);
    }
  }

  // 4. Bulk upsert into Supabase
  const { synced, errors: dbErrors } = rows.length > 0
    ? await bulkUpsertIndicatorData(rows, 'monday-sync')
    : { synced: 0, errors: [] };

  return NextResponse.json({
    success: true,
    year,
    monday_items_fetched: mondayItems.length,
    matched: matched.length,
    unmatched: unmatched.length,
    rows_prepared: rows.length,
    synced,
    db_errors: dbErrors,
    unmatched_names: unmatched.slice(0, 20), // first 20 for debugging
  });
}

