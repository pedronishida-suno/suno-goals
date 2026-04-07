import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  fetchResultadoBooks,
  normalize,
  MONDAY_BOARDS,
  type MondayBooksItem,
} from '@/lib/services/monday';
import { bulkUpsertIndicatorData, type BulkUpsertRow } from '@/lib/services/indicatorData';

/**
 * POST /api/monday/sync-books
 *
 * Pulls indicator data from the RESULTADO_BOOKS_2025 board and upserts it
 * into the indicator_data table. Uses the same match-by-name strategy as
 * /api/monday/sync, with an additional match by monday_item_id for boards
 * that share item IDs with INDICADORES_E_METAS.
 *
 * Protected: admin session or service-role bearer token.
 * Body: { year?: number }  — defaults to 2025 (matches board name)
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // ── Auth ────────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get('authorization');
  const isServiceCall = authHeader === `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`;
  let triggeredBy = 'service';

  if (!isServiceCall) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { data: userData } = await supabase
      .from('users')
      .select('role')
      .eq('auth_id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }
    triggeredBy = user.id;
  }

  const body = await request.json().catch(() => ({}));
  const year: number = body.year ?? 2025;

  const supabase = createServiceClient();

  // ── Open sync log entry ─────────────────────────────────────────────────────
  const { data: logRow } = await supabase
    .from('monday_sync_log')
    .insert({
      sync_type:    'resultado_books',
      board_id:     MONDAY_BOARDS.RESULTADO_BOOKS_2025,
      triggered_by: triggeredBy,
      status:       'started',
      metadata:     { year },
    })
    .select('id')
    .single();
  const logId: string | undefined = logRow?.id;

  const finishLog = async (
    status: 'success' | 'partial' | 'error',
    counts: { fetched: number; synced: number; skipped: number },
    meta: Record<string, unknown>,
    errorDetail?: string
  ) => {
    if (!logId) return;
    await supabase
      .from('monday_sync_log')
      .update({
        status,
        items_fetched: counts.fetched,
        items_synced:  counts.synced,
        items_skipped: counts.skipped,
        error_detail:  errorDetail ?? null,
        metadata:      meta,
        finished_at:   new Date().toISOString(),
      })
      .eq('id', logId);
  };

  // ── Load indicator lookup maps from Supabase ────────────────────────────────
  const { data: supabaseIndicators, error: supabaseError } = await supabase
    .from('backoffice_indicators')
    .select('id, name, monday_item_id')
    .eq('is_active', true);

  if (supabaseError) {
    await finishLog('error', { fetched: 0, synced: 0, skipped: 0 }, {}, supabaseError.message);
    return NextResponse.json({ error: supabaseError.message }, { status: 500 });
  }

  const nameToId      = new Map<string, string>();  // normalize(name) → indicator UUID
  const mondayIdToId  = new Map<number, string>();  // monday_item_id → indicator UUID

  for (const ind of supabaseIndicators ?? []) {
    nameToId.set(normalize(ind.name), ind.id);
    if (ind.monday_item_id) mondayIdToId.set(Number(ind.monday_item_id), ind.id);
  }

  // ── Fetch from Monday ───────────────────────────────────────────────────────
  let mondayItems: MondayBooksItem[];
  try {
    mondayItems = await fetchResultadoBooks(year);
  } catch (err) {
    await finishLog('error', { fetched: 0, synced: 0, skipped: 0 }, {}, String(err));
    return NextResponse.json(
      { error: `Monday.com fetch failed: ${String(err)}` },
      { status: 502 }
    );
  }

  // ── Match Monday items → Supabase indicator IDs ─────────────────────────────
  const rows: BulkUpsertRow[] = [];
  const unmatched: string[]   = [];
  const matched:   string[]   = [];

  for (const item of mondayItems) {
    // Priority: monday_item_id → indicatorName → item.name
    let indicatorId: string | undefined =
      mondayIdToId.get(Number(item.id)) ??
      nameToId.get(normalize(item.indicatorName)) ??
      nameToId.get(normalize(item.name));

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

  // ── Bulk upsert ──────────────────────────────────────────────────────────────
  const { synced, errors: dbErrors } = rows.length > 0
    ? await bulkUpsertIndicatorData(rows, 'monday-sync-books')
    : { synced: 0, errors: [] };

  // ── Close sync log ──────────────────────────────────────────────────────────
  const finalStatus = dbErrors.length > 0
    ? (synced > 0 ? 'partial' : 'error')
    : 'success';

  await finishLog(
    finalStatus,
    { fetched: mondayItems.length, synced, skipped: unmatched.length },
    {
      year,
      matched:         matched.length,
      unmatched:       unmatched.length,
      rows_prepared:   rows.length,
      unmatched_names: unmatched.slice(0, 20),
      db_errors:       dbErrors.slice(0, 10),
    },
    dbErrors[0]
  );

  return NextResponse.json({
    success:              finalStatus !== 'error',
    year,
    monday_items_fetched: mondayItems.length,
    matched:              matched.length,
    unmatched:            unmatched.length,
    rows_prepared:        rows.length,
    synced,
    db_errors:            dbErrors,
    unmatched_names:      unmatched.slice(0, 20),
    log_id:               logId,
  });
}
