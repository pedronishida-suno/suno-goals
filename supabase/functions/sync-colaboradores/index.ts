/**
 * sync-colaboradores — Edge Function
 * Syncs the COLABORADORES Monday board → public.users (update only).
 * Cannot create new auth users — only updates existing rows matched by
 * monday_item_id → email → full_name.
 *
 * Fields synced per user:
 *   monday_item_id, full_name, email, is_active, status,
 *   department (área), diretoria, grade, negocio, role (from nivel),
 *   manager_id (resolved from manager_email)
 *
 * POST https://{project}.supabase.co/functions/v1/sync-colaboradores
 */
import {
  makeSupabase,
  mondayGraphQL,
  openSyncLog,
  normalize,
  corsHeaders,
  BOARDS,
  COL_COLABORADORES,
} from '../_shared/monday.ts'

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders() })
  }

  const supabase = makeSupabase()
  const { logId, finish } = await openSyncLog(supabase, 'colaboradores', BOARDS.COLABORADORES)

  try {
    // 1. Fetch all items from the Colaboradores Monday board
    const mondayItems = await fetchColaboradores()

    // 2. Load existing Supabase users for matching
    const { data: existingUsers, error: usersErr } = await supabase
      .from('users')
      .select('id, email, full_name, monday_item_id')

    if (usersErr) {
      await finish('error', { fetched: mondayItems.length, synced: 0, skipped: 0 }, {}, usersErr.message)
      return Response.json({ error: usersErr.message }, { status: 500, headers: corsHeaders() })
    }

    // Build lookup maps for matching Monday items → Supabase user IDs
    const byMondayId = new Map<number, string>()   // monday_item_id → supabase user id
    const byEmail    = new Map<string, string>()   // normalized email → supabase user id
    const byName     = new Map<string, string>()   // normalized full_name → supabase user id

    for (const u of existingUsers ?? []) {
      if (u.monday_item_id) byMondayId.set(Number(u.monday_item_id), u.id)
      if (u.email)          byEmail.set(normalize(u.email), u.id)
      if (u.full_name)      byName.set(normalize(u.full_name), u.id)
    }

    // 3. Build update payloads — two passes needed:
    //    Pass A: map each Monday item → supabase user_id + raw payload (manager_email stored)
    //    Pass B: resolve manager_email → manager_id using the same byEmail map

    type RawUpdate = {
      userId: string
      data: Record<string, unknown>
      manager_email: string | null
    }
    const rawUpdates: RawUpdate[] = []
    const notInSupabase: string[] = []
    let skippedNoIdentity = 0

    for (const item of mondayItems) {
      const mid = Number(item.id)

      // Attempt match: monday_item_id > email > name
      let userId: string | undefined =
        byMondayId.get(mid) ??
        (item.email ? byEmail.get(normalize(item.email)) : undefined) ??
        byName.get(normalize(item.name))

      if (!userId) {
        if (!item.email && !item.name) {
          skippedNoIdentity++
        } else {
          notInSupabase.push(item.email ? `${item.name} <${item.email}>` : item.name)
        }
        continue
      }

      const data: Record<string, unknown> = {
        monday_item_id: mid,
        full_name:      item.name,
        is_active:      item.status !== 'inactive',
        status:         item.status === 'inactive' ? 'inactive' : 'active',
      }

      if (item.email)     data.email     = item.email
      if (item.area)      data.department = item.area
      if (item.diretoria) data.diretoria  = item.diretoria
      if (item.grade)     data.grade      = item.grade
      if (item.negocio)   data.negocio    = item.negocio

      const role = mapRole(item.nivel)
      if (role) data.role = role

      rawUpdates.push({ userId, data, manager_email: item.manager_email })
    }

    // Pass B: resolve manager_id for each update
    type FinalUpdate = { userId: string; data: Record<string, unknown> }
    const updates: FinalUpdate[] = rawUpdates.map(({ userId, data, manager_email }) => {
      if (manager_email) {
        const managerId = byEmail.get(normalize(manager_email))
        if (managerId && managerId !== userId) {
          data.manager_id = managerId
        }
      }
      return { userId, data }
    })

    // 4. Execute updates in chunks of 100
    const CHUNK = 100
    let synced = 0
    const dbErrors: string[] = []

    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK)
      const results = await Promise.allSettled(
        chunk.map(({ userId, data }) =>
          supabase.from('users').update(data).eq('id', userId)
        ),
      )
      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.error) dbErrors.push(r.value.error.message)
          else synced++
        } else {
          dbErrors.push(String(r.reason))
        }
      }
    }

    const finalStatus = dbErrors.length > 0 ? (synced > 0 ? 'partial' : 'error') : 'success'
    await finish(
      finalStatus,
      { fetched: mondayItems.length, synced, skipped: skippedNoIdentity },
      {
        not_in_supabase_count: notInSupabase.length,
        not_in_supabase:       notInSupabase.slice(0, 30),
        db_errors:             dbErrors.slice(0, 5),
      },
      dbErrors[0],
    )

    return Response.json({
      success:               finalStatus !== 'error',
      fetched:               mondayItems.length,
      synced,
      not_in_supabase_count: notInSupabase.length,
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

interface ColaboradorItem {
  id:            string
  name:          string
  email:         string | null
  manager_email: string | null
  status:        'active' | 'inactive' | null
  area:          string | null   // Área / department
  diretoria:     string | null   // Diretoria
  grade:         string | null   // Grade
  negocio:       string | null   // Negócio / Business Unit
  nivel:         string | null   // Nível (used for role mapping)
}

async function fetchColaboradores(): Promise<ColaboradorItem[]> {
  const colIds = Object.values(COL_COLABORADORES)
  const colValuesQ = `column_values(ids: ${JSON.stringify(colIds)}) { id text value }`

  const items: ColaboradorItem[] = []
  let cursor: string | null = null

  while (true) {
    const cursorPart = cursor ? `, cursor: "${cursor}"` : ''
    const query = `
      query {
        boards(ids: [${BOARDS.COLABORADORES}]) {
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

      // Email columns are stored as JSON: { "email": "...", "text": "..." }
      const email         = parseEmailCol(val[COL_COLABORADORES.email],         text[COL_COLABORADORES.email])
      const manager_email = parseEmailCol(val[COL_COLABORADORES.manager_email], text[COL_COLABORADORES.manager_email])

      items.push({
        id:            item.id,
        name:          item.name,
        email,
        manager_email,
        status:        mapStatus(text[COL_COLABORADORES.status]),
        area:          text[COL_COLABORADORES.area]      ?? null,
        diretoria:     text[COL_COLABORADORES.diretoria] ?? null,
        grade:         text[COL_COLABORADORES.grade]     ?? null,
        negocio:       text[COL_COLABORADORES.negocio]   ?? null,
        nivel:         text[COL_COLABORADORES.nivel]     ?? null,
      })
    }

    cursor = page.cursor ?? null
    if (!cursor) break
  }

  return items
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse a Monday email column (stored as JSON or plain text). */
function parseEmailCol(value: string | null | undefined, textFallback: string | null | undefined): string | null {
  if (value) {
    try {
      const parsed = JSON.parse(value) as { email?: string }
      if (parsed.email) return parsed.email
    } catch { /* fall through to text */ }
  }
  return textFallback ?? null
}

function mapStatus(t: string | null): 'active' | 'inactive' | null {
  if (!t) return null
  const l = t.toLowerCase()
  if (l.includes('ativo') || l === 'active') return 'active'
  if (l.includes('inativo') || l === 'inactive') return 'inactive'
  return null
}

function mapRole(t: string | null): 'admin' | 'manager' | 'employee' | null {
  if (!t) return null
  const l = t.toLowerCase()
  if (l.includes('admin') || l.includes('gestor geral') || l.includes('diretor')) return 'admin'
  if (l.includes('gestor') || l.includes('manager') || l.includes('lider') || l.includes('líder') || l.includes('coordenador')) return 'manager'
  if (l.includes('analista') || l.includes('colaborador') || l.includes('employee') || l.includes('assistente')) return 'employee'
  return null
}
