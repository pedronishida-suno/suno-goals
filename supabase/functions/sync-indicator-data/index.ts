/**
 * sync-indicator-data — Edge Function
 * Syncs monthly meta/real KPI values from INDICADORES_E_METAS board
 * → public.indicator_data (time-series table).
 *
 * POST https://{project}.supabase.co/functions/v1/sync-indicator-data
 * Body (optional): { "year": 2026 }
 */
import {
  makeSupabase,
  mondayGraphQL,
  openSyncLog,
  normalize,
  parseNum,
  corsHeaders,
  BOARDS,
  COL_2026,
} from '../_shared/monday.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  const body = await req.json().catch(() => ({})) as { year?: number }
  const year = body.year ?? new Date().getFullYear()

  const supabase = makeSupabase()
  const { logId, finish } = await openSyncLog(
    supabase,
    'indicator_data',
    BOARDS.INDICADORES_E_METAS,
    'edge-function',
    { year },
  )

  try {
    // 1. Load indicator lookup from Supabase
    const { data: indicators, error: indErr } = await supabase
      .from('backoffice_indicators')
      .select('id, name, monday_item_id')
      .eq('is_active', true)

    if (indErr) {
      await finish('error', { fetched: 0, synced: 0, skipped: 0 }, {}, indErr.message)
      return Response.json({ error: indErr.message }, { status: 500, headers: corsHeaders() })
    }

    const byMondayId = new Map<number, string>()
    const byName = new Map<string, string>()
    for (const ind of indicators ?? []) {
      if (ind.monday_item_id) byMondayId.set(Number(ind.monday_item_id), ind.id)
      byName.set(normalize(ind.name), ind.id)
    }

    // 2. Fetch from Monday with cursor pagination
    const mondayItems = await fetchIndicatorData(year)

    // 3. Build upsert rows
    const rows: Array<{
      indicator_id: string
      year: number
      month: number
      meta?: number
      real?: number
    }> = []
    const unmatched: string[] = []

    for (const item of mondayItems) {
      const mid = Number(item.id)
      let indicatorId =
        byMondayId.get(mid) ??
        byName.get(normalize(item.indicatorName)) ??
        byName.get(normalize(item.name))

      if (!indicatorId) {
        unmatched.push(item.indicatorName || item.name)
        continue
      }

      for (const m of item.monthly) {
        if (m.meta == null && m.real == null) continue
        const row: typeof rows[number] = {
          indicator_id: indicatorId,
          year,
          month: m.month,
        }
        if (m.meta != null) row.meta = m.meta
        if (m.real != null) row.real = m.real
        rows.push(row)
      }
    }

    if (rows.length === 0) {
      await finish('success', { fetched: mondayItems.length, synced: 0, skipped: unmatched.length }, {
        year,
        unmatched_count: unmatched.length,
        unmatched_sample: unmatched.slice(0, 10),
      })
      return Response.json({ success: true, fetched: mondayItems.length, synced: 0, skipped: unmatched.length, log_id: logId }, { headers: corsHeaders() })
    }

    // 4. Upsert via RPC (handles partial unique index correctly)
    const CHUNK = 500
    let synced = 0
    const dbErrors: string[] = []

    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK)
      const { data: rpcData, error } = await supabase
        .rpc('monday_upsert_indicator_data', { p_rows: chunk })

      if (error) {
        dbErrors.push(error.message)
      } else {
        synced += (rpcData as { upserted: number })?.upserted ?? chunk.length
      }
    }

    const finalStatus = dbErrors.length > 0 ? (synced > 0 ? 'partial' : 'error') : 'success'
    await finish(
      finalStatus,
      { fetched: mondayItems.length, synced, skipped: unmatched.length },
      {
        year,
        rows_prepared: rows.length,
        unmatched_count: unmatched.length,
        unmatched_sample: unmatched.slice(0, 10),
        db_errors: dbErrors.slice(0, 5),
      },
      dbErrors[0],
    )

    return Response.json({
      success: finalStatus !== 'error',
      fetched: mondayItems.length,
      rows_prepared: rows.length,
      synced,
      skipped: unmatched.length,
      db_errors: dbErrors,
      log_id: logId,
    }, { headers: corsHeaders() })

  } catch (err) {
    const msg = String(err)
    await finish('error', { fetched: 0, synced: 0, skipped: 0 }, {}, msg)
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders() })
  }
})

// ─── Monday fetcher ──────────────────────────────────────────────────────────

interface IndicatorItem {
  id: string
  name: string
  indicatorName: string
  monthly: Array<{ month: number; meta: number | null; real: number | null }>
}

async function fetchIndicatorData(_year: number): Promise<IndicatorItem[]> {
  const allColIds = [...COL_2026.meta, ...COL_2026.real, COL_2026.friendlyName, COL_2026.indicatorKey]
  const colValuesQ = `column_values(ids: ${JSON.stringify(allColIds)}) { id value }`

  const items: IndicatorItem[] = []
  let cursor: string | null = null

  while (true) {
    const cursorPart = cursor ? `, cursor: "${cursor}"` : ''
    const query = `
      query {
        boards(ids: [${BOARDS.INDICADORES_E_METAS}]) {
          items_page(limit: 200${cursorPart}) {
            cursor
            items {
              id
              name
              ${colValuesQ}
            }
          }
        }
      }
    `
    type Page = {
      boards: Array<{
        items_page: {
          cursor: string | null
          items: Array<{ id: string; name: string; column_values: Array<{ id: string; value: string | null }> }>
        }
      }>
    }
    const data = await mondayGraphQL<Page>(query)
    const page = data.boards[0]?.items_page
    if (!page) break

    for (const item of page.items) {
      const col: Record<string, string | null> = {}
      for (const cv of item.column_values) col[cv.id] = cv.value

      const monthly = COL_2026.meta.map((metaId, idx) => ({
        month: idx + 1,
        meta:  parseNum(col[metaId]),
        real:  parseNum(col[COL_2026.real[idx]]),
      }))

      const hasData = monthly.some(m => m.meta != null || m.real != null)
      if (!hasData) continue

      const rawName = col[COL_2026.friendlyName]
      const indicatorName = rawName ? String(JSON.parse(rawName)) : item.name

      items.push({ id: item.id, name: item.name, indicatorName, monthly })
    }

    cursor = page.cursor ?? null
    if (!cursor) break
  }

  return items
}
