import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  fetchColaboradores,
  normalize,
  MONDAY_BOARDS,
  type MondayColaboradorItem,
} from '@/lib/services/monday';

/**
 * POST /api/monday/sync-colaboradores
 *
 * Fetches all items from the COLABORADORES board and updates matching rows
 * in public.users (matched by monday_item_id → email → full_name).
 *
 * IMPORTANT: This route only UPDATES existing users. It cannot INSERT new
 * auth users — that requires supabase.auth.admin.inviteUserByEmail(), which
 * is out of scope. Unmatched Monday items are recorded in the sync log
 * metadata as `not_in_supabase` for admin visibility.
 *
 * Protected: admin session or service-role bearer token.
 * Body: (none required)
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
      .eq('id', user.id)
      .single();

    if (userData?.role !== 'admin') {
      return NextResponse.json({ error: 'Admin role required' }, { status: 403 });
    }
    triggeredBy = user.id;
  }

  const supabase = createServiceClient();

  // ── Open sync log entry ─────────────────────────────────────────────────────
  const { data: logRow } = await supabase
    .from('monday_sync_log')
    .insert({
      sync_type:    'colaboradores',
      board_id:     MONDAY_BOARDS.COLABORADORES,
      triggered_by: triggeredBy,
      status:       'started',
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
        items_fetched:  counts.fetched,
        items_synced:   counts.synced,
        items_skipped:  counts.skipped,
        error_detail:   errorDetail ?? null,
        metadata:       meta,
        finished_at:    new Date().toISOString(),
      })
      .eq('id', logId);
  };

  // ── Fetch from Monday ───────────────────────────────────────────────────────
  let mondayItems: MondayColaboradorItem[];
  try {
    mondayItems = await fetchColaboradores();
  } catch (err) {
    await finishLog('error', { fetched: 0, synced: 0, skipped: 0 }, {}, String(err));
    return NextResponse.json(
      { error: `Monday.com fetch failed: ${String(err)}` },
      { status: 502 }
    );
  }

  // ── Build lookup maps from existing Supabase users ──────────────────────────
  const { data: existingUsers } = await supabase
    .from('users')
    .select('id, email, full_name, monday_item_id');

  const byMondayId = new Map<number, string>();  // monday_item_id → user.id
  const byEmail    = new Map<string, string>();  // normalize(email) → user.id
  const byName     = new Map<string, string>();  // normalize(full_name) → user.id

  for (const u of existingUsers ?? []) {
    if (u.monday_item_id) byMondayId.set(Number(u.monday_item_id), u.id);
    if (u.email)          byEmail.set(normalize(u.email), u.id);
    if (u.full_name)      byName.set(normalize(u.full_name), u.id);
  }

  // ── Match + build update payloads ───────────────────────────────────────────
  type UpdatePayload = {
    userId: string;
    data: Record<string, unknown>;
  };

  const updateRows: UpdatePayload[] = [];
  const notInSupabase: string[] = [];  // Monday items with no matching Supabase user

  let matchedByMondayId = 0;
  let matchedByEmail    = 0;
  let matchedByName     = 0;
  let skippedNoIdentity = 0;

  for (const item of mondayItems) {
    // Try to match in priority order
    let userId: string | undefined;

    const mid = Number(item.id);
    if (byMondayId.has(mid)) {
      userId = byMondayId.get(mid);
      matchedByMondayId++;
    } else if (item.email && byEmail.has(normalize(item.email))) {
      userId = byEmail.get(normalize(item.email));
      matchedByEmail++;
    } else if (byName.has(normalize(item.name))) {
      userId = byName.get(normalize(item.name));
      matchedByName++;
    }

    if (!userId) {
      if (!item.email && !item.name) {
        skippedNoIdentity++;
      } else {
        notInSupabase.push(item.email ? `${item.name} <${item.email}>` : item.name);
      }
      continue;
    }

    const payload: Record<string, unknown> = {
      monday_item_id: mid,
      full_name:      item.name,
      is_active:      mapUserStatus(item.status) !== 'inactive',
    };
    if (item.email)      payload.email      = item.email;
    if (item.department) payload.department = item.department;

    const mappedRole = mapRole(item.role);
    if (mappedRole) payload.role = mappedRole;

    const mappedStatus = mapUserStatus(item.status);
    if (mappedStatus) payload.status = mappedStatus;

    updateRows.push({ userId, data: payload });
  }

  // ── Batch update in chunks of 100 ───────────────────────────────────────────
  const dbErrors: string[] = [];
  let updatedCount = 0;
  const CHUNK = 100;

  for (let i = 0; i < updateRows.length; i += CHUNK) {
    const chunk = updateRows.slice(i, i + CHUNK);
    const results = await Promise.allSettled(
      chunk.map(({ userId, data }) =>
        supabase.from('users').update(data).eq('id', userId)
      )
    );
    for (const result of results) {
      if (result.status === 'fulfilled') {
        if (result.value.error) {
          dbErrors.push(result.value.error.message);
        } else {
          updatedCount++;
        }
      } else {
        dbErrors.push(String(result.reason));
      }
    }
  }

  // ── Close sync log ──────────────────────────────────────────────────────────
  const finalStatus = dbErrors.length > 0
    ? (updatedCount > 0 ? 'partial' : 'error')
    : 'success';

  await finishLog(
    finalStatus,
    { fetched: mondayItems.length, synced: updatedCount, skipped: skippedNoIdentity },
    {
      matched_by_monday_id: matchedByMondayId,
      matched_by_email:     matchedByEmail,
      matched_by_name:      matchedByName,
      not_in_supabase_count: notInSupabase.length,
      not_in_supabase:      notInSupabase.slice(0, 50),
      db_errors:            dbErrors.slice(0, 10),
    },
    dbErrors[0]
  );

  return NextResponse.json({
    success:               finalStatus !== 'error',
    monday_items_fetched:  mondayItems.length,
    matched_by_monday_id:  matchedByMondayId,
    matched_by_email:      matchedByEmail,
    matched_by_name:       matchedByName,
    updated:               updatedCount,
    not_in_supabase_count: notInSupabase.length,
    not_in_supabase:       notInSupabase.slice(0, 20),
    skipped_no_identity:   skippedNoIdentity,
    db_errors:             dbErrors,
    log_id:                logId,
  });
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function mapRole(text: string | null): 'admin' | 'manager' | 'employee' | null {
  if (!text) return null;
  const l = text.toLowerCase();
  if (l.includes('admin') || l.includes('gestor geral')) return 'admin';
  if (
    l.includes('gestor') || l.includes('manager') ||
    l.includes('lider')  || l.includes('líder')
  ) return 'manager';
  if (l.includes('analista') || l.includes('colaborador') || l.includes('employee')) return 'employee';
  return null;  // unknown → don't overwrite existing role
}

function mapUserStatus(text: string | null): 'active' | 'inactive' | 'pending' | null {
  if (!text) return null;
  const l = text.toLowerCase();
  if (l.includes('ativo') || l === 'active')     return 'active';
  if (l.includes('inativo') || l === 'inactive') return 'inactive';
  return null;  // unknown → don't overwrite existing status
}
