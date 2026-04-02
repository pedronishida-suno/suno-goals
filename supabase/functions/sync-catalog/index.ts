/**
 * sync-catalog — Edge Function
 * Syncs the INDICADORES_E_METAS Monday board → public.backoffice_indicators.
 * Creates / updates indicator catalog entries, matched by monday_item_id.
 *
 * POST https://{project}.supabase.co/functions/v1/sync-catalog
 * Header: Authorization: Bearer <service-role-key>  (optional — checked inside)
 */
import {
  makeSupabase,
  mondayGraphQL,
  openSyncLog,
  parseNum,
  corsHeaders,
  BOARDS,
  COL_2026,
} from '../_shared/monday.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  const supabase = makeSupabase()
  const { logId, finish } = await openSyncLog(supabase, 'catalog', BOARDS.INDICADORES_E_METAS)

  try {
    const items = await fetchCatalog()

    const validItems = items.filter(i => i.friendlyName.trim().length > 0)
    const skipped = items.length - validItems.length

    const { error, count } = await supabase
      .from('backoffice_indicators')
      .upsert(
        validItems.map(item => ({
          monday_item_id:   Number(item.id),
          name:             item.friendlyName,
          description:      item.description || '',
          direction:        item.direction ?? 'up',
          format:           item.format ?? 'number',
          aggregation_type: item.aggregationType ?? 'none',
          status:           item.isActive === false ? 'in_construction' : 'validated',
          data_source:      'monday',
          is_active:        true,
        })),
        { onConflict: 'monday_item_id', count: 'exact' },
      )

    if (error) {
      await finish('error', { fetched: items.length, synced: 0, skipped }, {}, error.message)
      return Response.json({ error: error.message }, { status: 500, headers: corsHeaders() })
    }

    const synced = count ?? validItems.length
    await finish('success', { fetched: items.length, synced, skipped }, {
      valid_items: validItems.length,
      log_id: logId,
    })

    return Response.json({
      success: true,
      fetched: items.length,
      synced,
      skipped,
      log_id: logId,
    }, { headers: corsHeaders() })

  } catch (err) {
    const msg = String(err)
    await finish('error', { fetched: 0, synced: 0, skipped: 0 }, {}, msg)
    return Response.json({ error: msg }, { status: 500, headers: corsHeaders() })
  }
})

// ─── Monday fetcher ──────────────────────────────────────────────────────────

interface CatalogItem {
  id: string
  name: string
  friendlyName: string
  description: string | null
  isActive: boolean | null
  direction: 'up' | 'down' | null
  format: 'percentage' | 'number' | 'currency' | 'hours' | null
  aggregationType: 'sum' | 'average' | 'none' | null
}

async function fetchCatalog(): Promise<CatalogItem[]> {
  const CATALOG_COLS = [
    COL_2026.friendlyName,
    COL_2026.description,
    COL_2026.status,
    COL_2026.direction,
    COL_2026.format,
    COL_2026.aggregationType,
  ]
  const colValuesQ = `column_values(ids: ${JSON.stringify(CATALOG_COLS)}) { id text }`

  const items: CatalogItem[] = []
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
          items: Array<{ id: string; name: string; column_values: Array<{ id: string; text: string | null }> }>
        }
      }>
    }
    const data = await mondayGraphQL<Page>(query)
    const page = data.boards[0]?.items_page
    if (!page) break

    for (const item of page.items) {
      const col: Record<string, string | null> = {}
      for (const cv of item.column_values) col[cv.id] = cv.text

      items.push({
        id:              item.id,
        name:            item.name,
        friendlyName:    col[COL_2026.friendlyName] ?? item.name,
        description:     col[COL_2026.description] ?? null,
        isActive:        mapStatus(col[COL_2026.status]),
        direction:       mapDirection(col[COL_2026.direction]),
        format:          mapFormat(col[COL_2026.format]),
        aggregationType: mapAggregation(col[COL_2026.aggregationType]),
      })
    }

    cursor = page.cursor ?? null
    if (!cursor) break
  }

  return items
}

function mapStatus(t: string | null): boolean | null {
  if (!t) return null
  const l = t.toLowerCase()
  if (l.includes('ativo') || l === 'active') return true
  if (l.includes('inativo') || l === 'inactive') return false
  return null
}

function mapDirection(t: string | null): 'up' | 'down' | null {
  if (!t) return null
  const l = t.toLowerCase()
  if (l.includes('cima') || l === 'up') return 'up'
  if (l.includes('baixo') || l === 'down') return 'down'
  return null
}

function mapFormat(t: string | null): 'percentage' | 'number' | 'currency' | 'hours' | null {
  if (!t) return null
  if (t === '%') return 'percentage'
  if (t.startsWith('R$')) return 'currency'
  if (t === '#') return 'number'
  if (t.toLowerCase() === 'h') return 'hours'
  return null
}

function mapAggregation(t: string | null): 'sum' | 'average' | 'none' | null {
  if (!t) return null
  const l = t.toLowerCase()
  if (l.includes('soma') || l === 'sum') return 'sum'
  if (l.includes('média') || l.includes('media') || l === 'average') return 'average'
  return null
}
