/**
 * sync-books — Edge Function
 * Syncs approved book configurations from the Novos Books / Alteração
 * Colaboradores Monday board (3954357576) → public.books + public.book_indicator_config.
 *
 * Only processes items where color8 (Status Vigência do Book) = "Criado".
 *
 * Matching strategy:
 *   - User:      Novos Books email → public.users.email
 *   - Indicator: Parse base name from "Name: (filters…)" → match backoffice_indicators.name
 *
 * POST https://{project}.supabase.co/functions/v1/sync-books
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
  COL_NOVOS_BOOKS,
} from '../_shared/monday.ts'

const BOOK_STATUS_ACTIVE = 'Criado'
const INDICATOR_SLOTS = [
  { key: COL_NOVOS_BOOKS.ind1Key, weight: COL_NOVOS_BOOKS.ind1Weight },
  { key: COL_NOVOS_BOOKS.ind2Key, weight: COL_NOVOS_BOOKS.ind2Weight },
  { key: COL_NOVOS_BOOKS.ind3Key, weight: COL_NOVOS_BOOKS.ind3Weight },
  { key: COL_NOVOS_BOOKS.ind4Key, weight: COL_NOVOS_BOOKS.ind4Weight },
] as const

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  const body = await req.json().catch(() => ({})) as { year?: number }
  const year = body.year ?? 2026

  const supabase = makeSupabase()
  const { logId, finish } = await openSyncLog(supabase, 'books', BOARDS.NOVOS_BOOKS, 'edge-function', { year })

  try {
    // 1. Load all active indicators for name matching
    const { data: indicators, error: indErr } = await supabase
      .from('backoffice_indicators')
      .select('id, name')
      .eq('is_active', true)

    if (indErr) {
      await finish('error', { fetched: 0, synced: 0, skipped: 0 }, {}, indErr.message)
      return Response.json({ error: indErr.message }, { status: 500, headers: corsHeaders() })
    }

    // Build indicator lookup: normalized name → id
    const indByName = new Map<string, string>()
    for (const ind of indicators ?? []) {
      indByName.set(normalize(ind.name ?? ''), ind.id)
    }

    // 2. Load all users for email matching
    const { data: users, error: usersErr } = await supabase
      .from('users')
      .select('id, email')

    if (usersErr) {
      await finish('error', { fetched: 0, synced: 0, skipped: 0 }, {}, usersErr.message)
      return Response.json({ error: usersErr.message }, { status: 500, headers: corsHeaders() })
    }

    const userByEmail = new Map<string, string>()
    for (const u of users ?? []) {
      if (u.email) userByEmail.set(normalize(u.email), u.id)
    }

    // 3. Fetch active book configs from Monday
    const mondayItems = await fetchActiveBooks()

    // 4. Process each book config
    let booksSynced = 0
    let bookConfigsSynced = 0
    const dbErrors: string[] = []
    const unmatched: string[] = []

    for (const item of mondayItems) {
      // Resolve user
      const userId = item.email ? userByEmail.get(normalize(item.email)) : undefined
      if (!userId) {
        unmatched.push(`user:${item.email ?? item.name}`)
        continue
      }

      // Resolve indicators (skip empty slots)
      type SlotMatch = { indicatorId: string; weight: number | null; displayOrder: number }
      const matched: SlotMatch[] = []
      for (let i = 0; i < item.slots.length; i++) {
        const slot = item.slots[i]
        if (!slot.keyText) continue
        const baseName = parseIndicatorBaseName(slot.keyText)
        const indicatorId = indByName.get(normalize(baseName)) ?? indByName.get(normalize(slot.keyText))
        if (!indicatorId) {
          unmatched.push(`ind:${slot.keyText}`)
          continue
        }
        matched.push({ indicatorId, weight: slot.weight, displayOrder: i + 1 })
      }

      if (matched.length === 0) continue

      // Upsert book for this user + year
      const { data: existingBook } = await supabase
        .from('books')
        .select('id')
        .eq('owner_id', userId)
        .eq('year', year)
        .maybeSingle()

      let bookId: string

      if (existingBook?.id) {
        bookId = existingBook.id
        // Update book metadata
        await supabase
          .from('books')
          .update({ name: `Book ${year}`, is_active: true, updated_at: new Date().toISOString() })
          .eq('id', bookId)
      } else {
        const { data: newBook, error: bookErr } = await supabase
          .from('books')
          .insert({
            owner_id:    userId,
            name:        `Book ${year}`,
            year,
            description: `Synced from Monday.com Novos Books board (item ${item.id})`,
            is_active:   true,
          })
          .select('id')
          .single()

        if (bookErr || !newBook) {
          dbErrors.push(`Book create failed for ${item.email}: ${bookErr?.message}`)
          continue
        }
        bookId = newBook.id
        booksSynced++
      }

      // Sync book_indicator_config rows: delete stale + upsert fresh
      // First, get current indicator IDs for this book
      const { data: currentConfigs } = await supabase
        .from('book_indicator_config')
        .select('id, indicator_id')
        .eq('book_id', bookId)

      const currentIndIds = new Set((currentConfigs ?? []).map(c => c.indicator_id as string))
      const newIndIds = new Set(matched.map(m => m.indicatorId))

      // Remove indicators no longer in the book
      const toRemove = (currentConfigs ?? []).filter(c => !newIndIds.has(c.indicator_id as string))
      if (toRemove.length > 0) {
        await supabase
          .from('book_indicator_config')
          .delete()
          .in('id', toRemove.map(c => c.id))
      }

      // Upsert remaining
      for (const slot of matched) {
        const isNew = !currentIndIds.has(slot.indicatorId)
        if (isNew) {
          const { error: biErr } = await supabase
            .from('book_indicator_config')
            .insert({
              book_id:       bookId,
              indicator_id:  slot.indicatorId,
              display_order: slot.displayOrder,
            })
          if (biErr) dbErrors.push(biErr.message)
          else bookConfigsSynced++
        } else {
          // Update display_order if changed
          const { error: biErr } = await supabase
            .from('book_indicator_config')
            .update({ display_order: slot.displayOrder })
            .eq('book_id', bookId)
            .eq('indicator_id', slot.indicatorId)
          if (biErr) dbErrors.push(biErr.message)
          else bookConfigsSynced++
        }
      }
    }

    const finalStatus = dbErrors.length > 0 ? (booksSynced + bookConfigsSynced > 0 ? 'partial' : 'error') : 'success'
    await finish(
      finalStatus,
      { fetched: mondayItems.length, synced: booksSynced + bookConfigsSynced, skipped: 0 },
      {
        year,
        books_created:         booksSynced,
        book_configs_synced:   bookConfigsSynced,
        unmatched_count:       unmatched.length,
        unmatched_sample:      unmatched.slice(0, 20),
        db_errors:             dbErrors.slice(0, 5),
      },
      dbErrors[0],
    )

    return Response.json({
      success:               finalStatus !== 'error',
      fetched:               mondayItems.length,
      books_created:         booksSynced,
      book_configs_synced:   bookConfigsSynced,
      unmatched_count:       unmatched.length,
      unmatched_sample:      unmatched.slice(0, 20),
      db_errors:             dbErrors,
      log_id:                logId,
    }, { headers: corsHeaders() })

  } catch (err) {
    const msg = String(err)
    await finish('error', { fetched: 0, synced: 0, skipped: 0 }, {}, msg)
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders() })
  }
})

// ─── Monday fetcher ──────────────────────────────────────────────────────────

interface BookConfigItem {
  id:    string
  name:  string
  email: string | null
  slots: Array<{ keyText: string | null; weight: number | null }>
}

async function fetchActiveBooks(): Promise<BookConfigItem[]> {
  const allColIds = Object.values(COL_NOVOS_BOOKS)
  const colValuesQ = `column_values(ids: ${JSON.stringify(allColIds)}) { id type text value }`

  const items: BookConfigItem[] = []
  let cursor: string | null = null

  while (true) {
    const cursorPart = cursor ? `, cursor: "${cursor}"` : ''
    const query = `
      query {
        boards(ids: [${BOARDS.NOVOS_BOOKS}]) {
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
            column_values: Array<{ id: string; type: string; text: string | null; value: string | null }>
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

      // Skip items that haven't been approved/created yet
      const status = text[COL_NOVOS_BOOKS.statusBook]
      if (status !== BOOK_STATUS_ACTIVE) continue

      // Parse email — email type columns use JSON { "email": "...", "text": "..." }
      const email = parseEmailValue(val[COL_NOVOS_BOOKS.email], text[COL_NOVOS_BOOKS.email])

      // Build indicator slots
      const slots = INDICATOR_SLOTS.map(slot => ({
        keyText: text[slot.key] ?? null,
        weight:  parseNum(val[slot.weight]),
      }))

      items.push({ id: item.id, name: item.name, email, slots })
    }

    cursor = page.cursor ?? null
    if (!cursor) break
  }

  return items
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEmailValue(value: string | null | undefined, textFallback: string | null | undefined): string | null {
  if (value) {
    try {
      const parsed = JSON.parse(value) as { email?: string }
      if (parsed.email) return parsed.email
    } catch { /* fall through */ }
  }
  return textFallback ?? null
}

/**
 * Extract the base indicator name from the Novos Books compound key format.
 * Input:  "Receita: (Regime_Gerencial; Área_Consultoria; ...)"
 * Output: "Receita"
 *
 * If there's no ":" separator, returns the full text trimmed.
 */
function parseIndicatorBaseName(keyText: string): string {
  const colonIdx = keyText.indexOf(':')
  if (colonIdx === -1) return keyText.trim()
  return keyText.slice(0, colonIdx).trim()
}
