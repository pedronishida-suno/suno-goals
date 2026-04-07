/**
 * sync-colaboradores — Edge Function
 * Syncs the COLABORADORES Monday board → public.users
 *
 * After migration 012 public.users.id is decoupled from auth.users.id,
 * so we can INSERT new users directly with auth_id = null.
 * On first Google login the auth trigger will link them by email.
 *
 * Also auto-creates/updates teams from the Diretoria field.
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

    // ── 3. Auto-create/update teams from unique Diretoria values ─────────────
    const directoriaValues = [
      ...new Set(mondayItems.map(i => i.diretoria).filter(Boolean) as string[]),
    ]

    // Load existing teams by name
    const { data: existingTeams } = await supabase
      .from('teams')
      .select('id, name, monday_diretoria')

    const teamByDiretoria = new Map<string, string>() // normalized diretoria → team_id

    for (const t of existingTeams ?? []) {
      if (t.monday_diretoria) teamByDiretoria.set(normalize(t.monday_diretoria), t.id)
      else if (t.name)        teamByDiretoria.set(normalize(t.name), t.id)
    }

    // Upsert teams that don't exist yet
    for (const diretoria of directoriaValues) {
      const key = normalize(diretoria)
      if (!teamByDiretoria.has(key)) {
        const { data: newTeam } = await supabase
          .from('teams')
          .insert({ name: diretoria, monday_diretoria: diretoria, department: diretoria })
          .select('id')
          .maybeSingle()
        if (newTeam?.id) teamByDiretoria.set(key, newTeam.id)
      }
    }

    // 4. Build update/insert payloads — two passes needed:
    //    Pass A: map each Monday item → supabase user_id + raw payload
    //    Pass B: resolve manager_email → manager_id

    type RawPayload = {
      userId: string | null   // null = new user (needs INSERT)
      data: Record<string, unknown>
      manager_email: string | null
      isNew: boolean
    }
    const rawPayloads: RawPayload[] = []
    let skippedNoIdentity = 0

    for (const item of mondayItems) {
      const mid = Number(item.id)

      // Attempt match: monday_item_id > email > name
      let userId: string | undefined =
        byMondayId.get(mid) ??
        (item.email ? byEmail.get(normalize(item.email)) : undefined) ??
        byName.get(normalize(item.name))

      // Skip items with no identity info
      if (!userId && !item.email && !item.name) {
        skippedNoIdentity++
        continue
      }

      const teamId = item.diretoria
        ? teamByDiretoria.get(normalize(item.diretoria))
        : undefined

      const data: Record<string, unknown> = {
        monday_item_id: mid,
        full_name:      item.name,
        is_active:      item.status !== 'inactive',
        // For updates: only set status if inactive (preserve 'active' for users already logged in).
        // For inserts: status is explicitly set to 'pending' below.
        ...(item.status === 'inactive' ? { status: 'inactive' } : {}),
      }

      if (item.email)     data.email      = item.email
      if (item.area)      data.department = item.area
      if (item.diretoria) data.diretoria  = item.diretoria
      if (item.grade)     data.grade      = item.grade
      if (item.negocio)   data.negocio    = item.negocio
      if (teamId)         data.team_id    = teamId

      const role = mapRole(item.nivel)
      if (role) data.role = role

      rawPayloads.push({
        userId:        userId ?? null,
        data,
        manager_email: item.manager_email,
        isNew:         !userId,
      })

      // Register in lookup maps so managers resolved later can find this user
      if (!userId && item.email) {
        // We'll get the real id after INSERT; use a placeholder key
        byEmail.set(normalize(item.email), '__pending__')
      }
    }

    // Pass B: resolve manager_id
    type FinalPayload = { userId: string | null; data: Record<string, unknown>; isNew: boolean }
    const finalPayloads: FinalPayload[] = rawPayloads.map(({ userId, data, manager_email, isNew }) => {
      if (manager_email) {
        const managerId = byEmail.get(normalize(manager_email))
        if (managerId && managerId !== '__pending__' && managerId !== userId) {
          data.manager_id = managerId
        }
      }
      return { userId, data, isNew }
    })

    // 5. Execute updates and inserts in chunks of 100
    const CHUNK = 100
    let synced = 0
    let inserted = 0
    const dbErrors: string[] = []

    // Split into updates vs inserts
    const updates = finalPayloads.filter(p => !p.isNew && p.userId)
    const inserts = finalPayloads.filter(p => p.isNew)

    // Updates
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK)
      const results = await Promise.allSettled(
        chunk.map(({ userId, data }) =>
          supabase.from('users').update(data).eq('id', userId!)
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

    // Inserts — new users with auth_id = null (migration 012 decoupled id from auth)
    for (let i = 0; i < inserts.length; i += CHUNK) {
      const chunk = inserts.slice(i, i + CHUNK)
      const rows = chunk.map(({ data }) => ({
        ...data,
        auth_id: null,
        status: 'pending',
      }))

      const { error: insertErr, count } = await supabase
        .from('users')
        .insert(rows, { count: 'exact' })

      if (insertErr) {
        dbErrors.push(insertErr.message)
      } else {
        inserted += count ?? chunk.length
      }
    }

    const totalSynced = synced + inserted
    const finalStatus = dbErrors.length > 0
      ? (totalSynced > 0 ? 'partial' : 'error')
      : 'success'

    await finish(
      finalStatus,
      { fetched: mondayItems.length, synced: totalSynced, skipped: skippedNoIdentity },
      {
        updated:    synced,
        inserted,
        teams_synced: teamByDiretoria.size,
        db_errors:  dbErrors.slice(0, 5),
      },
      dbErrors[0],
    )

    return Response.json({
      success:      finalStatus !== 'error',
      fetched:      mondayItems.length,
      updated:      synced,
      inserted,
      teams_synced: teamByDiretoria.size,
      db_errors:    dbErrors,
      log_id:       logId,
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
  diretoria:     string | null   // Diretoria (used for team assignment)
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
