/**
 * sync-resultado-books — Edge Function
 * Syncs the RESULTADO_BOOKS_2025 Monday board → public.indicator_data (monthly real values)
 * and reconciles public.books + public.book_indicators.
 *
 * POST https://{project}.supabase.co/functions/v1/sync-resultado-books
 * Body (optional): { "year": 2025 }
 *
 * Board structure (RESULTADO_BOOKS_2025 — 18397693246):
 *   - text_mm01y6xx     = Nome do Indicador
 *   - text_mm01q1tw     = Chave do indicador
 *   - numeric_mm01efr5  = Alcance ACC Jan 25  (real value)
 *   - numeric_mm016cnq  = Alcance ACC Fev 25
 *   - ...               = months 3–12
 *   - numeric_mm01a1eg  = Alcance ACC Dez 25
 *   - multiple_person_mm02xr6h = Responsável Área (people → book owner)
 */
import {
  makeSupabase,
  mondayGraphQL,
  openSyncLog,
  normalize,
  parseNum,
  corsHeaders,
  BOARDS,
  COL_BOOKS,
} from '../_shared/monday.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  const body = await req.json().catch(() => ({})) as { year?: number }
  const year = body.year ?? 2025

  const supabase = makeSupabase()
  const { logId, finish } = await openSyncLog(
    supabase,
    'resultado_books',
    BOARDS.RESULTADO_BOOKS_2025,
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
    const byName     = new Map<string, string>()
    for (const ind of indicators ?? []) {
      if (ind.monday_item_id) byMondayId.set(Number(ind.monday_item_id), ind.id)
      byName.set(normalize(ind.name), ind.id)
    }

    // 2. Fetch from Monday
    const mondayItems = await fetchResultadoBooks()

    // 3. Build indicator_data upsert rows (monthly real values)
    type DataRow = {
      indicator_id: string
      year: number
      month: number
      real: number
    }
    const dataRows: DataRow[] = []
    const bookIndicatorPairs: Array<{ indicatorId: string; mondayPersonIds: number[] }> = []
    const unmatched: string[] = []

    for (const item of mondayItems) {
      const mid = Number(item.id)
      const indicatorId =
        byMondayId.get(mid) ??
        byName.get(normalize(item.indicatorName)) ??
        byName.get(normalize(item.name))

      if (!indicatorId) {
        unmatched.push(item.indicatorName || item.name)
        continue
      }

      for (const m of item.realMonths) {
        if (m.real == null) continue
        dataRows.push({
          indicator_id: indicatorId,
          year,
          month: m.month,
          real: m.real,
        })
      }

      if (item.responsiblePersonIds.length > 0) {
        bookIndicatorPairs.push({ indicatorId, mondayPersonIds: item.responsiblePersonIds })
      }
    }

    // 4. Upsert indicator_data via RPC (handles partial unique index correctly)
    const CHUNK = 500
    let dataSynced = 0
    const dbErrors: string[] = []

    for (let i = 0; i < dataRows.length; i += CHUNK) {
      const chunk = dataRows.slice(i, i + CHUNK)
      const { data: rpcData, error } = await supabase
        .rpc('monday_upsert_indicator_data', { p_rows: chunk })

      if (error) dbErrors.push(error.message)
      else dataSynced += (rpcData as { upserted: number })?.upserted ?? chunk.length
    }

    // 5. Sync books + book_indicators
    // Load users by monday_item_id to find book owners
    const { data: users } = await supabase
      .from('users')
      .select('id, monday_item_id')
      .not('monday_item_id', 'is', null)

    const userByMondayId = new Map<number, string>()
    for (const u of users ?? []) {
      if (u.monday_item_id) userByMondayId.set(Number(u.monday_item_id), u.id)
    }

    let booksSynced = 0
    let bookIndicatorsSynced = 0

    for (const pair of bookIndicatorPairs) {
      for (const personId of pair.mondayPersonIds) {
        const ownerId = userByMondayId.get(personId)
        if (!ownerId) continue

        // Find or create book for this owner
        const { data: existingBook } = await supabase
          .from('books')
          .select('id')
          .eq('owner_id', ownerId)
          .eq('name', `Resultado Book 2025`)
          .single()

        let bookId: string
        if (existingBook) {
          bookId = existingBook.id
        } else {
          const { data: newBook, error: bookErr } = await supabase
            .from('books')
            .insert({
              owner_id:    ownerId,
              name:        'Resultado Book 2025',
              description: 'Synced from Monday.com Resultado Books 2025 board',
              is_active:   true,
            })
            .select('id')
            .single()

          if (bookErr || !newBook) {
            dbErrors.push(`Book create failed for owner ${ownerId}: ${bookErr?.message}`)
            continue
          }
          bookId = newBook.id
          booksSynced++
        }

        // Upsert book_indicator
        const { error: biErr } = await supabase
          .from('book_indicators')
          .upsert(
            { book_id: bookId, indicator_id: pair.indicatorId },
            { onConflict: 'book_id,indicator_id' },
          )

        if (biErr) dbErrors.push(biErr.message)
        else bookIndicatorsSynced++
      }
    }

    const finalStatus = dbErrors.length > 0 ? (dataSynced > 0 ? 'partial' : 'error') : 'success'
    const totalSynced = dataSynced + booksSynced + bookIndicatorsSynced

    await finish(
      finalStatus,
      { fetched: mondayItems.length, synced: totalSynced, skipped: unmatched.length },
      {
        year,
        data_rows_synced:      dataSynced,
        books_created:         booksSynced,
        book_indicators_synced: bookIndicatorsSynced,
        unmatched_count:       unmatched.length,
        unmatched_sample:      unmatched.slice(0, 10),
        db_errors:             dbErrors.slice(0, 5),
      },
      dbErrors[0],
    )

    return Response.json({
      success:                finalStatus !== 'error',
      fetched:                mondayItems.length,
      data_rows_synced:       dataSynced,
      books_created:          booksSynced,
      book_indicators_synced: bookIndicatorsSynced,
      skipped:                unmatched.length,
      db_errors:              dbErrors,
      log_id:                 logId,
    }, { headers: corsHeaders() })

  } catch (err) {
    const msg = String(err)
    await finish('error', { fetched: 0, synced: 0, skipped: 0 }, {}, msg)
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders() })
  }
})

// ─── Monday fetcher ──────────────────────────────────────────────────────────

interface BooksItem {
  id: string
  name: string
  indicatorName: string
  realMonths: Array<{ month: number; real: number | null }>
  responsiblePersonIds: number[]
}

async function fetchResultadoBooks(): Promise<BooksItem[]> {
  const realMonthIds = COL_BOOKS.realMonths as readonly string[]
  const allColIds = [
    COL_BOOKS.indicatorName,
    COL_BOOKS.indicatorKey,
    COL_BOOKS.responsible,
    ...realMonthIds,
  ]
  const colValuesQ = `column_values(ids: ${JSON.stringify(allColIds)}) { id text value }`

  const items: BooksItem[] = []
  let cursor: string | null = null

  while (true) {
    const cursorPart = cursor ? `, cursor: "${cursor}"` : ''
    const query = `
      query {
        boards(ids: [${BOARDS.RESULTADO_BOOKS_2025}]) {
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
          items: Array<{
            id: string
            name: string
            column_values: Array<{ id: string; text: string | null; value: string | null }>
          }>
        }
      }>
    }
    const data = await mondayGraphQL<Page>(query)
    const page = data.boards[0]?.items_page
    if (!page) break

    for (const item of page.items) {
      const text: Record<string, string | null> = {}
      const val:  Record<string, string | null> = {}
      for (const cv of item.column_values) {
        text[cv.id] = cv.text
        val[cv.id]  = cv.value
      }

      const realMonths = realMonthIds.map((colId, idx) => ({
        month: idx + 1,
        real:  parseNum(val[colId]),
      }))

      const hasData = realMonths.some(m => m.real != null)
      if (!hasData) continue

      // Parse responsible people column
      let responsiblePersonIds: number[] = []
      const peopleVal = val[COL_BOOKS.responsible]
      if (peopleVal) {
        try {
          const parsed = JSON.parse(peopleVal) as { personsAndTeams?: { id: number; kind: string }[] }
          responsiblePersonIds = (parsed.personsAndTeams ?? [])
            .filter(p => p.kind === 'person')
            .map(p => p.id)
        } catch { /* ignore */ }
      }

      const rawName = val[COL_BOOKS.indicatorName]
      const indicatorName = rawName
        ? (() => { try { return String(JSON.parse(rawName)) } catch { return rawName } })()
        : item.name

      items.push({
        id:                   item.id,
        name:                 item.name,
        indicatorName,
        realMonths,
        responsiblePersonIds,
      })
    }

    cursor = page.cursor ?? null
    if (!cursor) break
  }

  return items
}
